"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import {
    Plus,
    Search,
    Trash2,
    ExternalLink,
    X,
    BarChart3,
    Upload,
    RefreshCw,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";

type Backtest = {
    id: string;
    title: string;
    productSlug: string;
    pair: string;
    timeframe: string;
    period: string;
    initialBalance: number;
    netProfit: number;
    winRate: number;
    maxDrawdown: number;
    reportUrl: string;
    reportFile: string;
    createdAt: number;
};

type Bot = { id: string; name?: string; slug?: string; symbol?: string };

function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    return user.getIdToken();
}

export default function AdminBacktestsPage() {
    const [backtests, setBacktests] = useState<Backtest[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [search, setSearch] = useState("");
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [bots, setBots] = useState<Bot[]>([]);

    const [title, setTitle] = useState("");
    const [selectedBotId, setSelectedBotId] = useState("");
    const [pair, setPair] = useState("");
    const [timeframe, setTimeframe] = useState("");
    const [period, setPeriod] = useState("");
    const [initialBalance, setInitialBalance] = useState("");
    const [netProfit, setNetProfit] = useState("");
    const [winRate, setWinRate] = useState("");
    const [maxDrawdown, setMaxDrawdown] = useState("");
    const [file, setFile] = useState<File | null>(null);

    const fetchBacktests = async () => {
        setLoading(true);
        setLoadError("");
        try {
            const token = await getToken();
            const res = await fetch("/api/admin/backtests", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            if (!res.ok) throw new Error((await res.json())?.error ?? "Unable to load backtests.");
            const data = await res.json();
            setBacktests(Array.isArray(data?.backtests) ? data.backtests : []);
        } catch (err) {
            console.error("Error loading backtests:", err);
            setLoadError(err instanceof Error ? err.message : "Unable to load backtests.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const botsRef = ref(database, "bots");
        const unsub = onValue(botsRef, (snap) => {
            const data = snap.val() || {};
            const list: Bot[] = Object.entries(data).map(([id, val]) => ({
                id,
                ...(val as Record<string, unknown>),
            })) as Bot[];
            setBots(list);
        });
        return unsub;
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) fetchBacktests();
            else setLoading(false);
        });
        return unsubscribe;
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        const selectedBot = bots.find((b) => b.id === selectedBotId);
        if (!title || !file || !selectedBot) return;
        setSaving(true);
        try {
            const token = await getToken();
            const formData = new FormData();
            formData.set("file", file);
            formData.set("title", title);
            formData.set("productSlug", selectedBot.slug || selectedBotId);
            formData.set("pair", pair);
            formData.set("timeframe", timeframe);
            formData.set("period", period);
            formData.set("initialBalance", String(initialBalance));
            formData.set("netProfit", String(netProfit));
            formData.set("winRate", String(winRate));
            formData.set("maxDrawdown", String(maxDrawdown));

            const res = await fetch("/api/admin/backtests", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            if (!res.ok) throw new Error((await res.json())?.error ?? "Upload failed.");
            setShowModal(false);
            setFile(null);
            setTitle("");
            fetchBacktests();
        } catch (err) {
            console.error("Failed to add backtest:", err);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item: Backtest) => {
        if (!confirm("Are you sure you want to delete this backtest report?")) return;
        try {
            const token = await getToken();
            const res = await fetch("/api/admin/backtests", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ id: item.id, reportFile: item.reportFile }),
            });
            if (!res.ok) throw new Error("Delete failed.");
            setBacktests((prev) => prev.filter((b) => b.id !== item.id));
        } catch (err) {
            console.error("Failed to delete backtest:", err);
        }
    };

    const filtered = backtests.filter(
        (b) =>
            String(b.title ?? "").toLowerCase().includes(search.toLowerCase()) ||
            String(b.pair ?? "").toLowerCase().includes(search.toLowerCase()) ||
            String(b.productSlug ?? "").toLowerCase().includes(search.toLowerCase())
    );

    return (
        <AdminShell
            title="Backtest Reports"
            subtitle="Publish verified MT5 strategy backtest results & performance reports"
        >
            {/* Action Bar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <input
                        type="text"
                        placeholder="Search by title, pair, or bot..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-xl border border-border bg-muted pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-emerald-500 focus:outline-none"
                    />
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-background transition hover:bg-emerald-400"
                >
                    <Plus size={16} /> Add Backtest Report
                </button>
            </div>

            {/* Content List */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"></div>
                </div>
            ) : loadError ? (
                <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.05] p-12 text-center">
                    <BarChart3 size={40} className="mx-auto text-rose-400 mb-3" />
                    <h3 className="text-lg font-bold text-foreground">Failed to Load Backtests</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">{loadError}</p>
                    <button
                        onClick={() => fetchBacktests()}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-background hover:bg-emerald-400 transition"
                    >
                        <RefreshCw size={15} /> Retry
                    </button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center">
                    <BarChart3 size={40} className="mx-auto text-muted-foreground mb-3" />
                    <h3 className="text-lg font-bold text-foreground">No Backtest Reports Published</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                        Add historical strategy backtest reports to demonstrate EA profitability to potential buyers.
                    </p>
                    <button
                        onClick={() => setShowModal(true)}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
                    >
                        <Plus size={16} /> Add First Backtest
                    </button>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((item) => (
                        <div
                            key={item.id}
                            className="rounded-2xl border border-border bg-card p-5 transition hover:border-border flex flex-col justify-between"
                        >
                            <div>
                                <div className="flex items-start justify-between">
                                    <div>
                                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground font-mono">
                                            {item.pair} • {item.timeframe}
                                        </span>
                                        <h4 className="font-bold text-foreground text-base mt-2">{item.title}</h4>
                                        <p className="text-xs text-muted-foreground mt-0.5">{item.period}</p>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(item)}
                                        className="text-muted-foreground hover:text-rose-400 transition"
                                        title="Delete report"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted p-3 text-center border border-border/60">
                                    <div>
                                        <p className="text-[10px] uppercase text-muted-foreground font-semibold">Net Profit</p>
                                        <p className="text-sm font-bold text-emerald-600 mt-0.5">
                                            +${item.netProfit.toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase text-muted-foreground font-semibold">Win Rate</p>
                                        <p className="text-sm font-bold text-foreground mt-0.5">{item.winRate}%</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase text-muted-foreground font-semibold">Max DD</p>
                                        <p className="text-sm font-bold text-rose-400 mt-0.5">{item.maxDrawdown}%</p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">Bot: <strong className="text-foreground">{item.productSlug}</strong></span>
                                <a
                                    href={item.reportUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline"
                                >
                                    View Full Report <ExternalLink size={13} />
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border pb-4">
                            <h3 className="text-lg font-bold text-foreground">Add Backtest Report</h3>
                            <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="mt-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Report Title</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. 5-Year Tick Data Backtest (99.9% Quality)"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Pair / Symbol</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="XAUUSD"
                                        value={pair}
                                        onChange={(e) => setPair(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Timeframe</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="M15"
                                        value={timeframe}
                                        onChange={(e) => setTimeframe(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Net Profit ($)</label>
                                    <input
                                        type="number"
                                        required
                                        placeholder="e.g. 14500"
                                        value={netProfit}
                                        onChange={(e) => setNetProfit(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Win Rate (%)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        required
                                        placeholder="e.g. 78.5"
                                        value={winRate}
                                        onChange={(e) => setWinRate(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Max DD (%)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        required
                                        placeholder="e.g. 6.2"
                                        value={maxDrawdown}
                                        onChange={(e) => setMaxDrawdown(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Product / Bot</label>
                                    <select
                                        required
                                        value={selectedBotId}
                                        onChange={(e) => setSelectedBotId(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    >
                                        <option value="">Select a product...</option>
                                        {bots.map((bot) => (
                                            <option key={bot.id} value={bot.id}>
                                                {bot.name || bot.slug || bot.id}
                                                {bot.symbol ? ` (${bot.symbol})` : ""}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Initial Balance ($)</label>
                                    <input
                                        type="number"
                                        required
                                        placeholder="e.g. 10000"
                                        value={initialBalance}
                                        onChange={(e) => setInitialBalance(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Period</label>
                                <input
                                    type="text"
                                    value={period}
                                    onChange={(e) => setPeriod(e.target.value)}
                                    placeholder="e.g. 2021 - 2026 (5 Years)"
                                    className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">HTML Report File</label>
                                <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted p-6 transition hover:border-emerald-500/50 hover:bg-card">
                                    <Upload size={20} className="text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">
                                        {file ? (
                                            <span className="font-medium text-emerald-600">{file.name}</span>
                                        ) : (
                                            "Click to upload MT5 HTML report (max 20 MB)"
                                        )}
                                    </span>
                                    <input
                                        type="file"
                                        required
                                        accept=".html,.htm"
                                        className="hidden"
                                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                                    />
                                </label>
                            </div>

                            <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-background hover:bg-emerald-400 disabled:opacity-50"
                                >
                                    {saving ? "Uploading..." : "Publish Backtest"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}