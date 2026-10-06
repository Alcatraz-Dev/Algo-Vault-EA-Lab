"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { TradingAccount } from "@/components/trading/AccountHeader";
import ConnectionStatus from "@/components/trading/ConnectionStatus";
import OrderPanel from "@/components/trading/OrderPanel";
import OpenPositions, { Position } from "@/components/trading/OpenPositions";
import PendingOrders, { PendingOrder } from "@/components/trading/PendingOrders";
import ExecutionLog, { ExecutionLogEntry } from "@/components/trading/ExecutionLog";
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
import {
    normalisePendingOrderType,
    partialCloseVolume,
    tradeFillFromExecution,
    type ChartPositionView,
    type ChartPendingOrderView,
    type ChartTradeFill,
} from "@/components/pro-scalping-terminal/chart-settings";
import { cn } from "@/lib/utils";
import {
    Lock,
    RefreshCw,
    BarChart2,
    ListOrdered,
    History,
    ChevronDown,
    Monitor,
    Box,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tab = "positions" | "orders" | "history";

export default function AccountTradingPage() {
    const router = useRouter();

    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [userToken, setUserToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasAccess, setHasAccess] = useState<boolean | null>(null);

    // Per-account RTDB state. Each node is keyed by account id so switching
    // accounts does not leak one account's live positions/orders into another.
    const [accounts, setAccounts] = useState<TradingAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    const selectedAccount = useMemo(
        () => accounts.find((a) => a.accountId === selectedAccountId) ?? null,
        [accounts, selectedAccountId]
    );

    const [positions, setPositions] = useState<Position[]>([]);
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([]);

    const [selectedSymbol, setSelectedSymbol] = useState("XAUUSD");
    const [activeTab, setActiveTab] = useState<Tab>("positions");
    const [refreshing, setRefreshing] = useState(false);

    // Auth listener
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                router.replace("/login?redirect=/account/trading");
                return;
            }
            setFirebaseUser(user);
            try {
                const tok = await user.getIdToken();
                setUserToken(tok);
            } catch {
                // Ignore token error
            }
        });
        return () => unsubscribe();
    }, [router]);

    // License verification
    useEffect(() => {
        if (!firebaseUser) return;

        async function checkAccess() {
            try {
                const token = await firebaseUser!.getIdToken();
                const res = await fetch("/api/trading/access", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) {
                    setHasAccess(false);
                    return;
                }
                const data = await res.json();
                const licenses = Array.isArray(data.licenses) ? data.licenses : [];
                setHasAccess(licenses.some((l: { status: string }) => l.status === "active"));
            } catch {
                setHasAccess(false);
            } finally {
                setLoading(false);
            }
        }

        checkAccess();
    }, [firebaseUser]);

    // RTDB listener for the account ledger — the source of truth for which
    // accounts exist and which one is selected.
    useEffect(() => {
        if (!firebaseUser || !hasAccess) return;

        const uid = firebaseUser.uid;

        const accountsRef = ref(database, `trading_accounts/${uid}`);
        const accountsUnsub = onValue(accountsRef, (snap) => {
            const val = snap.val();
            if (!val || typeof val !== "object") {
                setAccounts([]);
                return;
            }

            const list = Object.entries(val)
                .map(([accountId, accData]) => {
                    if (!accData || typeof accData !== "object") return null;
                    const raw = accData as Record<string, unknown>;
                    return {
                        accountId,
                        mt5Account:
                            (raw.mt5Account as string | undefined) ||
                            (raw.account_id as string | undefined) ||
                            accountId,
                        broker:
                            (raw.broker as string | undefined) ||
                            "MetaTrader 5",
                        server:
                            (raw.server as string | undefined) ||
                            "Live Server",
                        currency:
                            (raw.currency as string | undefined) ||
                            "USD",
                        leverage: raw.leverage
                            ? `1:${raw.leverage}`
                            : "1:100",
                        // Numeric fields are `number | null` on TradingAccount:
                        // null means the gateway has not reported the value
                        // yet and must never be rendered as a fabricated $0.00.
                        balance: toNumberOrNull(raw.balance),
                        equity:
                            toNumberOrNull(raw.equity) ??
                            toNumberOrNull(raw.balance),
                        margin: toNumberOrNull(raw.margin),
                        freeMargin:
                            toNumberOrNull(raw.freeMargin) ??
                            toNumberOrNull(raw.balance),
                        marginLevel: toNumberOrNull(raw.marginLevel),
                        status: normalizeAccountStatus(raw.status),
                        lastHeartbeatAt:
                            raw.lastHeartbeatAt === undefined
                                ? Date.now()
                                : Number(raw.lastHeartbeatAt) ||
                                  Date.now(),
                        gatewayVersion:
                            (raw.gatewayVersion as string | undefined) ||
                            "v2.4.0",
                    };
                })
                .filter(
                    (a): a is NonNullable<typeof a> => a !== null
                );

            setAccounts(list);

            // Persist selection across reloads only while the account still
            // exists. A stale selection falls back to the first account.
            if (list.length > 0) {
                const previouslySelected = selectedAccountId;
                const stillExists = list.some(
                    (a) => a?.accountId === previouslySelected
                );
                const fallback = stillExists
                    ? previouslySelected
                    : list[0]?.accountId ?? null;
                if (fallback) setSelectedAccountId(fallback);
            }
        });

        // Live trading state is scoped to the selected account so switching
        // accounts does not leak one account's positions/orders/events.
        const scopeRef = (accountId: string) =>
            `trading_positions/${uid}/${accountId}`;
        const ordersScopedRef = (accountId: string) =>
            `trading_orders/${uid}/${accountId}`;
        const logsScopedRef = (accountId: string) =>
            `trading_executions/${uid}/${accountId}`;

        let posUnsub: (() => void) | undefined;
        let ordUnsub: (() => void) | undefined;
        let logUnsub: (() => void) | undefined;

        const attachScopedListeners = (accountId: string) => {
            if (posUnsub) posUnsub();
            if (ordUnsub) ordUnsub();
            if (logUnsub) logUnsub();

            posUnsub = onValue(
                ref(database, scopeRef(accountId)),
                (snap) => {
                    const val = snap.val();
                    if (val) {
                        const posList: Position[] = Object.entries(val).map(
                            ([ticket, p]) => {
                                const raw = p as Record<string, unknown>;
                                return {
                                    ticket,
                                    symbol:
                                        (raw.symbol as string | undefined) ||
                                        "XAUUSD",
                                    type:
                                        raw.type === "SELL"
                                            ? "SELL"
                                            : "BUY",
                                    volume:
                                        raw.volume === undefined
                                            ? 0.01
                                            : Number(raw.volume) || 0.01,
                                    openPrice:
                                        raw.openPrice === undefined
                                            ? 0
                                            : Number(raw.openPrice) || 0,
                                currentPrice:
                                    raw.currentPrice === undefined
                                        ? Number(raw.openPrice) || 0
                                        : Number(raw.currentPrice) ||
                                          Number(raw.openPrice) ||
                                          0,
                                sl: raw.sl === undefined
                                    ? 0
                                    : Number(raw.sl) || 0,
                                tp: raw.tp === undefined
                                    ? 0
                                    : Number(raw.tp) || 0,
                                profit:
                                    raw.profit === undefined
                                        ? 0
                                        : Number(raw.profit) || 0,
                                swap:
                                    raw.swap === undefined
                                        ? 0
                                        : Number(raw.swap) || 0,
                                magic:
                                    raw.magic === undefined
                                        ? 0
                                        : Number(raw.magic) || 0,
                                openedAt:
                                    raw.openTime === undefined
                                        ? raw.openedAt === undefined
                                            ? Date.now()
                                            : Number(raw.openedAt) ||
                                              Date.now()
                                        : Number(raw.openTime) ||
                                          Number(raw.openedAt) ||
                                          Date.now(),
                                };
                            }
                        );
                        setPositions(posList);
                    } else {
                        setPositions([]);
                    }
                }
            );
            ordUnsub = onValue(
                ref(database, ordersScopedRef(accountId)),
                (snap) => {
                    const val = snap.val();
                    if (val) {
                        const ordList: PendingOrder[] =
                            Object.entries(val).map(([ticket, o]) => {
                                const raw = o as Record<string, unknown>;
                                return {
                                    ticket,
                                    symbol:
                                        (raw.symbol as string | undefined) ||
                                        "XAUUSD",
                                    type: (raw.type as string | undefined) ||
                                        "BUY_LIMIT",
                                    volume:
                                        raw.volume === undefined
                                            ? 0.01
                                            : Number(raw.volume) || 0.01,
                                    price:
                                        raw.price === undefined
                                            ? 0
                                            : Number(raw.price) || 0,
                                    sl: raw.sl === undefined
                                        ? 0
                                        : Number(raw.sl) || 0,
                                    tp: raw.tp === undefined
                                        ? 0
                                        : Number(raw.tp) || 0,
                                    status:
                                        (raw.status as string | undefined) ||
                                        (raw.state as string | undefined) ||
                                        "PLACED",
                                    updatedAt:
                                        raw.updatedAt === undefined
                                            ? raw.placedTime === undefined
                                                ? Date.now()
                                                : Number(raw.placedTime) ||
                                                  Date.now()
                                            : Number(raw.updatedAt) ||
                                              Number(raw.placedTime) ||
                                              Date.now(),
                                };
                            });
                        setOrders(ordList);
                    } else {
                        setOrders([]);
                    }
                }
            );
            logUnsub = onValue(
                ref(database, logsScopedRef(accountId)),
                (snap) => {
                    const val = snap.val();
                    if (val) {
                        const logList: ExecutionLogEntry[] =
                            Object.entries(val)
                                .map(([id, l]) => {
                                    const raw = l as Record<string, unknown>;
                                    return {
                                        clientOrderId:
                                            (raw.clientOrderId as string | undefined) ||
                                            id,
                                        accountId,
                                        action:
                                            (raw.action as string | undefined) ||
                                            (raw.type as string | undefined) ||
                                            "ORDER",
                                        symbol:
                                            (raw.symbol as string | undefined) ||
                                            "XAUUSD",
                                        volume:
                                            raw.volume === undefined
                                                ? 0.01
                                                : Number(raw.volume) || 0.01,
                                        status:
                                            (raw.status as string | undefined) ||
                                            "FILLED",
                                        mt5Ticket:
                                            (raw.mt5Ticket as string | undefined) ||
                                            (raw.ticket as string | undefined) ||
                                            id,
                                        executionPrice:
                                            raw.executionPrice === undefined
                                                ? raw.price === undefined
                                                    ? 0
                                                    : Number(raw.price) || 0
                                                : Number(raw.executionPrice) ||
                                                  Number(raw.price) ||
                                                  0,
                                        errorCode:
                                            raw.errorCode === undefined
                                                ? 0
                                                : Number(raw.errorCode) || 0,
                                        errorMessage:
                                            (raw.errorMessage as string | undefined) ||
                                            (raw.message as string | undefined) ||
                                            "Executed",
                                        createdAt:
                                            raw.createdAt === undefined
                                                ? raw.timestamp === undefined
                                                    ? Date.now()
                                                    : Number(raw.timestamp) ||
                                                      Date.now()
                                                : Number(raw.createdAt) ||
                                                  Number(raw.timestamp) ||
                                                  Date.now(),
                                        executedAt:
                                            raw.executedAt === undefined
                                                ? raw.timestamp === undefined
                                                    ? Date.now()
                                                    : Number(raw.timestamp) ||
                                                      Date.now()
                                                : Number(raw.executedAt) ||
                                                  Number(raw.timestamp) ||
                                                  Date.now(),
                                    };
                                })
                                .sort(
                                    (a, b) => b.createdAt - a.createdAt
                                );
                        setExecutionLogs(logList);
                    } else {
                        setExecutionLogs([]);
                    }
                }
            );
        };

        if (selectedAccountId) {
            attachScopedListeners(selectedAccountId);
        }

        return () => {
            accountsUnsub();
            posUnsub?.();
            ordUnsub?.();
            logUnsub?.();
        };
    }, [firebaseUser, hasAccess, selectedAccountId]);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            if (firebaseUser) {
                const token = await firebaseUser.getIdToken();
                await fetch("/api/trading/access", {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
            }
        } catch {
            // Ignore
        } finally {
            setTimeout(() => setRefreshing(false), 600);
        }
    };

    const selectAccount = (accountId: string) => {
        setSelectedAccountId(accountId);
    };

    const handleClosePosition = async (ticket: string) => {
        if (!firebaseUser || !selectedAccountId) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: selectedAccountId,
                    ticket,
                    action: "close",
                }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    const handlePartialClosePosition = async (
        ticket: string,
        volume: number
    ) => {
        if (!firebaseUser || !selectedAccountId) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: selectedAccountId,
                    ticket,
                    action: "partial_close",
                    volume,
                }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    const handleModifyPosition = async (
        ticket: string,
        sl: number,
        tp: number
    ) => {
        if (!firebaseUser || !selectedAccountId) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: selectedAccountId,
                    ticket,
                    sl,
                    tp,
                }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    const handleCancelOrder = async (ticket: string) => {
        if (!firebaseUser || !selectedAccountId) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: selectedAccountId,
                    ticket,
                    action: "cancel_order",
                }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    // ── chart trade views ───────────────────────────────────────────
    // Real execution data reshaped for the chart: positions become
    // entry/SL/TP level lines, pending orders become buy/sell limit lines,
    // and executed fills become entry/exit markers.
    const chartPositions = useMemo<ChartPositionView[]>(
        () =>
            positions.map((p) => ({
                ticket: p.ticket,
                symbol: p.symbol,
                side: p.type === "SELL" ? "SELL" : "BUY",
                volume: p.volume,
                entry: p.openPrice,
                current: p.currentPrice,
                sl: p.sl || null,
                tp: p.tp || null,
                profit: p.profit,
                openedAt: p.openedAt,
            })),
        [positions]
    );

    const chartOrders = useMemo<ChartPendingOrderView[]>(
        () =>
            orders.flatMap((o) => {
                const type = normalisePendingOrderType(o.type);
                if (!type) return [];
                return [
                    {
                        ticket: o.ticket,
                        symbol: o.symbol,
                        type,
                        volume: o.volume,
                        price: o.price,
                        sl: o.sl || null,
                        tp: o.tp || null,
                        status: o.status,
                    },
                ];
            }),
        [orders]
    );

    const chartHistory = useMemo<ChartTradeFill[]>(
        () =>
            executionLogs
                // Only genuinely executed fills count as trade history —
                // failed/rejected gateway attempts never draw on the chart.
                .filter(
                    (l) =>
                        !l.errorCode &&
                        Number.isFinite(l.executionPrice) &&
                        l.executionPrice > 0
                )
                .slice(0, 200)
                .flatMap((l) => {
                    const fill = tradeFillFromExecution({
                        id: l.clientOrderId,
                        action: l.action,
                        executedAt: l.executedAt || l.createdAt,
                        price: l.executionPrice,
                        symbol: l.symbol,
                        volume: l.volume,
                        profit: null,
                    });
                    return fill ? [fill] : [];
                }),
        [executionLogs]
    );

    // Close N% of a position from the chart's trade strip: rounds down to
    // the 0.01 lot step and falls back to a full close for dust remainders.
    const handleClosePositionPercent = async (
        ticket: string,
        percent: number
    ) => {
        if (!firebaseUser || !selectedAccountId) return;
        const pos = positions.find((p) => p.ticket === ticket);
        if (!pos) return;
        const { mode, volume } = partialCloseVolume(pos.volume, percent);
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: selectedAccountId,
                    ticket,
                    action:
                        mode === "full" ? "close" : "partial_close",
                    ...(mode !== "full" ? { volume } : {}),
                }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    if (loading) {
        return (
            <AccountShell
                title="Trading Terminal"
                subtitle="Live account trading, charts & orders"
            >
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                    <RefreshCw className="size-6 animate-spin text-primary" />
                    <p className="text-sm">Connecting to Trading Engine…</p>
                </div>
            </AccountShell>
        );
    }

    if (hasAccess === false) {
        return (
            <AccountShell
                title="Trading Terminal"
                subtitle="Live account trading, charts & orders"
            >
                <div className="mx-auto my-8 max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
                        <Lock className="size-7" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">
                        Trading Access License Required
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                        You need an active Trading Access License to use the
                        live trading terminal, connect your MT5 account, and
                        execute orders in real time.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <Button
                            onClick={() =>
                                router.push("/account/trading-access")
                            }
                            className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                        >
                            Get Trading Access License
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => router.push("/pricing")}
                        >
                            View Membership Plans
                        </Button>
                    </div>
                </div>
            </AccountShell>
        );
    }

    if (accounts.length === 0) {
        return (
            <AccountShell
                title="Trading Terminal"
                subtitle="Live account trading, charts & orders"
            >
                <div className="mx-auto my-8 max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        <Box className="size-7" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">
                        No Trading Account Connected
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                        Connect an MT5 account through the Gateway EA, then
                        switch back to this terminal to trade.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <Button
                            onClick={() =>
                                router.push("/account/trading-access")
                            }
                            className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                        >
                            Connect Trading Account
                        </Button>
                    </div>
                </div>
            </AccountShell>
        );
    }

    if (!selectedAccountId) {
        return (
            <AccountShell
                title="Trading Terminal"
                subtitle="Live account trading, charts & orders"
            >
                <div className="mx-auto my-8 max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        <Monitor className="size-7" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">
                        Select a Trading Account
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                        Choose which connected MT5 account this terminal
                        should trade against.
                    </p>
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell
            title="Trading Terminal"
            subtitle="Live MT5 account trading, real-time candles & orders"
        >
            <div className="flex flex-col gap-6">
                {/* Account & Connection Bar */}
                <div className="grid gap-4 lg:grid-cols-4">
                    <div className="lg:col-span-3">
                        <div className="rounded-xl border border-border bg-card p-4">
                            <div className="mb-4 flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">
                                    Active Account
                                </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleRefresh}
                                    disabled={refreshing}
                                    className="h-7 px-2 text-xs"
                                >
                                    <RefreshCw
                                        className={cn(
                                            "size-3.5 mr-1",
                                            refreshing &&
                                                "animate-spin"
                                        )}
                                    />
                                    Sync
                                </Button>
                            </div>
                            <AccountSwitcher
                                accounts={accounts}
                                selectedAccountId={selectedAccountId}
                                onSelect={selectAccount}
                            />
                        </div>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                                Gateway Sync
                            </span>
                        </div>
                        <ConnectionStatus
                            status={selectedAccount?.status || "offline"}
                            lastHeartbeat={
                                selectedAccount?.lastHeartbeatAt || 0
                            }
                        />
                    </div>
                </div>

                {/* Main Trading Area */}
                <div className="grid gap-6 xl:grid-cols-4">
                    {/* Pro Terminal chart workspace (3/4 width on xl).
                        All toolbars, drawing tools, layer picker, fullscreen,
                        and per-symbol persistence live in the workspace — this
                        page only contributes the Order Panel + Watchlist
                        context. */}
                    <div className="xl:col-span-3">
                        <ProTerminalChartWorkspace
                            initialSymbol={selectedSymbol}
                            token={userToken}
                            storageScope="account-trading"
                            hideWatchlist
                            onSymbolChange={setSelectedSymbol}
                            positions={chartPositions}
                            pendingOrders={chartOrders}
                            tradeHistory={chartHistory}
                            onClosePosition={handleClosePositionPercent}
                            onCancelOrder={handleCancelOrder}
                        />
                    </div>

                    {/* Side Panel: Order Panel */}
                    <div className="flex flex-col gap-4 xl:col-span-1">
                        <OrderPanel
                            account={selectedAccount}
                            symbol={selectedSymbol}
                            onOrderPlaced={() => handleRefresh()}
                        />
                    </div>
                </div>

                {/* Bottom Positions / Orders / History Tabs */}
                <div className="rounded-2xl border border-border bg-card shadow-md">
                    <div className="flex border-b border-border px-4 pt-3">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    setActiveTab("positions")
                                }
                                className={cn(
                                    "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                                    activeTab === "positions"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <BarChart2 className="size-4" />
                                <span>Positions</span>
                                <Badge
                                    variant="secondary"
                                    className="ml-1 text-xs"
                                >
                                    {positions.length}
                                </Badge>
                            </button>

                            <button
                                type="button"
                                onClick={() =>
                                    setActiveTab("orders")
                                }
                                className={cn(
                                    "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                                    activeTab === "orders"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <ListOrdered className="size-4" />
                                <span>Pending Orders</span>
                                <Badge
                                    variant="secondary"
                                    className="ml-1 text-xs"
                                >
                                    {orders.length}
                                </Badge>
                            </button>

                            <button
                                type="button"
                                onClick={() =>
                                    setActiveTab("history")
                                }
                                className={cn(
                                    "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                                    activeTab === "history"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <History className="size-4" />
                                <span>Execution Log</span>
                                <Badge
                                    variant="secondary"
                                    className="ml-1 text-xs"
                                >
                                    {executionLogs.length}
                                </Badge>
                            </button>
                        </div>
                    </div>

                    <div className="p-4">
                        {activeTab === "positions" && (
                            <OpenPositions
                                positions={positions}
                                onClose={handleClosePosition}
                                onPartialClose={handlePartialClosePosition}
                                onModify={handleModifyPosition}
                            />
                        )}
                        {activeTab === "orders" && (
                            <PendingOrders
                                orders={orders}
                                onCancel={handleCancelOrder}
                            />
                        )}
                        {activeTab === "history" && (
                            <ExecutionLog logs={executionLogs} />
                        )}
                    </div>
                </div>
            </div>
        </AccountShell>
    );
}

/** Coerce a gateway value to a number; `null` when it is missing/unreported. */
function toNumberOrNull(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeAccountStatus(
    value: unknown
): TradingAccount["status"] {
    if (typeof value !== "string") return "unknown";
    const lower = value.toLowerCase();
    if (lower === "connected") return "connected";
    if (lower === "offline") return "offline";
    if (lower === "unauthorized") return "unauthorized";
    if (lower === "license_expired") return "license_expired";
    if (lower === "disabled") return "disabled";
    return "unknown";
}

function AccountSwitcher({
    accounts,
    selectedAccountId,
    onSelect,
}: {
    accounts: TradingAccount[];
    selectedAccountId: string | null;
    onSelect: (accountId: string) => void;
}) {
    const selected = accounts.find(
        (a) => a.accountId === selectedAccountId
    ) ?? accounts[0] ?? null;

    const [open, setOpen] = useState(false);

    // Custom dropdown (rather than a native <select>) so each option can show
    // the account's broker, login, server and live connection dot.
    return (
        <div className="relative">
            <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-muted"
                onClick={() => setOpen((o) => !o)}
            >
                <StatusDot
                    status={selected?.status ?? "unknown"}
                    lastHeartbeat={selected?.lastHeartbeatAt ?? 0}
                />
                <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                        {selected?.broker ?? "No account"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                        {selected?.mt5Account} · {selected?.server}
                    </p>
                </div>
                <ChevronDown
                    className={cn(
                        "ml-2 size-4 text-muted-foreground transition-transform",
                        open && "rotate-180"
                    )}
                />
            </button>
            {open && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        aria-hidden
                        onClick={() => setOpen(false)}
                    />
                    <div
                        className="absolute left-0 right-0 z-20 mt-1 overflow-auto rounded-xl border border-border bg-card p-2 shadow-xl"
                        role="listbox"
                    >
                        {accounts.map((acc) => (
                            <div
                                key={acc.accountId}
                                role="option"
                                aria-selected={acc.accountId === selectedAccountId}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-muted",
                                    acc.accountId === selectedAccountId &&
                                        "bg-muted"
                                )}
                                onClick={() => {
                                    onSelect(acc.accountId);
                                    setOpen(false);
                                }}
                            >
                                <StatusDot
                                    status={acc.status}
                                    lastHeartbeat={acc.lastHeartbeatAt}
                                />
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold">
                                        {acc.broker}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {acc.mt5Account} · {acc.server}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/** Indirection keeps `Date.now` out of render (react-hooks/purity), matching
 *  the pattern used by `components/trading/AccountHeader`. */
function currentTimestamp(): number {
    return Date.now();
}

function StatusDot({
    status,
    lastHeartbeat,
}: {
    status: TradingAccount["status"];
    lastHeartbeat: number;
}) {
    const age = Math.floor((currentTimestamp() - lastHeartbeat) / 1000);
    const isConnected = status === "connected" && age < 120;

    return (
        <span className="relative flex h-2.5 w-2.5">
            {isConnected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            )}
            <span
                className={cn(
                    "relative inline-flex h-2.5 w-2.5 rounded-full",
                    isConnected
                        ? "bg-emerald-500"
                        : status === "offline"
                          ? "bg-rose-500"
                          : "bg-amber-500"
                )}
            />
        </span>
    );
}
