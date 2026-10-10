"use client";

/**
 * Explorer panels (Phase 16 §22, §23, §15–§18).
 *
 * Correlation matrix, relationship timeline, regime, clusters, factors and
 * events. Every panel renders the engine's structured data — if the engine
 * produced nothing (free tier, missing data), the panel says exactly that
 * instead of drawing empty fake cards (§AC).
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
    GraphCluster,
    GraphFactor,
    GraphRegime,
    GraphRelationshipRow,
    GraphSignal,
} from "./useCrossAsset";

function PanelCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-border bg-card p-3">
            <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h3>
                {hint ? <span className="text-micro text-muted-foreground">{hint}</span> : null}
            </header>
            <div className="mt-2">{children}</div>
        </section>
    );
}

/* ── relationship list (§22) ──────────────────────────────────────────────── */

export function RelationshipList({
    rows,
    focusSymbol,
    selectedPair,
    onSelect,
}: {
    rows: GraphRelationshipRow[];
    focusSymbol: string;
    selectedPair: string | null;
    onSelect: (pairKey: string) => void;
}) {
    const focus = focusSymbol.toUpperCase();
    const own = useMemo(
        () =>
            rows
                .filter((r) => (r.a === focus || r.b === focus) && r.coefficient !== null)
                .sort((x, y) => Math.abs(y.coefficient ?? 0) - Math.abs(x.coefficient ?? 0)),
        [rows, focus]
    );

    if (own.length === 0) {
        return (
            <PanelCard title="Relationships" hint={`window from controls`}>
                <p className="text-xs text-muted-foreground">
                    No relationship for {focus} passed the |ρ| ≥ 0.3 label threshold in this window — the list is empty
                    by design, not by failure.
                </p>
            </PanelCard>
        );
    }

    return (
        <PanelCard title="Relationships" hint={`${own.length} measured`}>
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-left text-micro uppercase tracking-wide text-muted-foreground">
                        <th className="py-1">Symbol</th>
                        <th>ρ</th>
                        <th>Δ</th>
                        <th>Stability</th>
                        <th>Term</th>
                        <th>n</th>
                        <th>Quality</th>
                    </tr>
                </thead>
                <tbody>
                    {own.map((r) => {
                        const other = r.a === focus ? r.b : r.a;
                        const key = `${r.a}|${r.b}`;
                        return (
                            <tr
                                key={key}
                                onClick={() => onSelect(key)}
                                className={cn(
                                    "cursor-pointer border-t border-border/60 hover:bg-muted/60",
                                    selectedPair === key && "bg-primary/10"
                                )}
                            >
                                <td className="py-1.5 font-mono text-foreground">{other}</td>
                                <td className={cn("font-mono", (r.coefficient ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {r.coefficient?.toFixed(2)}
                                </td>
                                <td className="font-mono text-muted-foreground">
                                    {r.delta === null ? "—" : `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)}`}
                                </td>
                                <td>
                                    <span className={cn("rounded px-1 py-0.5 text-micro", stabilityClass(r.stability))}>
                                        {r.stability}
                                    </span>
                                </td>
                                <td className="text-muted-foreground">{r.term.replace("_TERM", "").toLowerCase()}</td>
                                <td className="font-mono text-muted-foreground">{r.sampleSize}</td>
                                <td className="text-micro text-muted-foreground">{r.dataQuality.status}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </PanelCard>
    );
}

function stabilityClass(stability: string): string {
    switch (stability) {
        case "STABLE":
            return "bg-emerald-500/15 text-emerald-300";
        case "STRENGTHENING":
            return "bg-sky-500/15 text-sky-300";
        case "WEAKENING":
            return "bg-amber-500/15 text-amber-300";
        case "BREAKING":
        case "FLIPPING":
            return "bg-rose-500/20 text-rose-300";
        default:
            return "bg-zinc-500/20 text-zinc-300";
    }
}

/* ── correlation matrix (§22) ─────────────────────────────────────────────── */

export function CorrelationMatrix({
    cells,
    symbols,
    onSelectPair,
}: {
    cells: Array<{ a: string; b: string; coefficient: number | null; status: string }>;
    symbols: string[];
    onSelectPair?: (a: string, b: string) => void;
}) {
    if (cells.length === 0 || symbols.length < 2) {
        return (
            <p className="text-xs text-muted-foreground">
                The correlation matrix is a Pro feature — upgrade to see the full pairwise view (§51).
            </p>
        );
    }
    const lookup = new Map<string, { coefficient: number | null; status: string }>();
    for (const c of cells) {
        lookup.set(`${c.a}|${c.b}`, { coefficient: c.coefficient, status: c.status });
        lookup.set(`${c.b}|${c.a}`, { coefficient: c.coefficient, status: c.status });
    }

    return (
        <div className="overflow-x-auto">
            <table className="font-mono text-micro">
                <thead>
                    <tr>
                        <th className="p-1 text-left text-muted-foreground" />
                        {symbols.map((s) => (
                            <th key={s} className="p-1 text-muted-foreground" title={s}>
                                {s.length > 7 ? `${s.slice(0, 6)}…` : s}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {symbols.map((row) => (
                        <tr key={row}>
                            <td className="p-1 text-muted-foreground">{row}</td>
                            {symbols.map((col) => {
                                const cell = lookup.get(`${row}|${col}`);
                                const r = row === col ? 1 : (cell?.coefficient ?? null);
                                return (
                                    <td
                                        key={col}
                                        onClick={() => r !== null && row !== col && onSelectPair?.(row, col)}
                                        className={cn(
                                            "min-w-[46px] border border-border/40 p-1 text-center",
                                            r !== null ? "cursor-pointer" : "cursor-default",
                                            row === col && "bg-muted/50 text-muted-foreground"
                                        )}
                                        style={
                                            r !== null && row !== col
                                                ? {
                                                      backgroundColor:
                                                          r >= 0
                                      ? `rgba(52, 211, 153, ${Math.min(0.75, Math.abs(r))})`
                                      : `rgba(251, 113, 133, ${Math.min(0.75, Math.abs(r))})`,
                                                      color: Math.abs(r) > 0.45 ? "#09090b" : "#a1a1aa",
                                                  }
                                                : undefined
                                        }
                                        title={cell?.status === "INSUFFICIENT_DATA" ? "Insufficient data — not reported" : undefined}
                                    >
                                        {row === col ? "1.00" : r === null ? "n/a" : r.toFixed(2)}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* ── relationship timeline (§23) ──────────────────────────────────────────── */

export function RelationshipTimeline({
    observations,
    pairLabel,
}: {
    observations: GraphRelationshipRow["observations"];
    pairLabel: string;
}) {
    const points = useMemo(
        () => observations.filter((o) => typeof o.coefficient === "number"),
        [observations]
    );

    if (points.length < 2) {
        return (
            <p className="text-xs text-muted-foreground">
                Not enough rolling observations for a timeline — at least two completed windows are required.
            </p>
        );
    }

    const width = 560;
    const height = 150;
    const pad = 18;
    const xs = points.map((_, i) => pad + (i * (width - pad * 2)) / (points.length - 1));
    const ys = points.map((o) => {
        const r = o.coefficient as number;
        // ρ ∈ [−1, 1] → y (0 at top = +1)
        return pad + ((1 - r) / 2) * (height - pad * 2);
    });
    const path = points.map((_, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const zeroY = pad + ((1 - 0) / 2) * (height - pad * 2);
    const latest = points[points.length - 1];
    const first = points[0];
    const drift = Math.abs(latest.coefficient as number) - Math.abs(first.coefficient as number);
    const marker =
        latest && latest.coefficient !== null && first && first.coefficient !== null && first.coefficient * latest.coefficient < 0
            ? "FLIP"
            : Math.abs((latest.coefficient ?? 0) - (first.coefficient ?? 0)) >= 0.3
              ? "BREAK"
              : drift <= -0.1
                ? "WEAKENING"
                : drift >= 0.1
                  ? "STRENGTHENING"
                  : "STABLE";

    return (
        <div>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`Correlation timeline for ${pairLabel}`}>
                <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#52525b" strokeDasharray="4 4" />
                <text x={pad} y={zeroY - 4} fontSize="8" fill="#71717a">
                    ρ = 0
                </text>
                <text x={2} y={pad + 4} fontSize="8" fill="#71717a">
                    +1
                </text>
                <text x={2} y={height - pad} fontSize="8" fill="#71717a">
                    −1
                </text>
                <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.6" />
                {points.map((o, i) => (
                    <circle key={o.id} cx={xs[i]} cy={ys[i]} r={i === points.length - 1 ? 3.4 : 2} fill={i === points.length - 1 ? "#fbbf24" : "#38bdf8"}>
                        <title>{`${new Date(o.observedAt).toISOString().slice(0, 16)} · ρ=${(o.coefficient as number).toFixed(2)} · n=${o.sampleSize}`}</title>
                    </circle>
                ))}
            </svg>
            <div className="flex flex-wrap items-center justify-between gap-2 text-micro text-muted-foreground">
                <span>
                    {new Date(first.observedAt).toISOString().slice(5, 16).replace("T", " ")} →{" "}
                    {new Date(latest.observedAt).toISOString().slice(5, 16).replace("T", " ")} · {points.length} windows
                </span>
                <span className={cn("rounded px-1.5 py-0.5 font-semibold", stabilityClass(marker))}>{marker}</span>
            </div>
        </div>
    );
}

/* ── regime (§15, §16) ────────────────────────────────────────────────────── */

export function RegimePanel({ regime, transitions }: { regime?: GraphRegime; transitions?: Array<{ axis: string; previousState: string; newState: string; timestamp: number }> }) {
    if (!regime) {
        return (
            <p className="text-xs text-muted-foreground">
                Regime intelligence is part of Pro (§51) — upgrade to see the multi-axis global regime with evidence.
            </p>
        );
    }
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
                {regime.activeStates.map((state) => (
                    <span
                        key={state}
                        className={cn(
                            "rounded px-2 py-0.5 text-micro font-semibold",
                            state === "RISK_OFF" || state === "HIGH_VOLATILITY" || state === "DISLOCATION"
                                ? "bg-rose-500/20 text-rose-300"
                                : state === "RISK_ON" || state === "LOW_VOLATILITY"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : state === "UNKNOWN"
                                    ? "bg-zinc-500/20 text-zinc-300"
                                    : "bg-sky-500/20 text-sky-300"
                        )}
                    >
                        {state.replace(/_/g, " ")}
                    </span>
                ))}
            </div>
            <table className="w-full text-micro">
                <tbody>
                    {regime.axes.map((axis) => (
                        <tr key={axis.axis} className="border-t border-border/60 align-top">
                            <td className="py-1.5 pr-2 font-medium text-muted-foreground">{axis.axis}</td>
                            <td className="py-1.5">
                                <span className={cn("rounded px-1.5 py-0.5 text-micro", axis.state === "UNKNOWN" ? "bg-zinc-500/20 text-zinc-300" : stabilityClass(axis.state.includes("EXPANSION") ? "BREAKING" : "STABLE"))}>
                                    {axis.state.replace(/_/g, " ")}
                                </span>
                            </td>
                            <td className="py-1.5 text-micro text-muted-foreground">
                                {axis.evidence[0]?.text ?? "No evidence recorded."}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {regime.notComputed.length > 0 ? (
                <p className="text-micro text-muted-foreground">Not computed: {regime.notComputed.join(", ")}</p>
            ) : null}
            {(transitions ?? []).length > 0 ? (
                <ul className="space-y-1 text-micro">
                    {(transitions ?? []).map((t, i) => (
                        <li key={`${t.axis}-${i}`} className="text-amber-300/90">
                            Transition: {t.axis} {t.previousState.replace(/_/g, " ")} → {t.newState.replace(/_/g, " ")} ·{" "}
                            {new Date(t.timestamp).toISOString().slice(0, 16).replace("T", " ")}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

/* ── clusters (§11) ───────────────────────────────────────────────────────── */

export function ClustersPanel({ clusters }: { clusters?: GraphCluster[] }) {
    if (!clusters) {
        return (
            <p className="text-xs text-muted-foreground">Dynamic clusters are part of Pro (§51).</p>
        );
    }
    if (clusters.length === 0) {
        return (
            <p className="text-xs text-muted-foreground">
                No group of instruments currently co-moves above the clustering threshold — reported as empty rather than
                fabricated.
            </p>
        );
    }
    return (
        <ul className="space-y-2">
            {clusters.map((cluster) => (
                <li key={cluster.id} className="rounded border border-border/70 p-2">
                    <p className="text-xs font-medium text-foreground">
                        {cluster.label}
                        {cluster.meanCorrelation !== null ? (
                            <span className="ml-2 font-mono text-micro text-muted-foreground">mean ρ {cluster.meanCorrelation.toFixed(2)}</span>
                        ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-micro text-muted-foreground">
                        {cluster.memberNodeIds.map((id) => id.replace(/^instrument:/, "")).join(" · ")}
                    </p>
                    <p className="mt-1 text-micro text-muted-foreground">{cluster.evidence[0]?.text}</p>
                </li>
            ))}
        </ul>
    );
}

/* ── factors (§13, §14) ───────────────────────────────────────────────────── */

export function FactorsPanel({ factors }: { factors?: GraphFactor[] }) {
    if (!factors) return <p className="text-xs text-muted-foreground">Market factors are part of Pro (§51).</p>;
    if (factors.length === 0) return <p className="text-xs text-muted-foreground">No factors computed for this window.</p>;
    return (
        <ul className="space-y-2">
            {factors.map((f) => (
                <li key={f.id} className="rounded border border-border/70 p-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs font-semibold text-foreground">{f.name.replace("factor:", "")}</p>
                        <span
                            className={cn(
                                "rounded px-1.5 py-0.5 text-micro font-semibold",
                                f.status === "AVAILABLE" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/20 text-zinc-300"
                            )}
                        >
                            {f.status === "AVAILABLE" ? (f.value === null ? "AVAILABLE" : f.value.toFixed(2)) : "INSUFFICIENT DATA"}
                        </span>
                    </div>
                    <p className="mt-0.5 text-micro text-muted-foreground">{f.definition}</p>
                    <p className="mt-0.5 font-mono text-micro text-violet-300/90">
                        [{f.kind}] {f.formula}
                    </p>
                    <p className="mt-0.5 font-mono text-micro text-muted-foreground">
                        inputs: {f.inputs.filter((i) => i.used).map((i) => `${i.symbol}(${i.weight})`).join(", ") || "none"}
                        {" · confidence "}
                        {f.confidence.toFixed(2)}
                    </p>
                    {f.status !== "AVAILABLE" ? <p className="mt-0.5 text-micro text-amber-300/90">{f.limitations[0]}</p> : null}
                </li>
            ))}
        </ul>
    );
}

/* ── events (§18) ─────────────────────────────────────────────────────────── */

export function EventsPanel({ signals }: { signals?: GraphSignal[] }) {
    if (!signals) return <p className="text-xs text-muted-foreground">Cross-asset events are part of Pro (§51).</p>;
    if (signals.length === 0) {
        return <p className="text-xs text-muted-foreground">No active cross-asset events in the current window.</p>;
    }
    return (
        <ul className="space-y-1.5">
            {signals.slice(0, 12).map((s) => (
                <li key={s.id} className="rounded border border-border/70 p-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-micro font-semibold text-foreground">{s.type.replace(/_/g, " ")}</span>
                        <span
                            className={cn(
                                "rounded px-1.5 py-0.5 text-micro font-semibold",
                                s.status === "CONFIRMED"
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : s.status === "DETECTED"
                                      ? "bg-sky-500/15 text-sky-300"
                                      : "bg-zinc-500/20 text-zinc-300"
                            )}
                        >
                            {s.status}
                        </span>
                    </div>
                    <p className="mt-0.5 text-micro leading-4 text-muted-foreground">{s.summary}</p>
                    <p className="mt-0.5 font-mono text-micro text-muted-foreground/80">
                        observed {new Date(s.dataTimestamp).toISOString().slice(0, 16).replace("T", " ")} · confidence{" "}
                        {s.confidence.toFixed(2)} · context, not a signal (§18)
                    </p>
                </li>
            ))}
        </ul>
    );
}
