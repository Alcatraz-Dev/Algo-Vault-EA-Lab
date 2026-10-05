"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import {
    AlertTriangle,
    Crown,
    GripVertical,
    LayoutDashboard,
    Loader2,
    Plus,
    RefreshCw,
    RotateCcw,
    Shield,
    Trash2,
    X,
} from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { AITeamsEntryCard } from "@/components/ai-trading-teams/entry-card";
import { DashboardNativeAd } from "@/components/growth/DashboardNativeAd";
import {
    WIDGET_CATALOG,
    WIDGET_SPEC_BY_TYPE,
    WidgetBody,
    WidgetPicker,
    defaultWidgetConfig,
    isMarketScoped,
    type DashboardWidget,
    type MarketScope,
    type PortfolioAccount,
} from "@/components/dashboard/widgets";
import { SUPPORTED_SYMBOLS, TIMEFRAME_LABELS } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";
import { DASHBOARD_PRESETS, normalizeWidget, type DashboardPreset } from "@/lib/dashboard/presets";
import { HomeIntelligenceOS } from "@/components/intelligence-os/IntelligenceOSPanel";

type DashboardConfig = {
    id: string;
    name: string;
    widgets: DashboardWidget[];
    createdAt: number;
    updatedAt: number;
};

const SPAN_BY_WIDTH: Record<number, string> = {
    1: "sm:col-span-1",
    2: "sm:col-span-2",
    3: "sm:col-span-3",
};

