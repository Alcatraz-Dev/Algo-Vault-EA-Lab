"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref, off } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountHeader, { TradingAccount } from "@/components/trading/AccountHeader";
import ConnectionStatus from "@/components/trading/ConnectionStatus";
import Watchlist from "@/components/trading/Watchlist";
import OrderPanel from "@/components/trading/OrderPanel";
import OpenPositions, { Position } from "@/components/trading/OpenPositions";
import PendingOrders, { PendingOrder } from "@/components/trading/PendingOrders";
import ExecutionLog, { ExecutionLogEntry } from "@/components/trading/ExecutionLog";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

type Tab = "positions" | "orders" | "history";

export default function TradingTerminalPage() {
    const router = useRouter();

    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasAccess, setHasAccess] = useState<boolean | null>(null);
    const [account, setAccount] = useState<TradingAccount | null>(null);
    const [positions, setPositions] = useState<Position[]>([]);
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState("XAUUSD");
    const [activeTab, setActiveTab] = useState<Tab>("positions");
    const [refreshing, setRefreshing] = useState(false);

    const rtdbUnsubs = useRef<(() => void)[]>([]);

    // Auth check
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!user) {
                router.replace("/login");
                return;
            }
            setFirebaseUser(user);
        });
        return () => unsubscribe();
    }, [router]);

    // Check trading access license
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
                setHasAccess(data.license?.status === "active");
            } catch {
                setHasAccess(false);
            }
        }

        checkAccess();
    }, [firebaseUser]);

    // Fetch account + RTDB real-time listeners
    useEffect(() => {
        if (!firebaseUser || !hasAccess) return;

        const uid = firebaseUser.uid;

        // Account info from RTDB
        const accountRef = ref(database, `trading_accounts/${uid}`);
        const unsubAccount = onValue(accountRef, (snap) => {
            const val = snap.val();
            if (val) {
                const accounts = Array.isArray(val) ? val : Object.values(val);
                setAccount((accounts[0] as TradingAccount) ?? null);
            } else {
                setAccount(null);
            }
        });
        rtdbUnsubs.current.push(() => off(accountRef));

        // Positions
        const positionsRef = ref(database, `trading_positions/${uid}`);
        const unsubPositions = onValue(positionsRef, (snap) => {
            const val = snap.val();
            if (val) {
                const list = Array.isArray(val) ? val : Object.values(val);
                setPositions(list as Position[]);
            } else {
                setPositions([]);
            }
        });
        rtdbUnsubs.current.push(() => off(positionsRef));

        // Orders
        const ordersRef = ref(database, `trading_orders/${uid}`);
        const unsubOrders = onValue(ordersRef, (snap) => {
            const val = snap.val();
            if (val) {
                const list = Array.isArray(val) ? val : Object.values(val);
                setOrders(list as PendingOrder[]);
            } else {
                setOrders([]);
            }
        });
        rtdbUnsubs.current.push(() => off(ordersRef));

        // Execution logs
        const logsRef = ref(database, `trading_logs/${uid}`);
        const unsubLogs = onValue(logsRef, (snap) => {
            const val = snap.val();
            if (val) {
                const list = Array.isArray(val) ? val : Object.values(val);
                setExecutionLogs(list as ExecutionLogEntry[]);
            } else {
                setExecutionLogs([]);
            }
        });
        rtdbUnsubs.current.push(() => off(logsRef));

        setLoading(false);

        return () => {
            rtdbUnsubs.current.forEach((fn) => fn());
            rtdbUnsubs.current = [];
        };
    }, [firebaseUser, hasAccess]);

    // Auto-refresh every 5 seconds
    useEffect(() => {
        if (!firebaseUser || !hasAccess) return;

        const interval = setInterval(() => {
            setRefreshing(true);
            setTimeout(() => setRefreshing(false), 1000);
        }, 5000);

        return () => clearInterval(interval);
    }, [firebaseUser, hasAccess]);

    function handleOrderPlaced(_clientOrderId: string) {}

    function handleClosePosition(ticket: string) {
        if (!firebaseUser) return;
        const user = auth.currentUser;
        if (!user) return;
        user.getIdToken().then((token) => {
            fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: account?.accountId,
                    ticket,
                    action: "close",
                }),
            });
        });
    }

    function handlePartialClose(ticket: string, volume: number) {
        if (!firebaseUser) return;
        const user = auth.currentUser;
        if (!user) return;
        user.getIdToken().then((token) => {
            fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: account?.accountId,
                    ticket,
                    volume,
                    action: "partial_close",
                }),
            });
        });
    }

    function handleModifyPosition(ticket: string, sl: number, tp: number) {
        if (!firebaseUser) return;
        const user = auth.currentUser;
        if (!user) return;
        user.getIdToken().then((token) => {
            fetch("/api/trading/orders", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: account?.accountId,
                    ticket,
                    sl,
                    tp,
                }),
            });
        });
    }

    function handleCancelOrder(ticket: string) {
        if (!firebaseUser) return;
        const user = auth.currentUser;
        if (!user) return;
        user.getIdToken().then((token) => {
            fetch("/api/trading/orders", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    accountId: account?.accountId,
                    ticket,
                    action: "cancel",
                }),
            });
        });
    }

    // Loading state
    if (loading || hasAccess === null) {
        return (
            <div className="flex h-screen items-center justify-center bg-background">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
        );
    }

    // No access
    if (!hasAccess) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
                        <span className="text-2xl">🔒</span>
                    </div>
                    <h1 className="mt-5 text-xl font-bold">Trading Access Required</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        You need an active Trading Access License to use the trading terminal.
                    </p>
                    <button
                        onClick={() => router.push("/account/trading-access")}
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-background hover:bg-emerald-400"
                    >
                        Get Trading Access
                    </button>
                </div>
            </div>
        );
    }

    const tabs: { key: Tab; label: string; count: number }[] = [
        { key: "positions", label: "Open Positions", count: positions.length },
        { key: "orders", label: "Pending Orders", count: orders.length },
        { key: "history", label: "Execution Log", count: executionLogs.length },
    ];

    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground" data-guide="trading-terminal">
            {/* Top Bar */}
            <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-6" data-guide="page-header">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-bold">Trading Terminal</h1>
                    {account && (
                        <ConnectionStatus
                            status={account.status}
                            lastHeartbeat={account.lastHeartbeatAt}
                        />
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <span
                        className={cn(
                            "flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity",
                            refreshing ? "opacity-100" : "opacity-0"
                        )}
                    >
                        <RefreshCw size={12} className="animate-spin" />
                        Updating
                    </span>
                </div>
            </header>

            {/* Account Header */}
            <div className="border-b border-border px-4 py-3 md:px-6" data-guide="account-selector">
                <AccountHeader account={account} loading={loading} />
            </div>

            {/* Main Grid */}
            <div className="flex flex-1 overflow-hidden">
                {/* Watchlist - Left */}
                <aside className="hidden w-52 shrink-0 border-r border-border lg:flex">
                    <div className="w-full overflow-y-auto">
                        <Watchlist
                            onSelect={setSelectedSymbol}
                            selectedSymbol={selectedSymbol}
                        />
                    </div>
                </aside>

                {/* Chart Area - Center */}
                <div className="flex flex-1 flex-col overflow-hidden" data-guide="chart">
                    {/* Chart placeholder */}
                    <div className="flex flex-1 items-center justify-center border-b border-border">
                        <div className="text-center">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                                <svg
                                    className="h-8 w-8 text-muted-foreground"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.5}
                                        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                                    />
                                </svg>
                            </div>
                            <p className="mt-3 text-sm font-medium text-foreground">
                                {selectedSymbol}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                TradingView chart integration coming soon
                            </p>
                        </div>
                    </div>

                    {/* Bottom Tabs */}
                    <div className="flex flex-col overflow-hidden">
                        <div className="flex border-b border-border" data-guide="tabs">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onClick={() => setActiveTab(tab.key)}
                                    className={cn(
                                        "flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors",
                                        activeTab === tab.key
                                            ? "border-foreground text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span
                                            className={cn(
                                                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                                activeTab === tab.key
                                                    ? "bg-foreground text-background"
                                                    : "bg-muted text-muted-foreground"
                                            )}
                                        >
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            {activeTab === "positions" && (
                                <OpenPositions
                                    positions={positions}
                                    onClose={handleClosePosition}
                                    onPartialClose={handlePartialClose}
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

                {/* Order Panel - Right */}
                <aside className="hidden w-72 shrink-0 border-l border-border overflow-y-auto md:block" data-guide="order-panel">
                    <OrderPanel
                        account={account}
                        onOrderPlaced={handleOrderPlaced}
                    />
                </aside>
            </div>
        </div>
    );
}
