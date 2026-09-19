"use client";

import { useEffect, useState } from "react";
import { get, onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";

export type LiveAccount = {
    accountId: string;
    userId?: string;
    productId?: string;
    productName?: string;
    mt5Account?: string | number;
    currency?: string;
    balance?: number;
    equity?: number;
    floatingProfit?: number;
    peakEquity?: number;
    drawdown?: number;
    status?: string;
    lastHeartbeatAt?: number;
    broker?: string;
    server?: string;
    isPrimary?: boolean;
    accountType?: string;
    accountNumber?: string;
    settingsAccountId?: string;
    hasHeartbeat: boolean;
};

export type TradeRecord = {
    ticket?: string | number;
    symbol?: string;
    type?: string;
    volume?: number;
    openPrice?: number;
    closePrice?: number | null;
    profit?: number;
    commission?: number;
    swap?: number;
    openedAt?: number;
    closedAt?: number | null;
    accountId?: string;
};

export type EquityPoint = {
    timestamp: number;
    balance: number;
    equity: number;
};

export function useUserTradingData(userId: string | undefined) {
    const [accounts, setAccounts] = useState<LiveAccount[]>([]);
    const [trades, setTrades] = useState<TradeRecord[]>([]);
    const [equitySeries, setEquitySeries] = useState<EquityPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!userId) {
            const t = setTimeout(() => setLoading(false), 0);
            return () => clearTimeout(t);
        }

        const accountsRef = ref(database, "live_accounts");
        const settingsRef = ref(database, `users/${userId}/mt5Accounts`);

        let latestLive: LiveAccount[] = [];
        let latestSettings: LiveAccount[] = [];

        const apply = () => {
            setAccounts([...latestSettings, ...latestLive]);
        };

        const offLive = onValue(accountsRef, (snap) => {
            const data = snap.val() || {};
            latestLive = Object.entries(data)
                .map(
                    ([accountId, val]) =>
                        ({ accountId, ...(val as Partial<LiveAccount>), hasHeartbeat: true }) as LiveAccount
                )
                .filter((a) => a && String(a.userId ?? "") === userId);
            apply();
        });

        // Include MT5 accounts configured in Settings even before the first
        // heartbeat arrives, so connected accounts are always recognized.
        const offSettings = onValue(settingsRef, (snap) => {
            const settingsVal = snap.val() || {};
            const liveNumbers = new Set(
                latestLive.map((a) => String(a.mt5Account ?? "").trim() || a.accountId)
            );
            latestSettings = Object.entries(settingsVal)
                .map(([id, val]) => {
                    const item = (val ?? {}) as Record<string, unknown>;
                    return {
                        accountId: `settings_${id}`,
                        settingsAccountId: id,
                        mt5Account: String(item.accountNumber ?? "").trim(),
                        accountNumber: String(item.accountNumber ?? "").trim(),
                        broker: String(item.broker ?? ""),
                        server: String(item.server ?? ""),
                        currency: String(item.currency ?? ""),
                        accountType: String(item.accountType ?? ""),
                        isPrimary: item.isPrimary === true,
                        status: "configured",
                        hasHeartbeat: false,
                    } as LiveAccount;
                })
                .filter((a) => a.mt5Account && !liveNumbers.has(String(a.mt5Account)));
            apply();
        });

        return () => {
            offLive();
            offSettings();
        };
    }, [userId]);

    useEffect(() => {
        if (accounts.length === 0) {
            const t = setTimeout(() => {
                setTrades([]);
                setEquitySeries([]);
                setLoading(false);
            }, 0);
            return () => clearTimeout(t);
        }

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const tradeLists = await Promise.all(
                    accounts.map(async (account) => {
                        const snap = await get(ref(database, `trades/${account.accountId}`));
                        const data = snap.val() || {};
                        return Object.entries(data).map(
                            ([ticket, val]) =>
                                ({ ticket, ...(val as Partial<TradeRecord>) }) as TradeRecord
                        );
                    })
                );
                if (cancelled) return;
                setTrades(tradeLists.flat());

                const equityLists = await Promise.all(
                    accounts.map(async (account) => {
                        const snap = await get(ref(database, `live_equity/${account.accountId}`));
                        const data = snap.val() || {};
                        return Object.entries(data).map(([timestamp, val]) => {
                            const v = val as Partial<EquityPoint>;
                            return {
                                timestamp: Number(v?.timestamp ?? timestamp),
                                balance: Number(v?.balance ?? 0),
                                equity: Number(v?.equity ?? 0),
                            } as EquityPoint;
                        });
                    })
                );
                if (cancelled) return;

                const merged = new Map<number, EquityPoint>();
                for (const list of equityLists) {
                    for (const point of list) {
                        const existing = merged.get(point.timestamp);
                        if (existing) {
                            merged.set(point.timestamp, {
                                timestamp: point.timestamp,
                                balance: existing.balance + point.balance,
                                equity: existing.equity + point.equity,
                            });
                        } else {
                            merged.set(point.timestamp, point);
                        }
                    }
                }
                const sorted = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
                setEquitySeries(sorted.slice(-60));
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load trading data.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();

        return () => {
            cancelled = true;
        };
    }, [accounts]);

    return { accounts, liveAccounts: accounts.filter((a) => a.hasHeartbeat), trades, equitySeries, loading, error };
}