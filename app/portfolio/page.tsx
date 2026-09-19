"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Wallet,
    TrendingUp,
    TrendingDown,
    AlertTriangle,
    Loader2,
    RefreshCw,
    Monitor,
    Activity,
    Shield,
    ArrowUpRight,
    ArrowDownRight,
} from "lucide-react";
import SiteNavbar from "@/components/navbar/SiteNavbar";
import { cn } from "@/lib/utils";

type AccountSummary = {
    accountId: string;
    mt5Account: string;
    broker: string;
    server: string;
    currency: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number;
    floatingPnl: number;
    drawdown: number;
    status: string;
    lastHeartbeatAt: number;
    positionsCount: number;
};

type Exposure = {
    symbol: string;
    volume: number;
    type: string;
    pnl: number;
};

type PortfolioData = {
    totalBalance: number;
    totalEquity: number;
    totalMargin: number;
    totalFreeMargin: number;
    totalFloatingPnl: number;
    overallDrawdown: number;
    accountCount: number;
    onlineCount: number;
    accounts: AccountSummary[];
    exposure: Exposure[];
};

export default function PortfolioPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncingJournal, setSyncingJournal] = useState(false);
    const [syncResult, setSyncResult] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchPortfolio = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/portfolio", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setPortfolio(json.portfolio);
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => {
        if (!authLoading && user) fetchPortfolio();
    }, [authLoading, user, fetchPortfolio]);

    const syncJournal = async (accountId: string) => {
        if (!user) return;
        setSyncingJournal(true);
        setSyncResult(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/journal-sync", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ accountId }),
            });
            const json = await res.json();
            setSyncResult(`Synced ${json.synced} trades from ${accountId}`);
        } catch { setSyncResult("Sync failed"); } finally { setSyncingJournal(false); }
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <SiteNavbar />
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <Wallet size={40} className="text-muted-foreground" />
                    <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                    <a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground" data-guide="portfolio">
            <SiteNavbar />
            <div className="mx-auto max-w-7xl px-4 py-8">
                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Portfolio Overview</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Aggregated view of all connected MT5 accounts</p>
                    </div>
                    <button type="button" onClick={fetchPortfolio} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50">
                        <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                    </button>
                </div>

                {loading && !portfolio ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : portfolio ? (
                    <>
                        {/* Summary Cards */}
                        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" data-guide="stats">
                            <SummaryCard icon={Wallet} label="Total Balance" value={`$${portfolio.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                            <SummaryCard icon={TrendingUp} label="Total Equity" value={`$${portfolio.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color={portfolio.totalFloatingPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
                            <SummaryCard icon={Activity} label="Floating P/L" value={`${portfolio.totalFloatingPnl >= 0 ? "+" : ""}$${portfolio.totalFloatingPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color={portfolio.totalFloatingPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
                            <SummaryCard icon={Shield} label="Margin Used" value={`$${portfolio.totalMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                            <SummaryCard icon={AlertTriangle} label="Drawdown" value={`${portfolio.overallDrawdown.toFixed(2)}%`} color={portfolio.overallDrawdown > 10 ? "text-rose-400" : portfolio.overallDrawdown > 5 ? "text-amber-400" : "text-muted-foreground"} />
                            <SummaryCard icon={Monitor} label="Accounts" value={`${portfolio.onlineCount}/${portfolio.accountCount} Online`} />
                        </div>

                        {/* Accounts Table */}
                        <div className="mb-6 rounded-xl border border-border/30 bg-muted/50" data-guide="accounts">
                            <div className="border-b border-border/20 px-4 py-3">
                                <h2 className="text-sm font-semibold text-foreground">Connected Accounts</h2>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                            <th className="px-4 py-2.5 text-left">Status</th>
                                            <th className="px-4 py-2.5 text-left">Broker</th>
                                            <th className="px-4 py-2.5 text-left">Account</th>
                                            <th className="px-4 py-2.5 text-right">Balance</th>
                                            <th className="px-4 py-2.5 text-right">Equity</th>
                                            <th className="px-4 py-2.5 text-right">Floating P/L</th>
                                            <th className="px-4 py-2.5 text-right">Drawdown</th>
                                            <th className="px-4 py-2.5 text-right">Positions</th>
                                            <th className="px-4 py-2.5 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {portfolio.accounts.map((acc) => (
                                            <tr key={acc.accountId} className="border-b border-border/10 hover:bg-muted/50">
                                                <td className="px-4 py-2.5">
                                                    <span className={cn("flex items-center gap-1.5 text-xs", acc.status === "connected" ? "text-emerald-400" : "text-muted-foreground")}>
                                                        <span className={cn("h-1.5 w-1.5 rounded-full", acc.status === "connected" ? "bg-emerald-400" : "bg-muted")} />
                                                        {acc.status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-sm text-foreground">{acc.broker}</td>
                                                <td className="px-4 py-2.5 font-mono text-muted-foreground">{acc.mt5Account}</td>
                                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">${acc.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                <td className={cn("px-4 py-2.5 text-right font-mono font-medium", acc.floatingPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                    {acc.floatingPnl >= 0 ? "+" : ""}${acc.floatingPnl.toFixed(2)}
                                                </td>
                                                <td className={cn("px-4 py-2.5 text-right font-mono", acc.drawdown > 10 ? "text-rose-400" : acc.drawdown > 5 ? "text-amber-400" : "text-muted-foreground")}>
                                                    {acc.drawdown.toFixed(2)}%
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-muted-foreground">{acc.positionsCount}</td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <button type="button" onClick={() => syncJournal(acc.accountId)} disabled={syncingJournal} className="rounded-lg bg-violet-500/10 px-2.5 py-1 text-[10px] text-violet-400 hover:bg-violet-500/20 transition disabled:opacity-50">
                                                        {syncingJournal ? "Syncing..." : "Sync Journal"}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {syncResult && <div className="px-4 py-2 text-xs text-violet-400">{syncResult}</div>}
                        </div>

                        {/* Exposure */}
                        {portfolio.exposure.length > 0 && (
                            <div className="rounded-xl border border-border/30 bg-muted/50">
                                <div className="border-b border-border/20 px-4 py-3">
                                    <h2 className="text-sm font-semibold text-foreground">Position Exposure</h2>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                                <th className="px-4 py-2.5 text-left">Symbol</th>
                                                <th className="px-4 py-2.5 text-left">Direction</th>
                                                <th className="px-4 py-2.5 text-right">Total Volume</th>
                                                <th className="px-4 py-2.5 text-right">Floating P/L</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {portfolio.exposure.map((exp) => (
                                                <tr key={`${exp.symbol}_${exp.type}`} className="border-b border-border/10">
                                                    <td className="px-4 py-2.5 font-mono font-medium text-foreground">{exp.symbol}</td>
                                                    <td className={cn("px-4 py-2.5 font-medium", exp.type === "BUY" ? "text-emerald-400" : "text-rose-400")}>{exp.type}</td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{exp.volume.toFixed(2)}</td>
                                                    <td className={cn("px-4 py-2.5 text-right font-mono font-medium", exp.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                        {exp.pnl >= 0 ? "+" : ""}${exp.pnl.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-16 text-center">
                        <Wallet size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No accounts connected</p>
                        <p className="mt-1 text-xs text-muted-foreground">Connect your MT5 account via the Trading Gateway</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color?: string }) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
            <div className="flex items-center gap-2">
                <Icon size={14} className="text-violet-400" />
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
            </div>
            <p className={cn("mt-2 font-mono text-lg font-bold", color || "text-foreground")}>{value}</p>
        </div>
    );
}
