"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref, off } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import AccountHeader, { TradingAccount } from "@/components/trading/AccountHeader";
import ConnectionStatus from "@/components/trading/ConnectionStatus";
import Watchlist from "@/components/trading/Watchlist";
import OrderPanel from "@/components/trading/OrderPanel";
import OpenPositions, { Position } from "@/components/trading/OpenPositions";
import PendingOrders, { PendingOrder } from "@/components/trading/PendingOrders";
import ExecutionLog, { ExecutionLogEntry } from "@/components/trading/ExecutionLog";
import { ProTerminalChart } from "@/components/pro-scalping-terminal/ProTerminalChart";
import { LayerPicker } from "@/components/pro-scalping-terminal/LayerPicker";
import {
    CHART_LAYERS,
    TERMINAL_TIMEFRAMES,
    type ChartLayerId,
} from "@/components/pro-scalping-terminal/chart-layers";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";
import {
    Lock,
    RefreshCw,
    SlidersHorizontal,
    BarChart2,
    ListOrdered,
    History,
    ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tab = "positions" | "orders" | "history";

const cleanSymbol = (s: string): SupportedSymbol => {
    const raw = s.replace(/^(FX|CRYPTO|INDICES|FOREX):/, "");
    return (raw as SupportedSymbol) || "XAUUSD";
};

export default function AccountTradingPage() {
    const router = useRouter();

    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [userToken, setUserToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasAccess, setHasAccess] = useState<boolean | null>(null);

    const [account, setAccount] = useState<TradingAccount | null>(null);
    const [positions, setPositions] = useState<Position[]>([]);
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([]);

    const [selectedSymbol, setSelectedSymbol] = useState("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("M5");
    const [activeTab, setActiveTab] = useState<Tab>("positions");
    const [refreshing, setRefreshing] = useState(false);

    // Chart layers state
    const [layersOpen, setLayersOpen] = useState(false);
    const [layers, setLayers] = useState<Record<ChartLayerId, boolean>>(() => {
        const init: Partial<Record<ChartLayerId, boolean>> = {};
        for (const l of CHART_LAYERS) {
            init[l.id] = l.defaultOn && l.available;
        }
        return init as Record<ChartLayerId, boolean>;
    });

    const layerAvailability = useRef<Record<ChartLayerId, boolean>>(
        CHART_LAYERS.reduce(
            (acc, l) => ({ ...acc, [l.id]: l.available }),
            {} as Record<ChartLayerId, boolean>
        )
    ).current;

    const toggleLayer = (id: ChartLayerId) => {
        setLayers((prev) => ({ ...prev, [id]: !prev[id] }));
    };

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

    // RTDB Listeners for account, positions, orders, execution
    useEffect(() => {
        if (!firebaseUser || !hasAccess) return;

        const uid = firebaseUser.uid;

        const accountRef = ref(database, `trading_accounts/${uid}`);
        onValue(accountRef, (snap) => {
            const val = snap.val();
            if (val) {
                const firstKey = Object.keys(val)[0];
                const accData = val[firstKey];
                if (accData) {
                    setAccount({
                        accountId: firstKey,
                        mt5Account: accData.mt5Account || accData.account_id || firstKey,
                        broker: accData.broker || "MetaTrader 5",
                        server: accData.server || "Live Server",
                        currency: accData.currency || "USD",
                        leverage: accData.leverage ? `1:${accData.leverage}` : "1:100",
                        balance: accData.balance || 0,
                        equity: accData.equity || accData.balance || 0,
                        margin: accData.margin || 0,
                        freeMargin: accData.freeMargin || accData.balance || 0,
                        marginLevel: accData.marginLevel || 0,
                        status: accData.status || "connected",
                        lastHeartbeatAt: accData.lastHeartbeatAt || Date.now(),
                        gatewayVersion: accData.gatewayVersion || "v2.4.0",
                    });
                }
            }
        });

        const posRef = ref(database, `trading_positions/${uid}`);
        onValue(posRef, (snap) => {
            const val = snap.val();
            if (val) {
                const posList: Position[] = Object.entries(val).map(([ticket, p]: [string, any]) => ({
                    ticket,
                    symbol: p.symbol || "XAUUSD",
                    type: p.type === "SELL" ? "SELL" : "BUY",
                    volume: p.volume || 0.01,
                    openPrice: p.openPrice || 0,
                    currentPrice: p.currentPrice || p.openPrice || 0,
                    sl: p.sl || 0,
                    tp: p.tp || 0,
                    profit: p.profit || 0,
                    swap: p.swap || 0,
                    magic: p.magic || 0,
                    openedAt: p.openTime || p.openedAt || Date.now(),
                }));
                setPositions(posList);
            } else {
                setPositions([]);
            }
        });

        const ordersRef = ref(database, `trading_orders/${uid}`);
        onValue(ordersRef, (snap) => {
            const val = snap.val();
            if (val) {
                const ordList: PendingOrder[] = Object.entries(val).map(([ticket, o]: [string, any]) => ({
                    ticket,
                    symbol: o.symbol || "XAUUSD",
                    type: o.type || "BUY_LIMIT",
                    volume: o.volume || 0.01,
                    price: o.price || 0,
                    sl: o.sl || 0,
                    tp: o.tp || 0,
                    status: o.status || o.state || "PLACED",
                    updatedAt: o.updatedAt || o.placedTime || Date.now(),
                }));
                setOrders(ordList);
            } else {
                setOrders([]);
            }
        });

        const logsRef = ref(database, `trading_executions/${uid}`);
        onValue(logsRef, (snap) => {
            const val = snap.val();
            if (val) {
                const logList: ExecutionLogEntry[] = Object.entries(val)
                    .map(([id, l]: [string, any]) => ({
                        clientOrderId: l.clientOrderId || id,
                        accountId: uid,
                        action: l.action || l.type || "ORDER",
                        symbol: l.symbol || "XAUUSD",
                        volume: l.volume || 0.01,
                        status: l.status || "FILLED",
                        mt5Ticket: l.mt5Ticket || l.ticket || id,
                        executionPrice: l.executionPrice || l.price || 0,
                        errorCode: l.errorCode || 0,
                        errorMessage: l.errorMessage || l.message || "Executed",
                        createdAt: l.createdAt || l.timestamp || Date.now(),
                        executedAt: l.executedAt || l.timestamp || Date.now(),
                    }))
                    .sort((a, b) => b.createdAt - a.createdAt);
                setExecutionLogs(logList);
            } else {
                setExecutionLogs([]);
            }
        });

        return () => {
            off(accountRef);
            off(posRef);
            off(ordersRef);
            off(logsRef);
        };
    }, [firebaseUser, hasAccess]);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            if (firebaseUser) {
                const token = await firebaseUser.getIdToken();
                await fetch("/api/trading/access", {
                    headers: { Authorization: `Bearer ${token}` },
                });
            }
        } catch {
            // Ignore
        } finally {
            setTimeout(() => setRefreshing(false), 600);
        }
    };

    const handleClosePosition = async (ticket: string) => {
        if (!firebaseUser) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ ticket, action: "close" }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    const handlePartialClosePosition = async (ticket: string, volume: number) => {
        if (!firebaseUser) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ ticket, action: "partial_close", volume }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    const handleModifyPosition = async (ticket: string, sl: number, tp: number) => {
        if (!firebaseUser) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ ticket, sl, tp }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    const handleCancelOrder = async (ticket: string) => {
        if (!firebaseUser) return;
        try {
            const token = await firebaseUser.getIdToken();
            await fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ ticket, action: "cancel_order" }),
            });
            handleRefresh();
        } catch {
            // Ignore
        }
    };

    if (loading) {
        return (
            <AccountShell title="Trading Terminal" subtitle="Live account trading, charts & orders">
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                    <RefreshCw className="size-6 animate-spin text-primary" />
                    <p className="text-sm">Connecting to Trading Engine…</p>
                </div>
            </AccountShell>
        );
    }

    if (hasAccess === false) {
        return (
            <AccountShell title="Trading Terminal" subtitle="Live account trading, charts & orders">
                <div className="mx-auto my-8 max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
                        <Lock className="size-7" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">Trading Access License Required</h2>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                        You need an active Trading Access License to use the live trading terminal, connect your MT5 account, and execute orders in real time.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <Button
                            onClick={() => router.push("/account/trading-access")}
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

    const cleanedSymbol = cleanSymbol(selectedSymbol);

    return (
        <AccountShell title="Trading Terminal" subtitle="Live MT5 account trading, real-time candles & orders">
            <div className="flex flex-col gap-6">

                {/* Account & Connection Bar */}
                <div className="grid gap-4 lg:grid-cols-4">
                    <div className="lg:col-span-3">
                        <AccountHeader account={account} loading={loading} />
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Gateway Sync</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="h-7 px-2 text-xs"
                            >
                                <RefreshCw className={cn("size-3.5 mr-1", refreshing && "animate-spin")} />
                                Sync
                            </Button>
                        </div>
                        <ConnectionStatus
                            status={account?.status || "offline"}
                            lastHeartbeat={account?.lastHeartbeatAt || 0}
                        />
                    </div>
                </div>

                {/* Main Trading Area */}
                <div className="grid gap-6 xl:grid-cols-4">

                    {/* Chart & Layer Controls (3/4 width on xl) */}
                    <div className="flex flex-col gap-3 xl:col-span-3">
                        {/* Top Chart Toolbar */}
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                            <div className="flex items-center gap-3">
                                <Badge variant="outline" className="font-mono font-bold text-sm bg-primary/10 text-primary border-primary/20">
                                    {cleanedSymbol}
                                </Badge>

                                {/* Timeframe Picker */}
                                <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                                    {TERMINAL_TIMEFRAMES.map((tf) => (
                                        <button
                                            key={tf}
                                            type="button"
                                            onClick={() => setTimeframe(tf)}
                                            className={cn(
                                                "rounded-md px-2.5 py-1 text-xs font-mono font-semibold transition-all",
                                                timeframe === tf
                                                    ? "bg-primary text-primary-foreground shadow-sm"
                                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                            )}
                                        >
                                            {tf}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {/* Layer Picker Toggle */}
                                <Button
                                    size="sm"
                                    variant={layersOpen ? "default" : "outline"}
                                    onClick={() => setLayersOpen(!layersOpen)}
                                    className="h-8 gap-1.5 text-xs font-medium"
                                >
                                    <SlidersHorizontal className="size-3.5" />
                                    <span>Chart Layers</span>
                                    <ChevronDown className={cn("size-3 transition-transform", layersOpen && "rotate-180")} />
                                </Button>
                            </div>
                        </div>

                        {/* Collapsible Layer Picker */}
                        {layersOpen && (
                            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                                <LayerPicker
                                    layers={layers}
                                    availability={layerAvailability}
                                    onToggle={toggleLayer}
                                    compact
                                />
                            </div>
                        )}

                        {/* Scalping Pro Terminal Chart */}
                        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-md">
                            <ProTerminalChart
                                symbol={cleanedSymbol}
                                timeframe={timeframe}
                                layers={layers}
                                analysis={null}
                                token={userToken}
                                height={520}
                            />
                        </div>
                    </div>

                    {/* Side Panel: Watchlist & Order Panel */}
                    <div className="flex flex-col gap-4 xl:col-span-1">
                        <Watchlist
                            selectedSymbol={selectedSymbol}
                            onSelect={(sym) => setSelectedSymbol(sym)}
                        />
                        <OrderPanel
                            account={account}
                            symbol={selectedSymbol}
                            onOrderPlaced={() => {
                                handleRefresh();
                            }}
                        />
                    </div>
                </div>

                {/* Bottom Positions / Orders / History Tabs */}
                <div className="rounded-2xl border border-border bg-card shadow-md">
                    <div className="flex border-b border-border px-4 pt-3">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab("positions")}
                                className={cn(
                                    "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                                    activeTab === "positions"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <BarChart2 className="size-4" />
                                <span>Positions</span>
                                <Badge variant="secondary" className="ml-1 text-xs">
                                    {positions.length}
                                </Badge>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab("orders")}
                                className={cn(
                                    "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                                    activeTab === "orders"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <ListOrdered className="size-4" />
                                <span>Pending Orders</span>
                                <Badge variant="secondary" className="ml-1 text-xs">
                                    {orders.length}
                                </Badge>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab("history")}
                                className={cn(
                                    "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                                    activeTab === "history"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <History className="size-4" />
                                <span>Execution Log</span>
                                <Badge variant="secondary" className="ml-1 text-xs">
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
