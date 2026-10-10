"use client";

/**
 * AlgoVault — Pro Terminal portfolio panel (Phase 15 §26).
 *
 * Contextual, not a dashboard: when a symbol is selected the panel shows that
 * symbol's position, strategy, portfolio exposure, correlation with the rest of
 * the book, risk contribution and related positions — plus the chart actions
 * that operate on it.
 *
 * Advanced intelligence stays in collapsible panels so the chart is not buried.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPct, usePortfolioAction, usePortfolioQuery, type PortfolioSnapshotPayload } from "./client";

interface Props {
    symbol: string;
    timeframe: string;
    onOpenPortfolioAnalysis?: () => void;
}

function Panel({
    title,
    children,
    defaultOpen = false,
    id,
    isExpanded,
    onToggle,
}: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    id: string;
    isExpanded: (id: string) => boolean;
    onToggle: (id: string) => void;
}) {
    const open = isExpanded(id);
    return (
        <div className="border-b border-border last:border-b-0">
            <button
                type="button"
                onClick={() => onToggle(id)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
            >
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {title}
            </button>
            {open ? <div className="px-3 pb-2.5">{children}</div> : null}
        </div>
    );
}

export function PortfolioTerminalPanel({ symbol, timeframe, onOpenPortfolioAnalysis }: Props) {
    const { data, loading, error, message, freshness } = usePortfolioQuery<PortfolioSnapshotPayload>("/api/portfolio/snapshot");
    const precheck = usePortfolioAction<
        { symbol: string; side: string; quantity: number; entryPrice: number; stopLoss?: number },
        { precheck: { verdict: string; individualTradeRisk: string; portfolioImpact: string; reasons: string[] } | null }
    >("/api/portfolio/analyze");

    const symbolUpper = symbol.toUpperCase();

    const position = useMemo(
        () => data?.positions.filter((p) => p.symbol === symbolUpper) ?? [],
        [data, symbolUpper]
    );

    const symbolSlice = useMemo(
        () => data?.exposure.bySymbol.find((s) => s.key === symbolUpper) ?? null,
        [data, symbolUpper]
    );

    const correlations = useMemo(() => {
        if (!data?.correlationMatrix || data.correlationMatrix.symbols.length < 2) return [];
        const i = data.correlationMatrix.symbols.indexOf(symbolUpper);
        if (i < 0) return [];
        return data.correlationMatrix.symbols
            .map((other, j) => ({ other, value: data.correlationMatrix!.matrix[i]?.[j] ?? null }))
            .filter((r) => r.other !== symbolUpper)
            .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
    }, [data, symbolUpper]);

    const related = useMemo(
        () => data?.positions.filter((p) => p.symbol !== symbolUpper).slice(0, 6) ?? [],
        [data, symbolUpper]
    );

    // Panels start collapsed so the chart is never buried. The chart actions
    // open exactly the panel they name.
    const [expanded, setExpanded] = useState<string[]>(["position"]);
    const toggleSection = (id: string) =>
        setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    const isSectionOpen = (id: string) => expanded.includes(id);

    const actions = [
        {
            label: "Analyze portfolio impact",
            run: () => {
                if (!expanded.includes("actions")) toggleSection("actions");
                void precheck.run({ symbol: symbolUpper, side: "LONG", quantity: 0.01, entryPrice: position[0]?.currentPrice ?? 0 });
            },
        },
        { label: "Show exposure", toggle: "exposure" },
        { label: "Show risk contribution", toggle: "risk" },
        { label: "Find hedging candidates", toggle: "correlation" },
    ];

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center p-4">
                <Loader2 className="size-4 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-3">
                <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-2.5">
                    <div className="flex items-center gap-1.5 text-micro font-semibold text-amber-400">
                        <ShieldAlert className="size-3" /> Portfolio intelligence unavailable
                    </div>
                    <p className="mt-1 text-micro leading-4 text-muted-foreground">
                        {message ?? "Reason: portfolio data could not be loaded."} Automated live action is not authorised in
                        this state.
                    </p>
                </div>
            </div>
        );
    }

    if (!data) return <p className="p-3 text-micro italic text-muted-foreground">No portfolio data.</p>;

    const hasPosition = position.length > 0;

    return (
        <div>
            {/* Symbol context header */}
            <div className="border-b border-border px-3 py-2">
                <div className="flex items-center justify-between">
                    <span className="font-mono text-micro font-semibold text-foreground">
                        {symbolUpper} · {timeframe}
                    </span>
                    <span className="font-mono text-micro text-muted-foreground">
                        {freshness?.freshness === "STALE" ? "STALE DATA" : freshness?.freshness === "UNAVAILABLE" ? "UNAVAILABLE" : "LIVE"}
                    </span>
                </div>
                <p className="mt-0.5 text-micro text-muted-foreground">
                    {hasPosition
                        ? `${position.length} open position(s) · ${fmtPct(symbolSlice?.grossWeight ?? 0)} of gross exposure`
                        : "No open position on this symbol."}
                </p>
            </div>

            {/* Current position */}
            <Panel title="Current position" defaultOpen id="position" isExpanded={isSectionOpen} onToggle={toggleSection}>
                {hasPosition ? (
                    <dl className="space-y-0.5 text-micro">
                        {position.map((p) => (
                            <div key={p.positionId} className="flex items-center justify-between gap-2">
                                <dt className={cn("font-mono font-semibold", p.side === "LONG" ? "text-emerald-400" : "text-rose-400")}>
                                    {p.side} {p.quantity}
                                </dt>
                                <dd className="font-mono tabular-nums text-muted-foreground">
                                    {fmtMoney(p.unrealizedPnL, data.baseCurrency, 0)} · risk{" "}
                                    {p.riskAmount === null ? "unavailable" : fmtMoney(p.riskAmount, data.baseCurrency, 0)}
                                </dd>
                            </div>
                        ))}
                        <div className="flex items-center justify-between gap-2 border-t border-border pt-1">
                            <dt className="text-muted-foreground">Strategy</dt>
                            <dd className="font-mono text-foreground">{position[0].strategyId}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">Asset class</dt>
                            <dd className="font-mono text-foreground">{position[0].assetClass}</dd>
                        </div>
                    </dl>
                ) : (
                    <p className="text-micro italic text-muted-foreground">Nothing open on this symbol.</p>
                )}
            </Panel>

            {/* Portfolio exposure */}
            <Panel title="Portfolio exposure" id="exposure" isExpanded={isSectionOpen} onToggle={toggleSection}>
                <dl className="space-y-0.5 text-micro">
                    <Row label={`${symbolUpper} weight`} value={fmtPct(symbolSlice?.grossWeight ?? 0)} />
                    <Row label="Portfolio gross" value={fmtMoney(data.grossExposure, data.baseCurrency, 0)} />
                    <Row label="Portfolio net" value={fmtMoney(data.netExposure, data.baseCurrency, 0)} />
                    <Row label="Gross / equity" value={`${(data.exposure.grossToEquity ?? 0).toFixed(2)}×`} />
                    <Row
                        label="Correlated cluster"
                        value={`${fmtPct(data.correlation.clusteredExposureWeight)} · ρ ${data.correlation.meanCorrelation.toFixed(2)}`}
                    />
                </dl>
            </Panel>

            {/* Correlation */}
            <Panel title="Correlated assets" id="correlation" isExpanded={isSectionOpen} onToggle={toggleSection}>
                {correlations.length === 0 ? (
                    <p className="text-micro italic text-muted-foreground">
                        Correlation is UNAVAILABLE for this symbol — no aligned price history. It is not reported as zero.
                    </p>
                ) : (
                    <ul className="space-y-0.5">
                        {correlations.slice(0, 6).map((c) => (
                            <li key={c.other} className="flex items-center justify-between gap-2 text-micro">
                                <span className="font-mono text-foreground">{c.other}</span>
                                <span
                                    className={cn(
                                        "font-mono tabular-nums",
                                        c.value === null
                                            ? "italic text-muted-foreground"
                                            : c.value >= 0.3
                                              ? "text-rose-400"
                                              : c.value <= -0.3
                                                ? "text-emerald-400"
                                                : "text-muted-foreground"
                                    )}
                                >
                                    {c.value === null ? "unavailable" : c.value.toFixed(2)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-1.5 text-micro leading-4 text-muted-foreground">
                    Measured co-movement over the trailing window. A correlation is not a signal.
                </p>
            </Panel>

            {/* Risk contribution */}
            <Panel title="Risk contribution" id="risk" isExpanded={isSectionOpen} onToggle={toggleSection}>
                <dl className="space-y-0.5 text-micro">
                    <Row label="Cash risk to stop" value={position.reduce((a, p) => a + (p.riskAmount ?? 0), 0) === 0 && !hasPosition ? "unavailable" : fmtMoney(position.reduce((a, p) => a + (p.riskAmount ?? 0), 0), data.baseCurrency, 0)} />
                    <Row label="Portfolio open risk" value={data.risk.openRiskPercent === null ? "unavailable" : `${data.risk.openRiskPercent.toFixed(2)}%`} />
                    <Row
                        label="Share of portfolio risk"
                        value={
                            data.risk.openRisk && position.reduce((a, p) => a + (p.riskAmount ?? 0), 0) > 0
                                ? fmtPct(position.reduce((a, p) => a + (p.riskAmount ?? 0), 0) / data.risk.openRisk)
                                : "unavailable"
                        }
                    />
                    <Row label="Symbol concentration (HHI)" value={`${data.concentration.concentrationScore.toFixed(3)}`} />
                </dl>
            </Panel>

            {/* Related positions */}
            <Panel title="Related positions" id="related" isExpanded={isSectionOpen} onToggle={toggleSection}>
                {related.length === 0 ? (
                    <p className="text-micro italic text-muted-foreground">No other open positions.</p>
                ) : (
                    <ul className="space-y-0.5">
                        {related.map((p) => (
                            <li key={p.positionId} className="flex items-center justify-between gap-2 text-micro">
                                <span className="font-mono text-foreground">
                                    {p.symbol} <span className="text-muted-foreground">{p.strategyId}</span>
                                </span>
                                <span className={cn("font-mono tabular-nums", p.unrealizedPnL < 0 ? "text-rose-400" : "text-emerald-400")}>
                                    {fmtMoney(p.unrealizedPnL, data.baseCurrency, 0)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Panel>

            {/* Chart actions */}
            <Panel title="Portfolio actions" id="actions" isExpanded={isSectionOpen} onToggle={toggleSection}>
                <div className="flex flex-wrap gap-1">
                    {actions.map((a) => (
                        <button
                            key={a.label}
                            type="button"
                            onClick={() => {
                                if (a.run) a.run();
                                else if (a.toggle) toggleSection(a.toggle);
                            }}
                            className="rounded border border-border px-1.5 py-1 text-micro text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        >
                            {a.label}
                        </button>
                    ))}
                    {onOpenPortfolioAnalysis ? (
                        <button
                            type="button"
                            onClick={onOpenPortfolioAnalysis}
                            className="rounded border border-primary/40 px-1.5 py-1 text-micro text-primary transition hover:bg-primary/10"
                        >
                            Open portfolio analysis
                        </button>
                    ) : null}
                </div>
                {precheck.loading ? (
                    <p className="mt-1.5 flex items-center gap-1 text-micro text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" /> Running portfolio impact check…
                    </p>
                ) : precheck.data?.precheck ? (
                    <div className="mt-1.5 rounded border border-border bg-background p-2">
                        <div className="flex items-center gap-1.5">
                            <span
                                className={cn(
                                    "rounded border px-1.5 py-0.5 text-micro font-bold tracking-wide",
                                    precheck.data.precheck.verdict === "TRADE_ACCEPTABLE"
                                        ? "border-emerald-500/40 text-emerald-400"
                                        : precheck.data.precheck.verdict === "TRADE_BLOCKED"
                                          ? "border-rose-500/40 text-rose-400"
                                          : "border-amber-500/40 text-amber-400"
                                )}
                            >
                                {precheck.data.precheck.verdict}
                            </span>
                            <span className="text-micro text-muted-foreground">
                                trade risk {precheck.data.precheck.individualTradeRisk} · portfolio impact{" "}
                                {precheck.data.precheck.portfolioImpact}
                            </span>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                            {precheck.data.precheck.reasons.slice(0, 4).map((r, i) => (
                                <li key={i} className="text-micro leading-4 text-muted-foreground">
                                    • {r}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </Panel>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums text-foreground">{value}</dd>
        </div>
    );
}

export default PortfolioTerminalPanel;
