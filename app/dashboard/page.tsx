"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, Plus, Trash2, Settings, GripVertical, X, Layout,
    TrendingUp, ShieldAlert, Bell, Activity, Wallet, BarChart3, Clock,
    Brain, Activity as ActivityIcon, Target, Sparkles,
} from "lucide-react";
import Link from "next/link";
import SiteNavbar from "@/components/navbar/SiteNavbar";
import { cn } from "@/lib/utils";

type Widget = {
    id: string; type: string; title: string;
    x: number; y: number; w: number; h: number;
    config: Record<string, unknown>;
};

type DashboardConfig = { id: string; name: string; widgets: Widget[]; createdAt: number; updatedAt: number };

function currentTimestamp(): number {
    return Date.now();
}

const WIDGET_TYPES = [
    { type: "portfolio_summary", label: "Portfolio Summary", icon: Wallet, defaultW: 2, defaultH: 1 },
    { type: "market_score", label: "Market Score", icon: Activity, defaultW: 1, defaultH: 1 },
    { type: "risk_gauge", label: "Risk Gauge", icon: ShieldAlert, defaultW: 1, defaultH: 1 },
    { type: "recent_alerts", label: "Recent Alerts", icon: Bell, defaultW: 2, defaultH: 1 },
    { type: "positions_table", label: "Open Positions", icon: BarChart3, defaultW: 3, defaultH: 1 },
    { type: "performance_chart", label: "Performance", icon: TrendingUp, defaultW: 2, defaultH: 2 },
    { type: "market_clock", label: "Market Clock", icon: Clock, defaultW: 1, defaultH: 1 },
    { type: "watchlist迷你", label: "Mini Watchlist", icon: Layout, defaultW: 1, defaultH: 2 },
];

