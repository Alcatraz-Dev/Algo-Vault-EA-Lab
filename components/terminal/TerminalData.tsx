"use client";

/**
 * TerminalData — the terminal's shared subscriptions (Phase 5 §37).
 *
 * One fetch per source for the whole workspace. Panels do NOT poll on their
 * own; they read this context. The chart keeps its own candle feed (it needs
 * a much higher rate), and every other panel — intelligence, event feed,
 * watchlist, positions, risk, chat — renders from these payloads.
 *
 * Update cadence is deliberate and slow (8–30s): the underlying engines are
 * analytical, not tick-level, and the panels show freshness honestly rather
 * than pretending to be real-time (Phase 5 §38).
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import { useThrottledAuthedFetch, useAuthToken, useNow } from "@/lib/scalping/client";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
import type { Position } from "@/components/trading/OpenPositions";
import type { PendingOrder } from "@/components/trading/PendingOrders";
import type { TradingAccount } from "@/components/trading/AccountHeader";
import type { TerminalEvent } from "@/lib/terminal/types";
import { deriveAccountMode } from "@/lib/terminal/account";
import {
    buildEventFeed,
    riskEvents,
    signalEvents,
    structureEvents,
    sweepEvents,
    zoneEvents,
} from "@/lib/terminal/events";
import { useTerminal } from "./TerminalContext";

export type HudRiskStatus = "SAFE" | "WARNING" | "RESTRICTED" | "HALTED";

export interface RiskPayload {
    status: HudRiskStatus | null;
    reasons: string[];
    limits: {
        emergencyStop: boolean;
        maxDailyLossPercent: number | null;
        maxDrawdownPercent: number | null;
        maxOpenPositions: number | null;
        requireStopLoss: boolean;
        riskPercent: number | null;
    } | null;
    metrics: {
        balance: number | null;
        equity: number | null;
        usedMargin: number | null;
        availableMargin: number | null;
        floatingPnL: number | null;
        drawdownPct: number | null;
        dailyLossPct: number | null;
        openPositions: number | null;
        symbolExposureLots: number | null;
        halted: boolean;
    } | null;
    accountId: string | null;
    fetchedAt?: number;
}

export interface TerminalQuote {
    symbol?: string;
    bid?: number;
    ask?: number;
    changePercent?: number;
    timestamp?: number;
}

export interface TerminalDataValue {
    token: string | null;
    uid: string | null;
    /* market */
    quotes: Record<string, TerminalQuote>;
    quotesUpdatedAt: number | null;
    quotesError: string | null;
    quotesLoading: boolean;
    analysis: AdvancedAnalysisResult | null;
    analysisUpdatedAt: number | null;
    analysisError: string | null;
    analysisLoading: boolean;
    signals: TerminalSignal[];
    signalsUpdatedAt: number | null;
    signalsError: string | null;
    /* account */
    account: TradingAccount | null;
    positions: Position[];
    orders: PendingOrder[];
    accountLoading: boolean;
    risk: RiskPayload | null;
    riskError: string | null;
    riskLoading: boolean;
    /* derived */
    events: TerminalEvent[];
    lastPrice: number | null;
    changePct: number | null;
}

const TerminalDataContext = createContext<TerminalDataValue | null>(null);

export function useTerminalData(): TerminalDataValue {
    const ctx = useContext(TerminalDataContext);
    if (!ctx) throw new Error("useTerminalData must be used inside <TerminalDataProvider>");
    return ctx;
}

/** Non-throwing read for panels that can render without data. */
export function useOptionalTerminalData(): TerminalDataValue | null {
    return useContext(TerminalDataContext);
}

type QuotesPayload = { quotes?: Record<string, TerminalQuote> };
type AnalysisPayload = { analysis?: AdvancedAnalysisResult };
type SignalsPayload = { signals?: TerminalSignal[] };

const QUOTE_POLL_MS = 10_000;
const ANALYSIS_POLL_MS = 15_000;
const SIGNAL_POLL_MS = 20_000;
const RISK_POLL_MS = 30_000;

