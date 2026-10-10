"use client";

/**
 * Pro Scalping Terminal — data panels.
 *
 * Every panel renders one real data source and says so when that source has
 * nothing to show. No panel carries its own fetch logic except the calendar
 * (which the rest of the platform also calls directly); everything else takes
 * its payload as a prop so the main terminal owns loading and polling.
 */

import { memo, Suspense, lazy, useEffect, useState } from "react";
import {
    Activity,
    CalendarDays,
    ChevronDown,
    Clock,
    Eye,
    Layers,
    Plus,
    Radar as RadarIcon,
    Radio,
    Target,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from "@/lib/market-data/types";
import type { RadarResult, TerminalSignal } from "@/lib/ai/scalping/radar";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import { AwaitingState } from "@/components/scalping/TerminalPrimitives";
import {
    fmtCountdown,
    fmtPrice,
    fmtSignedPct,
    humaniseKey,
    sessionState,
    type CalendarEvent,
    eventTimestamp,
} from "./terminal-utils";
// AI Execution (additive): lazily loaded so the terminal bundle only pays for
// it when a token is present.
const TerminalPlanButtonLazy = lazy(() =>
    import("@/components/ai-execution/TerminalPlanButton").then((m) => ({ default: m.GenerateTradePlanButton }))
);

// ── shared bits ─────────────────────────────────────────────────────────────

export function PanelHeader({
    icon,
    title,
    meta,
    right,
}: {
    icon: React.ReactNode;
    title: string;
    meta?: React.ReactNode;
    right?: React.ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="shrink-0 text-muted-foreground">{icon}</span>
            <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h2>
            {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
            {right ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div> : null}
        </div>
    );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <section className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)}>
            {children}
        </section>
    );
}

/** Unavailable-tolerant value: a Sourced-style {value,status} or a bare nullable. */
function Val({
    value,
    format,
    className,
    fallback = "—",
    title,
}: {
    value: number | string | null | undefined;
    format?: (v: number | string) => string;
    className?: string;
    fallback?: string;
    title?: string;
}) {
    if (value === null || value === undefined || value === "") {
        return (
            <span className="text-xs italic text-muted-foreground" title={title ?? "Data unavailable"}>
                {fallback}
            </span>
        );
    }
    return (
        <span className={cn("font-mono tabular-nums", className)} title={title}>
            {format ? format(value) : value}
        </span>
    );
}

function BiasChip({ bias }: { bias: string | null | undefined }) {
    if (!bias) return <span className="text-xs italic text-muted-foreground">—</span>;
    const tone =
        bias === "bullish"
            ? "border-positive/40 bg-positive/10 text-positive"
            : bias === "bearish"
              ? "border-negative/40 bg-negative/10 text-negative"
              : "border-border bg-muted text-muted-foreground";
    return (
        <span className={cn("rounded-full border px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide", tone)}>
            {bias}
        </span>
    );
}

function ConfidenceBar({ value }: { value: number | null }) {
    if (value === null || !Number.isFinite(value)) {
        return <span className="text-xs italic text-muted-foreground">Data unavailable</span>;
    }
    const pct = Math.max(0, Math.min(100, value));
    return (
        <div className="flex min-w-[72px] items-center gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-mono text-micro tabular-nums text-muted-foreground">{pct.toFixed(0)}</span>
        </div>
    );
}

/** Currencies a symbol reacts to (best-effort, for calendar filtering). */
function currenciesOf(symbol: string): string[] {
    const s = symbol.toUpperCase();
    if (s.length === 6 && (s.endsWith("USD") || s.startsWith("USD"))) {
        return [s.slice(0, 3), s.slice(3)].filter((c) => c !== "USD" || true);
    }
    if (["XAUUSD", "XAGUSD", "US30", "NAS100", "SPX500", "SPY", "QQQ", "DXY"].includes(s)) return ["USD"];
    return [];
}

// ── watchlist ───────────────────────────────────────────────────────────────

