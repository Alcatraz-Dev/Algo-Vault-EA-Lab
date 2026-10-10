"use client";

/**
 * Cross-Asset Context panel (Phase 16 §20).
 *
 * When a symbol is selected in the Pro Terminal, this panel shows only the
 * instruments with meaningful current relationships — never an arbitrary
 * symbol dump. Every number comes from the canonical relationship engine via
 * `/api/cross-asset/[symbol]`; the panel degrades honestly (loading / error /
 * empty-by-design / free-tier) instead of drawing fake cards.
 */

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Network, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface SymbolContextResponse {
    success: boolean;
    tier: string;
    context: {
        symbol: string;
        dataTimestamp: number;
        window: { timeframe: string; bars: number };
        relationships: Array<{
            symbol: string;
            coefficient: number | null;
            stability: string;
            changed: boolean;
            sampleSize: number;
            dataQuality: string;
        }>;
        regime: { activeStates: string[] } | null;
        portfolioImpact: {
            status: string;
            relatedExposureWeight: number;
            warnings: Array<{ text: string }>;
        } | null;
        limitations: string[];
    };
}

/** Poll cadence — the graph is engine-cached for 5 minutes server-side. */
const REFRESH_MS = 90_000;

export const CrossAssetPanel = memo(function CrossAssetPanel({
    symbol,
    token,
}: {
    symbol: string;
    token: string | null;
}) {
    const [data, setData] = useState<SymbolContextResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/cross-asset/${encodeURIComponent(symbol)}?timeframe=H1&bars=100`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = (await res.json()) as SymbolContextResponse & { detail?: string };
            if (!res.ok || !body.success) throw new Error(body.detail ?? `Unavailable (${res.status})`);
            setData(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Cross-asset context unavailable.");
        } finally {
            setLoading(false);
        }
    }, [symbol, token]);

    useEffect(() => {
        setData(null);
        void load();
        const timer = setInterval(() => void load(), REFRESH_MS);
        return () => clearInterval(timer);
    }, [load]);

    const ctx = data?.context;

    return (
        <section className="rounded-lg border border-border bg-card p-3" data-phase="16-cross-asset">
            <header className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                    <Network className="size-3.5 text-sky-400" />
                    Cross-Asset Context
                </h3>
                <Link href="/cross-asset" className="text-micro text-primary hover:underline">
                    Explorer →
                </Link>
            </header>

            {loading && !ctx ? (
                <div className="flex items-center gap-2 py-3 text-micro text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Measuring relationships…
                </div>
            ) : null}

            {error ? (
                <p className="mt-2 flex items-start gap-1.5 text-micro text-amber-300/90">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    {error}
                </p>
            ) : null}

            {ctx ? (
                <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1">
                        {(ctx.regime?.activeStates ?? []).slice(0, 4).map((state) => (
                            <span
                                key={state}
                                className={cn(
                                    "rounded px-1.5 py-0.5 text-micro font-semibold",
                                    state === "RISK_OFF" || state === "HIGH_VOLATILITY"
                                        ? "bg-rose-500/20 text-rose-300"
                                        : state === "RISK_ON" || state === "LOW_VOLATILITY"
                                          ? "bg-emerald-500/20 text-emerald-300"
                                          : "bg-sky-500/20 text-sky-300"
                                )}
                            >
                                {state.replace(/_/g, " ")}
                            </span>
                        ))}
                        {!ctx.regime || ctx.regime.activeStates.length === 0 ? (
                            <span className="rounded bg-zinc-500/20 px-1.5 py-0.5 text-micro font-semibold text-zinc-300">
                                REGIME UNKNOWN
                            </span>
                        ) : null}
                    </div>

                    {ctx.relationships.length === 0 ? (
                        <p className="text-micro leading-4 text-muted-foreground">
                            No instrument currently has a meaningful (|ρ| ≥ 0.3) relationship with {ctx.symbol} in this
                            window — the list is empty by design.
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {ctx.relationships.slice(0, 7).map((r) => (
                                <li key={r.symbol} className="flex items-center justify-between gap-2 text-micro">
                                    <span className="font-mono text-foreground">{r.symbol}</span>
                                    <span className="flex items-center gap-1.5">
                                        <span
                                            className={cn(
                                                "font-mono",
                                                (r.coefficient ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                                            )}
                                        >
                                            {r.coefficient === null ? "n/a" : r.coefficient.toFixed(2)}
                                        </span>
                                        <span
                                            className={cn(
                                                "rounded px-1 py-0.5 text-[8px] font-semibold",
                                                r.stability === "BREAKING" || r.stability === "FLIPPING"
                                                    ? "bg-rose-500/20 text-rose-300"
                                                    : r.stability === "WEAKENING"
                                                      ? "bg-amber-500/20 text-amber-300"
                                                      : r.stability === "STRENGTHENING"
                                                        ? "bg-sky-500/20 text-sky-300"
                                                        : "bg-zinc-500/20 text-zinc-300"
                                            )}
                                        >
                                            {r.stability.replace("_", " ")}
                                        </span>
                                        {r.changed ? <span className="text-[8px] text-amber-300">Δ</span> : null}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {ctx.portfolioImpact && ctx.portfolioImpact.status === "AVAILABLE" ? (
                        <p className="text-micro leading-4 text-muted-foreground">
                            Portfolio: {(ctx.portfolioImpact.relatedExposureWeight * 100).toFixed(1)}% of gross exposure
                            sits in correlated positions.
                            {ctx.portfolioImpact.warnings[0]?.text ? (
                                <span className="text-amber-300/90"> {ctx.portfolioImpact.warnings[0].text}</span>
                            ) : null}
                        </p>
                    ) : null}

                    <p className="font-mono text-micro text-muted-foreground/80">
                        window {ctx.window.bars} {ctx.window.timeframe} · data{" "}
                        {ctx.dataTimestamp ? new Date(ctx.dataTimestamp).toISOString().slice(11, 16) : "—"} UTC ·
                        association, not prediction
                    </p>
                </div>
            ) : null}
        </section>
    );
});