export function TerminalDataProvider({ children }: { children: ReactNode }) {
    const { state, setAccountMode } = useTerminal();
    const { symbol, timeframe, watchlist } = state;
    const token = useAuthToken();
    // One shared clock drives every cache-busting tick — Date.now() is never
    // called during render (react-hooks/purity). Each source gets its own
    // cadence so a cheap quote refresh never drags the analysis pipeline
    // along with it (Phase 5 §37).
    const now = useNow(5_000);
    const quoteTick = Math.floor(now / 10_000);
    const analysisTick = Math.floor(now / 30_000);
    const signalTick = Math.floor(now / 60_000);
    const riskTick = Math.floor(now / 60_000);

    const symbolsParam = useMemo(() => watchlist.join(","), [watchlist]);

    const quotesUrl = `/api/analytics/watchlist?symbols=${encodeURIComponent(symbolsParam)}&t=${quoteTick}`;
    const analysisUrl = `/api/analysis/intelligence?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&t=${analysisTick}`;
    const signalsUrl = `/api/scalping/signals?symbols=${encodeURIComponent(symbolsParam)}&t=${signalTick}`;
    const riskUrl = `/api/terminal/risk?symbol=${encodeURIComponent(symbol)}&t=${riskTick}`;

    const quotes = useThrottledAuthedFetch<QuotesPayload>(quotesUrl, { minIntervalMs: QUOTE_POLL_MS });
    const analysis = useThrottledAuthedFetch<AnalysisPayload>(analysisUrl, { minIntervalMs: ANALYSIS_POLL_MS });
    const signals = useThrottledAuthedFetch<SignalsPayload>(signalsUrl, { minIntervalMs: SIGNAL_POLL_MS });
    const risk = useThrottledAuthedFetch<RiskPayload>(riskUrl, { minIntervalMs: RISK_POLL_MS });

    /* ── account / positions / orders (RTDB, same paths as the trade page) ── */
    const [user, setUser] = useState<User | null>(null);
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    const [account, setAccount] = useState<TradingAccount | null>(null);
    const [positions, setPositions] = useState<Position[]>([]);
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [accountLoading, setAccountLoading] = useState(true);

    /* eslint-disable react-hooks/set-state-in-effect -- Firebase auth/RTDB listeners: subscriptions can only be attached after the resolved session changes, and the callbacks that follow are the sanctioned place for setState. */
    useEffect(() => {
        if (!user) {
            setAccount(null);
            setPositions([]);
            setOrders([]);
            setAccountLoading(false);
            setAccountMode("unknown");
            return;
        }
        setAccountLoading(true);
        const uid = user.uid;
        const accountRef = ref(database, `trading_accounts/${uid}`);
        const posRef = ref(database, `trading_positions/${uid}`);
        const ordersRef = ref(database, `trading_orders/${uid}`);

        const unsubs = [
            onValue(accountRef, (snap) => {
                const val = snap.val() as Record<string, Record<string, unknown>> | null;
                const firstKey = val ? Object.keys(val)[0] : null;
                const acc = firstKey ? val?.[firstKey] : null;
                if (!acc) {
                    setAccount(null);
                    setAccountMode("unknown");
                } else {
                    const hb = Number(acc.lastHeartbeatAt) || 0;
                    // Absent broker fields stay null. `|| 0` / `|| "connected"`
                    // turned "not reported yet" into a plausible-looking zero
                    // and a healthy-looking status, so an account that had
                    // never reported read as connected with a real balance.
                    const num = (value: unknown): number | null =>
                        value === undefined || value === null || value === ""
                            ? null
                            : Number.isFinite(Number(value))
                              ? Number(value)
                              : null;
                    const knownStatus = ["connected", "disconnected", "degraded", "halted"];
                    const rawStatus = typeof acc.status === "string" ? acc.status.toLowerCase() : "";
                    setAccount({
                        accountId: firstKey as string,
                        mt5Account: String(acc.mt5Account || acc.account_id || firstKey),
                        broker: acc.broker ? String(acc.broker) : "MetaTrader 5",
                        server: acc.server ? String(acc.server) : "Live Server",
                        currency: acc.currency ? String(acc.currency) : "USD",
                        leverage: acc.leverage ? `1:${acc.leverage}` : "1:100",
                        balance: num(acc.balance),
                        equity: num(acc.equity),
                        margin: num(acc.margin),
                        freeMargin: num(acc.freeMargin),
                        marginLevel: num(acc.marginLevel),
                        status: (knownStatus.includes(rawStatus)
                            ? rawStatus
                            : "unknown") as TradingAccount["status"],
                        lastHeartbeatAt: hb,
                        gatewayVersion: String(acc.gatewayVersion || ""),
                    });
                    setAccountMode(deriveAccountMode(acc));
                }
                setAccountLoading(false);
            }),
            onValue(posRef, (snap) => {
                const val = snap.val() as Record<string, Record<string, unknown>> | null;
                if (!val) {
                    setPositions([]);
                    return;
                }
                setPositions(
                    Object.entries(val).map(([ticket, p]) => ({
                        ticket,
                        symbol: String(p.symbol || ""),
                        type: p.type === "SELL" ? "SELL" : "BUY",
                        volume: Number(p.volume) || 0,
                        openPrice: Number(p.openPrice) || 0,
                        currentPrice: Number(p.currentPrice) || Number(p.openPrice) || 0,
                        sl: Number(p.sl) || 0,
                        tp: Number(p.tp) || 0,
                        profit: Number(p.profit) || 0,
                        swap: Number(p.swap) || 0,
                        magic: Number(p.magic) || 0,
                        openedAt: Number(p.openTime || p.openedAt) || 0,
                    }))
                );
            }),
            onValue(ordersRef, (snap) => {
                const val = snap.val() as Record<string, Record<string, unknown>> | null;
                if (!val) {
                    setOrders([]);
                    return;
                }
                setOrders(
                    Object.entries(val).map(([ticket, o]) => ({
                        ticket,
                        symbol: String(o.symbol || ""),
                        type: String(o.type || "BUY_LIMIT"),
                        volume: Number(o.volume) || 0,
                        price: Number(o.price) || 0,
                        sl: Number(o.sl) || 0,
                        tp: Number(o.tp) || 0,
                        status: String(o.status || o.state || "PLACED"),
                        updatedAt: Number(o.updatedAt || o.placedTime) || 0,
                    }))
                );
            }),
        ];
        const teardown = unsubs;
        return () => {
            for (const u of teardown) u();
        };
    }, [user, setAccountMode]);
    /* eslint-enable react-hooks/set-state-in-effect */

    /* ── derived ─────────────────────────────────────────────────────────── */

    const quoteMap = useMemo(() => quotes.data?.quotes ?? {}, [quotes.data]);
    const activeQuote = quoteMap[symbol];
    const radarLike = activeQuote;

    const lastPrice = typeof radarLike?.bid === "number" && Number.isFinite(radarLike.bid) ? radarLike.bid : null;
    const changePct =
        typeof radarLike?.changePercent === "number" && Number.isFinite(radarLike.changePercent)
            ? radarLike.changePercent
            : null;

    const events = useMemo<TerminalEvent[]>(() => {
        const a = analysis.data?.analysis ?? null;
        return buildEventFeed([
            structureEvents(a, timeframe),
            sweepEvents(a, timeframe),
            zoneEvents(a, timeframe),
            signalEvents(signals.data?.signals ?? []),
            riskEvents(
                risk.data?.status && risk.data.status !== "SAFE"
                    ? {
                          symbol,
                          timeframe,
                          timestamp: risk.data.fetchedAt ?? now,
                          reasons: risk.data.reasons ?? [],
                          halted: risk.data.status === "HALTED",
                      }
                    : null
            ),
        ]);
    }, [analysis.data, signals.data, risk.data, symbol, timeframe, now]);

    const value = useMemo<TerminalDataValue>(
        () => ({
            token,
            uid: user?.uid ?? null,
            quotes: quoteMap,
            quotesUpdatedAt: quotes.lastUpdated,
            quotesError: quotes.error,
            quotesLoading: quotes.loading,
            analysis: analysis.data?.analysis ?? null,
            analysisUpdatedAt: analysis.lastUpdated,
            analysisError: analysis.error,
            analysisLoading: analysis.loading,
            signals: signals.data?.signals ?? [],
            signalsUpdatedAt: signals.lastUpdated,
            signalsError: signals.error,
            account,
            positions,
            orders,
            accountLoading,
            risk: risk.data,
            riskError: risk.error,
            riskLoading: risk.loading,
            events,
            lastPrice,
            changePct,
        }),
        [
            user,
            token,
            quoteMap,
            quotes.lastUpdated,
            quotes.error,
            quotes.loading,
            analysis.data,
            analysis.lastUpdated,
            analysis.error,
            analysis.loading,
            signals.data,
            signals.lastUpdated,
            signals.error,
            account,
            positions,
            orders,
            accountLoading,
            risk.data,
            risk.error,
            risk.loading,
            events,
            lastPrice,
            changePct,
        ]
    );

    return <TerminalDataContext.Provider value={value}>{children}</TerminalDataContext.Provider>;
}
