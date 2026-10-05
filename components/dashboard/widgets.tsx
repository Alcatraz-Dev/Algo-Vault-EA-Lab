"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { User } from "firebase/auth";
import {
    Activity,
    AlignLeft,
    AlertTriangle,
    BarChart3,
    Bell,
    CandlestickChart,
    Check,
    Clock,
    Crown,
    Droplet,
    Gauge,
    Globe,
    Grid3x3,
    Layers,
    LayoutDashboard,
    Lock,
    Minus,
    Percent,
    Radar,
    ShieldAlert,
    Sigma,
    Signal,
    Table2,
    TrendingUp,
    Waves,
    Wallet,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import AreaTrendChart from "@/components/charts/AreaTrendChart";
import CountUp from "@/components/charts/CountUp";
import LevelBars, { type LevelBarItem } from "@/components/charts/LevelBars";
import MiniSparkline from "@/components/charts/MiniSparkline";
import ProgressRing from "@/components/charts/ProgressRing";
import SignalCore, { type SignalVerdict } from "@/components/charts/SignalCore";
import LiveCandlesPanel from "./LiveCandlesPanel";

/* ────────────────────────────────────────────────────────────────────────────
 * Types — mirrors of the real API payloads (never invented client-side).
 * ────────────────────────────────────────────────────────────────────────── */

export type WidgetConfig = Record<string, unknown>;

export type DashboardWidget = {
    id: string;
    type: string;
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    config: WidgetConfig;
};

export type WidgetSpec = {
    type: string;
    label: string;
    description: string;
    icon: ComponentType<{ size?: number; className?: string }>;
    /** Widget reads account-scoped data and needs a connected account id. */
    needsAccount: boolean;
    /** Allowed width steps: 1 = third, 2 = half, 3 = full. */
    widths: number[];
    /** Pro-tier widget. Gated on the server-verified subscription. */
    pro?: boolean;
    /** Widget polls its own data — the header shows a live status dot. */
    live?: boolean;
};

export type PortfolioAccount = {
    accountId: string;
    mt5Account: string;
    broker: string;
    server: string;
    currency: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number;
    floatingPnl: number;
    drawdown: number;
    status: string;
    lastHeartbeatAt: number;
    positionsCount: number;
};

export type PortfolioExposure = {
    symbol: string;
    volume: number;
    type: string;
    pnl: number;
};

type Portfolio = {
    totalBalance: number;
    totalEquity: number;
    totalMargin: number;
    totalFreeMargin: number;
    totalFloatingPnl: number;
    overallDrawdown: number;
    accountCount: number;
    onlineCount: number;
    accounts: PortfolioAccount[];
    exposure: PortfolioExposure[];
};

type Risk = {
    accountBalance: number;
    accountEquity: number;
    marginUsed: number;
    marginFree: number;
    marginLevel: number;
    floatingPnl: number;
    drawdown: number;
    totalRiskExposure: number;
    marginUtilization: number;
    freeMarginPercent: number;
    marginCallDistance: number;
    positionsAtRisk: number;
    totalPositions: number;
    riskPerPosition: { symbol: string; risk: number; type: string; volume: number }[];
};

type AlertRecord = {
    id: string;
    symbol: string;
    type: string;
    message?: string;
    targetPrice?: number;
    timeframe?: string;
    triggered: boolean;
    triggeredAt?: number;
    createdAt: number;
};

type Position = {
    ticket: string;
    symbol?: string;
    type?: string;
    volume?: number;
    openPrice?: number;
    currentPrice?: number;
    sl?: number;
    tp?: number;
    profit?: number;
};

type Curve = {
    accountId: string;
    accountName: string;
    data: { time: number; equity: number; balance: number }[];
};

type ScoreComponent = {
    name: string;
    value: number;
    max: number;
    direction: string;
};

type Score = {
    total: number;
    bias: string;
    confidence: string;
    components: ScoreComponent[];
    timestamp: number;
};

type Quote = {
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    change: number;
    changePercent: number;
    timestamp: number;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Widget catalog
 * ────────────────────────────────────────────────────────────────────────── */

export const WIDGET_CATALOG: WidgetSpec[] = [
    {
        type: "portfolio_summary",
        label: "Portfolio Summary",
        description: "Balance, equity, floating P/L and margin across every connected account.",
        icon: Wallet,
        needsAccount: false,
        widths: [1, 2, 3],
    },
    {
        type: "accounts",
        label: "Connected Accounts",
        description: "Gateway connection status, equity and margin level per MT5 account.",
        icon: Globe,
        needsAccount: false,
        widths: [1, 2],
    },
    {
        type: "equity_curve",
        label: "Equity Curve",
        description: "Recorded equity and balance history for the selected account.",
        icon: TrendingUp,
        needsAccount: true,
        widths: [2, 3],
    },
    {
        type: "market_score",
        label: "Market Score",
        description: "Deterministic multi-factor market score with component breakdown.",
        icon: Activity,
        needsAccount: false,
        widths: [1, 2],
    },
    {
        type: "risk",
        label: "Risk & Margin",
        description: "Margin level, utilisation, drawdown and per-position risk.",
        icon: ShieldAlert,
        needsAccount: true,
        widths: [1, 2],
    },
    {
        type: "positions",
        label: "Open Positions",
        description: "Live positions reported by the MT5 gateway for the selected account.",
        icon: Table2,
        needsAccount: true,
        widths: [2, 3],
    },
    {
        type: "exposure",
        label: "Symbol Exposure",
        description: "Net volume and floating P/L grouped by symbol and direction.",
        icon: BarChart3,
        needsAccount: false,
        widths: [1, 2],
    },
    {
        type: "recent_alerts",
        label: "Recent Alerts",
        description: "Newest price and structure alerts, with triggered state.",
        icon: Bell,
        needsAccount: false,
        widths: [1, 2],
    },
    {
        type: "watchlist",
        label: "Watchlist",
        description: "Live bid quotes and session change for the symbols you follow.",
        icon: Gauge,
        needsAccount: false,
        widths: [1, 2, 3],
    },
    {
        type: "market_clock",
        label: "Market Clock",
        description: "Local and UTC time with the active trading session.",
        icon: Clock,
        needsAccount: false,
        widths: [1, 2],
    },
    {
        type: "signal_core",
        label: "Signal Core",
        description: "Pulsing BUY/SELL verdict ring with score, confidence and factor alignment.",
        icon: Signal,
        needsAccount: false,
        widths: [1, 2],
        live: true,
    },
    {
        type: "confidence_meter",
        label: "Signal Confidence",
        description: "Animated market-score meter with the per-factor checklist behind it.",
        icon: Percent,
        needsAccount: false,
        widths: [1, 2],
        live: true,
    },
    {
        type: "live_chart",
        label: "Live Chart",
        description: "Live candles with volume, quote header and a dashed trend projection line.",
        icon: CandlestickChart,
        needsAccount: false,
        widths: [2, 3],
        live: true,
    },
    {
        type: "mtf_bias",
        label: "Multi-Timeframe Bias",
        description: "Per-timeframe score and bias sparklines, with the alignment read on top.",
        icon: AlignLeft,
        needsAccount: false,
        widths: [1, 2, 3],
        live: true,
    },

    /* ── Pro tier: advanced analytics ─────────────────────────────────────── */
    {
        type: "market_regime",
        label: "Market Regime",
        description: "Classified market regime with confidence and the factors behind it.",
        icon: Radar,
        needsAccount: false,
        widths: [1, 2],
        pro: true,
    },
    {
        type: "volatility",
        label: "Volatility Profile",
        description: "ATR, ATR percent and range expansion with a volatility state.",
        icon: Waves,
        needsAccount: false,
        widths: [1, 2],
        pro: true,
    },
    {
        type: "volume_analysis",
        label: "Volume Analysis",
        description: "Relative volume against the 20-period average with expansion state.",
        icon: BarChart3,
        needsAccount: false,
        widths: [1, 2],
        pro: true,
    },
    {
        type: "structure_events",
        label: "Structure Events",
        description: "Break of structure and change of character events, newest first.",
        icon: TrendingUp,
        needsAccount: false,
        widths: [2, 3],
        pro: true,
    },
    {
        type: "liquidity_map",
        label: "Liquidity Map",
        description: "Resting liquidity levels and confirmed sweeps above/below price.",
        icon: Droplet,
        needsAccount: false,
        widths: [1, 2],
        pro: true,
    },
    {
        type: "zones",
        label: "Active Zones",
        description: "Order blocks, fair value gaps and liquidity zones still in play.",
        icon: Layers,
        needsAccount: false,
        widths: [2, 3],
        pro: true,
    },
    {
        type: "correlation_matrix",
        label: "Correlation Matrix",
        description: "Cross-asset correlation across the tracked symbol set.",
        icon: Grid3x3,
        needsAccount: false,
        widths: [2, 3],
        pro: true,
    },
    {
        type: "market_breadth",
        label: "Symbol Scores",
        description: "Deterministic market score for each symbol in your watchlist.",
        icon: Sigma,
        needsAccount: false,
        widths: [2, 3],
        pro: true,
    },
];

export const WIDGET_SPEC_BY_TYPE: Record<string, WidgetSpec> = Object.fromEntries(
    WIDGET_CATALOG.map((spec) => [spec.type, spec])
);

/** Default widget configuration used when a widget is first added. */
export function defaultWidgetConfig(type: string): WidgetConfig {
    switch (type) {
        // Every deterministic analytics endpoint takes the same symbol/timeframe pair.
        case "market_score":
        case "market_regime":
        case "volatility":
        case "volume_analysis":
        case "structure_events":
        case "liquidity_map":
        case "zones":
        case "signal_core":
        case "confidence_meter":
        case "live_chart":
            return { symbol: "XAUUSD", timeframe: "H1" };
        case "mtf_bias":
            return { symbol: "XAUUSD", timeframes: "M15,H1,H4,D1" };
        case "watchlist":
            return { symbols: "XAUUSD,EURUSD,GBPUSD" };
        case "market_breadth":
            return { symbols: "XAUUSD,EURUSD,GBPUSD,USDJPY", timeframe: "H1" };
        default:
            return {};
    }
}

/** Reads the symbol/timeframe pair every analytics widget shares. */
function readSymbolTimeframe(config: WidgetConfig): { symbol: string; timeframe: string } {
    return {
        symbol: String(config.symbol ?? "XAUUSD").toUpperCase(),
        timeframe: String(config.timeframe ?? "H1").toUpperCase(),
    };
}

function readSymbolList(config: WidgetConfig, fallback: string): string {
    const raw = String(config.symbols ?? fallback);
    return (
        raw
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
            .join(",") || fallback
    );
}

function analyticsPath(route: string, config: WidgetConfig): string {
    const { symbol, timeframe } = readSymbolTimeframe(config);
    return `/api/analytics/${route}?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Data plumbing — one authenticated fetch per widget, shared across renders.
 * ────────────────────────────────────────────────────────────────────────── */

type Status = "idle" | "loading" | "ready" | "error";

async function getJson<T>(user: User, path: string, auth: boolean): Promise<T | null> {
    try {
        const headers: Record<string, string> = {};
        if (auth) headers.Authorization = `Bearer ${await user.getIdToken()}`;
        const res = await fetch(path, { headers });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

function useApiData<T>(
    path: string | null,
    user: User | null,
    refreshKey: number,
    auth = true,
    /** Optional self-refresh interval for widgets that present as live. */
    pollMs = 0
): { data: T | null; status: Status } {
    // One state object keyed by request so a path/symbol/account change reads as
    // "loading" on the next render instead of flipping state from inside the effect.
    const [result, setResult] = useState<{ key: string; data: T | null; status: Status }>({
        key: "",
        data: null,
        status: "idle",
    });
    const [pollTick, setPollTick] = useState(0);
    const requestKey = `${path ?? ""}|${refreshKey}|${pollTick}|${user?.uid ?? ""}|${auth ? "auth" : "anon"}`;

    // Polling only while the tab is visible — a backgrounded dashboard must not
    // keep hitting the market data provider.
    useEffect(() => {
        if (pollMs <= 0) return;
        const timer = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            setPollTick((tick) => tick + 1);
        }, pollMs);
        return () => clearInterval(timer);
    }, [pollMs]);

    useEffect(() => {
        if (!path || !user) return;

        let cancelled = false;

        void getJson<T>(user, path, auth).then((json) => {
            if (cancelled) return;
            setResult({
                key: requestKey,
                data: json,
                status: json === null ? "error" : "ready",
            });
        });

        return () => {
            cancelled = true;
        };
    }, [path, user, refreshKey, auth, requestKey]);

    // Disabled request → nothing to show. Stale response → keep showing it while
    // the new one is in flight rather than flashing an empty widget.
    if (!path || !user) return { data: null, status: "idle" };
    if (result.key !== requestKey) {
        return result.status === "idle" ? { data: null, status: "loading" } : result;
    }
    return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared presentational pieces (loading / empty / error are first-class)
 * ────────────────────────────────────────────────────────────────────────── */

function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
            ))}
            <span className="sr-only">Loading widget data</span>
        </div>
    );
}

function WidgetState({
    icon: Icon,
    title,
    hint,
    tone = "muted",
    action,
}: {
    icon: ComponentType<{ size?: number; className?: string }>;
    title: string;
    hint?: string;
    tone?: "muted" | "negative";
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
            <Icon
                size={20}
                className={cn(tone === "negative" ? "text-negative" : "text-muted-foreground")}
            />
            <p className="text-[13px] font-medium text-foreground">{title}</p>
            {hint ? <p className="max-w-[38ch] text-xs text-muted-foreground">{hint}</p> : null}
            {action}
        </div>
    );
}

/**
 * Pro gate. Rendered instead of the widget body when the subscription is not
 * Pro — and no request is issued at all in that case, so the data never reaches
 * the client for a locked widget.
 */
function ProLock({ label, hint }: { label: string; hint: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-4 py-8 text-center">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                <Lock size={13} className="text-primary" />
                {label}
            </p>
            <p className="max-w-[40ch] text-xs text-muted-foreground">{hint}</p>
            <a
                href="/pricing"
                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/80"
            >
                <Crown size={11} />
                Upgrade to Pro
            </a>
        </div>
    );
}

function Metric({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: "positive" | "negative" | "warning" | "muted";
}) {
    return (
        <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p
                className={cn(
                    "font-numeric mt-1 truncate text-[15px] font-medium",
                    tone === "positive" && "text-positive",
                    tone === "negative" && "text-negative",
                    tone === "warning" && "text-warning",
                    tone === "muted" && "text-muted-foreground"
                )}
            >
                {value}
            </p>
        </div>
    );
}

/** The gateway heartbeat is what marks an account as live, not just its status. */
const HEARTBEAT_WINDOW_MS = 120_000;

function isAccountLive(status: string, lastHeartbeatAt: number): boolean {
    if (status !== "connected") return false;
    if (!lastHeartbeatAt) return false;
    return Date.now() - lastHeartbeatAt < HEARTBEAT_WINDOW_MS;
}

function statusTone(status: string, lastHeartbeatAt?: number): "positive" | "muted" {
    return isAccountLive(status, lastHeartbeatAt ?? 0) ? "positive" : "muted";
}

function pnlTone(value: number): "positive" | "negative" | "muted" {
    if (value > 0) return "positive";
    if (value < 0) return "negative";
    return "muted";
}

function money(value: number | undefined | null, currency = "USD"): string {
    const n = Number(value ?? 0);
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(n);
    } catch {
        return `$${n.toFixed(2)}`;
    }
}

function priceDigits(value: number): number {
    if (value >= 100) return 2;
    if (value >= 1) return 5;
    return 6;
}

function formatPrice(value: number | undefined | null, symbol?: string): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(priceDigits(n))}${symbol ? ` ${symbol}` : ""}`;
}

function relativeTime(ts?: number): string {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Widgets
 * ────────────────────────────────────────────────────────────────────────── */

function PortfolioSummaryWidget({ user, refreshKey }: WidgetProps) {
    const { data, status } = useApiData<{ portfolio?: Portfolio }>(
        "/api/analytics/portfolio",
        user,
        refreshKey
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton />;
    if (status === "error") {
        return (
            <WidgetState
                icon={AlertTriangle}
                tone="negative"
                title="Portfolio unavailable"
                hint="The analytics service did not respond. Use Refresh to retry."
            />
        );
    }

    const p = data?.portfolio;
    if (!p || p.accountCount === 0) {
        return (
            <WidgetState
                icon={Wallet}
                title="No connected accounts"
                hint="Connect an MT5 account through Trading Access to populate this dashboard."
            />
        );
    }

    const currency = p.accounts[0]?.currency || "USD";

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric label="Balance" value={money(p.totalBalance, currency)} />
                <Metric label="Equity" value={money(p.totalEquity, currency)} />
                <Metric
                    label="Floating P/L"
                    value={`${p.totalFloatingPnl >= 0 ? "+" : ""}${money(p.totalFloatingPnl, currency)}`}
                    tone={pnlTone(p.totalFloatingPnl)}
                />
                <Metric
                    label="Drawdown"
                    value={`${p.overallDrawdown.toFixed(2)}%`}
                    tone={p.overallDrawdown > 10 ? "negative" : p.overallDrawdown > 5 ? "warning" : "muted"}
                />
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
                <Metric label="Margin Used" value={money(p.totalMargin, currency)} />
                <Metric label="Free Margin" value={money(p.totalFreeMargin, currency)} />
                <Metric label="Accounts" value={`${p.onlineCount}/${p.accountCount} online`} />
                <Metric label="Open Exposure" value={`${p.exposure.length} symbol${p.exposure.length === 1 ? "" : "s"}`} />
            </div>
        </div>
    );
}

function AccountsWidget({ user, refreshKey }: WidgetProps) {
    const { data, status } = useApiData<{ accounts?: PortfolioAccount[] }>(
        "/api/analytics/accounts",
        user,
        refreshKey
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={2} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Accounts unavailable" />;
    }

    const accounts = data?.accounts ?? [];
    if (accounts.length === 0) {
        return (
            <WidgetState
                icon={Globe}
                title="Not connected"
                hint="No MT5 gateway has reported an account for this user yet."
            />
        );
    }

    return (
        <ul className="divide-y divide-border">
            {accounts.slice(0, 5).map((acc) => (
                <li key={acc.accountId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span
                        className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            statusTone(acc.status) === "positive" ? "bg-positive" : "bg-muted-foreground/40"
                        )}
                        aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">
                            {acc.broker || acc.mt5Account || acc.accountId}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                            {acc.mt5Account ? `#${acc.mt5Account}` : acc.accountId} · {acc.status} ·{" "}
                            {relativeTime(acc.lastHeartbeatAt)}
                        </p>
                    </div>
                    <div className="shrink-0 text-right">
                        <p className="font-numeric text-[13px] text-foreground">{money(acc.equity, acc.currency)}</p>
                        <p
                            className={cn(
                                "font-numeric text-[11px]",
                                pnlTone(acc.floatingPnl) === "positive" && "text-positive",
                                pnlTone(acc.floatingPnl) === "negative" && "text-negative",
                                pnlTone(acc.floatingPnl) === "muted" && "text-muted-foreground"
                            )}
                        >
                            {acc.floatingPnl >= 0 ? "+" : ""}
                            {money(acc.floatingPnl, acc.currency)}
                        </p>
                    </div>
                </li>
            ))}
            {accounts.length > 5 && (
                <li className="pt-2.5 text-[11px] text-muted-foreground">
                    +{accounts.length - 5} more account{accounts.length - 5 === 1 ? "" : "s"}
                </li>
            )}
        </ul>
    );
}

function EquityCurveWidget({ user, refreshKey, accountId, config }: WidgetProps) {
    const { data, status } = useApiData<{ curves?: Curve[]; success?: boolean }>(
        "/api/analytics/equity-curve",
        user,
        refreshKey
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={4} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Equity curve unavailable" />;
    }

    const curves = data?.curves ?? [];
    const preferred = String(config.accountId ?? "");
    const curve = curves.find((c) => c.accountId === preferred) ?? curves.find((c) => c.accountId === accountId) ?? curves[0];

    if (!curve) {
        return (
            <WidgetState
                icon={TrendingUp}
                title="No equity history"
                hint="The gateway has not written equity snapshots for this account yet."
            />
        );
    }

    if (curve.data.length < 2) {
        return (
            <WidgetState
                icon={TrendingUp}
                title="Insufficient data"
                hint={`${accountNameLabel(curve)} has ${curve.data.length} recorded point. At least 2 are needed to plot a curve.`}
            />
        );
    }

    const series = curve.data.map((point) => ({
        label: new Date(point.time).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }),
        equity: point.equity,
        balance: point.balance,
    }));

    const first = curve.data[0];
    const last = curve.data[curve.data.length - 1];
    const change = last.equity - first.equity;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-foreground">{accountNameLabel(curve)}</p>
                <p
                    className={cn(
                        "font-numeric text-[13px] font-medium",
                        pnlTone(change) === "positive" && "text-positive",
                        pnlTone(change) === "negative" && "text-negative",
                        pnlTone(change) === "muted" && "text-muted-foreground"
                    )}
                >
                    {change >= 0 ? "+" : ""}
                    {money(change)}
                    <span className="ml-1 text-[11px] text-muted-foreground">over {curve.data.length} points</span>
                </p>
            </div>
            <AreaTrendChart
                data={series}
                series={[
                    { key: "equity", label: "Equity", colorVar: "var(--chart-1)" },
                    { key: "balance", label: "Balance", colorVar: "var(--chart-3)" },
                ]}
                height={200}
            />
        </div>
    );
}