export default function DashboardBuilderPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [dashboards, setDashboards] = useState<DashboardConfig[]>([]);
    const [activeDashId, setActiveDashId] = useState("default");
    const [loading, setLoading] = useState(true);
    const [editMode, setEditMode] = useState(false);
    const [showAddWidget, setShowAddWidget] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchDashboards = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) {
                setDashboards(json.dashboards || []);
                if (json.dashboards?.length > 0) setActiveDashId(json.dashboards[0].id);
            }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchDashboards()); }, [user, fetchDashboards]);

    const activeDash = dashboards.find((d) => d.id === activeDashId);

    const saveDashboard = async (widgets: Widget[]) => {
        if (!user || !activeDashId) return;
        const token = await user.getIdToken();
        await fetch("/api/dashboard", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ dashboardId: activeDashId, widgets }),
        });
    };

    const addWidget = (type: string) => {
        if (!activeDash) return;
        const wt = WIDGET_TYPES.find((w) => w.type === type);
        if (!wt) return;
        const maxY = activeDash.widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
        const newWidget: Widget = {
            id: `w_${currentTimestamp()}`, type, title: wt.label,
            x: 0, y: maxY, w: wt.defaultW, h: wt.defaultH, config: {},
        };
        const updated = [...activeDash.widgets, newWidget];
        setDashboards((prev) => prev.map((d) => d.id === activeDashId ? { ...d, widgets: updated } : d));
        saveDashboard(updated);
        setShowAddWidget(false);
    };

    const removeWidget = (widgetId: string) => {
        if (!activeDash) return;
        const updated = activeDash.widgets.filter((w) => w.id !== widgetId);
        setDashboards((prev) => prev.map((d) => d.id === activeDashId ? { ...d, widgets: updated } : d));
        saveDashboard(updated);
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</a></div></div>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNavbar />
            <div className="mx-auto max-w-7xl px-4 py-8">
                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Custom Dashboard</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Build your personalized trading workspace</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setEditMode((m) => !m)} data-guide="edit-layout" className={cn("rounded-xl border px-4 py-2 text-xs font-medium transition", editMode ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-border/30 bg-muted text-muted-foreground hover:bg-muted/30")}>
                            {editMode ? "Done Editing" : "Edit Layout"}
                        </button>
                        {editMode && (
                            <button type="button" onClick={() => setShowAddWidget(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-foreground hover:bg-violet-500 transition">
                                <Plus size={14} /> Add Widget
                            </button>
                        )}
                    </div>
                </div>

                {/* Quick Access Cards */}
                <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-guide="quick-links">
                    <Link href="/ai-copilot" className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 transition hover:bg-violet-500/10">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/20"><Brain size={20} className="text-violet-400" /></div>
                            <div><p className="text-sm font-semibold text-foreground">AI Copilot</p><p className="text-[10px] text-muted-foreground">Ask about your market &amp; accounts</p></div>
                        </div>
                    </Link>
                    <Link href="/scanner" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition hover:bg-emerald-500/10">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20"><ActivityIcon size={20} className="text-emerald-400" /></div>
                            <div><p className="text-sm font-semibold text-foreground">Market Scanner</p><p className="text-[10px] text-muted-foreground">Scan assets across markets</p></div>
                        </div>
                    </Link>
                    <Link href="/insights" className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 transition hover:bg-sky-500/10">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/20"><Sparkles size={20} className="text-sky-400" /></div>
                            <div><p className="text-sm font-semibold text-foreground">AI Insights</p><p className="text-[10px] text-muted-foreground">AI-powered market insights</p></div>
                        </div>
                    </Link>
                    <Link href="/account/tools" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 transition hover:bg-amber-500/10">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20"><Target size={20} className="text-amber-400" /></div>
                            <div><p className="text-sm font-semibold text-foreground">Tools</p><p className="text-[10px] text-muted-foreground">Trading calculators &amp; utilities</p></div>
                        </div>
                    </Link>
                </div>

                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : activeDash ? (
                    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} data-guide="widgets">
                        {activeDash.widgets.map((widget) => {
                            const wt = WIDGET_TYPES.find((w) => w.type === widget.type);
                            const Icon = wt?.icon || Layout;
                            return (
                                <div key={widget.id} className={cn("rounded-xl border bg-muted/50 p-4 relative group", editMode ? "border-violet-500/20 border-dashed" : "border-border/30", widget.w === 2 ? "col-span-2" : widget.w >= 3 ? "col-span-3" : "")}>
                                    {editMode && (
                                        <div className="absolute -top-2 -right-2 flex gap-1 z-10">
                                            <button type="button" onClick={() => removeWidget(widget.id)} className="rounded-full bg-rose-500 p-1 text-foreground shadow-lg hover:bg-rose-400"><X size={10} /></button>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2 mb-3">
                                        <Icon size={14} className="text-violet-400" />
                                        <h3 className="text-xs font-semibold text-muted-foreground">{widget.title}</h3>
                                        {editMode && <GripVertical size={12} className="ml-auto text-muted-foreground" />}
                                    </div>
                                    <WidgetRenderer type={widget.type} config={widget.config} user={user} />
                                </div>
                            );
                        })}
                        {activeDash.widgets.length === 0 && (
                            <div className="col-span-3 rounded-xl border border-dashed border-border/30 p-16 text-center">
                                <Layout size={32} className="mx-auto text-muted-foreground" />
                                <p className="mt-3 text-sm text-muted-foreground">Empty dashboard. Click &quot;Edit Layout&quot; to add widgets.</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-border/30 p-16 text-center">
                        <Layout size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No dashboards found</p>
                    </div>
                )}

                {showAddWidget && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
                        <div className="w-full max-w-md rounded-2xl border border-border/40 bg-background p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-foreground">Add Widget</h2>
                                <button type="button" onClick={() => setShowAddWidget(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
                            </div>
                            <div className="space-y-2">
                                {WIDGET_TYPES.map((wt) => {
                                    const Icon = wt.icon;
                                    return (
                                        <button key={wt.type} type="button" onClick={() => addWidget(wt.type)} className="flex w-full items-center gap-3 rounded-xl border border-border/30 bg-muted/50 p-3 text-left transition hover:bg-muted/30">
                                            <Icon size={16} className="text-violet-400" />
                                            <div>
                                                <p className="text-sm font-medium text-foreground">{wt.label}</p>
                                                <p className="text-[10px] text-muted-foreground">{wt.defaultW}×{wt.defaultH} grid</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function WidgetRenderer({ type, config, user }: { type: string; config: Record<string, unknown>; user: User }) {
    const [data, setData] = useState<Record<string, unknown> | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const token = await user.getIdToken();
                let endpoint = "";
                if (type === "portfolio_summary") endpoint = "/api/analytics/portfolio";
                else if (type === "risk_gauge") endpoint = "/api/analytics/risk?accountId=default";
                else if (type === "recent_alerts") endpoint = "/api/alerts";
                else if (type === "positions_table") endpoint = "/api/trading/positions";
                else if (type === "market_score") endpoint = `/api/analytics/score?symbol=${config.symbol || "XAUUSD"}&interval=H1`;

                if (endpoint) {
                    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
                    const json = await res.json();
                    setData(json);
                }
            } catch {} finally { setLoading(false); }
        };
        fetchData();
    }, [type, config, user]);

    if (loading) return <div className="flex h-20 items-center justify-center"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div>;

    if (type === "portfolio_summary" && data) {
        const d = data as any;
        return (
            <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[9px] uppercase text-muted-foreground">Balance</p><p className="font-mono text-sm font-bold text-foreground">${d.totalBalance?.toLocaleString()}</p></div>
                <div><p className="text-[9px] uppercase text-muted-foreground">Equity</p><p className="font-mono text-sm font-bold text-foreground">${d.totalEquity?.toLocaleString()}</p></div>
                <div><p className="text-[9px] uppercase text-muted-foreground">P/L</p><p className={cn("font-mono text-sm font-bold", (d.totalFloatingPnl || 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>${d.totalFloatingPnl?.toFixed(2)}</p></div>
                <div><p className="text-[9px] uppercase text-muted-foreground">Accounts</p><p className="font-mono text-sm font-bold text-foreground">{d.accountCount}</p></div>
            </div>
        );
    }

    if (type === "market_score" && data) {
        const score = (data as any).score?.score || 0;
        return (
            <div className="text-center">
                <div className={cn("text-4xl font-bold font-mono", score > 70 ? "text-emerald-400" : score > 40 ? "text-amber-400" : "text-rose-400")}>{score}</div>
                <p className="text-[10px] text-muted-foreground mt-1">out of 100</p>
            </div>
        );
    }

    if (type === "recent_alerts" && data) {
        const alerts = (data as any).alerts || [];
        return (
            <div className="space-y-2 max-h-32 overflow-y-auto">
                {alerts.slice(0, 3).map((a: any) => (
                    <div key={a.id} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-foreground">{a.symbol}</span>
                        <span className="text-muted-foreground">{a.type?.replace(/_/g, " ")}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</span>
                    </div>
                ))}
                {alerts.length === 0 && <p className="text-xs text-muted-foreground text-center">No alerts</p>}
            </div>
        );
    }

    if (type === "risk_gauge" && data) {
        const r = (data as any).risk || {};
        return (
            <div className="text-center">
                <p className="text-3xl font-bold font-mono text-amber-400">{r.marginLevel?.toFixed(0) || 0}%</p>
                <p className="text-[10px] text-muted-foreground mt-1">Margin Level</p>
            </div>
        );
    }

    if (type === "market_clock") {
        return (
            <div className="text-center">
                <MarketClock />
            </div>
        );
    }

    return <p className="text-xs text-muted-foreground text-center">Widget data loading...</p>;
}

function MarketClock() {
    const [time, setTime] = useState("");
    useEffect(() => {
        const tick = () => setTime(new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, []);
    return <p className="font-mono text-2xl font-bold text-foreground">{time}</p>;
}
