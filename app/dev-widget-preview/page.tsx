"use client";

/**
 * TEMPORARY visual-QA page for the dashboard command-centre widgets.
 *
 * Every panel here is live — there are no fixtures in this file:
 *   · the widgets self-fetch from the authenticated `/api/analytics/*` routes,
 *   · the chart reads the canonical candle feed (`useLiveCandles`),
 *   · the narrative comes from `POST /api/ai/analyze` (unified router).
 * If a panel is empty it is because the market genuinely did not support it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { AlertTriangle, Crown, Loader2, Lock, RefreshCw, Sparkles } from "lucide-react";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { cn } from "@/lib/utils";
import { SUPPORTED_SYMBOLS, TIMEFRAME_LABELS, type MarketScore } from "@/lib/market-data/types";
import LiveCandlesPanel from "@/components/dashboard/LiveCandlesPanel";
import {
    ConfidenceView,
    SignalCoreView,
    WIDGET_SPEC_BY_TYPE,
    WidgetBody,
    defaultWidgetConfig,
} from "@/components/dashboard/widgets";
import CountUp from "@/components/charts/CountUp";
import LevelBars, { type LevelBarItem } from "@/components/charts/LevelBars";
import MiniSparkline from "@/components/charts/MiniSparkline";

const TIMEFRAMES = Object.keys(TIMEFRAME_LABELS) as (keyof typeof TIMEFRAME_LABELS)[];
const MTF_TIMEFRAMES = ["M15", "H1", "H4", "D1"] as const;

/* ── Real payloads, mirrored from the API routes (never invented) ──────────── */

type Snapshot = {
    symbol: string;
    timeframe: string;
    quote: { bid: number; ask: number; spread: number; change: number; changePercent: number; timestamp: number };
    regime: { regime: string; confidence: number; factors: string[] };
    volatility: { atr: number; atrPercent: number; state: string; rangeExpansion: number };
    volume: { relativeVolume: number; state: string; isTickVolume: boolean };
    vwap: { vwap: number; distancePercent: number; period: string };
    session: { current: string; name: string; high: number; low: number };
    liquidity: { id: string; type: string; price: number; strength: number }[];
    liquiditySweeps: { id: string; side: string; level: number; confirmed: boolean }[];
    zones: { id: string; type: string; direction: string; status: string; strength: number }[];
    score: MarketScore;
    multiTimeframe: { timeframe: string; bias: string; structure: string }[];
    candleCount: number;
    timestamp: number;
};

/** Mirror of the live `/api/ai-signals` record the Signal Core widget reads. */
type AiSignal = {
    id: string;
    symbol: string;
    direction: "BUY" | "SELL";
    timeframe: string;
    tier?: string;
    entry: number;
    stopLoss: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    confidence: number;
    strength?: string;
    riskReward?: number;
    status?: string;
    reasoning?: string;
    createdAt: number;
    updatedAt?: number;
    expiresAt?: number;
};

/** Statuses that mean the signal is finished — never presented as live. */
const AI_TERMINAL_STATUSES = new Set([
    "EXPIRED",
    "CANCELLED",
    "CLOSED",
    "STOPPED",
    "STOPPED_OUT",
    "INVALIDATED",
    "COMPLETED",
    "STALE",
    "OUTCOME_AMBIGUOUS",
]);

/** Newest still-live AI signal for this exact symbol, or null. */
function pickAiSignal(signals: AiSignal[] | undefined, symbol: string): AiSignal | null {
    if (!signals || signals.length === 0) return null;
    const forSymbol = signals.filter(
        (signal) => signal && String(signal.symbol ?? "").toUpperCase() === symbol
    );
    if (forSymbol.length === 0) return null;
    const live = forSymbol.filter(
        (signal) => !AI_TERMINAL_STATUSES.has(String(signal.status ?? "").toUpperCase())
    );
    const pool = live.length > 0 ? live : forSymbol;
    return [...pool].sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0] ?? null;
}

