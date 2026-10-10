"use client";

import { useState, useCallback, useEffect } from "react";
import {
    Loader2, Shield, ArrowLeft, Bell, BellRing, CheckCircle, Target, Lock,
    Zap, AlertTriangle, Activity, TrendingUp, TrendingDown, Eye, Trash2, X,
} from "lucide-react";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type Notification = {
    id: string; title: string; message: string; severity: string; link?: string;
    event?: string; symbol?: string; direction?: string; read: boolean; createdAt: number;
    metadata?: Record<string, unknown>;
};

const EVENT_ICONS: Record<string, React.ElementType> = {
    TRADE_OPENED: Activity, TP1_HIT: Target, TP2_HIT: Target, TP3_HIT: Target,
    BREAK_EVEN_APPLIED: Lock, PROFIT_LOCK_APPLIED: Lock, RUNNER_ACTIVE: Zap,
    STOP_LOSS_HIT: AlertTriangle, TRADE_CLOSED_PROFIT: CheckCircle, TRADE_CLOSED_LOSS: AlertTriangle,
    TP1_APPROACHING: Target, TP2_APPROACHING: Target, TP3_APPROACHING: Target,
};

const SEVERITY_COLORS: Record<string, string> = {
    success: "text-positive bg-positive/10",
    warning: "text-warning bg-warning/10",
    error: "text-negative bg-negative/10",
    info: "text-info bg-info/10",
};

