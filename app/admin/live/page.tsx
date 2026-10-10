"use client";

import { useEffect, useState } from "react";
import {
    Activity,
    Bot,
    DollarSign,
    RefreshCw,
    TrendingDown,
    Wifi,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";
import BarCompareChart from "@/components/charts/BarCompareChart";
import { StatusBadge } from "@/components/ui/status-badge";

function formatMoney(v: number, currency = "USD") {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
    } catch { return `$${v.toFixed(2)}`; }
}

function timeAgo(ms?: number | null, now = 0) {
    if (!ms) return "Never";
    const diff = Math.floor((now - ms) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

type LiveAccount = {
    id: string;
    productId: string;
    productName?: string;
    mt5Account: string;
    broker?: string;
    server?: string;
    currency?: string;
    balance?: number;
    equity?: number;
    floatingProfit?: number;
    peakEquity?: number;
    drawdown?: number;
    status?: string;
    lastHeartbeatAt?: number;
    userId?: string;
    licenseId?: string;
};

export default function AdminLivePage() {
    const [accounts, setAccounts] = useState<LiveAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [authOk, setAuthOk] = useState(false);
    const [error, setError] = useState("");
    const [now, setNow] = useState(0);

    useEffect(() => {
        return onAuthStateChanged(auth, async (user) => {
            if (!user) { setLoading(false); return; }
            setAuthOk(true);
        });
    }, []);

    useEffect(() => {
        if (!authOk) return;

        const fetchAccounts = async () => {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) return;
                const res = await fetch("/api/admin/live", {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                if (!res.ok) {
                    setError((await res.json())?.error ?? "Failed to load accounts.");
                    setLoading(false);
                    return;
                }
                const data = await res.json();
                setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
                setNow(Date.now());
                setError("");
            } catch (err) {
                console.error("Error loading live accounts:", err);
                setError("Failed to load accounts.");
            } finally {
                setLoading(false);
            }
        };

        fetchAccounts();
        const interval = setInterval(fetchAccounts, 30_000);
        return () => clearInterval(interval);
    }, [authOk]);

    const online = accounts.filter(a => a.lastHeartbeatAt && (now - a.lastHeartbeatAt) < 90_000);
    const offline = accounts.filter(a => !a.lastHeartbeatAt || (now - a.lastHeartbeatAt) >= 90_000);
    const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);
    const totalFloating = accounts.reduce((s, a) => s + (a.floatingProfit || 0), 0);

    return (
        <AdminShell title="Live Accounts" subtitle="Real-time heartbeat monitoring & MT5 account statistics">
            <div className="mb-6 flex items-center justify-end gap-3">
                <StatusBadge
                    tone="live"
                    dot
                    pulse
                    label={`${online.length} Live`}
                />
                <StatusBadge
                    tone="offline"
                    label={`${offline.length} Offline`}
                />
            </div>
            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
                {[
                    { label: "Total Accounts", value: String(accounts.length), icon: Bot, tone: null },
                    { label: "Online Now", value: String(online.length), icon: Wifi, tone: null },
                    { label: "Total Balance", value: formatMoney(totalBalance), icon: DollarSign, tone: null },
                    { label: "Floating P/L", value: (totalFloating >= 0 ? "+" : "") + formatMoney(totalFloating), icon: TrendingDown, tone: totalFloating >= 0 ? "text-positive" : "text-negative" },
                ].map(({ label, value, icon: Icon, tone }) => (
                    <div key={label} className="rounded-lg border border-border bg-card p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">{label}</p>
                                <p className={`mt-2 font-numeric text-2xl font-bold ${tone ?? ""}`}>{value}</p>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-2.5">
                                <Icon className="h-5 w-5 text-foreground" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {error && (
                <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {!loading && accounts.length > 0 && (
                <div className="mb-8 rounded-lg border border-border bg-card p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="font-semibold">Balance by Account</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Live balances across connected MT5 accounts
                            </p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/50">
                            <DollarSign className="h-5 w-5 text-foreground" />
                        </div>
                    </div>
                    <div className="mt-6">
                        <BarCompareChart
                            data={accounts.map((acct) => ({
                                label: acct.mt5Account ? `#${acct.mt5Account}` : acct.productName || acct.id,
                                value: acct.balance || 0,
                            }))}
                            xKey="label"
                            valueKey="value"
                            height={220}
                            colorVar="var(--chart-2)"
                            formatValue={(value) => formatMoney(value)}
                        />
                    </div>
                </div>
            )}

            {loading ? (
                <div className="rounded-lg border border-border bg-card p-16 text-center">
                    <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">Loading accounts...</p>
                </div>
            ) : accounts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-16 text-center">
                    <Activity className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                    <h3 className="font-semibold">No accounts yet</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Accounts appear here when an EA connects via heartbeat.</p>
                </div>
            ) : (
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-sm">
                            <thead className="bg-muted/40">
                                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                                    <th className="px-5 py-4 text-left">Status</th>
                                    <th className="px-5 py-4 text-left">Product / Account</th>
                                    <th className="px-5 py-4 text-left">Broker</th>
                                    <th className="px-5 py-4 text-right">Balance</th>
                                    <th className="px-5 py-4 text-right">Equity</th>
                                    <th className="px-5 py-4 text-right">Floating P/L</th>
                                    <th className="px-5 py-4 text-right">Drawdown</th>
                                    <th className="px-5 py-4 text-left">Last Heartbeat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map((acct) => {
                                    const isOnline = acct.lastHeartbeatAt && (now - acct.lastHeartbeatAt) < 90_000;
                                    const fl = acct.floatingProfit || 0;
                                    return (
                                        <tr key={acct.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                                            <td className="px-5 py-4">
                                                <StatusBadge
                                                    tone={isOnline ? "live" : "offline"}
                                                    dot
                                                    label={isOnline ? "LIVE" : "Offline"}
                                                />
                                            </td>
                                            <td className="px-5 py-4">
                                                <p className="font-semibold text-foreground">{acct.productName || acct.productId}</p>
                                                <p className="mt-0.5 font-numeric text-xs text-muted-foreground">MT5 #{acct.mt5Account}</p>
                                            </td>
                                            <td className="px-5 py-4 text-muted-foreground">
                                                <p>{acct.broker || "—"}</p>
                                                {acct.server && <p className="text-xs text-muted-foreground">{acct.server}</p>}
                                            </td>
                                            <td className="px-5 py-4 text-right font-numeric font-semibold text-foreground">
                                                {acct.balance != null ? formatMoney(acct.balance, acct.currency) : "—"}
                                            </td>
                                            <td className="px-5 py-4 text-right font-numeric text-foreground">
                                                {acct.equity != null ? formatMoney(acct.equity, acct.currency) : "—"}
                                            </td>
                                            <td className={`px-5 py-4 text-right font-numeric font-semibold ${fl >= 0 ? "text-positive" : "text-negative"}`}>
                                                {fl >= 0 ? "+" : ""}{formatMoney(fl, acct.currency)}
                                            </td>
                                            <td className={`px-5 py-4 text-right font-numeric ${(acct.drawdown || 0) > 20 ? "text-negative" : "text-muted-foreground"}`}>
                                                {acct.drawdown != null ? `${acct.drawdown.toFixed(2)}%` : "—"}
                                            </td>
                                            <td className="px-5 py-4 text-xs text-muted-foreground">
                                                {timeAgo(acct.lastHeartbeatAt, now)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </AdminShell >

    );
}