function accountNameLabel(curve: Curve): string {
    return curve.accountName || curve.accountId;
}

function MarketScoreWidget({ user, refreshKey, config }: WidgetProps) {
    const symbol = String(config.symbol ?? "XAUUSD").toUpperCase();
    const timeframe = String(config.timeframe ?? "H1").toUpperCase();

    const { data, status } = useApiData<{ score?: Score }>(
        `/api/analytics/score?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
        user,
        refreshKey
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return (
            <WidgetState
                icon={AlertTriangle}
                tone="negative"
                title="Market score unavailable"
                hint={`No score could be computed for ${symbol} ${timeframe}.`}
            />
        );
    }

    const score = data?.score;
    if (!score) {
        return <WidgetState icon={Activity} title="Insufficient data" hint="Not enough candles to score this market." />;
    }

    const biasTone =
        score.bias === "bullish" ? "positive" : score.bias === "bearish" ? "negative" : "muted";

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {symbol} · {timeframe}
                    </p>
                    <p
                        className={cn(
                            "font-numeric mt-1 text-3xl font-semibold",
                            biasTone === "positive" && "text-positive",
                            biasTone === "negative" && "text-negative",
                            biasTone === "muted" && "text-foreground"
                        )}
                    >
                        <CountUp value={Math.round(score.total)} />
                        <span className="text-sm text-muted-foreground">/100</span>
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <span
                        className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
                            biasTone === "positive" && "border-positive/30 bg-positive/10 text-positive",
                            biasTone === "negative" && "border-negative/30 bg-negative/10 text-negative",
                            biasTone === "muted" && "border-border bg-muted text-muted-foreground"
                        )}
                    >
                        {score.bias}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                        {score.confidence} confidence
                    </span>
                </div>
            </div>

            <LevelBars
                items={score.components.map<LevelBarItem>((component) => {
                    const tone = pnlTone(component.value);
                    return {
                        id: component.name,
                        label: component.name,
                        value: Math.abs(component.value),
                        colorVar:
                            tone === "positive"
                                ? "var(--positive)"
                                : tone === "negative"
                                    ? "var(--negative)"
                                    : "var(--muted-foreground)",
                        right: (
                            <span
                                className={cn(
                                    tone === "positive" && "text-positive",
                                    tone === "negative" && "text-negative",
                                    tone === "muted" && "text-muted-foreground"
                                )}
                            >
                                {component.value > 0 ? "+" : ""}
                                {Math.round(component.value)}
                                <span className="text-muted-foreground">/{component.max}</span>
                            </span>
                        ),
                    };
                })}
            />
        </div>
    );
}

function RiskWidget({ user, refreshKey, accountId }: WidgetProps) {
    const { data, status } = useApiData<{ risk?: Risk }>(
        accountId ? `/api/analytics/risk?accountId=${encodeURIComponent(accountId)}` : null,
        user,
        refreshKey
    );

    if (!accountId) {
        return (
            <WidgetState
                icon={ShieldAlert}
                title="Not connected"
                hint="Connect an MT5 account to see margin level, utilisation and risk."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Risk metrics unavailable" />;
    }

    const risk = data?.risk;
    if (!risk) {
        return <WidgetState icon={ShieldAlert} title="Insufficient data" />;
    }

    const utilisationTone =
        risk.marginUtilization > 80 ? "negative" : risk.marginUtilization > 50 ? "warning" : "positive";

    return (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0">
                <ProgressRing value={Math.round(risk.marginLevel)} threshold={500} label="Margin" size={112} />
            </div>
            <div className="w-full flex-1 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <Metric
                        label="Margin Used"
                        value={money(risk.marginUsed)}
                        tone={utilisationTone === "negative" ? "negative" : undefined}
                    />
                    <Metric label="Free Margin" value={money(risk.marginFree)} />
                    <Metric label="Floating P/L" value={money(risk.floatingPnl)} tone={pnlTone(risk.floatingPnl)} />
                    <Metric
                        label="Drawdown"
                        value={`${risk.drawdown.toFixed(2)}%`}
                        tone={risk.drawdown > 10 ? "negative" : risk.drawdown > 5 ? "warning" : "muted"}
                    />
                </div>
                <div className="space-y-1.5 border-t border-border pt-3">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Margin utilisation</span>
                        <span className="font-numeric text-foreground">{risk.marginUtilization.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                            className={cn(
                                "h-full rounded-full",
                                utilisationTone === "negative" && "bg-negative",
                                utilisationTone === "warning" && "bg-warning",
                                utilisationTone === "positive" && "bg-positive"
                            )}
                            style={{ width: `${Math.min(100, Math.max(2, risk.marginUtilization))}%` }}
                        />
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Open risk exposure</span>
                        <span className="font-numeric text-foreground">
                            {money(risk.totalRiskExposure)} · {risk.positionsAtRisk}/{risk.totalPositions} at risk
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PositionsWidget({ user, refreshKey, accountId }: WidgetProps) {
    const { data, status } = useApiData<{ positions?: Position[] }>(
        accountId ? `/api/trading/positions?accountId=${encodeURIComponent(accountId)}` : null,
        user,
        refreshKey
    );

    if (!accountId) {
        return <WidgetState icon={Table2} title="Not connected" hint="Positions appear once an MT5 account is connected." />;
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={4} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Positions unavailable" />;
    }

    const positions = data?.positions ?? [];
    if (positions.length === 0) {
        return <WidgetState icon={Table2} title="No open positions" hint="This account is flat right now." />;
    }

    const totalPnl = positions.reduce((sum, p) => sum + Number(p.profit ?? 0), 0);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {positions.length} open position{positions.length === 1 ? "" : "s"}
                </p>
                <p
                    className={cn(
                        "font-numeric text-[13px] font-medium",
                        pnlTone(totalPnl) === "positive" && "text-positive",
                        pnlTone(totalPnl) === "negative" && "text-negative",
                        pnlTone(totalPnl) === "muted" && "text-muted-foreground"
                    )}
                >
                    {totalPnl >= 0 ? "+" : ""}
                    {money(totalPnl)}
                </p>
            </div>
            <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="px-1 pb-2 text-left font-medium">Symbol</th>
                            <th className="px-1 pb-2 text-left font-medium">Side</th>
                            <th className="px-1 pb-2 text-right font-medium">Volume</th>
                            <th className="px-1 pb-2 text-right font-medium">Open</th>
                            <th className="px-1 pb-2 text-right font-medium">Price</th>
                            <th className="px-1 pb-2 text-right font-medium">S/L</th>
                            <th className="px-1 pb-2 text-right font-medium">P/L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.slice(0, 8).map((position) => {
                            const isBuy = String(position.type).toUpperCase().startsWith("BUY");
                            const pnl = Number(position.profit ?? 0);
                            return (
                                <tr key={position.ticket} className="border-b border-border/50 last:border-0">
                                    <td className="px-1 py-2 font-medium text-foreground">{position.symbol}</td>
                                    <td className={cn("px-1 py-2", isBuy ? "text-positive" : "text-negative")}>
                                        {isBuy ? "BUY" : "SELL"}
                                    </td>
                                    <td className="num-right px-1 py-2 text-foreground">{Number(position.volume ?? 0).toFixed(2)}</td>
                                    <td className="num-right px-1 py-2 text-muted-foreground">
                                        {formatPrice(position.openPrice)}
                                    </td>
                                    <td className="num-right px-1 py-2 text-foreground">
                                        {formatPrice(position.currentPrice)}
                                    </td>
                                    <td className="num-right px-1 py-2 text-muted-foreground">
                                        {formatPrice(position.sl)}
                                    </td>
                                    <td
                                        className={cn(
                                            "num-right px-1 py-2 font-medium",
                                            pnlTone(pnl) === "positive" && "text-positive",
                                            pnlTone(pnl) === "negative" && "text-negative",
                                            pnlTone(pnl) === "muted" && "text-muted-foreground"
                                        )}
                                    >
                                        {pnl >= 0 ? "+" : ""}
                                        {pnl.toFixed(2)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {positions.length > 8 && (
                <p className="text-[11px] text-muted-foreground">
                    +{positions.length - 8} more — open Positions for the full list.
                </p>
            )}
        </div>
    );
}

function ExposureWidget({ user, refreshKey }: WidgetProps) {
    const { data, status } = useApiData<{ portfolio?: Portfolio }>(
        "/api/analytics/portfolio",
        user,
        refreshKey
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Exposure unavailable" />;
    }

    const exposure = data?.portfolio?.exposure ?? [];
    if (exposure.length === 0) {
        return <WidgetState icon={BarChart3} title="No open exposure" hint="Nothing is currently open across your accounts." />;
    }

    const maxVolume = Math.max(...exposure.map((e) => Math.abs(e.volume)), 0.0001);

    return (
        <ul className="space-y-2.5">
            {exposure.slice(0, 6).map((item) => {
                const tone = String(item.type).toUpperCase().startsWith("BUY") ? "positive" : "negative";
                return (
                    <li key={`${item.symbol}_${item.type}`} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                            <span className="truncate font-medium text-foreground">
                                {item.symbol}{" "}
                                <span className={cn(tone === "positive" ? "text-positive" : "text-negative")}>
                                    {tone === "positive" ? "BUY" : "SELL"}
                                </span>
                            </span>
                            <span className="font-numeric shrink-0 text-muted-foreground">
                                {item.volume.toFixed(2)} lots ·{" "}
                                <span className={pnlTone(item.pnl) === "positive" ? "text-positive" : pnlTone(item.pnl) === "negative" ? "text-negative" : "text-muted-foreground"}>
                                    {item.pnl >= 0 ? "+" : ""}
                                    {money(item.pnl)}
                                </span>
                            </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                                className={cn("h-full rounded-full", tone === "positive" ? "bg-positive" : "bg-negative")}
                                style={{ width: `${Math.max(4, (Math.abs(item.volume) / maxVolume) * 100)}%` }}
                            />
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

function RecentAlertsWidget({ user, refreshKey }: WidgetProps) {
    const { data, status } = useApiData<{ alerts?: AlertRecord[] }>("/api/alerts", user, refreshKey);

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Alerts unavailable" />;
    }

    const alerts = data?.alerts ?? [];
    if (alerts.length === 0) {
        return (
            <WidgetState
                icon={Bell}
                title="No alerts yet"
                hint="Create price or structure alerts and they will surface here."
            />
        );
    }

    return (
        <ul className="divide-y divide-border">
            {alerts.slice(0, 5).map((alert) => (
                <li key={alert.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span
                        className={cn(
                            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                            alert.triggered ? "bg-primary" : "bg-muted-foreground/40"
                        )}
                        aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">
                            {alert.symbol} · {String(alert.type).replace(/_/g, " ")}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                            {alert.message || `${alert.timeframe || "H1"} alert`}
                        </p>
                    </div>
                    <div className="shrink-0 text-right">
                        <p
                            className={cn(
                                "text-[11px] font-medium",
                                alert.triggered ? "text-primary" : "text-muted-foreground"
                            )}
                        >
                            {alert.triggered ? "Triggered" : "Armed"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                            {relativeTime(alert.triggeredAt || alert.createdAt)}
                        </p>
                    </div>
                </li>
            ))}
        </ul>
    );
}

function WatchlistWidget({ user, refreshKey, config }: WidgetProps) {
    const symbols =
        String(config.symbols ?? "XAUUSD,EURUSD,GBPUSD")
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
            .join(",") || "XAUUSD";

    const { data, status } = useApiData<{ quotes?: Record<string, Quote> }>(
        `/api/analytics/watchlist?symbols=${encodeURIComponent(symbols)}`,
        user,
        refreshKey,
        false
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Quotes unavailable" />;
    }

    const quotes = Object.values(data?.quotes ?? {});
    if (quotes.length === 0) {
        return (
            <WidgetState
                icon={Gauge}
                title="No quotes available"
                hint="The upstream feed returned no data for these symbols."
            />
        );
    }

    return (
        <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-[11px]">
                <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-1 pb-2 text-left font-medium">Symbol</th>
                        <th className="px-1 pb-2 text-right font-medium">Bid</th>
                        <th className="px-1 pb-2 text-right font-medium">Ask</th>
                        <th className="px-1 pb-2 text-right font-medium">Change</th>
                    </tr>
                </thead>
                <tbody>
                    {quotes.map((quote) => (
                        <tr key={quote.symbol} className="border-b border-border/50 last:border-0">
                            <td className="px-1 py-2 font-medium text-foreground">{quote.symbol}</td>
                            <td className="num-right px-1 py-2 text-foreground">{formatPrice(quote.bid)}</td>
                            <td className="num-right px-1 py-2 text-muted-foreground">{formatPrice(quote.ask)}</td>
                            <td
                                className={cn(
                                    "num-right px-1 py-2 font-medium",
                                    pnlTone(quote.changePercent) === "positive" && "text-positive",
                                    pnlTone(quote.changePercent) === "negative" && "text-negative",
                                    pnlTone(quote.changePercent) === "muted" && "text-muted-foreground"
                                )}
                            >
                                {quote.changePercent >= 0 ? "+" : ""}
                                {quote.changePercent.toFixed(2)}%
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const SESSIONS: { label: string; from: number; to: number }[] = [
    { label: "Sydney", from: 21, to: 6 },
    { label: "Tokyo", from: 0, to: 9 },
    { label: "London", from: 7, to: 16 },
    { label: "New York", from: 12, to: 21 },
];

function MarketClockWidget() {
    const [now, setNow] = useState<Date | null>(null);

    useEffect(() => {
        const tick = () => setNow(new Date());
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, []);

    if (!now) return <WidgetSkeleton rows={1} />;

    const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
    const active = SESSIONS.filter((session) =>
        session.from <= session.to
            ? utcHour >= session.from && utcHour < session.to
            : utcHour >= session.from || utcHour < session.to
    ).map((session) => session.label);

    const weekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;
    const marketOpen = !weekend && active.length > 0;

    return (
        <div className="flex h-full flex-col justify-center gap-3">
            <div className="flex items-baseline gap-2">
                <span className="font-numeric text-3xl font-semibold tracking-tight text-foreground">
                    {now.toLocaleTimeString("en-GB", { hour12: false })}
                </span>
                <span className="text-[11px] text-muted-foreground">local</span>
            </div>
            <div className="flex items-baseline gap-2">
                <span className="font-numeric text-[15px] text-foreground">
                    {now.toLocaleTimeString("en-GB", {
                        hour12: false,
                        timeZone: "UTC",
                    })}
                </span>
                <span className="text-[11px] text-muted-foreground">UTC</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <span
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        marketOpen
                            ? "border-positive/30 bg-positive/10 text-positive"
                            : "border-border bg-muted text-muted-foreground"
                    )}
                >
                    <span
                        className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            marketOpen ? "bg-positive" : "bg-muted-foreground/50"
                        )}
                        aria-hidden="true"
                    />
                    {weekend ? "Weekend" : marketOpen ? "Market open" : "Between sessions"}
                </span>
                {active.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">Sessions: {active.join(", ")}</span>
                )}
            </div>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pro tier widgets
 * ────────────────────────────────────────────────────────────────────────── */

type Regime = { regime: string; confidence: number; factors: string[] };

const REGIME_LABELS: Record<string, string> = {
    trending_bullish: "Trending Bullish",
    trending_bearish: "Trending Bearish",
    ranging: "Ranging",
    breakout: "Breakout",
    high_volatility: "High Volatility",
    low_volatility: "Low Volatility",
    transitional: "Transitional",
};

function MarketRegimeWidget({ user, refreshKey, config, isPro }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);

    const { data, status } = useApiData<{ regime?: Regime }>(
        isPro ? analyticsPath("regime", config) : null,
        user,
        refreshKey
    );

    if (!isPro) {
        return (
            <ProLock
                label="Market Regime"
                hint="Regime classification with the confidence and factors behind each call is a Pro analytics widget."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Regime unavailable" />;
    }

    const regime = data?.regime;
    if (!regime) {
        return <WidgetState icon={Radar} title="Insufficient data" hint="Not enough candles to classify this market." />;
    }

    const bullish = regime.regime === "trending_bullish";
    const bearish = regime.regime === "trending_bearish";
    const directional = bullish || bearish;

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {symbol} · {timeframe}
                    </p>
                    <p
                        className={cn(
                            "mt-1 text-lg font-semibold",
                            bullish && "text-positive",
                            bearish && "text-negative",
                            !directional && "text-foreground"
                        )}
                    >
                        {REGIME_LABELS[regime.regime] ?? regime.regime}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Confidence</p>
                    <p className="font-numeric mt-1 text-2xl font-semibold text-foreground">
                        {Math.round(regime.confidence)}
                        <span className="text-sm text-muted-foreground">%</span>
                    </p>
                </div>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                    className={cn(
                        "h-full rounded-full",
                        bullish && "bg-positive",
                        bearish && "bg-negative",
                        !directional && "bg-muted-foreground/50"
                    )}
                    style={{ width: `${Math.min(100, Math.max(3, regime.confidence))}%` }}
                />
            </div>

            <ul className="space-y-1 border-t border-border pt-3">
                {regime.factors.slice(0, 5).map((factor, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
                        <span className="min-w-0">{factor}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

type Volatility = {
    atr: number;
    atrPercent: number;
    state: "low" | "normal" | "high" | "extreme";
    rangeExpansion: number;
    lookbackPeriods: number;
};

function VolatilityWidget({ user, refreshKey, config, isPro }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);

    const { data, status } = useApiData<{ volatility?: Volatility }>(
        isPro ? analyticsPath("volatility", config) : null,
        user,
        refreshKey
    );

    if (!isPro) {
        return (
            <ProLock
                label="Volatility Profile"
                hint="ATR, range expansion and volatility state are Pro analytics."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Volatility unavailable" />;
    }

    const vol = data?.volatility;
    if (!vol || vol.lookbackPeriods === 0) {
        return <WidgetState icon={Waves} title="Insufficient data" hint="No candles to measure volatility on." />;
    }

    const tone =
        vol.state === "extreme" || vol.state === "high"
            ? "negative"
            : vol.state === "low"
              ? "positive"
              : "warning";

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {symbol} · {timeframe}
                    </p>
                    <p
                        className={cn(
                            "mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] font-medium capitalize",
                            tone === "negative" && "border-negative/30 bg-negative/10 text-negative",
                            tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
                            tone === "positive" && "border-positive/30 bg-positive/10 text-positive"
                        )}
                    >
                        {vol.state} volatility
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">ATR</p>
                    <p className="font-numeric mt-1 text-2xl font-semibold text-foreground">
                        {formatPrice(vol.atr)}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                <Metric label="ATR %" value={`${vol.atrPercent.toFixed(3)}%`} />
                <Metric
                    label="Range expansion"
                    value={`${vol.rangeExpansion.toFixed(1)}×`}
                    tone={vol.rangeExpansion > 1.5 ? "warning" : "muted"}
                />
                <Metric label="Lookback" value={`${vol.lookbackPeriods} periods`} tone="muted" />
                <Metric
                    label="Tick size"
                    value={vol.atrPercent < 0.3 ? "Tight" : vol.atrPercent < 0.6 ? "Normal" : "Wide"}
                    tone={vol.atrPercent < 0.3 ? "positive" : vol.atrPercent < 0.6 ? "muted" : "negative"}
                />
            </div>
        </div>
    );
}

type VolumeData = {
    volume: number;
    averageVolume: number;
    relativeVolume: number;
    state: "expanded" | "normal" | "contracted";
    isTickVolume: boolean;
};

function VolumeAnalysisWidget({ user, refreshKey, config, isPro }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);

    const { data, status } = useApiData<{ volume?: VolumeData }>(
        isPro ? analyticsPath("volume", config) : null,
        user,
        refreshKey
    );

    if (!isPro) {
        return (
            <ProLock
                label="Volume Analysis"
                hint="Relative volume against the 20-period average is a Pro analytics widget."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Volume unavailable" />;
    }

    const vol = data?.volume;
    // The normalizer can supply tick volume, which is a proxy rather than real
    // traded volume. Say so rather than presenting it as exchange volume.
    const tickOnly = vol?.isTickVolume && vol.volume === 0;

    if (!vol || tickOnly) {
        return (
            <WidgetState
                icon={BarChart3}
                title="Insufficient data"
                hint="The feed returned no volume for this symbol and timeframe."
            />
        );
    }

    const tone = vol.state === "expanded" ? "warning" : vol.state === "contracted" ? "muted" : "positive";

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {symbol} · {timeframe}
                    </p>
                    <p className="font-numeric mt-1 text-2xl font-semibold text-foreground">
                        {vol.relativeVolume.toFixed(2)}
                        <span className="text-sm text-muted-foreground">× avg</span>
                    </p>
                </div>
                <span
                    className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] font-medium capitalize",
                        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
                        tone === "positive" && "border-positive/30 bg-positive/10 text-positive",
                        tone === "muted" && "border-border bg-muted text-muted-foreground"
                    )}
                >
                    {vol.state}
                </span>
            </div>

            {/* 1× average is the reference line; the bar shows relative volume. */}
            <div className="space-y-1.5">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                        className={cn(
                            "h-full rounded-full",
                            vol.relativeVolume >= 1.5
                                ? "bg-warning"
                                : vol.relativeVolume <= 0.7
                                  ? "bg-muted-foreground/50"
                                  : "bg-positive"
                        )}
                        style={{ width: `${Math.min(100, Math.max(3, (vol.relativeVolume / 2) * 100))}%` }}
                    />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>0×</span>
                    <span>1× average</span>
                    <span>2×</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                <Metric label="Current" value={Math.round(vol.volume).toLocaleString()} />
                <Metric label="20-period avg" value={vol.averageVolume.toLocaleString()} tone="muted" />
            </div>

            {vol.isTickVolume && (
                <p className="text-[11px] text-muted-foreground">
                    Source: tick volume — a proxy for participation, not centralized traded volume.
                </p>
            )}
        </div>
    );
}

type StructureEvent = {
    id: string;
    type: "BOS" | "CHOCH" | "swing_high" | "swing_low";
    direction: "bullish" | "bearish";
    price: number;
    timestamp: number;
    timeframe: string;
    brokenLevel?: number;
};

function StructureEventsWidget({ user, refreshKey, config, isPro }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);

    const { data, status } = useApiData<{ structure?: StructureEvent[] }>(
        isPro ? analyticsPath("structure", config) : null,
        user,
        refreshKey
    );

    if (!isPro) {
        return (
            <ProLock
                label="Structure Events"
                hint="Break of structure and change of character events with their broken levels are Pro analytics."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={4} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Structure unavailable" />;
    }

    const events = (data?.structure ?? [])
        .filter((e) => e.type === "BOS" || e.type === "CHOCH")
        .sort((a, b) => b.timestamp - a.timestamp);

    if (events.length === 0) {
        return (
            <WidgetState
                icon={TrendingUp}
                title="No structural breaks"
                hint={`No BOS or CHOCH has printed on ${symbol} ${timeframe} in this window.`}
            />
        );
    }

    return (
        <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-[11px]">
                <thead>
                    <tr className="border-b border-border uppercase tracking-wide text-muted-foreground">
                        <th className="px-1 pb-2 text-left font-medium">Event</th>
                        <th className="px-1 pb-2 text-left font-medium">Bias</th>
                        <th className="px-1 pb-2 text-right font-medium">Price</th>
                        <th className="px-1 pb-2 text-right font-medium">Broken level</th>
                        <th className="px-1 pb-2 text-right font-medium">Time</th>
                    </tr>
                </thead>
                <tbody>
                    {events.slice(0, 8).map((event) => {
                        const bullish = event.direction === "bullish";
                        return (
                            <tr key={event.id} className="border-b border-border/50 last:border-0">
                                <td className="px-1 py-2">
                                    <span
                                        className={cn(
                                            "inline-flex rounded-full border px-1.5 py-0.5 text-[11px] font-medium",
                                            event.type === "CHOCH"
                                                ? "border-warning/30 bg-warning/10 text-warning"
                                                : "border-border bg-muted text-foreground"
                                        )}
                                    >
                                        {event.type}
                                    </span>
                                </td>
                                <td className={cn("px-1 py-2 capitalize", bullish ? "text-positive" : "text-negative")}>
                                    {event.direction}
                                </td>
                                <td className="num-right px-1 py-2 text-foreground">{formatPrice(event.price)}</td>
                                <td className="num-right px-1 py-2 text-muted-foreground">
                                    {event.brokenLevel !== undefined ? formatPrice(event.brokenLevel) : "—"}
                                </td>
                                <td className="num-right px-1 py-2 text-muted-foreground">
                                    {relativeTime(event.timestamp)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {events.length > 8 && (
                <p className="pt-2 text-[11px] text-muted-foreground">+{events.length - 8} older events</p>
            )}
        </div>
    );
}

type LiquidityLevel = {
    id: string;
    type: string;
    price: number;
    strength: number;
    timeframe: string;
    timestamp: number;
};

type LiquiditySweep = {
    id: string;
    side: "buy_side" | "sell_side";
    level: number;
    sweepPrice: number;
    confirmed: boolean;
    timestamp: number;
};

const LIQUIDITY_LABELS: Record<string, string> = {
    equal_highs: "Equal highs",
    equal_lows: "Equal lows",
    prev_day_high: "Previous day high",
    prev_day_low: "Previous day low",
    prev_week_high: "Previous week high",
    prev_week_low: "Previous week low",
    swing_high: "Swing high",
    swing_low: "Swing low",
    session_high: "Session high",
    session_low: "Session low",
};

function LiquidityMapWidget({ user, refreshKey, config, isPro }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);

    const { data, status } = useApiData<{ levels?: LiquidityLevel[]; sweeps?: LiquiditySweep[] }>(
        isPro ? analyticsPath("liquidity", config) : null,
        user,
        refreshKey
    );

    if (!isPro) {
        return (
            <ProLock
                label="Liquidity Map"
                hint="Resting liquidity levels and confirmed sweeps are Pro analytics."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={4} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Liquidity unavailable" />;
    }

    const levels = [...(data?.levels ?? [])].sort((a, b) => b.strength - a.strength);
    const sweeps = [...(data?.sweeps ?? [])].sort((a, b) => b.timestamp - a.timestamp);

    if (levels.length === 0 && sweeps.length === 0) {
        return (
            <WidgetState
                icon={Droplet}
                title="No liquidity detected"
                hint={`No resting pools or sweeps on ${symbol} ${timeframe} in this window.`}
            />
        );
    }

    const maxStrength = Math.max(...levels.map((l) => l.strength), 1);

    return (
        <div className="space-y-4">
            {levels.length > 0 && (
                <LevelBars
                    max={maxStrength}
                    items={levels.slice(0, 6).map((level) => {
                        // Two chart series by side: high-side pools vs low-side
                        // pools — data-viz tokens only, nothing decorative.
                        const isHigh = level.type.includes("high");
                        return {
                            id: level.id,
                            label: LIQUIDITY_LABELS[level.type] ?? level.type,
                            value: level.strength,
                            colorVar: isHigh ? "var(--chart-1)" : "var(--chart-2)",
                            right: formatPrice(level.price),
                            hint: `${isHigh ? "High-side" : "Low-side"} pool · strength ${level.strength}`,
                        };
                    })}
                />
            )}

            {sweeps.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Recent sweeps</p>
                    <ul className="space-y-1.5">
                        {sweeps.slice(0, 4).map((sweep) => {
                            const buySide = sweep.side === "buy_side";
                            return (
                                <li
                                    key={sweep.id}
                                    className="flex items-center justify-between gap-2 text-[11px]"
                                >
                                    <span className={cn("font-medium", buySide ? "text-negative" : "text-positive")}>
                                        {buySide ? "Sell-side swept" : "Buy-side swept"}
                                        {sweep.confirmed ? "" : " (unconfirmed)"}
                                    </span>
                                    <span className="font-numeric shrink-0 text-muted-foreground">
                                        {formatPrice(sweep.sweepPrice)} · {relativeTime(sweep.timestamp)}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}

type Zone = {
    id: string;
    type: string;
    direction: "bullish" | "bearish" | "neutral";
    high: number;
    low: number;
    timeframe: string;
    strength: number;
    status: "active" | "mitigated" | "invalidated";
    createdAt: number;
};

const ZONE_LABELS: Record<string, string> = {
    order_block: "Order block",
    fvg: "Fair value gap",
    liquidity: "Liquidity",
    vwap: "VWAP",
    prev_high_low: "Previous high/low",
};

function ZonesWidget({ user, refreshKey, config, isPro }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);

    const { data, status } = useApiData<{ zones?: Zone[] }>(
        isPro ? analyticsPath("zones", config) : null,
        user,
        refreshKey
    );

    if (!isPro) {
        return (
            <ProLock
                label="Active Zones"
                hint="Order blocks, fair value gaps and liquidity zones with their status is Pro analytics."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={4} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Zones unavailable" />;
    }

    // Only zones still in play are actionable; mitigated/invalidated ones are history.
    const active = (data?.zones ?? []).filter((z) => z.status === "active");

    if (active.length === 0) {
        return (
            <WidgetState
                icon={Layers}
                title="No active zones"
                hint={`Every detected zone on ${symbol} ${timeframe} has been mitigated or invalidated.`}
            />
        );
    }

    const maxStrength = Math.max(...active.map((z) => z.strength), 1);

    return (
        <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-[11px]">
                <thead>
                    <tr className="border-b border-border uppercase tracking-wide text-muted-foreground">
                        <th className="px-1 pb-2 text-left font-medium">Type</th>
                        <th className="px-1 pb-2 text-left font-medium">Bias</th>
                        <th className="px-1 pb-2 text-right font-medium">Range</th>
                        <th className="px-1 pb-2 text-right font-medium">Strength</th>
                        <th className="px-1 pb-2 text-right font-medium">Age</th>
                    </tr>
                </thead>
                <tbody>
                    {active.slice(0, 8).map((zone) => (
                        <tr key={zone.id} className="border-b border-border/50 last:border-0">
                            <td className="px-1 py-2 font-medium text-foreground">
                                {ZONE_LABELS[zone.type] ?? zone.type}
                            </td>
                            <td
                                className={cn(
                                    "px-1 py-2 capitalize",
                                    zone.direction === "bullish" && "text-positive",
                                    zone.direction === "bearish" && "text-negative",
                                    zone.direction === "neutral" && "text-muted-foreground"
                                )}
                            >
                                {zone.direction}
                            </td>
                            <td className="num-right px-1 py-2 text-foreground">
                                {formatPrice(zone.low)} – {formatPrice(zone.high)}
                            </td>
                            <td className="px-1 py-2">
                                <span className="flex items-center justify-end gap-2">
                                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                        <span
                                            className="block h-full rounded-full bg-primary"
                                            style={{ width: `${Math.max(4, (zone.strength / maxStrength) * 100)}%` }}
                                        />
                                    </span>
                                    <span className="font-numeric w-7 text-right text-muted-foreground">
                                        {Math.round(zone.strength)}
                                    </span>
                                </span>
                            </td>
                            <td className="num-right px-1 py-2 text-muted-foreground">
                                {relativeTime(zone.createdAt)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {active.length > 8 && (
                <p className="pt-2 text-[11px] text-muted-foreground">+{active.length - 8} more active zones</p>
            )}
        </div>
    );
}

function correlationTone(value: number): string {
    if (value >= 0.5) return "bg-positive/80";
    if (value >= 0.2) return "bg-positive/40";
    if (value > -0.2) return "bg-muted-foreground/20";
    if (value > -0.5) return "bg-negative/40";
    return "bg-negative/80";
}

function CorrelationMatrixWidget({ user, refreshKey, isPro }: WidgetProps) {
    const { data, status } = useApiData<{
        symbols?: string[];
        available?: string[];
        matrix?: Record<string, Record<string, number>>;
    }>(isPro ? "/api/analytics/correlation" : null, user, refreshKey);

    if (!isPro) {
        return (
            <ProLock
                label="Correlation Matrix"
                hint="Cross-asset correlation across the tracked symbol set is Pro analytics."
            />
        );
    }
    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={6} />;
    if (status === "error") {
        return <WidgetState icon={AlertTriangle} tone="negative" title="Correlation unavailable" />;
    }

    const matrix = data?.matrix;
    // `available` is the authoritative list of symbols with enough return history.
    // Older payloads omit it, so fall back to any symbol the matrix has a row for.
    const available =
        data?.available ?? (data?.symbols ?? []).filter((s) => matrix?.[s] && Object.keys(matrix[s]).length > 0);

    if (available.length === 0) {
        return (
            <WidgetState
                icon={Grid3x3}
                title="Insufficient data"
                hint="Not enough return history was returned to compute correlation."
            />
        );
    }

    // Only symbols with enough data get a row/column — a symbol we could not
    // price would otherwise render as a column of misleading zeros.
    const populated = available;

    return (
        <div className="space-y-3">
            <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr>
                            <th className="px-1 pb-2" />
                            {populated.map((s) => (
                                <th
                                    key={s}
                                    className="px-1 pb-2 text-right font-medium text-muted-foreground"
                                    title={s}
                                >
                                    <span className="inline-block w-12 truncate">{s}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {populated.map((row) => (
                            <tr key={row}>
                                <th className="px-1 py-1 text-left font-medium text-muted-foreground">
                                    <span className="inline-block w-12 truncate">{row}</span>
                                </th>
                                {populated.map((col) => {
                                    const value = matrix?.[row]?.[col];
                                    const isDiagonal = row === col;
                                    return (
                                        <td
                                            key={col}
                                            className={cn(
                                                "px-0.5 py-0.5 text-center font-numeric text-[11px]",
                                                !isDiagonal && "rounded-sm"
                                            )}
                                            style={
                                                isDiagonal || value === undefined
                                                    ? undefined
                                                    : { backgroundColor: correlationTone(value) }
                                            }
                                            title={`${row} / ${col}: ${value !== undefined ? value.toFixed(3) : "no data"}`}
                                        >
                                            {isDiagonal ? (
                                                <span className="text-muted-foreground">—</span>
                                            ) : (
                                                <span className="text-foreground">
                                                    {value !== undefined ? value.toFixed(2) : "—"}
                                                </span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>Negative</span>
                <span className="h-2 w-20 rounded-sm bg-negative/80" aria-hidden="true" />
                <span className="h-2 w-6 rounded-sm bg-muted-foreground/20" aria-hidden="true" />
                <span className="h-2 w-20 rounded-sm bg-positive/80" aria-hidden="true" />
                <span>Positive</span>
                {data?.symbols && data.symbols.length > populated.length && (
                    <span>
                        · {data.symbols.length - populated.length} symbol
                        {data.symbols.length - populated.length === 1 ? "" : "s"} omitted — not enough price history
                    </span>
                )}
            </div>
        </div>
    );
}

function MarketBreadthWidget({ user, refreshKey, config, isPro }: WidgetProps) {
    const symbolsKey = readSymbolList(config, "XAUUSD,EURUSD,GBPUSD,USDJPY");
    const timeframe = String(config.timeframe ?? "H1").toUpperCase();

    // Each symbol needs its own score request, so they fan out in parallel and
    // settle together. A symbol that fails shows as unavailable rather than 0.
    const requestKey = `${symbolsKey}|${timeframe}|${refreshKey}|${user?.uid ?? ""}`;
    const [state, setState] = useState<{
        key: string;
        rows: { symbol: string; score: Score | null }[] | null;
    }>({ key: "", rows: null });

    useEffect(() => {
        if (!isPro || !user) return;

        let cancelled = false;
        const next: { symbol: string; score: Score | null }[] = [];

        void Promise.all(
            symbolsKey.split(",").map(async (symbol) => {
                const json = await getJson<{ score?: Score }>(
                    user,
                    `/api/analytics/score?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
                    true
                );
                next.push({ symbol, score: json?.score ?? null });
            })
        ).then(() => {
            if (cancelled) return;
            setState({
                key: requestKey,
                rows: next.sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1)),
            });
        });

        return () => {
            cancelled = true;
        };
    }, [user, isPro, refreshKey, symbolsKey, timeframe, requestKey]);

    if (!isPro) {
        return (
            <ProLock
                label="Symbol Scores"
                hint="Deterministic market scores across your whole watchlist are Pro analytics."
            />
        );
    }

    const rows = state.key === requestKey ? state.rows : null;
    if (!rows) return <WidgetSkeleton rows={4} />;

    const available = rows.filter((r) => r.score);

    if (available.length === 0) {
        return (
            <WidgetState
                icon={Sigma}
                title="Scores unavailable"
                hint="No symbol in this list returned a score for the selected timeframe."
            />
        );
    }

    return (
        <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{timeframe} market scores</p>
            <ul className="space-y-2.5">
                {rows.map((row) => {
                    if (!row.score) {
                        return (
                            <li key={row.symbol} className="flex items-center justify-between text-[11px]">
                                <span className="font-medium text-foreground">{row.symbol}</span>
                                <span className="text-muted-foreground">Unavailable</span>
                            </li>
                        );
                    }
                    const score = row.score;
                    const tone = score.bias === "bullish" ? "positive" : score.bias === "bearish" ? "negative" : "muted";
                    return (
                        <li key={row.symbol} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                                <span className="font-medium text-foreground">{row.symbol}</span>
                                <span className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            "rounded-full border px-1.5 py-0.5 text-[11px] capitalize",
                                            tone === "positive" && "border-positive/30 bg-positive/10 text-positive",
                                            tone === "negative" && "border-negative/30 bg-negative/10 text-negative",
                                            tone === "muted" && "border-border bg-muted text-muted-foreground"
                                        )}
                                    >
                                        {score.bias}
                                    </span>
                                    <span className="font-numeric w-8 text-right text-foreground">
                                        {Math.round(score.total)}
                                    </span>
                                </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                    className={cn(
                                        "h-full rounded-full",
                                        tone === "positive" && "bg-positive",
                                        tone === "negative" && "bg-negative",
                                        tone === "muted" && "bg-muted-foreground/40"
                                    )}
                                    style={{ width: `${Math.max(3, score.total)}%` }}
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Renderer
 * ────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────────
 * Command-centre widgets — animated signal core, confidence meter, live chart
 * and multi-timeframe bias. Same API payloads as every other widget in this
 * file; only the presentation is instrument-grade.
 * ────────────────────────────────────────────────────────────────────── */

type ScorePayload = { score?: Score };

const BIAS_TONE: Record<Score["bias"], "positive" | "negative" | "muted"> = {
    bullish: "positive",
    bearish: "negative",
    neutral: "muted",
};

function verdictOf(bias: Score["bias"]): SignalVerdict {
    return bias === "bullish" ? "buy" : bias === "bearish" ? "sell" : "flat";
}

function biasLabel(bias: Score["bias"]): string {
    return bias === "bullish" ? "Buy" : bias === "bearish" ? "Sell" : "Flat";
}

/** Data-viz colour for a bias — used by sparklines and the confidence meter. */
function biasColorVar(bias: Score["bias"]): string {
    return bias === "bullish" ? "var(--positive)" : bias === "bearish" ? "var(--negative)" : "var(--info)";
}

function BiasChip({ bias }: { bias: Score["bias"] }) {
    const tone = BIAS_TONE[bias];
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                tone === "positive" && "border-positive/30 bg-positive/10 text-positive",
                tone === "negative" && "border-negative/30 bg-negative/10 text-negative",
                tone === "muted" && "border-border bg-muted text-muted-foreground"
            )}
        >
            {biasLabel(bias)}
        </span>
    );
}