export default function AlertCenterPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "unread" | "trades" | "targets" | "risk">("all");
    const [unreadCount, setUnreadCount] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [selectMode, setSelectMode] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/trade-management/notifications?limit=100", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setNotifications(data.notifications || []);
                setUnreadCount(data.unreadCount || 0);
            }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    const markRead = async (id: string) => {
        if (!user) return;
        const token = await user.getIdToken();
        await fetch("/api/trade-management/notifications", {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ notificationId: id }),
        });
        setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
        setUnreadCount((prev) => Math.max(0, prev - 1));
    };

    const markAllRead = async () => {
        if (!user) return;
        const token = await user.getIdToken();
        await fetch("/api/trade-management/notifications", {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ markAll: true }),
        });
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
    };

    const deleteNotif = async (id: string) => {
        if (!user || !confirm("Delete this notification?")) return;
        const previous = notifications;
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        const wasUnread = previous.find((n) => n.id === id)?.read === false;
        if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));
        try {
            const token = await user.getIdToken();
            const res = await fetch(
                `/api/trade-management/notifications?notificationId=${encodeURIComponent(id)}`,
                { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
            );
            if (!res.ok) setNotifications(previous);
        } catch {
            setNotifications(previous);
        }
    };

    const clearAll = async () => {
        if (!user || notifications.length === 0) return;
        if (!confirmClear) { setConfirmClear(true); return; }
        setNotifications([]);
        setUnreadCount(0);
        setConfirmClear(false);
        try {
            const token = await user.getIdToken();
            await fetch("/api/trade-management/notifications?clearAll=true", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch {
            fetchData();
        }
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
        const filtered = notifications.filter((n) => {
            if (filter === "unread") return !n.read;
            if (filter === "trades") return ["TRADE_OPENED", "TRADE_MODIFIED", "TRADE_CLOSED_PROFIT", "TRADE_CLOSED_LOSS", "STOP_LOSS_HIT"].includes(n.event || "");
            if (filter === "targets") return ["TP1_HIT", "TP2_HIT", "TP3_HIT", "TP1_APPROACHING", "TP2_APPROACHING", "TP3_APPROACHING"].includes(n.event || "");
            if (filter === "risk") return ["BREAK_EVEN_APPLIED", "PROFIT_LOCK_APPLIED", "RUNNER_ACTIVE", "STOP_LOSS_HIT"].includes(n.event || "");
            return true;
        });
        setSelected(new Set(filtered.map((n) => n.id)));
    };

    const deselectAll = () => setSelected(new Set());

    const bulkDelete = async () => {
        if (!user || selected.size === 0 || !confirm(`Delete ${selected.size} notification(s)?`)) return;
        const previous = notifications;
        const selectedIds = new Set(selected);
        setNotifications((prev) => prev.filter((n) => !selectedIds.has(n.id)));
        const removedUnread = previous.filter((n) => selectedIds.has(n.id) && !n.read).length;
        setUnreadCount((prev) => Math.max(0, prev - removedUnread));
        setSelected(new Set());
        setSelectMode(false);
        try {
            const token = await user.getIdToken();
            const promises = Array.from(selectedIds).map((id) =>
                fetch(`/api/trade-management/notifications?notificationId=${encodeURIComponent(id)}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}` },
                })
            );
            await Promise.all(promises);
        } catch {
            fetchData();
        }
    };

    if (authLoading) return <div className="flex min-h-screen bg-background items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    if (!user) return <div className="flex min-h-screen bg-background items-center justify-center gap-4 flex-col"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">Sign In</Link></div>;

    const filtered = notifications.filter((n) => {
        if (filter === "unread") return !n.read;
        if (filter === "trades") return ["TRADE_OPENED", "TRADE_MODIFIED", "TRADE_CLOSED_PROFIT", "TRADE_CLOSED_LOSS", "STOP_LOSS_HIT"].includes(n.event || "");
        if (filter === "targets") return ["TP1_HIT", "TP2_HIT", "TP3_HIT", "TP1_APPROACHING", "TP2_APPROACHING", "TP3_APPROACHING"].includes(n.event || "");
        if (filter === "risk") return ["BREAK_EVEN_APPLIED", "PROFIT_LOCK_APPLIED", "RUNNER_ACTIVE", "STOP_LOSS_HIT"].includes(n.event || "");
        return true;
    });

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-warning/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-warning/10 hidden" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-info/10 hidden" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition"><ArrowLeft size={12} /> Back to Account</Link>

                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Alert Center</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Trade events, target hits, and management notifications</p>
                    </div>
                    {notifications.length > 0 && (
                        <div className="flex items-center gap-2">
                            {selectMode ? (
                                <>
                                    <span className="text-micro text-muted-foreground">{selected.size} selected</span>
                                    <button type="button" onClick={selected.size > 0 ? bulkDelete : undefined} disabled={selected.size === 0} className="flex items-center gap-2 rounded-lg border border-negative/20 bg-negative/10 px-4 py-2.5 text-xs font-semibold text-negative hover:bg-negative/20 transition disabled:opacity-50">
                                        <Trash2 size={13} /> Delete
                                    </button>
                                    <button type="button" onClick={() => { setSelectMode(false); setSelected(new Set()); }} className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition">
                                        <X size={13} /> Cancel
                                    </button>
                                </>
                            ) : (
                                <>
                                    {unreadCount > 0 && (
                                        <button type="button" onClick={markAllRead} className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/20 transition">
                                            <Eye size={13} /> Mark all read ({unreadCount})
                                        </button>
                                    )}
                                    <button type="button" onClick={() => setSelectMode(true)} className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition">
                                        <Trash2 size={13} /> Select
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearAll}
                                        className={cn(
                                          "flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition",
                                            confirmClear
                                                ? "border border-negative/40 bg-negative/20 text-negative hover:bg-negative/30"
                                                : "border border-negative/20 bg-negative/10 text-negative hover:bg-negative/20"
                                        )}
                                    >
                                        <Trash2 size={13} /> {confirmClear ? "Confirm delete all?" : "Clear all"}
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Stats */}
                <div className="mb-6 grid grid-cols-4 gap-4" data-guide="stats">
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-4">
                        <p className="text-micro font-semibold uppercase text-muted-foreground">Unread</p>
                        <p className="text-xl font-bold font-numeric text-primary">{unreadCount}</p>
                    </div>
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-4">
                        <p className="text-micro font-semibold uppercase text-muted-foreground">Target Hits</p>
                        <p className="text-xl font-bold font-numeric text-positive">{notifications.filter((n) => ["TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(n.event || "")).length}</p>
                    </div>
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-4">
                        <p className="text-micro font-semibold uppercase text-muted-foreground">Risk Events</p>
                        <p className="text-xl font-bold font-numeric text-warning">{notifications.filter((n) => ["BREAK_EVEN_APPLIED", "PROFIT_LOCK_APPLIED"].includes(n.event || "")).length}</p>
                    </div>
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-4">
                        <p className="text-micro font-semibold uppercase text-muted-foreground">Total</p>
                        <p className="text-xl font-bold font-numeric text-foreground">{notifications.length}</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-4 flex gap-2" data-guide="filters">
                    {(["all", "unread", "trades", "targets", "risk"] as const).map((f) => (
                        <button key={f} type="button" onClick={() => { setFilter(f); setSelected(new Set()); setSelectMode(false); }} className={cn("rounded-lg px-4 py-2 text-xs font-medium transition-all", filter === f ? "bg-primary text-foreground" : "text-muted-foreground hover:text-muted-foreground bg-muted")}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/40 p-16 text-center">
                        <Bell size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No notifications</p>
                    </div>
                ) : (
                    <div className="space-y-2" data-guide="notifications">
                        {filtered.map((notif) => {
                            const Icon = EVENT_ICONS[notif.event || ""] || Bell;
                            const sevColor = SEVERITY_COLORS[notif.severity] || SEVERITY_COLORS.info;

                            return (
                                <div
                                    key={notif.id}
                                    onClick={() => {
                                        if (selectMode) toggleSelect(notif.id);
                                        else if (!notif.read) markRead(notif.id);
                                    }}
                                    className={cn(
                                        "flex items-start gap-4 rounded-lg border p-4 transition-all cursor-pointer",
                                        selected.has(notif.id)
                                            ? "border-primary/30 bg-primary/5"
                                            : notif.read
                                                ? "border-border/20 bg-muted/10 opacity-60"
                                                : "border-border/40 bg-muted hover:bg-muted/20"
                                    )}
                                >
                                    {selectMode && (
                                        <input
                                            type="checkbox"
                                            checked={selected.has(notif.id)}
                                            onChange={() => toggleSelect(notif.id)}
                                            className="mt-1 h-4 w-4 rounded border-border/50 bg-muted/10 text-primary focus:ring-primary/30"
                                        />
                                    )}
                                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0", sevColor)}>
                                        <Icon size={16} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-foreground">{notif.title}</span>
                                            {!notif.read && !selectMode && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
                                        </div>
                                        <p className="mt-1 text-micro text-muted-foreground whitespace-pre-line">{notif.message}</p>
                                        {notif.symbol && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="rounded-md bg-muted px-2 py-0.5 text-micro font-numeric text-muted-foreground">{notif.symbol}</span>
                                                {notif.direction && <span className={cn("rounded-md px-2 py-0.5 text-micro font-medium", notif.direction === "BUY" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative")}>{notif.direction}</span>}
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-micro text-muted-foreground flex-shrink-0">{new Date(notif.createdAt).toLocaleTimeString()}</span>
                                    {!selectMode && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); deleteNotif(notif.id); }}
                                            className="rounded-lg p-1.5 text-muted-foreground hover:text-negative hover:bg-negative/10 transition flex-shrink-0"
                                            aria-label="Delete notification"
                                            title="Delete notification"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