type MtfRow = {
    timeframe: string;
    bias: MarketScore["bias"] | null;
    total: number | null;
    closes: number[];
};

type Narrative = {
    content: string;
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
    safety: string;
    requestId: string;
};

/**
 * Compact the snapshot into the bounded context `/api/ai/analyze` accepts
 * (12 kB ceiling). Levels are trimmed to what the model can actually reason
 * about — the raw array is never shipped.
 */
function buildAiContext(snap: Snapshot) {
    return {
        schema: "mic-1",
        symbol: snap.symbol,
        timeframe: snap.timeframe,
        candles: snap.candleCount,
        asOf: new Date(snap.timestamp).toISOString(),
        quote: {
            bid: snap.quote.bid,
            ask: snap.quote.ask,
            spread: snap.quote.spread,
            changePercent: snap.quote.changePercent,
        },
        score: {
            total: Math.round(snap.score.total),
            bias: snap.score.bias,
            confidence: snap.score.confidence,
            factors: snap.score.components.map((c) => `${c.name} ${c.value > 0 ? "+" : ""}${c.value}/${c.max} ${c.direction}`),
        },
        regime: snap.regime,
        volatility: snap.volatility,
        volume: snap.volume,
        vwap: { value: snap.vwap.vwap, distancePercent: snap.vwap.distancePercent, period: snap.vwap.period },
        session: snap.session,
        liquidity: snap.liquidity.slice(0, 6).map((l) => `${l.type} @ ${l.price} (strength ${l.strength})`),
        sweeps: snap.liquiditySweeps
            .slice(0, 4)
            .map((s) => `${s.side} swept ${s.level}${s.confirmed ? " confirmed" : ""}`),
        zones: {
            active: snap.zones.filter((z) => z.status === "active").length,
            strongest: snap.zones
                .filter((z) => z.status === "active")
                .slice(0, 4)
                .map((z) => `${z.type} ${z.direction} strength ${z.strength}`),
        },
    };
}

const QUESTIONS: { label: string; task: string; question: string }[] = [
    {
        label: "Signal read",
        task: "SIGNAL_EXPLANATION",
        question:
            "State the dominant bias for this market, which factors drive it, which factor contradicts it, and the level that would invalidate the read. No trade advice.",
    },
    {
        label: "Regime call",
        task: "REGIME_CLASSIFICATION",
        question:
            "Classify the current regime from the evidence, give your confidence and the single observation that would most change it.",
    },
    {
        label: "Setup validation",
        task: "SETUP_VALIDATION",
        question:
            "Is there an actionable setup in this context? Name the trigger, the invalidation and why the current evidence does or does not support it.",
    },
];

/* ── Presentation helpers ─────────────────────────────────────────────────── */

function Card({
    title,
    meta,
    children,
    className,
}: {
    title: string;
    meta?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("flex flex-col rounded-lg border border-border bg-card shadow-sm", className)}>
            <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                </span>
                <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
                {meta ? <span className="ml-auto text-micro text-muted-foreground">{meta}</span> : null}
            </header>
            <div className="flex-1 p-4">{children}</div>
        </section>
    );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "positive" | "negative" }) {
    return (
        <div className="min-w-0">
            <p className="text-micro uppercase tracking-wide text-muted-foreground">{label}</p>
            <p
                className={cn(
                    "font-numeric mt-1 text-[15px] font-semibold",
                    tone === "positive" && "text-positive",
                    tone === "negative" && "text-negative",
                    !tone && "text-foreground"
                )}
            >
                {value}
            </p>
        </div>
    );
}

function Notice({ tone = "muted", children }: { tone?: "muted" | "negative"; children: React.ReactNode }) {
    return (
        <div
            className={cn(
                "flex items-start gap-2 rounded-md border border-dashed px-3 py-4 text-xs",
                tone === "negative" ? "border-negative/30 bg-negative/5 text-negative" : "border-border text-muted-foreground"
            )}
        >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{children}</span>
        </div>
    );
}

