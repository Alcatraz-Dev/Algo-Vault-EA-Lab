"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    ArrowLeft,
    Bell,
    BellRing,
    Loader2,
    Plus,
    Trash2,
    TrendingUp,
    TrendingDown,
    Zap,
    Activity,
    Clock,
    Shield,
    CheckCircle,
    X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type AlertType = "price_above" | "price_below" | "structure_bos" | "structure_choch" | "zone_entry" | "volatility_high" | "session_start";

type Alert = {
    id: string;
    symbol: string;
    type: AlertType;
    targetPrice?: number;
    timeframe: string;
    message: string;
    notifyDiscord: boolean;
    notifyTelegram: boolean;
    notifyInApp: boolean;
    triggered: boolean;
    triggeredAt?: number;
    createdAt: number;
};

const ALERT_TYPES: { value: AlertType; label: string; icon: React.ElementType; description: string }[] = [
    { value: "price_above", label: "Price Above", icon: TrendingUp, description: "Alert when price crosses above a level" },
    { value: "price_below", label: "Price Below", icon: TrendingDown, description: "Alert when price crosses below a level" },
    { value: "structure_bos", label: "BOS Detected", icon: Zap, description: "Alert on Break of Structure" },
    { value: "structure_choch", label: "CHoCH Detected", icon: Activity, description: "Alert on Change of Character" },
    { value: "zone_entry", label: "Zone Entry", icon: Bell, description: "Alert when price enters a zone" },
    { value: "volatility_high", label: "High Volatility", icon: Shield, description: "Alert on ATR spike" },
    { value: "session_start", label: "Session Start", icon: Clock, description: "Alert at session open" },
];