function newWidgetId(): string {
    return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const MARKET_STORAGE_KEY = "algovault.dashboard.market";

/**
 * The picker's groups. The symbol list is still the single source of truth
 * (`SUPPORTED_SYMBOLS` validates every choice) — this only orders it so a
 * 44-symbol dropdown is navigable.
 */
const SYMBOL_GROUPS: { label: string; symbols: string[] }[] = [
    { label: "Metals", symbols: ["XAUUSD", "XAGUSD"] },
    { label: "Majors", symbols: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD"] },
    { label: "Crosses", symbols: ["EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "EURCHF"] },
    { label: "Indices", symbols: ["US30", "NAS100", "SPX500", "SPY", "QQQ", "DXY"] },
    { label: "Crypto", symbols: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOGEUSD", "BNBUSD", "LTCUSD", "DOTUSD"] },
    { label: "Equities", symbols: ["AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "COIN"] },
].map((group) => ({
    ...group,
    // Drop anything the data layer stopped supporting rather than offering a
    // selection that 400s on every request.
    symbols: group.symbols.filter((s) => (SUPPORTED_SYMBOLS as readonly string[]).includes(s)),
}));

/** Only ever stores symbols/timeframes the data layer actually serves. */
function readStoredMarket(): MarketScope {
    const fallback: MarketScope = { symbol: "XAUUSD", timeframe: "H1" };
    if (typeof window === "undefined") return fallback;
    try {
        const raw = window.localStorage.getItem(MARKET_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as Partial<MarketScope>;
        const symbol = String(parsed.symbol ?? "").toUpperCase();
        const timeframe = String(parsed.timeframe ?? "").toUpperCase();
        return {
            symbol: (SUPPORTED_SYMBOLS as readonly string[]).includes(symbol) ? symbol : fallback.symbol,
            timeframe: timeframe in TIMEFRAME_LABELS ? timeframe : fallback.timeframe,
        };
    } catch {
        return fallback;
    }
}

/**
 * The command-centre starter layout: AI signal panels first, then the
 * account widgets around them. Used by Reset and by the first-run seed so a
 * fresh dashboard opens with the AI widgets already on screen.
 */
function buildCommandCenterSeed(): DashboardWidget[] {
    return [
        { id: newWidgetId(), type: "portfolio_summary", title: "Portfolio Summary", x: 0, y: 0, w: 3, h: 1, config: {} },
        { id: newWidgetId(), type: "live_chart", title: "Live Chart", x: 0, y: 1, w: 3, h: 1, config: defaultWidgetConfig("live_chart") },
        { id: newWidgetId(), type: "signal_core", title: "Signal Core", x: 0, y: 2, w: 1, h: 1, config: defaultWidgetConfig("signal_core") },
        { id: newWidgetId(), type: "confidence_meter", title: "Signal Confidence", x: 0, y: 3, w: 1, h: 1, config: defaultWidgetConfig("confidence_meter") },
        { id: newWidgetId(), type: "mtf_bias", title: "Multi-Timeframe Bias", x: 0, y: 4, w: 1, h: 1, config: defaultWidgetConfig("mtf_bias") },
        { id: newWidgetId(), type: "equity_curve", title: "Equity Curve", x: 0, y: 5, w: 2, h: 1, config: {} },
        { id: newWidgetId(), type: "market_score", title: "Market Score", x: 0, y: 6, w: 1, h: 1, config: { symbol: "XAUUSD", timeframe: "H1" } },
        { id: newWidgetId(), type: "positions", title: "Open Positions", x: 0, y: 7, w: 2, h: 1, config: {} },
        { id: newWidgetId(), type: "recent_alerts", title: "Recent Alerts", x: 0, y: 8, w: 1, h: 1, config: {} },
    ];
}

/** Builds a full, normalized layout for a preset (or the command centre). */
function buildPresetLayout(preset: DashboardPreset | null): DashboardWidget[] {
    const spec = preset ? preset.widgets : null;
    if (!spec) return buildCommandCenterSeed();
    return spec.map(([type, w], index) =>
        normalizeWidget({
            id: newWidgetId(),
            type,
            title: WIDGET_SPEC_BY_TYPE[type]?.label ?? type,
            x: 0,
            y: index,
            w,
            h: 1,
            config: defaultWidgetConfig(type),
        })
    );
}

export default function DashboardBuilderPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    const [dashboards, setDashboards] = useState<DashboardConfig[]>([]);
    const [activeDashId, setActiveDashId] = useState<string>("");
    const [layoutLoading, setLayoutLoading] = useState(true);
    const [layoutError, setLayoutError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    const [editMode, setEditMode] = useState(false);
    const [showAddWidget, setShowAddWidget] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
    // The market every symbol-scoped widget follows. Seeded from the last
    // choice so the dashboard reopens on what the user was actually watching.
    const [market, setMarket] = useState<MarketScope>(readStoredMarket);
    // Pro entitlement for the advanced widgets. Read from the server-mirrored
    // subscription record (never from a client flag) and defaults to locked, so
    // a failed lookup can never accidentally unlock Pro data.
    const [isPro, setIsPro] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (authLoading || !user) return;

        let cancelled = false;

        void onSubscriptionChange(user.uid).then((sub) => {
            if (!cancelled) setIsPro(sub.hasSubscription);
        });

        return () => {
            cancelled = true;
        };
    }, [authLoading, user]);

    // Account-scoped widgets (risk, positions, equity curve) need a real account id.
    // The old code passed the literal "default", which never matches a gateway account
    // key, so those widgets silently 404'd. Resolve the id from the live account list.
    useEffect(() => {
        if (authLoading || !user) return;

        let cancelled = false;

        void (async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch("/api/analytics/accounts", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = await res.json();
                if (cancelled || !json.success) return;
                const list: PortfolioAccount[] = json.accounts || [];
                setAccounts(list);
                setSelectedAccountId((current) =>
                    current && list.some((a) => a.accountId === current) ? current : list[0]?.accountId || ""
                );
            } catch {
                if (!cancelled) setAccounts([]);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authLoading, user, refreshKey]);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
        });
        return () => unsub();
    }, []);

    // Read once on mount and mirror every change back, so the choice survives a
    // reload without adding a field to the persisted dashboard layout. The lazy
    // initializer is safe here: the page renders the auth spinner until the
    // client has a session, so the selector is never in the SSR HTML.
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(market));
        } catch {
            // Private mode / storage disabled — the selector still works for the session.
        }
    }, [market]);

    const loadLayouts = useCallback(async () => {
        setLayoutLoading(true);
        setLayoutError(null);
        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch("/api/dashboard", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                setLayoutError(json.error || "Could not load your dashboard layout.");
                return;
            }
            const loaded: DashboardConfig[] = (json.dashboards || []).map((dash: DashboardConfig) => ({
                ...dash,
                widgets: (dash.widgets || []).map(normalizeWidget),
            }));
            setDashboards(loaded);
            setActiveDashId((current) =>
                current && loaded.some((d) => d.id === current) ? current : loaded[0]?.id || ""
            );
        } catch {
            setLayoutError("Could not reach the dashboard service.");
        } finally {
            setLayoutLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authLoading || !user) return;
        // Deferred like the other authed pages: the load sets state on entry, so
        // calling it synchronously in the effect body would cascade renders.
        void Promise.resolve().then(() => loadLayouts());
    }, [authLoading, user, loadLayouts]);

    const activeDash = useMemo(
        () => dashboards.find((d) => d.id === activeDashId) ?? null,
        [dashboards, activeDashId]
    );
    const widgets = activeDash?.widgets ?? [];
    const scopedWidgetCount = widgets.filter((w) => isMarketScoped(w.type)).length;

    /** Optimistic local update, then a debounced persist. */
    const commitWidgets = useCallback(
        (next: DashboardWidget[]) => {
            if (!activeDashId) return;
            setDashboards((prev) =>
                prev.map((d) => (d.id === activeDashId ? { ...d, widgets: next } : d))
            );

            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(async () => {
                setSaving(true);
                try {
                    const token = await auth.currentUser?.getIdToken();
                    await fetch("/api/dashboard", {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ dashboardId: activeDashId, widgets: next }),
                    });
                    setSavedAt(Date.now());
                } finally {
                    setSaving(false);
                }
            }, 400);
        },
        [activeDashId]
    );

    useEffect(() => {
        return () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
        };
    }, []);

    // Every dashboard opens with the command-centre AI widgets on screen —
    // empty layouts get the full seed, existing layouts get only the seed
    // widget types they are missing (so a layout the user curated keeps its
    // order and content). The localStorage marker makes it a one-shot per
    // dashboard: removing a seeded widget later never re-adds it.
    const seededDashRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (layoutLoading || !activeDash) return;
        const dashId = activeDash.id;
        if (seededDashRef.current.has(dashId)) return;
        const marker = `algovault:dashboard-seeded:${dashId}`;
        try {
            if (window.localStorage.getItem(marker)) {
                seededDashRef.current.add(dashId);
                return;
            }
            window.localStorage.setItem(marker, "1");
        } catch {
            // Storage unavailable (private mode) — the in-memory ref still
            // limits this to one seed per session.
        }
        seededDashRef.current.add(dashId);

        const existing = activeDash.widgets;
        const present = new Set(existing.map((w) => w.type));
        const seed = buildCommandCenterSeed();
        const missing = existing.length === 0 ? seed : seed.filter((w) => !present.has(w.type));
        if (missing.length === 0) return;
        // Missing command-centre widgets go to the front (that is the point of
        // the seed — they open on screen); existing widgets keep their order.
        // y is renumbered to the array index, matching moveWidget's convention.
        const merged = existing.length === 0 ? missing : [...missing, ...existing];
        const next = merged.map((w, index) => ({ ...w, y: index }));
        // Deferred like loadLayouts above: commitWidgets writes state, so
        // calling it synchronously in the effect body would cascade renders.
        let cancelled = false;
        void Promise.resolve().then(() => {
            if (!cancelled) commitWidgets(next);
        });
        return () => {
            cancelled = true;
        };
    }, [layoutLoading, activeDash, commitWidgets]);

    const addWidget = (type: string) => {
        const spec = WIDGET_SPEC_BY_TYPE[type];
        if (!spec) return;
        const width = spec.widths[0];
        commitWidgets([
            ...widgets,
            normalizeWidget({
                id: newWidgetId(),
                type,
                title: spec.label,
                x: 0,
                y: widgets.length,
                w: width,
                h: 1,
                config: defaultWidgetConfig(type),
            }),
        ]);
        setShowAddWidget(false);
    };

    const removeWidget = (widgetId: string) => {
        commitWidgets(widgets.filter((w) => w.id !== widgetId));
    };

    /** Cycles width within the widths the widget supports. */
    const cycleWidth = (widgetId: string) => {
        commitWidgets(
            widgets.map((w) => {
                if (w.id !== widgetId) return w;
                const spec = WIDGET_SPEC_BY_TYPE[w.type];
                if (!spec) return w;
                const index = spec.widths.indexOf(w.w);
                const nextWidth = spec.widths[(index + 1) % spec.widths.length];
                return { ...w, w: nextWidth };
            })
        );
    };

    const cycleHeight = (widgetId: string) => {
        commitWidgets(widgets.map((w) => (w.id === widgetId ? { ...w, h: w.h === 1 ? 2 : 1 } : w)));
    };

    const moveWidget = (fromId: string, toId: string) => {
        if (fromId === toId) return;
        const fromIndex = widgets.findIndex((w) => w.id === fromId);
        const toIndex = widgets.findIndex((w) => w.id === toId);
        if (fromIndex < 0 || toIndex < 0) return;

        const next = [...widgets];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        commitWidgets(next.map((w, index) => ({ ...w, y: index })));
    };

    const resetLayout = () => {
        commitWidgets(buildCommandCenterSeed());
    };

    const applyPreset = (presetId: string) => {
        const preset = DASHBOARD_PRESETS.find((p) => p.id === presetId) ?? null;
        if (!preset) return;
        commitWidgets(buildPresetLayout(preset));
    };

    // Bumping refreshKey re-runs every widget fetch and the account lookup, so a
    // single Refresh pulls fresh data everywhere without re-fetching the layout.
    const refreshData = useCallback(() => setRefreshKey((k) => k + 1), []);

    if (authLoading) {
        return (
            <AccountShell title="Dashboard" onBack={() => router.push("/account")}>
                <div className="flex h-[50vh] items-center justify-center">
                    <Loader2 size={22} className="animate-spin text-primary" />
                </div>
            </AccountShell>
        );
    }

    if (!user) {
        return (
            <AccountShell title="Dashboard" onBack={() => router.push("/account")}>
                <div className="flex h-[50vh] flex-col items-center justify-center gap-4">
                    <Shield size={32} className="text-muted-foreground" />
                    <h1 className="text-lg font-semibold text-foreground">Sign in required</h1>
                    <a
                        href="/login"
                        className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/80"
                    >
                        Sign in
                    </a>
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell
            title="Custom Dashboard"
            subtitle="Build a workspace from your live accounts, positions and signals"
            onBack={() => router.push("/account")}
        >
            <div className="space-y-5" data-guide="dashboard">
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-2.5" data-guide="controls">
                    <button
                        type="button"
                        onClick={refreshData}
                        disabled={layoutLoading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                        <RefreshCw size={13} className={layoutLoading ? "animate-spin" : ""} />
                        Refresh
                    </button>

                    <button
                        type="button"
                        onClick={() => setEditMode((m) => !m)}
                        aria-pressed={editMode}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium transition",
                            editMode
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                    >
                        {editMode ? "Done editing" : "Edit layout"}
                    </button>

                    {editMode && (
                        <>
                            <button
                                type="button"
                                onClick={() => setShowAddWidget(true)}
                                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/80"
                            >
                                <Plus size={13} /> Add widget
                            </button>
                            <label className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
                                <LayoutDashboard size={13} />
                                <span className="sr-only">Layout preset</span>
                                <select
                                    value=""
                                    onChange={(e) => {
                                        if (e.target.value) applyPreset(e.target.value);
                                    }}
                                    className="bg-transparent text-xs text-foreground outline-none"
                                >
                                    <option value="">Apply preset…</option>
                                    {DASHBOARD_PRESETS.map((p) => (
                                        <option key={p.id} value={p.id} title={p.description}>
                                            {p.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="button"
                                onClick={resetLayout}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                                <RotateCcw size={13} /> Reset
                            </button>
                        </>
                    )}

                    <span className="ml-auto text-[11px] text-muted-foreground" aria-live="polite">
                        {saving
                            ? "Saving layout…"
                            : layoutError
                                ? "Layout not saved"
                                : savedAt
                                    ? `Layout saved ${new Date(savedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                                    : `${widgets.length} widget${widgets.length === 1 ? "" : "s"}`}
                    </span>
                </div>

                {/* Account selector — account-scoped widgets follow this choice. */}
                {accounts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2" data-guide="account-selector">
                        <label
                            htmlFor="dashboard-account"
                            className="text-[11px] uppercase tracking-wide text-muted-foreground"
                        >
                            Account
                        </label>
                        <select
                            id="dashboard-account"
                            value={selectedAccountId}
                            onChange={(e) => setSelectedAccountId(e.target.value)}
                            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-primary"
                        >
                            {accounts.map((acc) => (
                                <option key={acc.accountId} value={acc.accountId}>
                                    {acc.broker || acc.mt5Account || acc.accountId}
                                    {acc.mt5Account ? ` · #${acc.mt5Account}` : ""}
                                </option>
                            ))}
                        </select>
                        <span className="text-[11px] text-muted-foreground">
                            Risk, positions and equity widgets follow this selection.
                        </span>
                    </div>
                )}

                {/* Market selector — every symbol-scoped widget follows this choice. */}
                <div className="flex flex-wrap items-center gap-2" data-guide="market-selector">
                    <label htmlFor="dashboard-symbol" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Market
                    </label>
                    <select
                        id="dashboard-symbol"
                        value={market.symbol}
                        onChange={(e) => setMarket((m) => ({ ...m, symbol: e.target.value }))}
                        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-primary"
                    >
                        {SYMBOL_GROUPS.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                                {group.symbols.map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    <select
                        aria-label="Market timeframe"
                        value={market.timeframe}
                        onChange={(e) => setMarket((m) => ({ ...m, timeframe: e.target.value }))}
                        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-primary"
                    >
                        {(Object.keys(TIMEFRAME_LABELS) as (keyof typeof TIMEFRAME_LABELS)[]).map((tf) => (
                            <option key={tf} value={tf}>
                                {tf} · {TIMEFRAME_LABELS[tf]}
                            </option>
                        ))}
                    </select>
                    <span className="text-[11px] text-muted-foreground">
                        {scopedWidgetCount === 0
                            ? "No symbol widgets on this layout yet."
                            : `${scopedWidgetCount} widget${scopedWidgetCount === 1 ? "" : "s"} follow this market.`}
                    </span>
                </div>

                {layoutError && (
                    <div
                        role="alert"
                        className="flex items-start gap-2.5 rounded-lg border border-negative/30 bg-negative/5 p-3.5"
                    >
                        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-negative" />
                        <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-foreground">Dashboard unavailable</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{layoutError}</p>
                        </div>
                        <button
                            type="button"
                            onClick={refreshData}
                            className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        >
                            Retry
                        </button>
                    </div>
                )}

                <DashboardNativeAd />

                {/* Intelligence OS context layer */}
                {isPro && (
                    <HomeIntelligenceOS refreshKey={refreshKey} />
                )}

                {/* Quick access */}
                <div
                    className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                    data-guide="quick-links"
                >
                    <AITeamsEntryCard context="Dashboard" compact className="sm:col-span-2 lg:col-span-4" />
                </div>

                {/* Widgets */}
                {layoutLoading && widgets.length === 0 ? (
                    <div className="flex h-64 items-center justify-center">
                        <Loader2 size={20} className="animate-spin text-primary" />
                    </div>
                ) : widgets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
                        <p className="text-sm font-medium text-foreground">No widgets yet</p>
                        <p className="mx-auto mt-1 max-w-[46ch] text-xs text-muted-foreground">
                            {editMode
                                ? "Add a widget to start building your workspace."
                                : "Turn on Edit layout to add widgets for your portfolio, positions, alerts and market scores."}
                        </p>
                        {editMode && (
                            <button
                                type="button"
                                onClick={() => setShowAddWidget(true)}
                                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/80"
                            >
                                <Plus size={13} /> Add widget
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-guide="widgets">
                        {widgets.map((widget) => {
                            const spec = WIDGET_SPEC_BY_TYPE[widget.type];
                            const Icon = spec?.icon ?? WidgetsFallbackIcon;
                            return (
                                <section
                                    key={widget.id}
                                    draggable={editMode}
                                    onDragStart={() => setDraggingId(widget.id)}
                                    onDragOver={(e) => editMode && e.preventDefault()}
                                    onDrop={() => {
                                        if (draggingId) moveWidget(draggingId, widget.id);
                                        setDraggingId(null);
                                    }}
                                    onDragEnd={() => setDraggingId(null)}
                                    className={cn(
                                        "flex animate-page-enter flex-col rounded-lg border border-border bg-card shadow-sm",
                                        widget.h === 2 && "sm:row-span-2",
                                        SPAN_BY_WIDTH[widget.w] ?? "sm:col-span-1",
                                        editMode && "border-dashed border-primary/40",
                                        draggingId === widget.id && "opacity-50"
                                    )}
                                >
                                    <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                                        {editMode && (
                                            <GripVertical
                                                size={13}
                                                className="shrink-0 cursor-grab text-muted-foreground"
                                                aria-label="Drag to reorder"
                                            />
                                        )}
                                        {spec?.live ? (
                                            <span
                                                className="relative flex h-1.5 w-1.5 shrink-0"
                                                title="Polling live data"
                                            >
                                                <span
                                                    aria-hidden="true"
                                                    className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60"
                                                />
                                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                                            </span>
                                        ) : null}
                                        <Icon size={14} className="shrink-0 text-primary" />
                                        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                                            {widget.title}
                                        </h2>
                                        {editMode ? (
                                            <div className="flex shrink-0 items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => cycleWidth(widget.id)}
                                                    className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                                    title="Change width"
                                                >
                                                    W
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => cycleHeight(widget.id)}
                                                    className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                                    title="Change height"
                                                >
                                                    H
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removeWidget(widget.id)}
                                                    className="rounded-md border border-negative/30 p-1 text-negative transition hover:bg-negative/10"
                                                    title="Remove widget"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="flex shrink-0 items-center gap-1.5">
                                                {spec?.pro && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                                                        <Crown size={9} />
                                                        Pro
                                                    </span>
                                                )}
                                                {spec?.needsAccount && (
                                                    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                                        per account
                                                    </span>
                                                )}
                                                {isMarketScoped(widget.type) && (
                                                    <span
                                                        className="font-numeric rounded-full border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                                        title="Follows the Market selector above"
                                                    >
                                                        {market.symbol} · {market.timeframe}
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                    </header>

                                    <div className="flex-1 p-4">
                                        <WidgetBody
                                            type={widget.type}
                                            user={user}
                                            refreshKey={refreshKey}
                                            config={widget.config}
                                            accountId={selectedAccountId}
                                            isPro={isPro}
                                            marketScope={market}
                                        />
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}

                {/* Catalogue reference, doubles as discovery while editing */}
                {editMode && (
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                        <h3 className="text-xs font-semibold text-foreground">
                            Available widgets ({WIDGET_CATALOG.length})
                        </h3>
                        <ul className="mt-2.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                            {WIDGET_CATALOG.map((spec) => {
                                const Icon = spec.icon;
                                const placed = widgets.some((w) => w.type === spec.type);
                                return (
                                    <li key={spec.type} className="flex items-start gap-2 text-[11px]">
                                        <Icon
                                            size={12}
                                            className={cn("mt-0.5 shrink-0", placed ? "text-positive" : "text-muted-foreground")}
                                        />
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-1.5">
                                                <span className="font-medium text-foreground">{spec.label}</span>
                                                {spec.pro && (
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                                                            isPro
                                                                ? "border-positive/30 bg-positive/10 text-positive"
                                                                : "border-primary/40 bg-primary/10 text-primary"
                                                        )}
                                                    >
                                                        <Crown size={9} />
                                                        {isPro ? "Pro · unlocked" : "Pro"}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {" "}
                                                — {spec.description}
                                            </span>
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>

            {showAddWidget && (
                <WidgetPicker
                    isPro={isPro}
                    onPick={addWidget}
                    onClose={() => setShowAddWidget(false)}
                />
            )}
        </AccountShell>
    );
}

function WidgetsFallbackIcon({ size, className }: { size?: number; className?: string }) {
    return <X size={size} className={className} />;
}
