"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, ArrowLeft, Clock, Bell, BellRing, CheckCircle, Trash2,
    Filter, TrendingUp, TrendingDown, Zap, Activity, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type AlertHistory = {
    id: string; source?: "manual" | "tool"; symbol: string; type: string; targetPrice: number | null;
    timeframe: string; message: string; triggered: boolean;
    triggeredAt: number | null; triggeredPrice: number | null; createdAt: number;
};

const TYPE_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
    price_above: { icon: TrendingUp, color: "text-positive" },
    price_below: { icon: TrendingDown, color: "text-negative" },
    structure_bos: { icon: Zap, color: "text-primary" },
    structure_choch: { icon: Activity, color: "text-warning" },
    zone_entry: { icon: Bell, color: "text-info" },
    volatility_high: { icon: Zap, color: "text-warning" },
    session_start: { icon: Clock, color: "text-info" },
    tool_alert: { icon: BellRing, color: "text-primary" },
};

export default function AlertHistoryPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [history, setHistory] = useState<AlertHistory[]>([]);
    const [stats, setStats] = useState({ total: 0, triggered: 0, active: 0 });
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "triggered" | "active">("all");
    const [sourceFilter, setSourceFilter] = useState<"all" | "manual" | "tool">("all");
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
            const res = await fetch("/api/alerts/history", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) { setHistory(json.history || []); setStats(json.stats); }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    const deleteAlert = async (alert: AlertHistory) => {
        if (!user || !confirm("Delete this alert?")) return;
        try {
            const token = await user.getIdToken();
            if (alert.source === "tool") {
                await fetch("/api/pine-alerts", {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ eventId: alert.id }),
                });
            } else {
                await fetch("/api/alerts", {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ alertId: alert.id }),
                });
            }
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
        const filtered = getFiltered();
        setSelected(new Set(filtered.map((a) => a.id)));
    };

    const deselectAll = () => setSelected(new Set());

    const bulkDelete = async () => {
        if (!user || selected.size === 0 || !confirm(`Delete ${selected.size} alert(s)?`)) return;
        setDeleting(true);
        try {
            const token = await user.getIdToken();
            const selectedAlerts = history.filter((a) => selected.has(a.id));
            const toolIds = selectedAlerts.filter((a) => a.source === "tool").map((a) => a.id);
            const manualIds = selectedAlerts.filter((a) => a.source !== "tool").map((a) => a.id);

            const promises: Promise<unknown>[] = [];
            if (toolIds.length > 0) {
                promises.push(
                    fetch("/api/pine-alerts", {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ eventIds: toolIds }),
                    })
                );
            }
            if (manualIds.length > 0) {
                for (const id of manualIds) {
                    promises.push(
                        fetch("/api/alerts", {
                            method: "DELETE",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ alertId: id }),
                        })
                    );
                }
            }
            await Promise.all(promises);
            setSelected(new Set());
            fetchData();
        } catch {} finally { setDeleting(false); }
    };

    const getFiltered = () => {
        return history.filter((a) => {
            if (filter === "triggered" && !a.triggered) return false;
            if (filter === "active" && a.triggered) return false;
            if (sourceFilter === "manual" && a.source === "tool") return false;
            if (sourceFilter === "tool" && a.source !== "tool") return false;
            return true;
        });
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">Sign In</Link></div></div>);
    }

    const filtered = getFiltered();
    const manualCount = history.filter((a) => a.source !== "tool").length;
    const toolCount = history.filter((a) => a.source === "tool").length;

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-warning/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-warning/10 hidden" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-info/10 hidden" />
            </div>
            <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Alert History</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">View all alerts and their trigger history</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {selected.size > 0 && (
                            <button
                                type="button"
                                onClick={bulkDelete}
                                disabled={deleting}
                                className="flex items-center gap-2 rounded-lg border border-negative/20 bg-negative/10 px-4 py-2.5 text-xs font-semibold text-negative hover:bg-negative/20 transition disabled:opacity-50"
                            >
                                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                Delete ({selected.size})
                            </button>
                        )}
                        <Link href="/alerts" className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition">
                            <BellRing size={13} /> New Alert
                        </Link>
                    </div>
                </div>

                {/* Stats */}
                <div className="mb-6 grid grid-cols-4 gap-4" data-guide="stats">
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-4">
                        <div className="flex items-center gap-2 mb-1"><Bell size={13} className="text-primary" /><span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Total</span></div>
                        <p className="text-xl font-bold font-numeric text-foreground">{stats.total}</p>
                    </div>
                    <div className="rounded-lg border border-positive/10 bg-positive/[0.03] p-4">
                        <div className="flex items-center gap-2 mb-1"><CheckCircle size={13} className="text-positive" /><span className="text-micro font-semibold uppercase tracking-wider text-positive/60">Triggered</span></div>
                        <p className="text-xl font-bold font-numeric text-positive">{stats.triggered}</p>
                    </div>
                    <div className="rounded-lg border border-warning/10 bg-warning/[0.03] p-4">
                        <div className="flex items-center gap-2 mb-1"><Clock size={13} className="text-warning" /><span className="text-micro font-semibold uppercase tracking-wider text-warning/60">Active</span></div>
                        <p className="text-xl font-bold font-numeric text-warning">{stats.active}</p>
                    </div>
                    <div className="rounded-lg border border-info/10 bg-info/[0.03] p-4">
                        <div className="flex items-center gap-2 mb-1"><Zap size={13} className="text-info" /><span className="text-micro font-semibold uppercase tracking-wider text-info/60">Sources</span></div>
                        <p className="text-sm font-numeric text-foreground"><span className="text-info">{manualCount}</span> <span className="text-muted-foreground text-micro">manual</span> / <span className="text-primary">{toolCount}</span> <span className="text-muted-foreground text-micro">tool</span></p>
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                        {/* Status filter */}
                        <div className="flex gap-1.5 rounded-lg border border-border/30 bg-muted/30 p-1">
                            {(["all", "triggered", "active"] as const).map((f) => (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => { setFilter(f); setSelected(new Set()); }}
                                    className={cn(
                                        "rounded-lg px-3 py-1.5 text-micro font-medium transition-all",
                                        filter === f
                                            ? f === "triggered" ? "bg-positive/20 text-positive" : f === "active" ? "bg-warning/20 text-warning" : "bg-primary text-foreground"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {f.charAt(0).toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                        </div>
                        {/* Source filter */}
                        <div className="flex gap-1.5 rounded-lg border border-border/30 bg-muted/30 p-1">
                            {(["all", "manual", "tool"] as const).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => { setSourceFilter(s); setSelected(new Set()); }}
                                    className={cn(
                                        "rounded-lg px-3 py-1.5 text-micro font-medium transition-all",
                                        sourceFilter === s
                                            ? s === "tool" ? "bg-primary/20 text-primary" : s === "manual" ? "bg-info/20 text-info" : "bg-primary text-foreground"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {s === "all" ? "All Sources" : s.charAt(0).toUpperCase() + s.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    {filtered.length > 0 && (
                        <button
                            type="button"
                            onClick={selected.size === filtered.length ? deselectAll : selectAll}
                            className="text-micro text-muted-foreground hover:text-foreground transition"
                        >
                            {selected.size === filtered.length ? "Deselect all" : "Select all"}
                        </button>
                    )}
                </div>

                {loading && history.length === 0 ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/40 p-16 text-center">
                        <Bell size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">
                            {history.length === 0 ? "No alerts found" : "No alerts match your filters"}
                        </p>
                        {history.length === 0 && (
                            <Link href="/alerts" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">Create an alert</Link>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filtered.map((alert) => {
                            const typeInfo = TYPE_ICONS[alert.type] || { icon: Bell, color: "text-muted-foreground" };
                            const Icon = typeInfo.icon;

                            return (
                                <div
                                    key={alert.id}
                                    className={cn(
                                        "group flex items-center gap-4 rounded-lg border p-4 transition-all",
                                        selected.has(alert.id)
                                            ? "border-primary/30 bg-primary/5"
                                            : alert.triggered
                                                ? "border-positive/10 bg-positive/[0.02] hover:bg-positive/[0.04]"
                                                : "border-border/30 bg-muted/50 hover:bg-muted"
                                    )}
                                >
                                    {/* Checkbox */}
                                    <input
                                        type="checkbox"
                                        checked={selected.has(alert.id)}
                                        onChange={() => toggleSelect(alert.id)}
                                        className="h-4 w-4 rounded border-border/50 bg-muted/10 text-primary focus:ring-primary/30"
                                    />

                                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0", alert.triggered ? "bg-positive/10" : "bg-muted")}>
                                        <Icon size={16} className={alert.triggered ? "text-positive" : typeInfo.color} />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-numeric text-sm font-bold text-foreground">{alert.symbol}</span>
                                            <span className={cn("text-micro font-medium", typeInfo.color)}>
                                                {alert.type.replace(/_/g, " ")}
                                            </span>
                                            {alert.source === "tool" && (
                                                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-micro font-semibold text-primary">Tool</span>
                                            )}
                                            {alert.source === "manual" && (
                                                <span className="rounded-md bg-info/10 px-1.5 py-0.5 text-micro font-semibold text-info">Manual</span>
                                            )}
                                            {alert.targetPrice && (
                                                <span className="font-numeric text-micro text-muted-foreground">@ {alert.targetPrice}</span>
                                            )}
                                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">{alert.timeframe}</span>
                                        </div>
                                        <p className="mt-0.5 text-micro text-muted-foreground truncate max-w-lg">{alert.message}</p>
                                    </div>

                                    <div className="text-right flex-shrink-0">
                                        {alert.triggered ? (
                                            <div>
                                                <span className="flex items-center gap-1 text-micro text-positive">
                                                    <CheckCircle size={10} /> Triggered
                                                </span>
                                                {alert.triggeredPrice && (
                                                    <p className="font-numeric text-micro text-muted-foreground">@ {alert.triggeredPrice}</p>
                                                )}
                                                {alert.triggeredAt && (
                                                    <p className="text-micro text-muted-foreground">{new Date(alert.triggeredAt).toLocaleString()}</p>
                                                )}
                                            </div>
                                        ) : (
                                            <div>
                                                <span className="flex items-center gap-1 text-micro text-warning">
                                                    <Clock size={10} /> Waiting
                                                </span>
                                                <p className="text-micro text-muted-foreground">Created {new Date(alert.createdAt).toLocaleDateString()}</p>
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => deleteAlert(alert)}
                                        className="rounded-lg p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-negative hover:bg-negative/10 transition-all flex-shrink-0"
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
