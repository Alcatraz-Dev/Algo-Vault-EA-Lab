"use client";

/**
 * Trade Journal — the user's real logged trades and the analytics derived
 * from them.
 *
 * Data comes from `/api/journal` (Firebase `tradeJournal/{uid}`). Analytics
 * are computed only from what the API returned; with no entries the panel
 * shows an explicit empty state instead of zeros that imply history.
 */

import { memo, useMemo, useState } from "react";
import { Award, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AwaitingState } from "@/components/scalping/TerminalPrimitives";
import {
    computeJournalAnalytics,
    fmtDate,
    type JournalAnalytics,
    type TerminalTrade,
} from "./terminal-utils";

type GroupKey = "setup" | "symbol" | "session";

const GROUP_LABEL: Record<GroupKey, string> = {
    setup: "By setup",
    symbol: "By symbol",
    session: "By session",
};

export const ProTerminalJournal = memo(function ProTerminalJournal({
    trades,
    loading,
    error,
    now,
}: {
    trades: TerminalTrade[];
    loading: boolean;
    error: string | null;
    now: number;
}) {
    const [group, setGroup] = useState<GroupKey>("setup");
    const [expanded, setExpanded] = useState(false);

    const analytics: JournalAnalytics = useMemo(() => computeJournalAnalytics(trades), [trades]);
    const breakdown =
        group === "setup" ? analytics.bySetup : group === "symbol" ? analytics.bySymbol : analytics.bySession;
    const rows = expanded ? trades : trades.slice(0, 6);

    if (error) {
        return (
            <PanelShell
                title="Trade Journal"
                meta={undefined}
            >
                <div className="p-3">
                    <AwaitingState compact reason={error} />
                </div>
            </PanelShell>
        );
    }

    return (
        <PanelShell
            title="Trade Journal"
            meta={
                loading
                    ? "loading…"
                    : analytics.total > 0
                      ? `${analytics.total} trade${analytics.total === 1 ? "" : "s"}`
                      : undefined
            }
        >
            {loading && trades.length === 0 ? (
                <div className="p-3">
                    <AwaitingState compact reason="Loading your journal…" />
                </div>
            ) : trades.length === 0 ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason="No journal entries yet. Trades you log appear here with real analytics computed from them."
                    />
                </div>
            ) : (
                <>
                    {/* Headline stats */}
                    <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3 lg:grid-cols-6">
                        <Stat
                            label="Win rate"
                            value={analytics.winRate !== null ? `${analytics.winRate.toFixed(1)}%` : null}
                            sub={
                                analytics.winRate !== null
                                    ? `${analytics.wins}W / ${analytics.losses}L${analytics.breakeven > 0 ? ` / ${analytics.breakeven}BE` : ""}`
                                    : "no decided trades"
                            }
                        />
                        <Stat
                            label="Net R"
                            value={analytics.netR !== null ? fmtSignedR(analytics.netR) : null}
                            tone={(analytics.netR ?? 0) >= 0 ? "positive" : "negative"}
                        />
                        <Stat
                            label="Avg R"
                            value={analytics.avgR !== null ? fmtSignedR(analytics.avgR) : null}
                            tone={(analytics.avgR ?? 0) >= 0 ? "positive" : "negative"}
                        />
                        <Stat
                            label="Profit factor"
                            value={
                                analytics.profitFactor !== null
                                    ? analytics.profitFactor.toFixed(2)
                                    : analytics.profitFactorUnbounded
                                      ? "∞"
                                      : null
                            }
                            title={
                                analytics.profitFactorUnbounded
                                    ? "No losing R recorded, so the factor is unbounded."
                                    : undefined
                            }
                        />
                        <Stat label="Best / worst" value={
                            analytics.best !== null ? `${fmtSignedR(analytics.best)} / ${fmtSignedR(analytics.worst ?? 0)}` : null
                        } />
                        <Stat
                            label="Current streak"
                            value={analytics.streak ? `${analytics.streak.count} ${analytics.streak.kind}${analytics.streak.count === 1 ? "" : "s"}` : null}
                            tone={analytics.streak?.kind === "win" ? "positive" : analytics.streak?.kind === "loss" ? "negative" : undefined}
                        />
                    </div>

                    {/* Breakdown */}
                    <div className="px-3 pb-2">
                        <div className="mb-1.5 flex items-center gap-1.5">
                            {(Object.keys(GROUP_LABEL) as GroupKey[]).map((g) => (
                                <button
                                    key={g}
                                    type="button"
                                    onClick={() => setGroup(g)}
                                    className={cn(
                                        "rounded border px-1.5 py-0.5 text-[10px] transition",
                                        group === g
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    {GROUP_LABEL[g]}
                                </button>
                            ))}
                        </div>
                        {breakdown.length === 0 ? (
                            <p className="text-xs italic text-muted-foreground">
                                No {group} labels on your trades yet — tag entries to unlock this breakdown.
                            </p>
                        ) : (
                            <div className="min-w-0 overflow-x-auto rounded-md border border-border/70">
                                <table className="w-full border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                                            <th className="px-2 py-1 font-medium">{GROUP_LABEL[group].replace("By ", "")}</th>
                                            <th className="px-2 py-1 text-right font-medium">N</th>
                                            <th className="px-2 py-1 text-right font-medium">Win%</th>
                                            <th className="px-2 py-1 text-right font-medium">Net R</th>
                                            <th className="px-2 py-1 text-right font-medium">Avg R</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {breakdown.map((b) => (
                                            <tr key={b.key} className="border-b border-border/40 last:border-0">
                                                <td className="max-w-[140px] truncate px-2 py-1" title={b.key}>
                                                    {b.key}
                                                </td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums">{b.n}</td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums">
                                                    {b.n > 0 ? `${((b.wins / b.n) * 100).toFixed(0)}%` : "—"}
                                                </td>
                                                <td
                                                    className={cn(
                                                        "px-2 py-1 text-right font-mono tabular-nums",
                                                        b.netR >= 0 ? "text-emerald-400" : "text-rose-400"
                                                    )}
                                                >
                                                    {fmtSignedR(b.netR)}
                                                </td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                                                    {fmtSignedR(b.avgR)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Trade list */}
                    <div className="border-t border-border">
                        <ul className="divide-y divide-border/50">
                            {rows.map((t) => {
                                const age = t.createdAt ? Math.round((now - t.createdAt) / 86400000) : null;
                                return (
                                    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs">
                                        <span className="font-mono font-semibold text-foreground">{t.symbol ?? "—"}</span>
                                        <span
                                            className={cn(
                                                "w-14 shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide",
                                                t.result === "win"
                                                    ? "bg-emerald-500/10 text-emerald-400"
                                                    : t.result === "loss"
                                                      ? "bg-rose-500/10 text-rose-400"
                                                      : t.result === "breakeven"
                                                        ? "bg-muted text-muted-foreground"
                                                        : "border border-border text-muted-foreground"
                                            )}
                                        >
                                            {t.result ?? "open"}
                                        </span>
                                        {t.setup ? (
                                            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={t.setup}>
                                                {t.setup}
                                            </span>
                                        ) : (
                                            <span className="min-w-0 flex-1" />
                                        )}
                                        {t.session ? (
                                            <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
                                                {t.session}
                                            </span>
                                        ) : null}
                                        {t.timeframe ? (
                                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                                {t.timeframe}
                                            </span>
                                        ) : null}
                                        <span
                                            className={cn(
                                                "w-14 shrink-0 text-right font-mono tabular-nums",
                                                t.r === null
                                                    ? "text-muted-foreground"
                                                    : t.r >= 0
                                                      ? "text-emerald-400"
                                                      : "text-rose-400"
                                            )}
                                        >
                                            {t.r !== null ? fmtSignedR(t.r) : "—"}
                                        </span>
                                        <span className="hidden w-24 shrink-0 text-right font-mono text-[10px] text-muted-foreground sm:inline">
                                            {t.createdAt ? (age !== null && age < 1 ? "today" : fmtDate(t.createdAt)) : "—"}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                        {trades.length > 6 ? (
                            <button
                                type="button"
                                onClick={() => setExpanded((v) => !v)}
                                className="flex w-full items-center justify-center gap-1 border-t border-border py-1.5 text-[10px] text-muted-foreground transition hover:text-foreground"
                            >
                                <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
                                {expanded ? "Show less" : `Show all ${trades.length} trades`}
                            </button>
                        ) : null}
                    </div>
                </>
            )}
        </PanelShell>
    );
});

function PanelShell({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
            <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
                <Award className="size-3.5 shrink-0 text-muted-foreground" />
                <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h2>
                {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
            </div>
            {children}
        </section>
    );
}

function Stat({
    label,
    value,
    sub,
    tone,
    title,
}: {
    label: string;
    value: string | null;
    sub?: string;
    tone?: "positive" | "negative";
    title?: string;
}) {
    return (
        <div className="rounded-md border border-border/70 bg-background px-2 py-1.5" title={title}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div
                className={cn(
                    "font-mono text-xs font-semibold tabular-nums",
                    tone === "positive" && "text-emerald-400",
                    tone === "negative" && "text-rose-400",
                    !tone && "text-foreground"
                )}
            >
                {value ?? <span className="italic text-muted-foreground">—</span>}
            </div>
            {sub ? <div className="text-[10px] text-muted-foreground/70">{sub}</div> : null}
        </div>
    );
}

function fmtSignedR(v: number): string {
    return `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
}