/* ── Signal Core ─────────────────────────────────────────────────────────── */

function SignalCoreWidget({ user, refreshKey, config }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);
    // The score is cheap server-side (candles are cached), so the verdict ring
    // can breathe on a 60s poll like the rest of the command centre.
    const { data, status } = useApiData<ScorePayload>(
        analyticsPath("score", config),
        user,
        refreshKey,
        true,
        60_000
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={3} />;
    if (status === "error") {
        return (
            <WidgetState
                icon={AlertTriangle}
                tone="negative"
                title="Signal unavailable"
                hint={`No score could be computed for ${symbol} ${timeframe}.`}
            />
        );
    }
    const score = data?.score;
    if (!score) {
        return <WidgetState icon={Signal} title="Insufficient data" hint="Not enough candles to derive a signal." />;
    }
    return <SignalCoreView symbol={symbol} timeframe={timeframe} score={score} />;
}

export function SignalCoreView({
    symbol,
    timeframe,
    score,
}: {
    symbol: string;
    timeframe: string;
    score: Score;
}) {
    const total = score.components.length;
    const aligned = score.components.filter((component) => component.direction === score.bias).length;

    return (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <SignalCore verdict={verdictOf(score.bias)} />
            <div className="w-full min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <BiasChip bias={score.bias} />
                    <span className="font-numeric truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                        {symbol} · {timeframe}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    <div className="min-w-0">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Market score</p>
                        <p className="font-numeric mt-1 text-2xl font-semibold text-foreground">
                            <CountUp value={Math.round(score.total)} />
                            <span className="text-sm text-muted-foreground">/100</span>
                        </p>
                    </div>
                    <Metric label="Confidence" value={score.confidence} />
                    <Metric label="Factors aligned" value={`${aligned}/${total}`} />
                    <Metric label="Updated" value={relativeTime(score.timestamp)} tone="muted" />
                </div>
            </div>
        </div>
    );
}

