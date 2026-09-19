"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
    Activity,
    ArrowLeft,
    BarChart3,
    Bot,
    CircleDollarSign,
    Clock,
    Loader2,
    MapPin,
    ShieldCheck,
    TrendingDown,
    TrendingUp,
    Trophy,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";

type BotStats = {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    totalPnl: number;
    todayPnl: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    maxDrawdown: number;
    avgHoldingTimeMs: number;
};

type Position = {
    ticket: string;
    symbol: string;
    type: string;
    volume: number;
    profit: number;
    swap: number;
    openPrice: number;
    currentPrice: number;
    magic: string;
    openedAt: number;
    comment: string;
};

type Trade = {
    ticket: string;
    symbol: string;
    type: string;
    volume: number;
    openPrice: number;
    closePrice: number;
    profit: number;
    commission: number;
    swap: number;
    magic: string;
    comment: string;
    openedAt: number;
    closedAt: number;
    updatedAt: number;
};

type BotDetail = {
    id: string;
    name: string;
    type: string;
    status: string;
    online: boolean;
    lastHeartbeatAt: number | null;
    mt5Account: string | null;
    magicNumber: string | null;
    symbol: string | null;
    timeframe: string | null;
    commentFilter: string | null;
    description?: string;
    createdAt: number;
    mapping: Record<string, unknown> | null;
};