function relativeTime(ts: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function DevWidgetPreviewPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    // Fail-closed: a failed entitlement lookup must never unlock Pro surfaces.
    const [isPro, setIsPro] = useState(false);

    const [symbol, setSymbol] = useState("XAUUSD");
    const [timeframe, setTimeframe] = useState("H1");
    const [refreshKey, setRefreshKey] = useState(0);

    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [snapshotError, setSnapshotError] = useState<string | null>(null);
    const [snapshotLoading, setSnapshotLoading] = useState(false);

    const [aiSignal, setAiSignal] = useState<AiSignal | null>(null);

    const [rows, setRows] = useState<MtfRow[]>([]);
    const [narrative, setNarrative] = useState<Narrative | null>(null);
    const [narrativeError, setNarrativeError] = useState<string | null>(null);
    const [narrativeLoading, setNarrativeLoading] = useState(false);
    const [question, setQuestion] = useState(QUESTIONS[0]);

    useEffect(() => onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthLoading(false);
    }), []);

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

    /* One authenticated call carries quote + every deterministic engine, so the
       shared panels below never issue a second request for the same window. */
    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        // Deferred like the dashboard: the load sets state on entry, so calling
        // it synchronously in the effect body would cascade renders.
        void Promise.resolve().then(async () => {
            if (cancelled) return;
            setSnapshotLoading(true);
            setSnapshotError(null);
            try {
                const token = await user.getIdToken();
                const res = await fetch(
                    `/api/analytics/market?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                const json = await res.json().catch(() => null);
                if (cancelled) return;
                if (!res.ok || !json?.success || !json?.score) {
                    setSnapshot(null);
                    setSnapshotError(json?.error || "The analytics engine returned no score for this window.");
                    return;
                }
                setSnapshot(json as Snapshot);
            } catch {
                if (!cancelled) {
                    setSnapshot(null);
                    setSnapshotError("Could not reach the analytics service.");
                }
            } finally {
                if (!cancelled) setSnapshotLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [user, symbol, timeframe, refreshKey]);

    /* The stored AI signal for this symbol — the same feed Signal Core reads. */
    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        void (async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch(`/api/ai-signals?symbol=${encodeURIComponent(symbol)}&limit=40`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = res.ok ? await res.json().catch(() => null) : null;
                if (!cancelled) setAiSignal(pickAiSignal(json?.signals, symbol));
            } catch {
                if (!cancelled) setAiSignal(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user, symbol, refreshKey]);

    /* Multi-timeframe rows: a real score plus real closes for the sparkline. */
    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        void Promise.resolve().then(async () => {
            if (cancelled) return;
            setRows(MTF_TIMEFRAMES.map((timeframe) => ({ timeframe, bias: null, total: null, closes: [] })));
            try {
                const token = await user.getIdToken();
                const headers = { Authorization: `Bearer ${token}` };
                const results = await Promise.all(
                    MTF_TIMEFRAMES.map(async (tf): Promise<MtfRow> => {
                        const [scoreRes, ohlcRes] = await Promise.all([
                            fetch(`/api/analytics/score?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`, { headers }),
                            fetch(`/api/analytics/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&limit=60`),
                        ]);
                        const scoreJson = scoreRes.ok ? await scoreRes.json().catch(() => null) : null;
                        const ohlcJson = ohlcRes.ok ? await ohlcRes.json().catch(() => null) : null;
                        const score: MarketScore | undefined = scoreJson?.score;
                        const closes: number[] = Array.isArray(ohlcJson?.candles)
                            ? ohlcJson.candles
                                  .map((c: { close?: number }) => Number(c.close))
                                  .filter((n: number) => Number.isFinite(n))
                            : [];
                        return {
                            timeframe: tf,
                            bias: score?.bias ?? null,
                            total: score ? Math.round(score.total) : null,
                            closes,
                        };
                    })
                );
                if (!cancelled) setRows(results);
            } catch {
                if (!cancelled) setRows(MTF_TIMEFRAMES.map((tf) => ({ timeframe: tf, bias: null, total: null, closes: [] })));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [user, symbol, refreshKey]);

    /* ── Real AI narrative ────────────────────────────────────────────────
       Guarded by a ref so switching symbol/timeframe fires exactly one call;
       the button re-runs it on demand instead of polling the budget. */
    const askedFor = useRef("");
    const askAi = useCallback(async () => {
        if (!user || !snapshot) return;
        setNarrativeLoading(true);
        setNarrativeError(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/ai/analyze", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    task: question.task,
                    question: question.question,
                    context: buildAiContext(snapshot),
                    maxTokens: 700,
                }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setNarrative(null);
                setNarrativeError(
                    json?.error === "AI_UNAVAILABLE"
                        ? "No AI provider could serve this request. The deterministic panels above are unaffected."
                        : json?.error || json?.message || `AI request failed (${res.status}).`
                );
                return;
            }
            setNarrative({
                content: json.content ?? "",
                provider: json.provider ?? "unknown",
                model: json.model ?? "unknown",
                latencyMs: json.latencyMs ?? 0,
                fallbackUsed: Boolean(json.fallbackUsed),
                safety: json.safety ?? "pass",
                requestId: json.requestId ?? "—",
            });
        } catch {
            setNarrative(null);
            setNarrativeError("Could not reach the intelligence gateway.");
        } finally {
            setNarrativeLoading(false);
        }
    }, [user, snapshot, question]);

    useEffect(() => {
        if (!snapshot) return;
        const key = `${snapshot.symbol}|${snapshot.timeframe}|${snapshot.timestamp}|${question.task}`;
        if (askedFor.current === key) return;
        askedFor.current = key;
        void askAi();
    }, [snapshot, question.task, askAi]);

    const liquidityItems = useMemo<LevelBarItem[]>(
        () =>
            (snapshot?.liquidity ?? []).slice(0, 8).map((level) => ({
                id: level.id,
                label: level.type.replace(/_/g, " "),
                right: level.price,
                value: level.strength,
                colorVar:
                    level.type.includes("high") || level.type.includes("prev_day_high") || level.type.includes("prev_week_high")
                        ? "var(--chart-1)"
                        : "var(--chart-2)",
                hint: `strength ${level.strength}`,
            })),
        [snapshot]
    );

    const changeTone = (snapshot?.quote.changePercent ?? 0) >= 0 ? "positive" : "negative";
    const alignedBias = rows.filter((r) => r.bias).reduce(
        (acc, r) => {
            if (r.bias) acc[r.bias] += 1;
            return acc;
        },
        { bullish: 0, bearish: 0, neutral: 0 } as Record<MarketScore["bias"], number>
    );

    /* ── Gates ───────────────────────────────────────────────────────────── */

    if (authLoading) {
        return (
            <main className="flex min-h-[60vh] items-center justify-center">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </main>
        );
    }

    if (!user) {
        return (
            <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
                <Lock size={28} className="text-muted-foreground" />
                <h1 className="text-lg font-semibold text-foreground">Sign in required</h1>
                <p className="text-sm text-muted-foreground">
                    Every panel on this page reads authenticated market data. No fixtures are bundled.
                </p>
                <a href="/login?redirect=/dev-widget-preview" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                    Sign in
                </a>
            </main>
        );
    }

    if (!isPro) {
        return (
            <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
                <Crown size={28} className="text-primary" />
                <h1 className="text-lg font-semibold text-foreground">Pro entitlement required</h1>
                <p className="text-sm text-muted-foreground">
                    This QA surface renders the Pro command-centre widgets and spends live AI budget, so it is gated on your
                    server-verified subscription.
                </p>
                <a href="/pricing" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                    View plans
                </a>
            </main>
        );
    }

    /* ── Page ────────────────────────────────────────────────────────────── */

    return (
        <main className="mx-auto max-w-[1400px] space-y-4 p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Temporary widget QA — live data, live AI
                    </p>
                    <h1 className="mt-1 text-lg font-semibold text-foreground">
                        {symbol} · {timeframe}
                    </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        aria-label="Symbol"
                        className="rounded-md border border-border bg-card px-2 py-1.5 text-[12px] text-foreground"
                    >
                        {SUPPORTED_SYMBOLS.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                    <select
                        value={timeframe}
                        onChange={(e) => setTimeframe(e.target.value)}
                        aria-label="Timeframe"
                        className="rounded-md border border-border bg-card px-2 py-1.5 text-[12px] text-foreground"
                    >
                        {TIMEFRAMES.map((tf) => (
                            <option key={tf} value={tf}>
                                {tf} · {TIMEFRAME_LABELS[tf]}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() => setRefreshKey((k) => k + 1)}
                        disabled={snapshotLoading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] text-foreground transition hover:bg-muted disabled:opacity-60"
                    >
                        {snapshotLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card title="Signal Core" meta={snapshot ? relativeTime(snapshot.timestamp) : undefined}>
                    {snapshot ? (
                        <SignalCoreView
                            symbol={snapshot.symbol}
                            timeframe={snapshot.timeframe}
                            score={snapshot.score}
                            ai={aiSignal}
                        />
                    ) : snapshotError ? (
                        <Notice tone="negative">{snapshotError}</Notice>
                    ) : (
                        <div className="space-y-2" aria-busy="true">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
                            ))}
                        </div>
                    )}
                </Card>

                <Card title="Signal Confidence">
                    {snapshot ? (
                        <ConfidenceView
                            symbol={snapshot.symbol}
                            timeframe={snapshot.timeframe}
                            score={snapshot.score}
                            ai={aiSignal}
                        />
                    ) : (
                        <div className="space-y-2" aria-busy="true">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
                            ))}
                        </div>
                    )}
                </Card>

                <Card title="AI Read" meta={narrative ? `${narrative.provider} · ${narrative.latencyMs}ms` : undefined}>
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                value={question.task}
                                onChange={(e) =>
                                    setQuestion(QUESTIONS.find((q) => q.task === e.target.value) ?? QUESTIONS[0])
                                }
                                aria-label="AI task"
                                className="rounded-md border border-border bg-background px-2 py-1 text-micro text-foreground"
                            >
                                {QUESTIONS.map((q) => (
                                    <option key={q.task} value={q.task}>
                                        {q.label}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => void askAi()}
                                disabled={narrativeLoading || !snapshot}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-micro text-foreground transition hover:bg-muted disabled:opacity-60"
                            >
                                {narrativeLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                Regenerate
                            </button>
                        </div>

                        {narrativeLoading ? (
                            <div className="space-y-2" aria-busy="true">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="h-3 w-full animate-pulse rounded bg-muted" />
                                ))}
                            </div>
                        ) : narrativeError ? (
                            <Notice tone="negative">{narrativeError}</Notice>
                        ) : narrative ? (
                            <>
                                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
                                    {narrative.content}
                                </p>
                                <dl className="grid grid-cols-2 gap-2 border-t border-border pt-2.5 text-micro text-muted-foreground">
                                    <div className="flex gap-1">
                                        <dt>model</dt>
                                        <dd className="font-numeric truncate text-foreground/80">{narrative.model}</dd>
                                    </div>
                                    <div className="flex gap-1">
                                        <dt>safety</dt>
                                        <dd className="text-foreground/80">{narrative.safety}</dd>
                                    </div>
                                    <div className="flex gap-1">
                                        <dt>fallback</dt>
                                        <dd className="text-foreground/80">{narrative.fallbackUsed ? "yes" : "no"}</dd>
                                    </div>
                                    <div className="flex gap-1">
                                        <dt>request</dt>
                                        <dd className="font-numeric truncate text-foreground/80">{narrative.requestId}</dd>
                                    </div>
                                </dl>
                            </>
                        ) : (
                            <Notice>
                                No narrative yet. It is generated once per symbol/timeframe from the live snapshot above.
                            </Notice>
                        )}
                    </div>
                </Card>

                <Card title="Multi-Timeframe Bias" meta={`${alignedBias.bullish + alignedBias.bearish}/${rows.length} directional`}>
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-numeric text-micro uppercase tracking-wide text-muted-foreground">
                                {symbol} · multi-timeframe
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="font-numeric text-micro text-muted-foreground">
                                    {alignedBias.bullish} up · {alignedBias.bearish} down
                                </span>
                            </span>
                        </div>
                        <ul className="space-y-2.5">
                            {rows.map((row) => (
                                <li key={row.timeframe} className="flex items-center gap-3">
                                    <span className="font-numeric w-9 shrink-0 text-micro uppercase tracking-wide text-muted-foreground">
                                        {row.timeframe}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        {row.closes.length > 1 ? (
                                            <MiniSparkline
                                                values={row.closes}
                                                colorVar={
                                                    row.bias === "bullish"
                                                        ? "var(--positive)"
                                                        : row.bias === "bearish"
                                                            ? "var(--negative)"
                                                            : "var(--info)"
                                                }
                                                height={28}
                                                animate
                                            />
                                        ) : (
                                            <span className="block h-7 w-full animate-pulse rounded-md bg-muted" />
                                        )}
                                    </span>
                                    <span className="font-numeric w-8 shrink-0 text-right text-micro text-muted-foreground">
                                        {row.total ?? "—"}
                                    </span>
                                    <span
                                        className={cn(
                                            "inline-flex w-12 items-center justify-center rounded-full border px-2 py-0.5 text-micro font-medium uppercase tracking-wide",
                                            row.bias === "bullish" && "border-positive/30 bg-positive/10 text-positive",
                                            row.bias === "bearish" && "border-negative/30 bg-negative/10 text-negative",
                                            (!row.bias || row.bias === "neutral") && "border-border bg-muted text-muted-foreground"
                                        )}
                                    >
                                        {row.bias === "bullish" ? "Buy" : row.bias === "bearish" ? "Sell" : "Flat"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </Card>

                <Card title="Liquidity Pools (LevelBars)" meta={`${snapshot?.liquidity.length ?? 0} detected`}>
                    {liquidityItems.length > 0 ? (
                        <LevelBars items={liquidityItems} />
                    ) : (
                        <Notice>
                            No resting liquidity was detected for {symbol} {timeframe} in the loaded window.
                        </Notice>
                    )}
                </Card>

                <Card title="Market Snapshot" meta={snapshot ? `${snapshot.candleCount} candles` : undefined}>
                    {snapshot ? (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <Stat
                                label="Change"
                                tone={changeTone}
                                value={
                                    <>
                                        <CountUp value={snapshot.quote.changePercent} decimals={2} suffix="%" />
                                    </>
                                }
                            />
                            <Stat label="Spread" value={<CountUp value={snapshot.quote.spread} decimals={5} />} />
                            <Stat label="Regime" value={snapshot.regime.regime.replace(/_/g, " ")} />
                            <Stat label="Regime conf." value={`${Math.round(snapshot.regime.confidence)}%`} />
                            <Stat label="ATR" value={<CountUp value={snapshot.volatility.atr} decimals={5} />} />
                            <Stat label="ATR %" value={<CountUp value={snapshot.volatility.atrPercent} decimals={2} suffix="%" />} />
                            <Stat label="Rel. volume" value={<CountUp value={snapshot.volume.relativeVolume} decimals={2} />} />
                            <Stat label="Session" value={snapshot.session.name} />
                            <Stat label="VWAP dist." value={<CountUp value={snapshot.vwap.distancePercent} decimals={2} suffix="%" />} tone={snapshot.vwap.distancePercent >= 0 ? "positive" : "negative"} />
                            <Stat label="Active zones" value={snapshot.zones.filter((z) => z.status === "active").length} />
                        </div>
                    ) : snapshotError ? (
                        <Notice tone="negative">{snapshotError}</Notice>
                    ) : (
                        <div className="space-y-2" aria-busy="true">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="h-6 animate-pulse rounded-md bg-muted" />
                            ))}
                        </div>
                    )}
                </Card>

                <Card title="Live Chart" className="sm:col-span-2 lg:col-span-2">
                    <LiveCandlesPanel
                        symbol={symbol}
                        timeframe={timeframe}
                        height={260}
                        badge={
                            snapshot ? (
                                <span className="flex items-center gap-1.5">
                                    <span
                                        className={cn(
                                            "inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-medium uppercase tracking-wide",
                                            snapshot.score.bias === "bullish" && "border-positive/30 bg-positive/10 text-positive",
                                            snapshot.score.bias === "bearish" && "border-negative/30 bg-negative/10 text-negative",
                                            snapshot.score.bias === "neutral" && "border-border bg-muted text-muted-foreground"
                                        )}
                                    >
                                        {snapshot.score.bias === "bullish" ? "Buy" : snapshot.score.bias === "bearish" ? "Sell" : "Flat"}
                                    </span>
                                    <span className="font-numeric text-micro text-muted-foreground">
                                        {Math.round(snapshot.score.total)}/100
                                    </span>
                                </span>
                            ) : null
                        }
                    />
                </Card>

                <Card title="Registered widget bodies">
                    <div className="space-y-3">
                        <ul className="space-y-1 text-micro">
                            {["signal_core", "confidence_meter", "live_chart", "mtf_bias"].map((type) => {
                                const spec = WIDGET_SPEC_BY_TYPE[type];
                                return (
                                    <li key={type} className="flex items-center gap-2">
                                        <span className={spec ? "text-positive" : "text-negative"}>{spec ? "✓" : "✗"}</span>
                                        <span className="font-numeric">{type}</span>
                                        <span className="text-muted-foreground">
                                            {spec
                                                ? `${spec.label} · widths ${spec.widths.join("/")}${spec.live ? " · live" : ""}`
                                                : "MISSING SPEC"}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="grid gap-3">
                            {["signal_core", "confidence_meter", "live_chart", "mtf_bias"].map((type) => (
                                <div key={type} className="rounded-md border border-border p-3">
                                    <p className="mb-2 text-micro uppercase tracking-wide text-muted-foreground">
                                        WidgetBody({type})
                                    </p>
                                    <WidgetBody
                                        type={type}
                                        user={user}
                                        refreshKey={refreshKey}
                                        config={defaultWidgetConfig(type)}
                                        accountId=""
                                        isPro={isPro}
                                        marketScope={{ symbol, timeframe }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>

                <Card title="Pro widget bodies" className="sm:col-span-2 lg:col-span-2">
                    <div className="grid gap-3">
                        {["market_regime", "volatility", "volume_analysis", "structure_events", "liquidity_map", "zones", "correlation_matrix", "market_breadth"].map(
                            (type) => (
                                <div key={type} className="rounded-md border border-border p-3">
                                    <p className="mb-2 text-micro uppercase tracking-wide text-muted-foreground">
                                        WidgetBody({type}) · isPro
                                    </p>
                                    <WidgetBody
                                        type={type}
                                        user={user}
                                        refreshKey={refreshKey}
                                        config={{ ...defaultWidgetConfig(type), symbol, timeframe }}
                                        accountId=""
                                        isPro={isPro}
                                        marketScope={{ symbol, timeframe }}
                                    />
                                </div>
                            )
                        )}
                    </div>
                </Card>
            </div>
        </main>
    );
}