/* ── Signal Confidence ───────────────────────────────────────────────────── */

type FactorState = "aligned" | "against" | "flat";

/**
 * Does this factor back the current verdict? A neutral verdict is only ever
 * backed by neutral factors — bullish ones genuinely argue against "flat".
 */
function factorState(bias: Score["bias"], component: ScoreComponent): FactorState {
    if (component.direction === bias) return bias === "neutral" ? "flat" : "aligned";
    if (component.direction === "neutral") return "flat";
    return "against";
}

function ConfidenceWidget({ user, refreshKey, config }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);
    const { data, status } = useApiData<ScorePayload>(
        analyticsPath("score", config),
        user,
        refreshKey,
        true,
        60_000
    );

    if (status === "loading" || status === "idle") return <WidgetSkeleton rows={4} />;
    if (status === "error") {
        return (
            <WidgetState
                icon={AlertTriangle}
                tone="negative"
                title="Confidence unavailable"
                hint={`No score could be computed for ${symbol} ${timeframe}.`}
            />
        );
    }
    const score = data?.score;
    if (!score) {
        return <WidgetState icon={Percent} title="Insufficient data" hint="Not enough candles to score this market." />;
    }
    return <ConfidenceView symbol={symbol} timeframe={timeframe} score={score} />;
}

