"use client";

/**
 * Mobile Market Context (Phase 16 §52).
 *
 * The simplified cross-asset screen for small screens: selected market,
 * current regime, top relationships, correlation changes, portfolio impact
 * and a link to alerts. The full interactive graph stays on desktop — mobile
 * gets a Relationship List, not a squeezed canvas.
 *
 * Data comes from the canonical `/api/cross-asset/[symbol]` endpoint (same
 * engine, same evidence); nothing is recomputed on the client.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { Activity, AlertCircle, ChevronRight, Loader2, RefreshCw, Network } from "lucide-react";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { MobileErrorBoundary } from "@/components/mobile/MobileErrorBoundary";

interface ContextResponse {
    success: boolean;
    tier: string;
    context: {
        symbol: string;
        calculatedAt: number;
        dataTimestamp: number;
        window: { timeframe: string; bars: number };
        relationships: Array<{
            symbol: string;
            coefficient: number | null;
            stability: string;
            term: string;
            sampleSize: number;
            dataQuality: string;
            changed: boolean;
        }>;
        regime: { activeStates: string[]; states: Record<string, string> } | null;
        signals: Array<{ id: string; type: string; status: string; summary: string }>;
        portfolioImpact: {
            status: string;
            relatedExposureWeight: number;
            correlatedHoldings: string[];
            warnings: Array<{ text: string }>;
        } | null;
        narrative: Array<{ kind: string; text: string }>;
        limitations: string[];
    };
}

const MOBILE_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "SPX500", "NAS100", "BTCUSD", "ETHUSD"];

export default function MobileMarketContextPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [symbol, setSymbol] = useState("XAUUSD");
    const [data, setData] = useState<ContextResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthReady(true);
        });
        return () => unsub();
    }, []);

    const load = useCallback(async () => {
        if (!authReady || !user) return;
        setLoading(true);
        setError(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/cross-asset/${encodeURIComponent(symbol)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = (await res.json()) as ContextResponse & { error?: string; detail?: string };
            if (!res.ok || !body.success) throw new Error(body.detail ?? body.error ?? `Failed (${res.status})`);
            setData(body);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Market context unavailable.");
        } finally {
            setLoading(false);
        }
    }, [authReady, user, symbol]);

    useEffect(() => {
        // Deferred so no setState runs synchronously inside the effect body.
        void Promise.resolve().then(() => load());
    }, [load]);

    const ctx = data?.context;

    return (
        <MobileErrorBoundary>
            <div className="space-y-3 px-4 py-4">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-base font-semibold">
                            <Network className="size-4 text-primary" />
                            Market Context
                        </h1>
                        <p className="text-[11px] text-muted-foreground">Cross-asset intelligence for {symbol}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void load()}
                        className="rounded-md border border-border p-2 text-muted-foreground"
                        aria-label="Refresh market context"
                    >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    </button>
                </header>

                {/* symbol picker */}
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {MOBILE_SYMBOLS.map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSymbol(s)}
                            className={cn(
                                "whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11px]",
                                symbol === s
                                    ? "border-primary bg-primary/15 text-primary"
                                    : "border-border text-muted-foreground"
                            )}
                        >
                            {s}
                        </button>
                    ))}
                </div>

                {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                ) : null}

                {!authReady || (loading && !ctx) ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                ) : null}

                {ctx ? (
                    <>
                        {/* regime */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Current regime
                            </h2>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {(ctx.regime?.activeStates ?? ["UNKNOWN"]).map((state) => (
                                    <span
                                        key={state}
                                        className={cn(
                                            "rounded px-2 py-0.5 text-[10px] font-semibold",
                                            state === "RISK_OFF" || state === "HIGH_VOLATILITY"
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
                            {ctx.regime ? (
                                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                                    {Object.entries(ctx.regime.states)
                                        .map(([axis, state]) => `${axis}: ${state}`)
                                        .join(" · ")}
                                </p>
                            ) : null}
                        </section>

                        {/* relationships */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Top relationships
                            </h2>
                            {ctx.relationships.length === 0 ? (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    No relationship for {symbol} passed the label threshold this window.
                                </p>
                            ) : (
                                <ul className="mt-1.5 divide-y divide-border/60">
                                    {ctx.relationships.map((r) => (
                                        <li key={r.symbol} className="flex items-center justify-between gap-2 py-1.5">
                                            <span className="font-mono text-xs text-foreground">{r.symbol}</span>
                                            <span className="flex items-center gap-2">
                                                <span
                                                    className={cn(
                                                        "font-mono text-xs",
                                                        (r.coefficient ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                                                    )}
                                                >
                                                    {r.coefficient === null ? "n/a" : r.coefficient.toFixed(2)}
                                                </span>
                                                <span
                                                    className={cn(
                                                        "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                                                        r.stability === "BREAKING" || r.stability === "FLIPPING"
                                                            ? "bg-rose-500/20 text-rose-300"
                                                            : r.stability === "WEAKENING"
                                                              ? "bg-amber-500/20 text-amber-300"
                                                              : "bg-zinc-500/20 text-zinc-300"
                                                    )}
                                                >
                                                    {r.stability}
                                                    {r.changed ? " · changed" : ""}
                                                </span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="mt-1 text-[10px] text-muted-foreground">
                                window {ctx.window.bars} {ctx.window.timeframe} · measured association, not a signal
                            </p>
                        </section>

                        {/* correlation changes */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Correlation changes
                            </h2>
                            {ctx.signals.length === 0 ? (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    No active relationship changes detected in this window.
                                </p>
                            ) : (
                                <ul className="mt-1.5 space-y-1.5">
                                    {ctx.signals.slice(0, 5).map((s) => (
                                        <li key={s.id} className="text-[11px] leading-4 text-muted-foreground">
                                            <span className="font-mono text-[10px] text-foreground">
                                                {s.type.replace(/_/g, " ")} [{s.status}]
                                            </span>{" "}
                                            {s.summary}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {/* portfolio impact */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Portfolio impact
                            </h2>
                            {ctx.portfolioImpact === null || ctx.portfolioImpact.status === "NO_HOLDINGS" ? (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    No open holdings — impact not applicable.
                                </p>
                            ) : (
                                <div className="mt-1.5 space-y-1">
                                    <p className="font-mono text-sm text-foreground">
                                        {(ctx.portfolioImpact.relatedExposureWeight * 100).toFixed(1)}% of gross exposure
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                        Correlated holdings:{" "}
                                        {ctx.portfolioImpact.correlatedHoldings.join(", ") || "none"}
                                    </p>
                                    {ctx.portfolioImpact.warnings.map((w) => (
                                        <p key={w.text} className="text-[11px] text-amber-300/90">
                                            {w.text}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* narrative (§30) */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Evidence summary
                            </h2>
                            <ul className="mt-1.5 space-y-1.5">
                                {ctx.narrative.map((n) => (
                                    <li key={n.text.slice(0, 40)} className="text-[11px] leading-4 text-muted-foreground">
                                        <span
                                            className={cn(
                                                "mr-1 rounded px-1 py-0.5 font-mono text-[9px]",
                                                n.kind === "OBSERVED" && "bg-emerald-500/15 text-emerald-300",
                                                n.kind === "CALCULATED" && "bg-sky-500/15 text-sky-300",
                                                n.kind === "INFERENCE" && "bg-violet-500/15 text-violet-300",
                                                n.kind === "RECOMMENDATION" && "bg-rose-500/15 text-rose-300"
                                            )}
                                        >
                                            {n.kind}
                                        </span>
                                        {n.text}
                                    </li>
                                ))}
                            </ul>
                        </section>

                        {/* actions */}
                        <div className="flex flex-col gap-2">
                            <Link
                                href="/mobile/alerts"
                                className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-xs"
                            >
                                <span className="flex items-center gap-2">
                                    <Activity className="size-3.5 text-muted-foreground" />
                                    Manage cross-asset alerts
                                </span>
                                <ChevronRight className="size-3.5 text-muted-foreground" />
                            </Link>
                            <p className="text-[10px] leading-4 text-muted-foreground">
                                Cross-asset context describes measured historical associations — context, not prediction
                                (Phase 16 §57).
                            </p>
                        </div>
                    </>
                ) : null}
            </div>
        </MobileErrorBoundary>
    );
}
