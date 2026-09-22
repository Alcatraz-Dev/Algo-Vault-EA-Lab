"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2, Shield, ArrowLeft, Download, FileText, TrendingUp, TrendingDown, BarChart3, PieChart, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type MT5Account = { id: string; mt5Account: string; broker: string };

type StatementData = {
    account: { mt5Account: string; broker: string; balance: number; equity: number };
    period: string;
    summary: {
        totalTrades: number; wins: number; losses: number; winRate: number;
        totalProfit: number; totalSwap: number; totalCommission: number; netPnl: number;
        avgWin: number; avgLoss: number; profitFactor: number; maxDrawdown: number;
    };
    bySymbol: { symbol: string; trades: number; profit: number; winRate: number }[];
    equityCurve: [string, number][];
    trades: {
        ticket: string; symbol: string; type: string; volume: number;
        openPrice: number; closePrice: number; profit: number; swap: number;
        commission: number; openTime: number; closeTime: number;
    }[];
};

export default function StatementPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [accounts, setAccounts] = useState<MT5Account[]>([]);
    const [accountsLoading, setAccountsLoading] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState("");
    const [period, setPeriod] = useState("30");
    const [data, setData] = useState<StatementData | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        void Promise.resolve().then(() => setAccountsLoading(true));
        user.getIdToken().then((token) => {
            if (cancelled) return;
            void fetch(`/api/trading/gateway/status`, {
                headers: { Authorization: `Bearer ${token}` },
            }).then(async (res) => {
                const json = await res.json();
                if (cancelled) return;
                if (json.success && Array.isArray(json.accounts)) {
                    const list = json.accounts.map((a: Record<string, unknown>) => ({
                        id: String(a.accountId || ""),
                        mt5Account: String(a.mt5Account || ""),
                        broker: String(a.broker || ""),
                    }));
                    setAccounts(list);
                    if (list.length > 0 && !selectedAccount) setSelectedAccount(list[0].id);
                }
                setAccountsLoading(false);
            }).catch(() => { if (!cancelled) setAccountsLoading(false); });
        });
        return () => { cancelled = true; };
    }, [user]);

    const generate = useCallback(async () => {
        if (!user || !selectedAccount) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/statement?accountId=${selectedAccount}&period=${period}`, { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setData(json.statement);
        } catch {} finally { setLoading(false); }
    }, [user, selectedAccount, period]);

    useEffect(() => { if (selectedAccount) void Promise.resolve().then(() => generate()); }, [selectedAccount, period, generate]);

    const printStatement = () => window.print();

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link></div></div>);
    }

    const s = data?.summary;

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Account Statement</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Detailed performance report for your trading account</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-xs text-foreground focus:border-violet-500 focus:outline-none">
                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.broker} — {a.mt5Account}</option>)}
                        </select>
                        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-xs text-foreground focus:border-violet-500 focus:outline-none">
                            <option value="7">7 Days</option>
                            <option value="30">30 Days</option>
                            <option value="90">90 Days</option>
                            <option value="180">6 Months</option>
                            <option value="365">1 Year</option>
                        </select>
                         <button type="button" onClick={generate} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted px-4 py-2.5 text-xs text-muted-foreground hover:bg-background/15 hover:text-foreground transition disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                        <button type="button" onClick={printStatement} className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted px-4 py-2.5 text-xs text-muted-foreground hover:bg-background/15 hover:text-foreground transition">
                            <Download size={13} /> Export
                        </button>
                    </div>
                </div>

                {accountsLoading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : accounts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Shield size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No trading accounts connected</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">Install the AlgoVault Gateway EA on your MT5 terminal to start streaming account data</p>
                    </div>
                ) : loading && !data ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : data && s ? (
                    <>
                        {/* Account Header */}
                        <div className="mb-6 rounded-2xl border border-border/30 bg-muted/50 p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-muted-foreground">Account Statement</p>
                                    <p className="font-mono text-lg font-bold text-foreground">{data.account.mt5Account}</p>
                                    <p className="text-xs text-muted-foreground">{data.account.broker} · {data.period}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-muted-foreground">Generated</p>
                                    <p className="text-sm font-medium text-foreground">{new Date().toLocaleDateString()}</p>
                                </div>
                            </div>
                        </div>

                        {/* Summary Cards */}
                        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                            <StatCard label="Net P/L" value={`${s.netPnl >= 0 ? "+" : ""}$${s.netPnl.toLocaleString()}`} color={s.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
                            <StatCard label="Total Trades" value={String(s.totalTrades)} />
                            <StatCard label="Win Rate" value={`${s.winRate}%`} color={s.winRate >= 55 ? "text-emerald-400" : "text-muted-foreground"} />
                            <StatCard label="Profit Factor" value={String(s.profitFactor)} color={s.profitFactor >= 2 ? "text-emerald-400" : "text-muted-foreground"} />
                            <StatCard label="Max Drawdown" value={`-${s.maxDrawdown}%`} color="text-rose-400" />
                            <StatCard label="Avg Win" value={`$${s.avgWin}`} color="text-emerald-400/80" />
                        </div>

                        {/* Breakdown */}
                        <div className="mb-6 grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                <h3 className="mb-3 text-sm font-semibold text-foreground">P/L Breakdown</h3>
                                <div className="space-y-2">
                                    {[
                                        { label: "Gross Profit", value: s.totalProfit, color: "text-emerald-400" },
                                        { label: "Swaps", value: s.totalSwap, color: s.totalSwap >= 0 ? "text-emerald-400" : "text-rose-400" },
                                        { label: "Commission", value: s.totalCommission, color: "text-rose-400" },
                                        { label: "Net P/L", value: s.netPnl, color: s.netPnl >= 0 ? "text-emerald-400" : "text-rose-400", bold: true },
                                    ].map((item) => (
                                        <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-border/15">
                                            <span className="text-xs text-muted-foreground">{item.label}</span>
                                            <span className={cn("font-mono text-xs font-bold", item.color, item.bold && "text-sm")}>
                                                {item.value >= 0 ? "+" : ""}${item.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                <h3 className="mb-3 text-sm font-semibold text-foreground">By Symbol</h3>
                                <div className="space-y-2">
                                    {data.bySymbol.map((sym) => (
                                        <div key={sym.symbol} className="flex items-center justify-between py-1.5 border-b border-border/15">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs font-medium text-foreground">{sym.symbol}</span>
                                                <span className="text-[10px] text-muted-foreground">{sym.trades} trades</span>
                                            </div>
                                            <span className={cn("font-mono text-xs font-bold", sym.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                {sym.profit >= 0 ? "+" : ""}${sym.profit.toFixed(2)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Trades Table */}
                        <div className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden">
                            <div className="border-b border-border/20 px-5 py-3">
                                <h3 className="text-sm font-semibold text-foreground">Trade History ({data.trades.length})</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-border/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                                            <th className="px-4 py-2.5 text-left">Ticket</th>
                                            <th className="px-4 py-2.5 text-left">Symbol</th>
                                            <th className="px-4 py-2.5 text-left">Type</th>
                                            <th className="px-4 py-2.5 text-right">Volume</th>
                                            <th className="px-4 py-2.5 text-right">Open</th>
                                            <th className="px-4 py-2.5 text-right">Close</th>
                                            <th className="px-4 py-2.5 text-right">P/L</th>
                                            <th className="px-4 py-2.5 text-right">Swap</th>
                                            <th className="px-4 py-2.5 text-right">Net</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.trades.map((t) => {
                                            const net = t.profit + t.swap + t.commission;
                                            return (
                                                <tr key={t.ticket} className="border-b border-border/10 hover:bg-muted/50 transition">
                                                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{t.ticket}</td>
                                                    <td className="px-4 py-2.5 font-mono font-medium text-foreground">{t.symbol}</td>
                                                    <td className={cn("px-4 py-2.5 font-medium", t.type === "BUY" ? "text-emerald-400" : "text-rose-400")}>{t.type}</td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{t.volume}</td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{t.openPrice}</td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{t.closePrice}</td>
                                                    <td className={cn("px-4 py-2.5 text-right font-mono", t.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                        {t.profit >= 0 ? "+" : ""}{t.profit.toFixed(2)}
                                                    </td>
                                                    <td className={cn("px-4 py-2.5 text-right font-mono", t.swap >= 0 ? "text-emerald-400/60" : "text-rose-400/60")}>
                                                        {t.swap.toFixed(2)}
                                                    </td>
                                                    <td className={cn("px-4 py-2.5 text-right font-mono font-bold", net >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                        {net >= 0 ? "+" : ""}{net.toFixed(2)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <FileText size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">Select an account to generate a statement</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={cn("mt-1 text-lg font-bold font-mono", color || "text-foreground")}>{value}</p>
        </div>
    );
}