export function ConfidenceView({
    symbol,
    timeframe,
    score,
}: {
    symbol: string;
    timeframe: string;
    score: Score;
}) {
    const value = Math.max(0, Math.min(100, score.total));
    const tone = BIAS_TONE[score.bias];
    const aligned = score.components.filter((c) => factorState(score.bias, c) === "aligned").length;

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {symbol} · {timeframe} market score
                    </p>
                    <p
                        className={cn(
                            "font-numeric mt-1 text-4xl font-semibold leading-none",
                            tone === "positive" && "text-positive",
                            tone === "negative" && "text-negative",
                            tone === "muted" && "text-foreground"
                        )}
                    >
                        <CountUp value={Math.round(value)} suffix="%" />
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <BiasChip bias={score.bias} />
                    <span className="text-[11px] text-muted-foreground">{score.confidence} confidence</span>
                </div>
            </div>

            {/* Meter — grows on mount, eases on every refresh, sweeps while live */}
            <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                    className="h-full rounded-full transition-[width] duration-1000 ease-out"
                    style={{ width: `${value}%`, background: biasColorVar(score.bias) }}
                />
                <div aria-hidden="true" className="shimmer-overlay absolute inset-0" />
            </div>

            <ul className="space-y-2">
                {score.components.map((component, index) => {
                    const state = factorState(score.bias, component);
                    const Icon = state === "aligned" ? Check : state === "against" ? X : Minus;
                    return (
                        <li
                            key={component.name}
                            className="flex items-center gap-2.5 animate-page-enter"
                            style={{ animationDelay: `${index * 45}ms` }}
                        >
                            <span
                                className={cn(
                                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                                    state === "aligned" && "border-positive/40 bg-positive/10 text-positive",
                                    state === "against" && "border-negative/40 bg-negative/10 text-negative",
                                    state === "flat" && "border-border bg-muted text-muted-foreground"
                                )}
                            >
                                <Icon size={11} />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                                {component.name}
                            </span>
                            <span className="font-numeric shrink-0 text-[11px] text-muted-foreground">
                                {component.value > 0 ? "+" : ""}
                                {Math.round(component.value)}/{component.max}
                            </span>
                        </li>
                    );
                })}
            </ul>

            <p className="border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                {score.components.length === 0
                    ? "No factors were computed for this window."
                    : `${aligned}/${score.components.length} factors align with the ${biasLabel(score.bias).toUpperCase()} call · updated ${relativeTime(score.timestamp)}`}
            </p>
        </div>
    );
}

