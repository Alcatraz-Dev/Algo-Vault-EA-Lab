"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, ArrowLeft, Bell, BellRing, Trash2, CheckCircle,
    AlertTriangle, Clock, Zap, Activity, X, Power, PowerOff, Filter,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ToolAlertDefinition = {
    id: string;
    scriptId: string;
    scriptName: string;
    symbol: string;
    timeframe: string;
    alertTitle: string;
    message: string;
    frequency: string;
    direction: string;
    price: number | undefined;
    signalStrength: string;
    isActive: boolean;
    createdAt: number;
    expiredAt: number | undefined;
    expiration: string;
    notifyInApp: boolean;
    notifyWebhook: boolean;
    webhookUrl: string;
    notifyDiscord: boolean;
    notifyTelegram: boolean;
    notifyEmail: boolean;
    playSound: boolean;
    soundName: string;
    lastTriggeredAt: number | undefined;
};

const FREQUENCY_LABELS: Record<string, string> = {
    once: "Once",
    once_per_bar: "Once Per Bar",
    once_per_bar_close: "Once Per Bar Close",
    every_time: "Every Time",
};

function currentTimestamp(): number {
    return Date.now();
}

const DIRECTION_COLORS: Record<string, string> = {
    long: "text-emerald-400 bg-emerald-500/10",
    short: "text-rose-400 bg-rose-500/10",
    neutral: "text-blue-400 bg-blue-500/10",
};

