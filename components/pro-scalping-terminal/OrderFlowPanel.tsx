"use client";

/**
 * Order Flow Panel — compact dock for the Pro Scalping Terminal.
 *
 * Shows the honestly-computable order-flow state: session volume profile
 * levels, behavioural events, capability/data-quality summary and the
 * evidence list (facts / interpretations / limitations) the AI consumes.
 * Everything unavailable is rendered as an explicit "unavailable" row with
 * the capability reason — never as a fabricated value.
 */

import { useMemo } from "react";
import { Activity, BarChart3, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UseOrderFlowResult } from "@/hooks/use-order-flow";
import type { GexResult, OrderFlowEvidence } from "@/lib/order-flow/types";

const QUALITY_STYLES: Record<string, string> = {
    HIGH: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    PARTIAL: "border-sky-500/40 bg-sky-500/10 text-sky-400",
    ESTIMATED: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    UNAVAILABLE: "border-border bg-muted/40 text-muted-foreground",
    STALE: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
    INSUFFICIENT_HISTORY: "border-border bg-muted/40 text-muted-foreground",
};

function Row({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" | "muted" }) {
    return (
        <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-micro uppercase tracking-wide text-muted-foreground">{label}</span>
            <span
                className={cn(
                    "font-mono text-micro tabular-nums",
                    tone === "bull" && "text-emerald-400",
                    tone === "bear" && "text-rose-400",
                    (!tone || tone === "muted") && "text-foreground",
                )}
            >
                {value}
            </span>
        </div>
    );
}

function EvidenceList({ title, items }: { title: string; items: OrderFlowEvidence[] }) {
    if (items.length === 0) return null;
    return (
        <div>
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
            <ul className="mt-0.5 space-y-0.5">
                {items.slice(-4).map((e, i) => (
                    <li key={i} className="text-micro leading-4 text-foreground/80">
                        · {e.text}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function fmtStrike(p: number): string {
    return p >= 100 ? p.toFixed(2) : p.toFixed(5);
}

/** Compact real-GEX readout (walls + flip + net) — empty when no chain. */
function GexBlock({ gex, symbol }: { gex: GexResult | null; symbol: string }) {
    if (!gex || gex.dataQuality !== "HIGH") {
        return (
            <div className="mt-2 rounded-md border border-border/60 bg-background/50 p-2">
                <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">GEX</p>
                <p className="mt-1 text-micro leading-4 text-muted-foreground">
                    No options chain for {symbol} — GEX unavailable (crypto via Deribit, US indices/ETFs/equities via CBOE delayed).
                </p>
            </div>
        );
    }
    return (
        <div className="mt-2 rounded-md border border-border/60 bg-background/50 p-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">GEX · real chain</p>
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-micro font-bold text-emerald-400">HIGH</span>
            </div>
            <Row label="Net GEX" value={`${gex.netGex >= 0 ? "+" : ""}${(gex.netGex / 1e9).toFixed(2)}B$/1%`} tone={gex.netGex > 0 ? "bull" : gex.netGex < 0 ? "bear" : "muted"} />
            {gex.callWalls.slice(0, 3).map((w) => (
                <Row key={`cw_${w.strike}`} label="Call wall" value={fmtStrike(w.strike)} tone="bear" />
            ))}
            {gex.putWalls.slice(0, 3).map((w) => (
                <Row key={`pw_${w.strike}`} label="Put wall" value={fmtStrike(w.strike)} tone="bull" />
            ))}
            <Row label="Gamma flip" value={gex.gammaFlip !== null ? fmtStrike(gex.gammaFlip) : "—"} />
        </div>
    );
}

export function OrderFlowPanel({ orderFlow, symbol }: { orderFlow: UseOrderFlowResult; symbol: string }) {
    const ctx = orderFlow.context;
    const unavailable = useMemo(() => {
        if (!ctx) return [] as Array<[string, string]>;
        const out: Array<[string, string]> = [];
        for (const [feature, a] of Object.entries(ctx.featureAvailability)) {
            if (a.quality === "UNAVAILABLE") out.push([feature, a.reason]);
        }
        return out;
    }, [ctx]);

    if (!orderFlow.enabled) {
        return (
            <div className="rounded-lg border border-border bg-card p-3">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                    <Activity className="size-3.5 text-primary" />
                    Order Flow
                </h3>
                <p className="mt-1.5 text-micro text-muted-foreground">Order Flow intelligence is disabled by feature flag.</p>
            </div>
        );
    }

    const vp = ctx?.volumeProfile;
    const delta = ctx?.delta;
    const confl = ctx?.confluence;

    return (
        <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                    <BarChart3 className="size-3.5 text-primary" />
                    Order Flow
                </h3>
                {ctx ? (
                    <span
                        className={cn(
                            "rounded border px-1.5 py-0.5 text-micro font-bold tracking-wider",
                            QUALITY_STYLES[ctx.dataQuality] ?? QUALITY_STYLES.UNAVAILABLE,
                        )}
                        title={`Calculation basis: ${ctx.volumeProfile.method ?? ctx.delta.method ?? "capability-gated"}`}
                    >
                        {ctx.dataQuality}
                    </span>
                ) : null}
            </div>

            {/* Volume profile block */}
            <div className="mt-2 rounded-md border border-border/60 bg-background/50 p-2">
                <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                    Volume profile {vp?.available && vp.kind ? `· ${vp.kind.replace("_", " ")}` : ""}
                </p>
                {vp?.available ? (
                    <div className="mt-1">
                        <Row label="POC" value={vp.poc !== null ? vp.poc.toFixed(vp.poc >= 100 ? 2 : 5) : "—"} />
                        <Row label="VAH" value={vp.vah !== null ? vp.vah.toFixed(vp.vah >= 100 ? 2 : 5) : "—"} />
                        <Row label="VAL" value={vp.val !== null ? vp.val.toFixed(vp.val >= 100 ? 2 : 5) : "—"} />
                        <Row
                            label="Price vs POC"
                            value={vp.priceRelation ? vp.priceRelation.replace(/_/g, " ") : "—"}
                            tone={vp.priceRelation === "above_poc" ? "bull" : vp.priceRelation === "below_poc" ? "bear" : "muted"}
                        />
                        <p className="mt-1 text-micro text-muted-foreground">
                            HVN {vp.hvn.length > 0 ? vp.hvn.map((p) => p.toFixed(p >= 100 ? 1 : 5)).join(" · ") : "—"} · LVN{" "}
                            {vp.lvn.length > 0 ? vp.lvn.map((p) => p.toFixed(p >= 100 ? 1 : 5)).join(" · ") : "—"}
                        </p>
                    </div>
                ) : (
                    <p className="mt-1 text-micro text-muted-foreground">Insufficient bars for a session profile.</p>
                )}
            </div>

            {/* Delta block — true delta when classified trades exist, else the
                clearly-labelled ESTIMATED candle-direction proxy. */}
            <div className="mt-2 rounded-md border border-border/60 bg-background/50 p-2">
                <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Delta</p>
                {delta?.available ? (
                    <div className="mt-1">
                        <Row label="Delta" value={delta.value !== null ? delta.value.toFixed(0) : "—"} tone={delta.value !== null && delta.value > 0 ? "bull" : delta.value !== null && delta.value < 0 ? "bear" : "muted"} />
                        <Row label="Cumulative" value={delta.cumulative !== null ? delta.cumulative.toFixed(0) : "—"} tone={delta.cumulative !== null && delta.cumulative > 0 ? "bull" : delta.cumulative !== null && delta.cumulative < 0 ? "bear" : "muted"} />
                        <p className="mt-1 text-micro text-muted-foreground">True bid/ask delta · {delta.method ?? "aggressor-trades"}</p>
                    </div>
                ) : orderFlow.estimatedDelta ? (
                    <div className="mt-1">
                        <Row label="Delta (est.)" value={orderFlow.estimatedDelta.delta >= 0 ? `+${orderFlow.estimatedDelta.delta.toFixed(0)}` : orderFlow.estimatedDelta.delta.toFixed(0)} tone={orderFlow.estimatedDelta.delta > 0 ? "bull" : orderFlow.estimatedDelta.delta < 0 ? "bear" : "muted"} />
                        <Row label="Cum. (est.)" value={orderFlow.estimatedDelta.cumulativeDelta >= 0 ? `+${orderFlow.estimatedDelta.cumulativeDelta.toFixed(0)}` : orderFlow.estimatedDelta.cumulativeDelta.toFixed(0)} tone={orderFlow.estimatedDelta.cumulativeDelta > 0 ? "bull" : orderFlow.estimatedDelta.cumulativeDelta < 0 ? "bear" : "muted"} />
                        <p className="mt-1 text-micro leading-4 text-amber-400/90">
                            ESTIMATED · {orderFlow.estimatedDelta.method} — candle volume signed by bar direction, not bid/ask delta.
                        </p>
                    </div>
                ) : (
                    <p className="mt-1 text-micro leading-4 text-muted-foreground">
                        True bid/ask delta unavailable — {symbol} feed has no trade-side classification.
                    </p>
                )}
            </div>

            <GexBlock gex={orderFlow.gex} symbol={symbol} />

            {/* Events + confluence */}
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-md border border-border/60 bg-background/50 p-1.5">
                    <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{orderFlow.absorptionEvents.length}</p>
                    <p className="text-micro uppercase tracking-wide text-muted-foreground">Absorption</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/50 p-1.5">
                    <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{orderFlow.exhaustionEvents.length}</p>
                    <p className="text-micro uppercase tracking-wide text-muted-foreground">Exhaustion</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/50 p-1.5">
                    <p
                        className={cn(
                            "font-mono text-sm font-semibold tabular-nums",
                            confl?.direction === "bullish" ? "text-emerald-400" : confl?.direction === "bearish" ? "text-rose-400" : "text-foreground",
                        )}
                    >
                        {confl ? `${confl.score}%` : "—"}
                    </p>
                    <p className="text-micro uppercase tracking-wide text-muted-foreground">
                        {confl ? confl.direction : "Confluence"}
                    </p>
                </div>
            </div>

            {/* Evidence (FACT / INTERPRETATION) + limitations */}
            {ctx ? (
                <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                    <EvidenceList title="Facts" items={ctx.facts} />
                    <EvidenceList title="Interpretations" items={ctx.interpretations} />
                    {ctx.limitations.length > 0 ? (
                        <div>
                            <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                                <TriangleAlert className="size-2.5 text-amber-400" />
                                Limitations
                            </p>
                            <ul className="mt-0.5 space-y-0.5">
                                {ctx.limitations.slice(0, 3).map((l, i) => (
                                    <li key={i} className="text-micro leading-4 text-muted-foreground">
                                        · {l}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* Unavailable capabilities (collapsible-feel compact list) */}
            {unavailable.length > 0 ? (
                <details className="mt-2 border-t border-border/60 pt-2">
                    <summary className="flex cursor-pointer items-center gap-1 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                        <ShieldCheck className="size-2.5" />
                        {unavailable.length} capabilities unavailable
                    </summary>
                    <ul className="mt-1 space-y-1">
                        {unavailable.map(([feature, reason]) => (
                            <li key={feature} className="text-micro leading-4 text-muted-foreground">
                                <span className="font-medium text-foreground/80">{feature.replace(/([A-Z])/g, " $1")}</span> — {reason}
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
        </div>
    );
}