/* ── Live Chart ──────────────────────────────────────────────────────────── */

function LiveChartWidget({ user, refreshKey, config }: WidgetProps) {
    const { symbol, timeframe } = readSymbolTimeframe(config);
    // The candle feed itself is owned by LiveCandlesPanel (canonical live
    // stream); the score only adds the bias chip next to the price.
    const { data } = useApiData<ScorePayload>(analyticsPath("score", config), user, refreshKey, true, 60_000);
    const score = data?.score;

    return (
        <LiveCandlesPanel
            symbol={symbol}
            timeframe={timeframe}
            height={260}
            badge={
                score ? (
                    <span className="flex items-center gap-1.5">
                        <BiasChip bias={score.bias} />
                        <span className="font-numeric text-[11px] text-muted-foreground">
                            {Math.round(score.total)}/100
                        </span>
                    </span>
                ) : null
            }
        />
    );
}

/* ── Multi-Timeframe Bias ────────────────────────────────────────────────── */

const MTF_DEFAULT_TIMEFRAMES = "M15,H1,H4,D1";
const MTF_KNOWN_TIMEFRAMES = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];
const MTF_MAX_ROWS = 6;

/** Reads the configured timeframe list — validated, deduped, capped at 6. */
function readTimeframeList(config: WidgetConfig): string[] {
    const raw = String(config.timeframes ?? MTF_DEFAULT_TIMEFRAMES);
    const parsed = raw
        .split(",")
        .map((tf) => tf.trim().toUpperCase())
        .filter((tf) => MTF_KNOWN_TIMEFRAMES.includes(tf));
    const unique = [...new Set(parsed)];
    return (unique.length > 0 ? unique : MTF_DEFAULT_TIMEFRAMES.split(",")).slice(0, MTF_MAX_ROWS);
}

