"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import {
    Shield,
    AlertTriangle,
    Loader2,
    RefreshCw,
    TrendingDown,
    Activity,
    Wallet,
    BarChart3,
    ArrowUpRight,
    ArrowDownRight,
} from "lucide-react";
import SiteNavbar from "@/components/navbar/SiteNavbar";
import { cn } from "@/lib/utils";

type RiskData = {
    accountBalance: number;
    accountEquity: number;
    marginUsed: number;
    marginFree: number;
    marginLevel: number;
    floatingPnl: number;
    drawdown: number;
    maxDrawdown: number;
    riskPerPosition: { symbol: string; risk: number; type: string; volume: number }[];
    totalRiskExposure: number;
    marginUtilization: number;
    freeMarginPercent: number;
    marginCallDistance: number;
    positionsAtRisk: number;
    totalPositions: number;
    hedgedPositions: number;
    unhedgedExposure: number;
};

type MT5Account = { id: string; mt5Account: string; broker: string; status: string };

export default function RiskPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [accounts, setAccounts] = useState<MT5Account[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<string>("");
    const [risk, setRisk] = useState<RiskData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;
        const accountsRef = ref(database, `trading_accounts/${user.uid}`);
        return onValue(accountsRef, (snap) => {
            const data = snap.val() || {};
            const list = Object.entries(data).map(([id, val]) => {
                const a = val as Record<string, unknown>;
                return { id, mt5Account: String(a.mt5Account || ""), broker: String(a.broker || ""), status: String(a.status || "") };
            });
            setAccounts(list);
            if (list.length > 0 && !selectedAccount) setSelectedAccount(list[0].id);
        });
    }, [user, selectedAccount]);

    const fetchRisk = useCallback(async () => {
        if (!user || !selectedAccount) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/analytics/risk?accountId=${selectedAccount}`, { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setRisk(json.risk);
        } catch {} finally { setLoading(false); }
    }, [user, selectedAccount]);

    useEffect(() => {
        if (selectedAccount) fetchRisk();
    }, [selectedAccount, fetchRisk]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <SiteNavbar />
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <Shield size={40} className="text-muted-foreground" />
                    <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                    <a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNavbar />
            <div className="mx-auto max-w-7xl px-4 py-8">
                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Risk Dashboard</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Real-time risk monitoring and margin analysis</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-violet-500 focus:outline-none">
                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.broker} — {a.mt5Account}</option>)}
                        </select>
                        <button type="button" onClick={fetchRisk} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                    </div>
                </div>

                {loading && !risk ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : risk ? (
                    <>
                        {/* Risk Score Header */}
                        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4" data-guide="stats">
                            <RiskGauge label="Margin Level" value={`${risk.marginLevel.toFixed(0)}%`} status={risk.marginLevel > 500 ? "safe" : risk.marginLevel > 200 ? "warning" : "danger"} />
                            <RiskGauge label="Drawdown" value={`${risk.drawdown.toFixed(2)}%`} status={risk.drawdown < 5 ? "safe" : risk.drawdown < 15 ? "warning" : "danger"} />
                            <RiskGauge label="Margin Usage" value={`${risk.marginUtilization.toFixed(1)}%`} status={risk.marginUtilization < 30 ? "safe" : risk.marginUtilization < 60 ? "warning" : "danger"} />
                            <RiskGauge label="Positions at Risk" value={`${risk.positionsAtRisk}/${risk.totalPositions}`} status={risk.positionsAtRisk === 0 ? "safe" : risk.positionsAtRisk <= 2 ? "warning" : "danger"} />
                        </div>

                        {/* Main Metrics */}
                        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5" data-guide="metrics">
                            <MetricCard label="Balance" value={`$${risk.accountBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={Wallet} />
                            <MetricCard label="Equity" value={`$${risk.accountEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={TrendingDown} color={risk.floatingPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
                            <MetricCard label="Floating P/L" value={`${risk.floatingPnl >= 0 ? "+" : ""}$${risk.floatingPnl.toFixed(2)}`} icon={Activity} color={risk.floatingPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
                            <MetricCard label="Total Risk" value={`$${risk.totalRiskExposure.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={AlertTriangle} color={risk.totalRiskExposure > risk.accountBalance * 0.1 ? "text-rose-400" : "text-muted-foreground"} />
                            <MetricCard label="Unhedged" value={`${risk.unhedgedExposure.toFixed(2)} lots`} icon={BarChart3} />
                        </div>

                        {/* Margin Bar */}
                        <div className="mb-6 rounded-xl border border-border/30 bg-muted/50 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-muted-foreground">Margin Utilization</span>
                                <span className="text-xs text-muted-foreground">${risk.marginUsed.toFixed(2)} / ${risk.accountBalance.toFixed(2)}</span>
                            </div>
                            <div className="h-3 overflow-hidden rounded-full bg-muted/20">
                                <div className={cn("h-full rounded-full transition-all", risk.marginUtilization < 30 ? "bg-emerald-500" : risk.marginUtilization < 60 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.min(100, risk.marginUtilization)}%` }} />
                            </div>
                            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                                <span>Free: ${risk.marginFree.toFixed(2)} ({risk.freeMarginPercent.toFixed(1)}%)</span>
                                <span>Margin Call Distance: {risk.marginCallDistance.toFixed(0)}%</span>
                            </div>
                        </div>

                        {/* Per-Position Risk */}
                        {risk.riskPerPosition.length > 0 && (
                            <div className="rounded-xl border border-border/30 bg-muted/50">
                                <div className="border-b border-border/20 px-4 py-3">
                                    <h2 className="text-sm font-semibold text-foreground">Position Risk Breakdown</h2>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                                <th className="px-4 py-2.5 text-left">Symbol</th>
                                                <th className="px-4 py-2.5 text-left">Direction</th>
                                                <th className="px-4 py-2.5 text-right">Volume</th>
                                                <th className="px-4 py-2.5 text-right">Risk ($)</th>
                                                <th className="px-4 py-2.5 text-right">Risk (%)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {risk.riskPerPosition.map((pos, i) => {
                                                const riskPercent = risk.accountBalance > 0 ? (pos.risk / risk.accountBalance) * 100 : 0;
                                                return (
                                                    <tr key={`${pos.symbol}_${i}`} className="border-b border-border/10">
                                                        <td className="px-4 py-2.5 font-mono font-medium text-foreground">{pos.symbol}</td>
                                                        <td className={cn("px-4 py-2.5 font-medium", pos.type === "BUY" ? "text-emerald-400" : "text-rose-400")}>{pos.type}</td>
                                                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{pos.volume.toFixed(2)}</td>
                                                        <td className={cn("px-4 py-2.5 text-right font-mono font-medium", pos.risk > risk.accountBalance * 0.05 ? "text-rose-400" : "text-muted-foreground")}>${pos.risk.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                        <td className={cn("px-4 py-2.5 text-right font-mono", riskPercent > 5 ? "text-rose-400" : riskPercent > 2 ? "text-amber-400" : "text-muted-foreground")}>{riskPercent.toFixed(2)}%</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        <div className="mt-6 rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-[11px] text-amber-400/60">
                            <Shield size={12} className="mr-1 inline" />
                            Risk data is computed from your connected MT5 account. Always manage risk according to your trading plan.
                        </div>
                    </>
                ) : (
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-16 text-center">
                        <Shield size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">Select an account to view risk data</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function RiskGauge({ label, value, status }: { label: string; value: string; status: "safe" | "warning" | "danger" }) {
    const colors = { safe: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400", warning: "border-amber-500/20 bg-amber-500/[0.06] text-amber-400", danger: "border-rose-500/20 bg-rose-500/[0.06] text-rose-400" };
    return (
        <div className={cn("rounded-xl border p-4", colors[status])}>
            <p className="text-[10px] font-semibold uppercase opacity-60">{label}</p>
            <p className="mt-1 text-xl font-bold font-mono">{value}</p>
        </div>
    );
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color?: string }) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
            <div className="flex items-center gap-2"><Icon size={14} className="text-violet-400" /><span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span></div>
            <p className={cn("mt-2 font-mono text-sm font-bold", color || "text-foreground")}>{value}</p>
        </div>
    );
}