export type WatchlistQuote = {
    symbol: string;
    bid: number | null;
    changePercent: number | null;
    spread: number | null;
    timestamp: number | null;
};

export const WatchlistPanel = memo(function WatchlistPanel({
    quotes,
    active,
    watchlist,
    onSelect,
    onAdd,
    onRemove,
    quotesLoading,
}: {
    quotes: Record<string, WatchlistQuote>;
    active: SupportedSymbol;
    watchlist: SupportedSymbol[];
    onSelect: (s: SupportedSymbol) => void;
    onAdd: (s: SupportedSymbol) => void;
    onRemove: (s: SupportedSymbol) => void;
    quotesLoading: boolean;
}) {
    const [addOpen, setAddOpen] = useState(false);
    const [query, setQuery] = useState("");

    const candidates = SUPPORTED_SYMBOLS.filter(
        (s) => !watchlist.includes(s) && (query === "" || s.toLowerCase().includes(query.toLowerCase()))
    );

    return (
        <Panel>
            <PanelHeader
                icon={<Eye className="size-3.5" />}
                title="Watchlist"
                meta={`${watchlist.length}`}
                right={
                    <button
                        type="button"
                        onClick={() => setAddOpen((o) => !o)}
                        aria-expanded={addOpen}
                        aria-label="Add symbol"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                        <Plus className="size-3" />
                    </button>
                }
            />
            {addOpen ? (
                <div className="border-b border-border px-3 py-2">
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter symbols…"
                        className="mb-1.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
                        aria-label="Filter supported symbols"
                    />
                    <div className="max-h-36 overflow-y-auto">
                        {candidates.length === 0 ? (
                            <p className="px-1 py-1 text-xs text-muted-foreground">
                                {query ? "No match." : "All supported symbols are on the watchlist."}
                            </p>
                        ) : (
                            candidates.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => {
                                        onAdd(s);
                                        setQuery("");
                                    }}
                                    className="block w-full rounded px-1.5 py-1 text-left font-mono text-xs text-foreground/80 transition hover:bg-muted hover:text-foreground"
                                >
                                    {s}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            ) : null}
            <div className="min-w-0 overflow-x-auto">
                {watchlist.length === 0 ? (
                    <div className="p-3">
                        <AwaitingState compact reason="Watchlist is empty — add a symbol to begin." />
                    </div>
                ) : (
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                                <th className="px-3 py-1.5 font-medium">Symbol</th>
                                <th className="px-2 py-1.5 text-right font-medium">Bid</th>
                                <th className="px-2 py-1.5 text-right font-medium">Chg%</th>
                                <th className="px-2 py-1.5 text-right font-medium">Spr</th>
                                <th className="w-6 px-1 py-1.5" aria-label="Remove" />
                            </tr>
                        </thead>
                        <tbody>
                            {watchlist.map((s) => {
                                const q = quotes[s];
                                const isActive = s === active;
                                const chg = q?.changePercent ?? null;
                                return (
                                    <tr
                                        key={s}
                                        className={cn(
                                            "group cursor-pointer border-b border-border/50 transition last:border-0 hover:bg-muted/60",
                                            isActive && "bg-primary/5"
                                        )}
                                        onClick={() => onSelect(s)}
                                    >
                                        <td className="px-3 py-1.5">
                                            <span
                                                className={cn(
                                                    "font-mono text-xs font-semibold",
                                                    isActive ? "text-primary" : "text-foreground"
                                                )}
                                            >
                                                {s}
                                            </span>
                                        </td>
                                        <td className="px-2 py-1.5 text-right">
                                            {quotesLoading && !q ? (
                                                <span className="text-xs text-muted-foreground">…</span>
                                            ) : (
                                                <Val value={q?.bid ?? null} format={(v) => fmtPrice(Number(v), s)} />
                                            )}
                                        </td>
                                        <td
                                            className={cn(
                                                "px-2 py-1.5 text-right font-mono tabular-nums",
                                                chg === null
                                                    ? "text-muted-foreground"
                                                    : chg >= 0
                                                      ? "text-positive"
                                                      : "text-negative"
                                            )}
                                        >
                                            {chg === null ? "—" : fmtSignedPct(chg, 3)}
                                        </td>
                                        <td className="px-2 py-1.5 text-right">
                                            <Val value={q?.spread ?? null} format={(v) => Number(v).toFixed(2)} />
                                        </td>
                                        <td className="px-1 py-1.5">
                                            {watchlist.length > 1 ? (
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${s} from watchlist`}
                                                    className="rounded p-0.5 text-muted-foreground/50 opacity-0 transition hover:bg-negative/15 hover:text-negative focus:opacity-100 group-hover:opacity-100"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onRemove(s);
                                                    }}
                                                >
                                                    <X className="size-3" />
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </Panel>
    );
});

// ── sessions ────────────────────────────────────────────────────────────────

export const SessionsPanel = memo(function SessionsPanel({ now }: { now: number }) {
    const st = sessionState(now);
    return (
        <Panel>
            <PanelHeader
                icon={<Clock className="size-3.5" />}
                title="Sessions"
                meta={st.activeLabel}
                right={
                    st.nextEventLabel ? (
                        <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                            {st.nextEventLabel} in {fmtCountdown(st.nextEventInMin)}
                        </span>
                    ) : null
                }
            />
            <div className="flex flex-col gap-2 p-3">
                {st.rows.map((s) => (
                    <div key={s.key} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className={cn("font-medium", s.active ? "text-foreground" : "text-muted-foreground")}>
                                {s.name}
                                <span className="ml-1.5 font-mono text-micro text-muted-foreground/70">
                                    {String(Math.floor(s.startMin / 60)).padStart(2, "0")}:
                                    {String(s.startMin % 60).padStart(2, "0")}–
                                    {String(Math.floor(s.endMin / 60)).padStart(2, "0")}:
                                    {String(s.endMin % 60).padStart(2, "0")}
                                </span>
                            </span>
                            {s.active ? (
                                <span className="inline-flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-positive">
                                    <span className="size-1.5 animate-pulse rounded-full bg-positive" />
                                    live
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                                className={cn("h-full rounded-full", s.active ? "bg-positive" : "bg-transparent")}
                                style={{ width: `${s.progress * 100}%` }}
                            />
                        </div>
                    </div>
                ))}
                <p className="text-micro leading-4 text-muted-foreground">
                    Session ranges shown in the chart come from real candles inside each UTC window.
                </p>
            </div>
        </Panel>
    );
});

// ── MTF intelligence (from /api/analysis/intelligence) ──────────────────────

type TfRow = AdvancedAnalysisResult["multiTimeframe"]["timeframes"][number];

export const MtfPanel = memo(function MtfPanel({
    analysis,
    loading,
    error,
}: {
    analysis: AdvancedAnalysisResult | null;
    loading: boolean;
    error: string | null;
}) {
    const rows = analysis?.multiTimeframe.timeframes ?? [];
    return (
        <Panel>
            <PanelHeader
                icon={<Layers className="size-3.5" />}
                title="MTF Intelligence"
                meta={
                    analysis
                        ? `${analysis.multiTimeframe.alignedCount}/${analysis.multiTimeframe.availableCount} aligned`
                        : loading
                          ? "loading…"
                          : null
                }
                right={
                    analysis ? <BiasChip bias={analysis.multiTimeframe.dominantBias.value ?? null} /> : null
                }
            />
            {error ? (
                <div className="p-3">
                    <AwaitingState compact reason={error} />
                </div>
            ) : rows.length === 0 ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason={
                            loading
                                ? "Fetching the multi-timeframe ladder from the analytics engine…"
                                : "No multi-timeframe data for this symbol yet."
                        }
                    />
                </div>
            ) : (
                <div className="min-w-0 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                                <th className="px-3 py-1.5 font-medium">TF</th>
                                <th className="px-2 py-1.5 text-right font-medium">Trend</th>
                                <th className="px-2 py-1.5 text-right font-medium">Mom</th>
                                <th className="px-2 py-1.5 text-right font-medium">ATR%</th>
                                <th className="px-2 py-1.5 text-right font-medium">VWAP</th>
                                <th className="px-3 py-1.5 text-right font-medium">Align</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r: TfRow) => (
                                <tr key={r.timeframe} className="border-b border-border/50 last:border-0">
                                    <td className="px-3 py-1.5 font-mono font-semibold text-foreground">
                                        {r.timeframe}
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                        <BiasChip bias={r.available ? (r.trend.value ?? null) : null} />
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                        <BiasChip bias={r.available ? (r.momentum.value ?? null) : null} />
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                        <Val value={r.available ? r.atrPercent.value : null} format={(v) => `${Number(v).toFixed(2)}`} />
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                        <Val
                                            value={r.available ? r.vwapPosition.value : null}
                                            className="capitalize text-muted-foreground"
                                        />
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                        <span
                                            className={cn(
                                                "text-micro font-medium uppercase",
                                                r.alignment.value === "aligned"
                                                    ? "text-positive"
                                                    : r.alignment.value === "conflicting"
                                                      ? "text-warning"
                                                      : "text-muted-foreground"
                                            )}
                                        >
                                            {r.available ? (r.alignment.value ?? "—") : "n/a"}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {analysis ? (
                <div className="border-t border-border px-3 py-2">
                    <p className="text-micro leading-4 text-muted-foreground">
                        {analysis.multiTimeframe.summary.value ??
                            analysis.multiTimeframe.summary.reason ??
                            "Multi-timeframe summary unavailable."}
                    </p>
                </div>
            ) : null}
        </Panel>
    );
});

// ── liquidity + zones (from /api/analysis/intelligence) ─────────────────────

export const LiquidityPanel = memo(function LiquidityPanel({
    analysis,
    loading,
}: {
    analysis: AdvancedAnalysisResult | null;
    loading: boolean;
}) {
    const st = analysis?.structure ?? null;
    const levels = st?.liquidityLevels.value ?? null;
    const sweeps = st?.liquiditySweeps.value ?? null;
    const fvg = st?.fairValueGaps.value ?? null;
    const ob = st?.orderBlocks.value ?? null;
    // Non-null view of `analysis` for the branches below; TS cannot infer it
    // from `st` being non-null, so the guard makes the narrowing explicit.
    const a = analysis;

    const nearest = levels && levels.length > 0 ? levels.slice(0, 4) : null;

    return (
        <Panel>
            <PanelHeader
                icon={<RadarIcon className="size-3.5" />}
                title="Liquidity & Zones"
                meta={
                    levels
                        ? `${levels.length} level${levels.length === 1 ? "" : "s"} · ${sweeps?.length ?? 0} sweep${(sweeps?.length ?? 0) === 1 ? "" : "s"}`
                        : loading
                          ? "loading…"
                          : undefined
                }
            />
            {!st || !a ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason={
                            loading
                                ? "Running the liquidity and zone engines…"
                                : "Liquidity engine has not reported for this symbol."
                        }
                    />
                </div>
            ) : (
                <div className="flex flex-col gap-2 p-3">
                    <div className="grid grid-cols-2 gap-1.5">
                        <Stat label="FVGs" value={fvg ? String(fvg.length) : null} />
                        <Stat label="Order blocks" value={ob ? String(ob.length) : null} />
                        <Stat label="Sweeps" value={sweeps ? String(sweeps.length) : null} />
                        <Stat
                            label="Regime conf."
                            value={
                                a.regime.confidence.value !== null && a.regime.confidence.value !== undefined
                                    ? `${a.regime.confidence.value.toFixed(0)}`
                                    : null
                            }
                        />
                    </div>

                    {nearest && nearest.length > 0 ? (
                        <div className="rounded-md border border-border/70">
                            <div className="border-b border-border/60 px-2 py-1 text-micro uppercase tracking-wide text-muted-foreground">
                                Nearest liquidity levels
                            </div>
                            <ul className="divide-y divide-border/50">
                                {nearest.map((l) => (
                                    <li key={l.id} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                                        <span className="min-w-0 truncate text-muted-foreground">
                                            {humaniseKey(l.type)}
                                            <span className="ml-1 font-mono text-micro text-muted-foreground/60">
                                                {l.timeframe}
                                            </span>
                                        </span>
                                        <Val value={l.price} format={(v) => fmtPrice(Number(v), a.symbol)} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <p className="text-xs italic text-muted-foreground">
                            No liquidity levels detected in the analysed window.
                        </p>
                    )}

                    {a.scoredZones.length > 0 ? (
                        <div className="rounded-md border border-border/70">
                            <div className="border-b border-border/60 px-2 py-1 text-micro uppercase tracking-wide text-muted-foreground">
                                Top zones by score
                            </div>
                            <ul className="divide-y divide-border/50">
                                {a.scoredZones.slice(0, 3).map(({ zone, score, reasons }) => (
                                    <li key={zone.id} className="px-2 py-1.5 text-xs">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="min-w-0 truncate text-muted-foreground">
                                                {humaniseKey(zone.type)} · {zone.direction}
                                            </span>
                                            <span className="font-mono tabular-nums text-foreground">
                                                {fmtPrice(zone.low, a.symbol)}–{fmtPrice(zone.high, a.symbol)}
                                            </span>
                                        </div>
                                        <div className="mt-0.5 flex items-center justify-between gap-2">
                                            <span className="min-w-0 truncate text-micro text-muted-foreground/70">
                                                {reasons.slice(0, 2).join(" · ")}
                                            </span>
                                            <Val value={score} format={(v) => Number(v).toFixed(2)} title="Zone score" />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <p className="text-xs italic text-muted-foreground">No active zones detected.</p>
                    )}
                </div>
            )}
        </Panel>
    );
});

function Stat({ label, value, title }: { label: string; value: string | null; title?: string }) {
    return (
        <div className="rounded-md border border-border/70 bg-background px-2 py-1.5" title={title}>
            <div className="text-micro uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-xs font-medium text-foreground">
                {value ?? <span className="italic text-muted-foreground">—</span>}
            </div>
        </div>
    );
}

// ── regime strip ────────────────────────────────────────────────────────────

export const RegimeStrip = memo(function RegimeStrip({
    analysis,
    loading,
}: {
    analysis: AdvancedAnalysisResult | null;
    loading: boolean;
}) {
    const regime = analysis?.regime.regime.value ?? null;
    const confidence = analysis?.regime.confidence.value ?? null;
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs">
                <Activity className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Regime</span>
                {regime ? (
                    <span className="font-mono font-semibold capitalize text-foreground">{regime.replace(/_/g, " ")}</span>
                ) : (
                    <span className="italic text-muted-foreground">{loading ? "measuring…" : "Data unavailable"}</span>
                )}
            </span>
            <span className="inline-flex min-w-[140px] items-center gap-2 text-xs">
                <span className="text-muted-foreground">Confidence</span>
                <ConfidenceBar value={confidence} />
            </span>
            {analysis?.regime.classifierFactors.length ? (
                <span className="min-w-0 flex-1 truncate text-micro text-muted-foreground" title={analysis.regime.classifierFactors.join(" · ")}>
                    {analysis.regime.classifierFactors.join(" · ")}
                </span>
            ) : null}
        </div>
    );
});

// ── compact radar (from /api/scalping/radar) ────────────────────────────────

export const RadarMiniPanel = memo(function RadarMiniPanel({
    radar,
    loading,
    activeSymbol,
    onSelectSymbol,
}: {
    radar: RadarResult | null;
    loading: boolean;
    activeSymbol: SupportedSymbol | null;
    onSelectSymbol?: (s: SupportedSymbol) => void;
}) {
    const rows = radar?.rows ?? [];
    const sorted = [...rows].sort((a, b) => {
        const av = a.confidence.status === "available" ? (a.confidence.value ?? 0) : -1;
        const bv = b.confidence.status === "available" ? (b.confidence.value ?? 0) : -1;
        return bv - av;
    });
    return (
        <Panel>
            <PanelHeader
                icon={<RadarIcon className="size-3.5" />}
                title="Market Radar"
                meta={radar ? `${rows.length} on ${radar.timeframe}` : loading ? "building…" : undefined}
            />
            {rows.length === 0 ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason={
                            loading
                                ? "Running the deterministic pipeline over the watchlist…"
                                : radar && radar.failed.length > 0
                                  ? "Provider returned no candles for the watched symbols."
                                  : "No radar data yet."
                        }
                    />
                    {radar && radar.failed.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                            {radar.failed.map((f) => (
                                <li key={f.symbol} className="text-micro text-muted-foreground">
                                    <span className="font-mono">{f.symbol}</span> — {f.reason}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : (
                <div className="min-w-0 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                                <th className="px-3 py-1.5 font-medium">Symbol</th>
                                <th className="px-2 py-1.5 text-right font-medium">Last</th>
                                <th className="px-2 py-1.5 text-right font-medium">Chg%</th>
                                <th className="px-2 py-1.5 text-right font-medium">Trend</th>
                                <th className="px-3 py-1.5 text-right font-medium">AI conf.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((r) => {
                                const chg = r.changePercent.status === "available" ? r.changePercent.value : null;
                                const trend = r.trend.status === "available" ? (r.trend.value?.bias ?? null) : null;
                                const conf = r.confidence.status === "available" ? r.confidence.value : null;
                                return (
                                    <tr
                                        key={r.symbol}
                                        className={cn(
                                            "border-b border-border/50 transition last:border-0",
                                            onSelectSymbol && "cursor-pointer hover:bg-muted/60",
                                            r.symbol === activeSymbol && "bg-primary/5"
                                        )}
                                        onClick={onSelectSymbol ? () => onSelectSymbol(r.symbol) : undefined}
                                    >
                                        <td className="px-3 py-1.5 font-mono font-semibold text-foreground">
                                            {r.symbol}
                                            {r.stale ? <span className="ml-1 text-micro text-warning">stale</span> : null}
                                        </td>
                                        <td className="px-2 py-1.5 text-right">
                                            <Val value={r.lastPrice.status === "available" ? r.lastPrice.value : null} format={(v) => fmtPrice(Number(v), r.symbol)} />
                                        </td>
                                        <td
                                            className={cn(
                                                "px-2 py-1.5 text-right font-mono tabular-nums",
                                                chg === null ? "text-muted-foreground" : chg >= 0 ? "text-positive" : "text-negative"
                                            )}
                                        >
                                            {chg === null ? "—" : fmtSignedPct(chg, 3)}
                                        </td>
                                        <td className="px-2 py-1.5 text-right">
                                            <BiasChip bias={trend} />
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <div className="flex justify-end">
                                                <ConfidenceBar value={conf} />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {radar ? (
                <div className="border-t border-border px-3 py-1.5">
                    <p className="text-micro text-muted-foreground">
                        Source: {radar.dataSource.label} · deterministic pipeline, no AI spend
                    </p>
                </div>
            ) : null}
        </Panel>
    );
});

// ── live signals (from /api/scalping/signals) ───────────────────────────────

export const SignalsMiniPanel = memo(function SignalsMiniPanel({
    signals,
    rejected,
    loading,
    now,
    token,
}: {
    signals: TerminalSignal[];
    rejected: Array<{ symbol: string; reason: string }>;
    loading: boolean;
    now: number;
    /** Auth token for the optional AI-execution TradePlan action (additive). */
    token?: string | null;
}) {
    const [showRejected, setShowRejected] = useState(false);
    return (
        <Panel>
            <PanelHeader
                icon={<Radio className="size-3.5" />}
                title="Live Signals"
                meta={`${signals.length} qualifying · ${rejected.length} rejected`}
            />
            {signals.length === 0 ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason={
                            loading
                                ? "Scanning the watchlist with the deterministic scanner…"
                                : "No symbol met the configured confidence and R:R gates — a normal scanner outcome."
                        }
                    />
                </div>
            ) : (
                <ul className="divide-y divide-border/60">
                    {signals.map((s) => {
                        const isLong = s.direction === "long";
                        const ageMin = Math.max(0, Math.round((now - s.createdAt) / 60000));
                        return (
                            <li key={s.id} className="px-3 py-2">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-mono text-xs font-semibold text-foreground">{s.symbol}</span>
                                    <span
                                        className={cn(
                                            "rounded-full border px-1.5 py-0.5 text-micro font-bold tracking-wide",
                                            isLong
                                                ? "border-positive/40 bg-positive/10 text-positive"
                                                : "border-negative/40 bg-negative/10 text-negative"
                                        )}
                                    >
                                        {isLong ? "LONG" : "SHORT"}
                                    </span>
                                    <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                                        {s.timeframe}
                                    </span>
                                    <span className="ml-auto font-mono text-micro text-muted-foreground">
                                        {ageMin < 1 ? "just now" : `${ageMin}m ago`}
                                    </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-micro tabular-nums">
                                    <span className="text-muted-foreground">
                                        E <span className="text-foreground">{fmtPrice(s.entry, s.symbol)}</span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        SL <span className="text-negative">{fmtPrice(s.stop, s.symbol)}</span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        TP <span className="text-positive">{fmtPrice(s.target, s.symbol)}</span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        R:R <span className="text-foreground">{s.riskReward.toFixed(2)}</span>
                                    </span>
                                </div>
                                {s.evidence.length > 0 ? (
                                    <p className="mt-1 line-clamp-2 text-micro leading-4 text-muted-foreground" title={s.evidence.join(" · ")}>
                                        {s.evidence.slice(0, 2).join(" · ")}
                                    </p>
                                ) : null}
                                {/* AI Execution (additive): turn a qualifying signal into a TradePlan. */}
                                {token ? (
                                    <div className="mt-1.5">
                                        <Suspense fallback={null}>
                                            <TerminalPlanButtonLazy signal={{ id: s.id, symbol: s.symbol, direction: s.direction, entry: s.entry, stop: s.stop, target: s.target, timeframe: s.timeframe, evidence: s.evidence }} token={token} />
                                        </Suspense>
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}
            {rejected.length > 0 ? (
                <div className="border-t border-border px-3 py-1.5">
                    <button
                        type="button"
                        onClick={() => setShowRejected((v) => !v)}
                        aria-expanded={showRejected}
                        className="inline-flex items-center gap-1 text-micro text-muted-foreground transition hover:text-foreground"
                    >
                        <Target className="size-3" />
                        {rejected.length} symbol{rejected.length === 1 ? "" : "s"} did not qualify
                        <ChevronDown className={cn("size-3 transition-transform", showRejected && "rotate-180")} />
                    </button>
                    {showRejected ? (
                        <ul className="mt-1.5 space-y-1">
                            {rejected.map((r) => (
                                <li key={r.symbol} className="text-micro leading-4 text-muted-foreground">
                                    <span className="font-mono text-foreground/80">{r.symbol}</span> — {r.reason}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}
        </Panel>
    );
});

// ── economic calendar (from /api/calendar) ──────────────────────────────────

const IMPACT_TONE: Record<CalendarEvent["impact"], string> = {
    High: "border-negative/40 bg-negative/10 text-negative",
    Medium: "border-warning/40 bg-warning/10 text-warning",
    Low: "border-border bg-muted text-muted-foreground",
};

export function CalendarPanel({
    events,
    loading,
    error,
    activeSymbol,
    now,
    source,
}: {
    events: CalendarEvent[];
    loading: boolean;
    error: string | null;
    activeSymbol: string;
    /** Ticking clock, passed in so the component stays render-pure. */
    now: number;
    /** Which feed produced the rows (platform feed vs TradingView MCP). */
    source?: "platform" | "tradingview-mcp" | "none";
}) {
    const relevant = currenciesOf(activeSymbol);

    const withTs = events
        .map((e) => ({ e, ts: eventTimestamp(e) }))
        .filter((x): x is { e: CalendarEvent; ts: number } => x.ts !== null)
        .sort((a, b) => a.ts - b.ts);
    const upcoming = withTs.filter((x) => x.ts >= now).slice(0, 6);
    const recent = [...withTs.filter((x) => x.ts < now)].slice(-2);

    return (
        <Panel>
            <PanelHeader
                icon={<CalendarDays className="size-3.5" />}
                title="Economic Calendar"
                meta={relevant.length > 0 ? `${relevant.join(", ")} focus` : undefined}
                right={
                    <span className="text-micro text-muted-foreground">
                        {loading ? "loading…" : `${events.length} events`}
                    </span>
                }
            />
            {error ? (
                <div className="p-3">
                    <AwaitingState compact reason={error} />
                </div>
            ) : upcoming.length === 0 && recent.length === 0 ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason={
                            loading
                                ? "Loading the calendar feed…"
                                : "Calendar feed returned no events right now — nothing is invented to fill the gap."
                        }
                    />
                </div>
            ) : (
                <div className="flex flex-col">
                    {[...recent, ...upcoming].map(({ e, ts }) => {
                        const past = ts < now;
                        const relevantEvent = relevant.includes(e.currency);
                        return (
                            <div
                                key={e.id}
                                className={cn(
                                    "flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs last:border-0",
                                    past && "opacity-50",
                                    relevantEvent && !past && "bg-primary/[0.04]"
                                )}
                            >
                                <span className="w-14 shrink-0 font-mono text-micro text-muted-foreground">
                                    {e.timeUtc || "—"}
                                </span>
                                <span className="w-9 shrink-0 font-mono text-micro text-muted-foreground">
                                    {e.currency}
                                </span>
                                <span
                                    className={cn(
                                        "shrink-0 rounded border px-1 py-0.5 text-micro font-semibold uppercase",
                                        IMPACT_TONE[e.impact]
                                    )}
                                >
                                    {e.impact}
                                </span>
                                <span className="min-w-0 flex-1 truncate" title={e.title}>
                                    {e.title}
                                </span>
                                <span className="hidden shrink-0 gap-2 font-mono text-micro tabular-nums text-muted-foreground sm:flex">
                                    <span title="Forecast">F {e.forecast}</span>
                                    <span title="Previous">P {e.previous}</span>
                                    {e.actual ? <span title="Actual" className="text-foreground">A {e.actual}</span> : null}
                                </span>
                            </div>
                        );
                    })}
                    <p className="px-3 py-1.5 text-micro text-muted-foreground">
                        Times in UTC from the {source === "tradingview-mcp" ? "TradingView MCP" : "platform calendar"} feed. Rows relevant to {activeSymbol} are highlighted.
                    </p>
                </div>
            )}
        </Panel>
    );
}

/** Hook: economic calendar with in-component caching per mount. */
export function useCalendar(token?: string | null) {
    const [state, setState] = useState<{
        events: CalendarEvent[];
        loading: boolean;
        error: string | null;
        source?: "platform" | "tradingview-mcp" | "none";
    }>({ events: [], loading: true, error: null });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/calendar", {
                    next: undefined,
                    // Auth lets the route fall back to the caller's TradingView
                    // MCP calendar when the platform feed is empty.
                    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
                } as RequestInit);
                const body = (await res.json().catch(() => null)) as { events?: CalendarEvent[]; source?: "platform" | "tradingview-mcp" | "none" } | null;
                if (cancelled) return;
                if (!res.ok || !body) throw new Error("Calendar feed unavailable");
                setState({ events: body.events ?? [], loading: false, error: null, source: body.source });
            } catch {
                if (cancelled) return;
                setState({ events: [], loading: false, error: "Calendar feed unavailable right now." });
            }
        })();
        return () => {
            cancelled = true;
        };
        // Re-fetch when the token lands: the MCP fallback needs it.
    }, [token]);

    return state;
}