export default function ToolAlertsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [definitions, setDefinitions] = useState<ToolAlertDefinition[]>([]);
    const [stats, setStats] = useState({ total: 0, active: 0, expired: 0 });
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "active" | "expired">("all");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/pine-alerts?view=definitions", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (json.success) {
                setDefinitions(json.definitions || []);
                setStats(json.stats || { total: 0, active: 0, expired: 0 });
            }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    const now = useMemo(() => currentTimestamp(), []);

    const isExpired = (def: ToolAlertDefinition) =>
        def.isActive === false || (def.expiredAt && def.expiredAt <= now);

    const deleteDefinition = async (def: ToolAlertDefinition) => {
        if (!user || !confirm(`Delete alert "${def.alertTitle || def.scriptName}"?`)) return;
        try {
            const token = await user.getIdToken();
            await fetch("/api/pine-alerts", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ definitionId: def.id }),
            });
            fetchData();
        } catch {}
    };

    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => {
        const filtered = definitions.filter((d) => {
            if (filter === "active") return !isExpired(d);
            if (filter === "expired") return isExpired(d);
            return true;
        });
        setSelected(new Set(filtered.map((d) => d.id)));
    };

    const deselectAll = () => setSelected(new Set());

    const bulkDelete = async () => {
        if (!user || selected.size === 0 || !confirm(`Delete ${selected.size} alert(s)?`)) return;
        setDeleting(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/pine-alerts", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ definitionIds: Array.from(selected) }),
            });
            setSelected(new Set());
            fetchData();
        } catch {} finally { setDeleting(false); }
    };

    const clearAll = async () => {
        if (!user || !confirm("Delete ALL tool alerts? This cannot be undone.")) return;
        setDeleting(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/pine-alerts", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ clearAllDefinitions: true }),
            });
            setSelected(new Set());
            fetchData();
        } catch {} finally { setDeleting(false); }
    };

    if (authLoading) {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <Shield size={40} className="text-muted-foreground" />
                    <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                    <Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">
                        Sign In
                    </Link>
                </div>
            </div>
        );
    }

    const filtered = definitions.filter((d) => {
        if (filter === "active") return !isExpired(d);
        if (filter === "expired") return isExpired(d);
        return true;
    });

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Tool Alerts</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Manage Pine Script and strategy alert definitions</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {selected.size > 0 && (
                            <button
                                type="button"
                                onClick={bulkDelete}
                                disabled={deleting}
                                className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
                            >
                                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                Delete ({selected.size})
                            </button>
                        )}
                        {definitions.length > 0 && (
                            <button
                                type="button"
                                onClick={clearAll}
                                className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition"
                            >
                                <Trash2 size={13} /> Clear all
                            </button>
                        )}
                    </div>
                </div>

                {/* Stats */}
                <div className="mb-6 grid grid-cols-3 gap-4" data-guide="stats">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Bell size={13} className="text-violet-400" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</span>
                        </div>
                        <p className="text-xl font-bold font-mono text-foreground">{stats.total}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.03] p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <CheckCircle size={13} className="text-emerald-400" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500/60">Active</span>
                        </div>
                        <p className="text-xl font-bold font-mono text-emerald-400">{stats.active}</p>
                    </div>
                    <div className="rounded-2xl border border-rose-500/10 bg-rose-500/[0.03] p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle size={13} className="text-rose-400" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-500/60">Expired</span>
                        </div>
                        <p className="text-xl font-bold font-mono text-rose-400">{stats.expired}</p>
                    </div>
                </div>

                {/* Filters + Select All */}
                <div className="mb-4 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                        {(["all", "active", "expired"] as const).map((f) => (
                            <button
                                key={f}
                                type="button"
                                onClick={() => { setFilter(f); setSelected(new Set()); }}
                                className={cn(
                                    "rounded-xl px-4 py-2 text-xs font-medium transition-all",
                                    filter === f
                                        ? f === "active" ? "bg-emerald-500/20 text-emerald-400" : f === "expired" ? "bg-rose-500/20 text-rose-400" : "bg-violet-600 text-foreground"
                                        : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
                                )}
                            >
                                {f.charAt(0).toUpperCase() + f.slice(1)}
                            </button>
                        ))}
                    </div>
                    {filtered.length > 0 && (
                        <button
                            type="button"
                            onClick={selected.size === filtered.length ? deselectAll : selectAll}
                            className="text-[11px] text-muted-foreground hover:text-foreground transition"
                        >
                            {selected.size === filtered.length ? "Deselect all" : "Select all"}
                        </button>
                    )}
                </div>

                {loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Bell size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">
                            {filter === "all" ? "No tool alerts configured" : `No ${filter} alerts`}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground/60">
                            Create alerts from the TradingView chart using Pine Script
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filtered.map((def) => {
                            const expired = isExpired(def);
                            return (
                                <div
                                    key={def.id}
                                    className={cn(
                                        "group flex items-center gap-4 rounded-2xl border p-4 transition-all",
                                        expired
                                            ? "border-rose-500/10 bg-rose-500/[0.02] opacity-60"
                                            : "border-border/30 bg-muted/50 hover:bg-muted"
                                    )}
                                >
                                    {/* Checkbox */}
                                    <input
                                        type="checkbox"
                                        checked={selected.has(def.id)}
                                        onChange={() => toggleSelect(def.id)}
                                        className="h-4 w-4 rounded border-border/50 bg-muted/10 text-violet-500 focus:ring-violet-500/30"
                                    />

                                    {/* Status icon */}
                                    <div className={cn(
                                        "flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0",
                                        expired ? "bg-rose-500/10" : "bg-emerald-500/10"
                                    )}>
                                        {expired
                                            ? <PowerOff size={16} className="text-rose-400" />
                                            : <Power size={16} className="text-emerald-400" />
                                        }
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono text-sm font-bold text-foreground">{def.symbol}</span>
                                            <span className="text-xs text-muted-foreground">{def.alertTitle || def.scriptName}</span>
                                            {def.direction && def.direction !== "neutral" && (
                                                <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-medium", DIRECTION_COLORS[def.direction] || "text-muted-foreground bg-muted")}>
                                                    {def.direction.toUpperCase()}
                                                </span>
                                            )}
                                            {def.price && (
                                                <span className="font-mono text-[10px] text-muted-foreground">@ {def.price}</span>
                                            )}
                                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{def.timeframe}</span>
                                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                                {FREQUENCY_LABELS[def.frequency] || def.frequency}
                                            </span>
                                        </div>
                                        {def.message && (
                                            <p className="mt-0.5 text-[11px] text-muted-foreground truncate max-w-lg">{def.message}</p>
                                        )}
                                        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/60">
                                            <span>Created {new Date(def.createdAt).toLocaleDateString()}</span>
                                            {def.expiredAt && (
                                                <span>Expires {new Date(def.expiredAt).toLocaleDateString()}</span>
                                            )}
                                            {def.lastTriggeredAt && (
                                                <span>Last fired {new Date(def.lastTriggeredAt).toLocaleDateString()}</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Notification channels */}
                                    <div className="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground/60 flex-shrink-0">
                                        {def.notifyDiscord && <span className="rounded bg-muted px-1.5 py-0.5">Discord</span>}
                                        {def.notifyTelegram && <span className="rounded bg-muted px-1.5 py-0.5">Telegram</span>}
                                        {def.notifyWebhook && <span className="rounded bg-muted px-1.5 py-0.5">Webhook</span>}
                                        {def.notifyEmail && <span className="rounded bg-muted px-1.5 py-0.5">Email</span>}
                                        {def.playSound && <span className="rounded bg-muted px-1.5 py-0.5">Sound</span>}
                                    </div>

                                    {/* Delete */}
                                    <button
                                        type="button"
                                        onClick={() => deleteDefinition(def)}
                                        className="rounded-lg p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 transition-all flex-shrink-0"
                                        title="Delete alert"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