function formatPnl(v: number) {
    return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(ts: number) {
    return ts ? new Date(ts * 1000).toLocaleString() : "—";
}

function fmtTs(ts: number) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function BotDetailPage() {
    const params = useParams<{ botId: string }>();
    const botId = params?.botId;

    const [user, setUser] = useState<User | null>(null);
    const [bot, setBot] = useState<BotDetail | null>(null);
    const [stats, setStats] = useState<BotStats | null>(null);
    const [positions, setPositions] = useState<Position[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        if (!user || !botId) return;
        setError("");
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/bots/${botId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (await res.json()) as {
                success?: boolean;
                bot?: BotDetail;
                stats?: BotStats;
                positions?: Position[];
                trades?: Trade[];
                error?: string;
            };
            if (!res.ok) throw new Error(data.error || "Failed to load bot.");
            setBot(data.bot || null);
            setStats(data.stats || null);
            setPositions(data.positions || []);
            setTrades(data.trades || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load bot.");
        } finally {
            setLoading(false);
        }
    }, [user, botId]);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) setLoading(false);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user || !botId) return;
        const id = window.setTimeout(() => {
            void load();
        }, 0);
        return () => window.clearTimeout(id);
    }, [user, botId, load]);

    const chartData = useMemo(() => {
        if (!trades.length) return [];
        const sorted = [...trades]
            .filter((t) => t.closedAt)
            .sort((a, b) => a.closedAt - b.closedAt);

        let cum = 0;
        return sorted.map((t) => {
            cum += (t.profit || 0) + (t.commission || 0) + (t.swap || 0);
            return { date: fmtTs(t.closedAt), pnl: Math.round(cum * 100) / 100 };
        });
    }, [trades]);

    if (loading) {
        return (
            <AccountShell title="Bot Details">
                <div className="flex items-center justify-center py-24">
                    <Loader2 size={22} className="animate-spin" />
                </div>
            </AccountShell>
        );
    }

    if (error || !bot) {
        return (
            <AccountShell title="Bot Details">
                <div className="space-y-4">
                    {error && (
                        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                            {error}
                        </div>
                    )}
                    <Link
                        href="/account/bots"
                        className="flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm transition hover:bg-muted"
                    >
                        <ArrowLeft size={15} /> Back to My Bots
                    </Link>
                </div>
            </AccountShell>
        );
    }

    const online = bot.online && bot.status !== "disconnected";
    const isMarketplace = bot.type === "marketplace";

    return (
        <AccountShell title={bot.name} subtitle={`${bot.id} · ${isMarketplace ? "Marketplace" : "Custom"} Bot`}>
            <div className="space-y-6" data-guide="page-header">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Link
                            href="/account/bots"
                            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm transition hover:bg-muted"
                        >
                            <ArrowLeft size={14} /> All Bots
                        </Link>
                        <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium">
                            <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
                            {online ? "Online" : "Offline"}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <Link
                            href="/pricing"
                            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm transition hover:bg-muted"
                        >
                            <ShieldCheck size={14} /> Upgrade
                        </Link>
                    </div>
                </div>

                {bot.description && (
                    <p className="rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
                        {bot.description}
                    </p>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard label="Total P/L" icon={<CircleDollarSign size={16} />} value={formatPnl(stats?.totalPnl || 0)} accent={Number(stats?.totalPnl || 0) >= 0 ? "emerald" : "red"} />
                    <StatCard label="Today P/L" icon={<TrendingUp size={16} />} value={formatPnl(stats?.todayPnl || 0)} accent={Number(stats?.todayPnl || 0) >= 0 ? "emerald" : "red"} />
                    <StatCard label="Win rate" icon={<Trophy size={16} />} value={`${stats?.winRate || 0}%`} />
                    <StatCard label="Profit factor" icon={<BarChart3 size={16} />} value={stats?.profitFactor === Infinity ? "∞" : String(stats?.profitFactor || 0)} />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard label="Closed trades" icon={<Activity size={16} />} value={String(stats?.totalTrades || 0)} />
                    <StatCard label="Avg win" icon={<TrendingUp size={16} />} value={formatPnl(stats?.avgWin || 0)} accent="emerald" />
                    <StatCard label="Avg loss" icon={<TrendingDown size={16} />} value={formatPnl(stats?.avgLoss || 0)} accent="red" />
                    <StatCard label="Max drawdown" icon={<TrendingDown size={16} />} value={`$${Math.abs(stats?.maxDrawdown || 0).toFixed(2)}`} accent="red" />
                </div>

                <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Bot size={15} /> Trade
                    </h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                        <Info label="MT5 Account" value={bot.mt5Account || "Not mapped"} />
                        <Info label="Magic Number" value={bot.magicNumber || "—"} />
                        <Info label="Symbol" value={bot.symbol || "—"} />
                        <Info label="Timeframe" value={bot.timeframe || "—"} />
                        <Info label="Comment filter" value={bot.commentFilter || "None"} />
                        <Info label="Connected at" value={formatTime(bot.createdAt)} />
                    </div>
                </div>

                {/* Equity curve from bot trades */}
                {chartData.length > 2 && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <h3 className="mb-3 text-sm font-semibold text-foreground">Equity curve (bot trades)</h3>
                        <ResponsiveContainer width="100%" height={240}>
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="pc" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.15)" />
                                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#888" />
                                <YAxis tick={{ fontSize: 11 }} stroke="#888" tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                                <Tooltip formatter={(v) => formatPnl(Number(v))} />
                                <Area type="monotone" dataKey="pnl" stroke="#22c55e" strokeWidth={2} fill="url(#pc)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Open positions */}
                {positions.length > 0 && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                            <MapPin size={15} /> Open Positions
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                                        <th className="px-3 py-2">Ticket</th>
                                        <th className="px-3 py-2">Symbol</th>
                                        <th className="px-3 py-2">Type</th>
                                        <th className="px-3 py-2 text-right">Volume</th>
                                        <th className="px-3 py-2 text-right">Open</th>
                                        <th className="px-3 py-2 text-right">Current</th>
                                        <th className="px-3 py-2 text-right">P/L</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {positions.map((p) => (
                                        <tr key={p.ticket} className="border-b border-border/50 hover:bg-muted/30">
                                            <td className="px-3 py-2 font-mono text-xs">{p.ticket}</td>
                                            <td className="px-3 py-2">{p.symbol}</td>
                                            <td className="px-3 py-2">
                                                <span className={p.type === "BUY" ? "text-emerald-500" : "text-destructive"}>{p.type}</span>
                                            </td>
                                            <td className="px-3 py-2 text-right">{p.volume}</td>
                                            <td className="px-3 py-2 text-right">{p.openPrice}</td>
                                            <td className="px-3 py-2 text-right">{p.currentPrice}</td>
                                            <td className={`px-3 py-2 text-right font-medium ${p.profit >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                                                {formatPnl(p.profit + p.swap)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Trade history */}
                {trades.length > 0 && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Clock size={15} /> Trade History
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                                        <th className="px-3 py-2">Ticket</th>
                                        <th className="px-3 py-2">Symbol</th>
                                        <th className="px-3 py-2">Type</th>
                                        <th className="px-3 py-2 text-right">Volume</th>
                                        <th className="px-3 py-2 text-right">Open</th>
                                        <th className="px-3 py-2 text-right">Close</th>
                                        <th className="px-3 py-2 text-right">P/L</th>
                                        <th className="px-3 py-2">Closed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trades.slice(0, 100).map((t) => (
                                        <tr key={t.ticket} className="border-b border-border/50 hover:bg-muted/30">
                                            <td className="px-3 py-2 font-mono text-xs">{t.ticket}</td>
                                            <td className="px-3 py-2">{t.symbol}</td>
                                            <td className="px-3 py-2">
                                                <span className={t.type === "BUY" ? "text-emerald-500" : "text-destructive"}>{t.type}</span>
                                            </td>
                                            <td className="px-3 py-2 text-right">{t.volume}</td>
                                            <td className="px-3 py-2 text-right">{t.openPrice}</td>
                                            <td className="px-3 py-2 text-right">{t.closePrice}</td>
                                            <td className={`px-3 py-2 text-right font-medium ${t.profit + t.commission + t.swap >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                                                {formatPnl(t.profit + t.commission + t.swap)}
                                            </td>
                                            <td className="px-3 py-2 text-muted-foreground">{fmtTs(t.closedAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Notes */}
                <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                        <ShieldCheck size={16} /> About bot equity & P/L
                    </p>
                    <ul className="mt-2 list-inside list-disc space-y-1">
                        <li>Equity on MT5 is an account-level property — it is not attributed to individual bots.</li>
                        <li>Bot P/L is calculated from the bot&apos;s own closed trades plus any currently open positions matched by magic number.</li>
                        <li>Max drawdown is peak-to-trough of the bot&apos;s cumulative realized P/L — not the MT5 account equity drawdown.</li>
                    </ul>
                </div>
            </div>
        </AccountShell>
    );
}

function StatCard({
    label,
    icon,
    value,
    accent,
}: {
    label: string;
    icon: React.ReactNode;
    value: string;
    accent?: "emerald" | "red";
}) {
    const colors = accent === "emerald" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : accent === "red" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground";
    return (
        <div className={`rounded-2xl border border-border p-4 ${colors}`}>
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider opacity-80">
                {icon} {label}
            </div>
            <p className="mt-2 text-xl font-bold">{value}</p>
        </div>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
        </>
    );
}