export default function AlertsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);

    const [newSymbol, setNewSymbol] = useState("XAUUSD");
    const [newType, setNewType] = useState<AlertType>("price_above");
    const [newPrice, setNewPrice] = useState("");
    const [newTimeframe, setNewTimeframe] = useState("H1");
    const [newMessage, setNewMessage] = useState("");
    const [newDiscord, setNewDiscord] = useState(true);
    const [newTelegram, setNewTelegram] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchAlerts = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/alerts", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setAlerts(json.alerts || []);
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => {
        if (!authLoading && user) fetchAlerts();
    }, [authLoading, user, fetchAlerts]);

    const createAlert = async () => {
        if (!user) return;
        setCreating(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/alerts", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbol: newSymbol, type: newType, targetPrice: newPrice ? Number(newPrice) : undefined,
                    timeframe: newTimeframe, message: newMessage || `${newType} alert for ${newSymbol}`,
                    notifyDiscord: newDiscord, notifyTelegram: newTelegram, notifyInApp: true,
                }),
            });
            setShowCreate(false);
            setNewPrice("");
            setNewMessage("");
            fetchAlerts();
        } catch {} finally { setCreating(false); }
    };

    const deleteAlert = async (alertId: string) => {
        if (!user || !confirm("Delete this alert?")) return;
        try {
            const token = await user.getIdToken();
            await fetch("/api/alerts", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ alertId }),
            });
            fetchAlerts();
        } catch {}
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="mx-auto max-w-7xl px-4 py-8"><Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition"><ArrowLeft size={12} /> Back to Account</Link></div><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                        <ArrowLeft size={12} /> Back to Account
                    </Link>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <Bell size={40} className="text-muted-foreground" />
                    <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                    <a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</a>
                </div>
            </div>
        );
    }

    const activeAlerts = alerts.filter((a) => !a.triggered);
    const triggeredAlerts = alerts.filter((a) => a.triggered);

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

                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Alerts</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Price, structure, and zone alerts with Discord/Telegram notifications</p>
                    </div>
                    <button type="button" onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-violet-500 transition">
                        <Plus size={14} /> New Alert
                    </button>
                </div>

                {/* Stats */}
                <div className="mb-6 grid grid-cols-3 gap-4" data-guide="stats">
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Active</p>
                        <p className="mt-1 text-2xl font-bold text-violet-400">{activeAlerts.length}</p>
                    </div>
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Triggered</p>
                        <p className="mt-1 text-2xl font-bold text-emerald-400">{triggeredAlerts.length}</p>
                    </div>
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Total</p>
                        <p className="mt-1 text-2xl font-bold text-foreground">{alerts.length}</p>
                    </div>
                </div>

                {/* Create Modal */}
                {showCreate && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
                        <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-foreground">Create Alert</h2>
                                <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Symbol</label>
                                    <select value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                        {["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "US30", "NAS100"].map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Alert Type</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {ALERT_TYPES.map((at) => {
                                            const Icon = at.icon;
                                            return (
                                                <button key={at.value} type="button" onClick={() => setNewType(at.value)} className={cn("flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition", newType === at.value ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted")}>
                                                    <Icon size={14} />
                                                    <span>{at.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                {(newType === "price_above" || newType === "price_below") && (
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Target Price</label>
                                        <input type="number" step="any" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="e.g. 3650.00" className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                    </div>
                                )}
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Timeframe</label>
                                    <select value={newTimeframe} onChange={(e) => setNewTimeframe(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                        {["M5", "M15", "M30", "H1", "H4", "D1"].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Message (optional)</label>
                                    <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Custom alert message" className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                </div>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <input type="checkbox" checked={newDiscord} onChange={(e) => setNewDiscord(e.target.checked)} className="rounded border-border/50 bg-muted/10 text-violet-500" /> Discord
                                    </label>
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <input type="checkbox" checked={newTelegram} onChange={(e) => setNewTelegram(e.target.checked)} className="rounded border-border/50 bg-muted/10 text-violet-500" /> Telegram
                                    </label>
                                </div>
                                <button type="button" onClick={createAlert} disabled={creating || (newType.startsWith("price") && !newPrice)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                                    {creating ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />} Create Alert
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Active Alerts */}
                <div className="mb-6">
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Active Alerts</h2>
                    {loading ? (
                        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                    ) : activeAlerts.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/30 p-8 text-center">
                            <Bell size={24} className="mx-auto text-muted-foreground" />
                            <p className="mt-2 text-sm text-muted-foreground">No active alerts</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {activeAlerts.map((alert) => {
                                const typeInfo = ALERT_TYPES.find((t) => t.value === alert.type);
                                const Icon = typeInfo?.icon || Bell;
                                return (
                                    <div key={alert.id} className="flex items-center gap-3 rounded-xl border border-border/30 bg-muted/50 px-4 py-3">
                                        <Icon size={16} className="text-violet-400" />
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm font-medium text-foreground">{alert.symbol}</span>
                                                <span className="text-xs text-muted-foreground">{typeInfo?.label}</span>
                                                {alert.targetPrice && <span className="font-mono text-xs text-muted-foreground">@ {alert.targetPrice}</span>}
                                                <span className="rounded bg-muted/30 px-1.5 py-0.5 text-[9px] text-muted-foreground">{alert.timeframe}</span>
                                            </div>
                                            <p className="mt-0.5 text-[11px] text-muted-foreground">{alert.message}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            {alert.notifyDiscord && <span>Discord</span>}
                                            {alert.notifyTelegram && <span>Telegram</span>}
                                        </div>
                                        <button type="button" onClick={() => deleteAlert(alert.id)} className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-400 transition"><Trash2 size={14} /></button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Triggered Alerts */}
                {triggeredAlerts.length > 0 && (
                    <div>
                        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Triggered</h2>
                        <div className="space-y-2">
                            {triggeredAlerts.slice(0, 10).map((alert) => {
                                const typeInfo = ALERT_TYPES.find((t) => t.value === alert.type);
                                const Icon = typeInfo?.icon || Bell;
                                return (
                                    <div key={alert.id} className="flex items-center gap-3 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] px-4 py-3 opacity-60">
                                        <CheckCircle size={16} className="text-emerald-400" />
                                        <div className="flex-1">
                                            <span className="font-mono text-sm text-foreground">{alert.symbol}</span>
                                            <span className="ml-2 text-xs text-muted-foreground">{typeInfo?.label}</span>
                                            {alert.targetPrice && <span className="ml-2 font-mono text-xs text-muted-foreground">@ {alert.targetPrice}</span>}
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">{alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : ""}</span>
                                        <button type="button" onClick={() => deleteAlert(alert.id)} className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-400 transition"><Trash2 size={14} /></button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