function MtfBiasWidget({ user, refreshKey, config }: WidgetProps) {
    const symbol = String(config.symbol ?? "XAUUSD").toUpperCase();
    const timeframes = readTimeframeList(config);
    // Rows report their score up so the header can read alignment across them
    // without a second request — stable callback, keyed by timeframe.
    const [reports, setReports] = useState<Record<string, { bias: Score["bias"]; total: number }>>({});
    const report = useCallback((timeframe: string, score: Score) => {
        setReports((prev) => {
            const current = prev[timeframe];
            if (current && current.bias === score.bias && current.total === score.total) return prev;
            return { ...prev, [timeframe]: { bias: score.bias, total: score.total } };
        });
    }, []);

    const known = timeframes.filter((tf) => reports[tf]);
    const counts = known.reduce(
        (acc, tf) => {
            acc[reports[tf].bias] += 1;
            return acc;
        },
        { bullish: 0, bearish: 0, neutral: 0 } as Record<Score["bias"], number>
    );
    const dominant: Score["bias"] =
        counts.bullish > counts.bearish && counts.bullish >= counts.neutral
            ? "bullish"
            : counts.bearish > counts.bullish && counts.bearish >= counts.neutral
                ? "bearish"
                : "neutral";
    const aligned = known.filter((tf) => reports[tf].bias === dominant).length;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-numeric text-[11px] uppercase tracking-wide text-muted-foreground">
                    {symbol} · multi-timeframe
                </span>
                {known.length > 0 ? (
                    <span className="flex items-center gap-1.5">
                        <BiasChip bias={dominant} />
                        <span className="font-numeric text-[11px] text-muted-foreground">
                            {aligned}/{known.length} aligned
                        </span>
                    </span>
                ) : null}
            </div>

            <ul className="space-y-2.5">
                {timeframes.map((timeframe) => (
                    <MtfRow
                        key={timeframe}
                        symbol={symbol}
                        timeframe={timeframe}
                        user={user}
                        refreshKey={refreshKey}
                        onReport={report}
                    />
                ))}
            </ul>
        </div>
    );
}

