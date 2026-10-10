"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Research Evidence Panel — read-only integration for the Scalping Terminal.
//
// "Research Similar Strategies" queries Strategy Memory / the Research Engine
// (GET /api/strategy-research/survivors) for the CURRENT symbol and renders
// historical research evidence. It NEVER reads or writes live signals, never
// changes signal generation, and offers no execution controls.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useState } from "react";
import Link from "next/link";
import { FlaskConical, Search } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";

interface SurvivorRow {
    candidateId: string;
    missionId: string;
    missionName: string;
    strategyId: string | null;
    name: string;
    market: string;
    timeframe: string | null;
    direction: string;
    concepts: string[];
    lifecycle: string;
    score: { total: number; verdict: string } | null;
    backtest: { totalTrades: number; winRate: number; profitFactor: number; maxDrawdownPct: number } | null;
    outOfSample: { verdict: string; degradation: number } | null;
    warnings: number;
}

export default function ResearchEvidencePanel({ symbol }: { symbol: string }) {
    // State is keyed by symbol so a symbol change invalidates stale results at
    // render time — no reset effect (react-hooks/set-state-in-effect).
    const [state, setState] = useState<{ symbol: string; rows: SurvivorRow[] | null; error: string | null; loading: boolean }>({
        symbol,
        rows: null,
        error: null,
        loading: false,
    });

    const search = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
                setState({ symbol, rows: [], error: "Sign in to view research evidence.", loading: false });
                return;
            }
            const res = await fetch(
                `/api/strategy-research/survivors?symbol=${encodeURIComponent(symbol)}&limit=10`,
                { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
            );
            const body = (await res.json()) as { survivors?: SurvivorRow[]; error?: string };
            if (!res.ok) throw new Error(body.error ?? "Lookup failed");
            setState({ symbol, rows: body.survivors ?? [], error: null, loading: false });
        } catch (err) {
            setState({ symbol, rows: [], error: err instanceof Error ? err.message : "Lookup failed", loading: false });
        }
    }, [symbol]);

    const current = state.symbol === symbol ? state : { symbol, rows: null, error: null, loading: false };
    const rows = current.rows;
    const error = current.error;
    const loading = current.loading;

    return (
        <div className="rounded-lg border bg-card p-5">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <FlaskConical className="h-4 w-4 text-muted-foreground" /> Research Similar Strategies
                </h2>
                <button
                    type="button"
                    onClick={search}
                    disabled={loading}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                    <Search className="h-3 w-3" /> {loading ? "Searching…" : "Search"}
                </button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
                Historical research evidence for <span className="font-medium text-foreground">{symbol}</span> from the
                Strategy Research Engine — read-only; live signals are untouched.
            </p>

            {error ? <p className="text-xs text-negative">{error}</p> : null}

            {rows && rows.length === 0 && !error ? (
                <p className="text-xs text-muted-foreground">
                    No research survivors recorded for {symbol} yet.{" "}
                    <Link href="/strategy-research" className="text-primary hover:underline">
                        Run a research mission →
                    </Link>
                </p>
            ) : null}

            {rows && rows.length > 0 ? (
                <ul className="space-y-1.5">
                    {rows.map((r) => (
                        <li key={r.candidateId} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium">{r.name}</span>
                                <Badge variant="outline">{r.lifecycle}</Badge>
                            </div>
                            <div className="mt-0.5 text-micro text-muted-foreground">
                                {r.timeframe ?? "—"} · {r.direction} · {r.concepts.slice(0, 4).join(", ")}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-micro text-muted-foreground">
                                {r.backtest ? (
                                    <span>
                                        {r.backtest.totalTrades}T · PF {r.backtest.profitFactor.toFixed(2)} · DD {r.backtest.maxDrawdownPct.toFixed(1)}%
                                    </span>
                                ) : null}
                                {r.outOfSample ? <span>OOS {r.outOfSample.verdict}</span> : null}
                                {r.score ? <span>score {r.score.total}</span> : null}
                                {r.warnings > 0 ? <span className="text-warning">{r.warnings} warnings</span> : null}
                            </div>
                            <Link
                                href={`/strategy-research/${r.missionId}/${r.candidateId}`}
                                className="mt-0.5 inline-block text-micro text-primary hover:underline"
                            >
                                Open lineage →
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