/** One timeframe row: score (for bias + sparkline colour) and its closes. */
function MtfRow({
    symbol,
    timeframe,
    user,
    refreshKey,
    onReport,
}: {
    symbol: string;
    timeframe: string;
    user: User | null;
    refreshKey: number;
    onReport: (timeframe: string, score: Score) => void;
}) {
    const scorePath = `/api/analytics/score?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`;
    const ohlcPath = `/api/analytics/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=60`;
    const scoreRes = useApiData<ScorePayload>(scorePath, user, refreshKey, true, 120_000);
    const ohlcRes = useApiData<{ candles?: { timestamp: number; close: number }[] }>(
        ohlcPath,
        user,
        refreshKey,
        true,
        120_000
    );
    const score = scoreRes.data?.score;

    const report = onReport;
    useEffect(() => {
        if (score) report(timeframe, score);
    }, [score, timeframe, report]);

    const closes = (ohlcRes.data?.candles ?? []).map((candle) => candle.close);
    const failed = scoreRes.status === "error";

    return (
        <li className="flex items-center gap-3">
            <span className="font-numeric w-9 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                {timeframe}
            </span>
            <span className="min-w-0 flex-1">
                {closes.length >= 2 ? (
                    <MiniSparkline
                        values={closes}
                        colorVar={biasColorVar(score?.bias ?? "neutral")}
                        height={28}
                        animate
                    />
                ) : (
                    <span className="block h-7 w-full animate-pulse rounded-md bg-muted" />
                )}
            </span>
            <span className="font-numeric w-8 shrink-0 text-right text-[11px] text-muted-foreground">
                {score ? Math.round(score.total) : "—"}
            </span>
            {score ? (
                <BiasChip bias={score.bias} />
            ) : (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {failed ? "n/a" : "…"}
                </span>
            )}
        </li>
    );
}

export type WidgetProps = {
    user: User | null;
    refreshKey: number;
    config: WidgetConfig;
    accountId: string;
    /** Server-verified Pro entitlement. Gates every `pro` widget. */
    isPro: boolean;
};

export function WidgetBody(props: WidgetProps & { type: string }) {
    const { type } = props;

    switch (type) {
        case "portfolio_summary":
            return <PortfolioSummaryWidget {...props} />;
        case "accounts":
            return <AccountsWidget {...props} />;
        case "equity_curve":
            return <EquityCurveWidget {...props} />;
        case "market_score":
            return <MarketScoreWidget {...props} />;
        case "risk":
            return <RiskWidget {...props} />;
        case "positions":
            return <PositionsWidget {...props} />;
        case "exposure":
            return <ExposureWidget {...props} />;
        case "recent_alerts":
            return <RecentAlertsWidget {...props} />;
        case "watchlist":
            return <WatchlistWidget {...props} />;
        case "market_clock":
            return <MarketClockWidget />;
        case "market_regime":
            return <MarketRegimeWidget {...props} />;
        case "volatility":
            return <VolatilityWidget {...props} />;
        case "volume_analysis":
            return <VolumeAnalysisWidget {...props} />;
        case "structure_events":
            return <StructureEventsWidget {...props} />;
        case "liquidity_map":
            return <LiquidityMapWidget {...props} />;
        case "zones":
            return <ZonesWidget {...props} />;
        case "correlation_matrix":
            return <CorrelationMatrixWidget {...props} />;
        case "market_breadth":
            return <MarketBreadthWidget {...props} />;
        case "signal_core":
            return <SignalCoreWidget {...props} />;
        case "confidence_meter":
            return <ConfidenceWidget {...props} />;
        case "live_chart":
            return <LiveChartWidget {...props} />;
        case "mtf_bias":
            return <MtfBiasWidget {...props} />;
        default:
            return (
                <WidgetState
                    icon={LayoutDashboard}
                    title="Unknown widget"
                    hint={`No renderer is registered for "${type}". Remove it or reset the layout.`}
                />
            );
    }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Edit-mode add-widget picker
 * ────────────────────────────────────────────────────────────────────────── */

export function WidgetPicker({
    onPick,
    onClose,
    isPro,
}: {
    onPick: (type: string) => void;
    onClose: () => void;
    isPro: boolean;
}) {
    const standard = WIDGET_CATALOG.filter((spec) => !spec.pro);
    const pro = WIDGET_CATALOG.filter((spec) => spec.pro);

    const renderItem = (spec: WidgetSpec) => {
        const Icon = spec.icon;
        const locked = Boolean(spec.pro) && !isPro;
        return (
            <li key={spec.type}>
                <button
                    type="button"
                    onClick={() => onPick(spec.type)}
                    className={cn(
                        "flex w-full items-start gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition hover:bg-muted",
                        locked ? "border-primary/30" : "border-border"
                    )}
                >
                    <Icon size={15} className="mt-0.5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-foreground">
                                {spec.label}
                            </span>
                            {spec.pro && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                                    <Crown size={10} />
                                    Pro
                                </span>
                            )}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {spec.description}
                        </span>
                    </span>
                </button>
            </li>
        );
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Add widget"
            onClick={onClose}
        >
            <div
                className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-popover p-4 shadow-lg"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-foreground">Add widget</h2>
                        <p className="text-[11px] text-muted-foreground">
                            Every widget reads live data from your connected accounts.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                        Close
                    </button>
                </div>

                <ul className="space-y-1.5">{standard.map(renderItem)}</ul>

                {pro.length > 0 && (
                    <>
                        <div className="mb-2 mt-4 flex items-center gap-2">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Advanced analytics
                            </h3>
                            <span className="h-px flex-1 bg-border" aria-hidden="true" />
                            {!isPro && (
                                <span className="text-[11px] text-muted-foreground">
                                    Requires Pro
                                </span>
                            )}
                        </div>
                        <ul className="space-y-1.5">{pro.map(renderItem)}</ul>
                    </>
                )}
            </div>
        </div>
    );
}


