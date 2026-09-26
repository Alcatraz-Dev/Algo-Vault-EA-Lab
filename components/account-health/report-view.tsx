"use client";

/**
 * The account-health verdict, rendered once and used by both surfaces.
 *
 * The self-service page and the admin console show the same numbers, so they
 * render the same components. Anything that differs between the two — the
 * header, the call to action — is passed in as slots, which keeps the parts
 * that must agree (score, verdicts, bars, metrics) in one file where they cannot
 * drift apart.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScoreRing } from "./score-ring";
import { BreakdownBars } from "./breakdown-bars";
import { AccountMetrics } from "./metrics";
import { NoDataPill, StatusPillRow } from "./status-pill";
import type { AccountHealthReport } from "@/lib/account-health/types";

function SectionCard({ title, action, children, className }: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("rounded-2xl border border-border/30 bg-muted/50 p-4", className)}>
            <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
                {action}
            </div>
            {children}
        </div>
    );
}

function relativeTime(ts: number): string {
    if (!ts) return "never";
    const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
}

export function AccountHealthReportView({
    health,
    header,
    footer,
    compact = false,
}: {
    health: AccountHealthReport;
    /** Identity row, shown above the score. */
    header?: ReactNode;
    /** Extra context, shown under the metrics. */
    footer?: ReactNode;
    compact?: boolean;
}) {
    const { metrics, trading } = health;
    // "No resolved sample" is a different statement from "a 0% win rate", and
    // the two are never interchangeable.
    const hasSignalSample = trading.resolvedSignals > 0;

    return (
        <div className="space-y-3">
            {header}

            {!health.hasData && (
                <div className="flex items-start gap-2 rounded-xl border border-border/30 bg-muted/40 px-3 py-2.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <p className="text-[11px] leading-5 text-muted-foreground">
                        No trading account is linked to this user — no broker account, no balance and
                        no open positions. There is no health verdict to report, so no score is shown.
                    </p>
                </div>
            )}

            <div className={cn("grid gap-3", compact ? "lg:grid-cols-1" : "lg:grid-cols-2")}>
                <SectionCard title="Health score">
                    <div className="flex items-center gap-5">
                        <ScoreRing
                            score={health.score}
                            riskLevel={health.riskLevel}
                            hasData={health.hasData}
                            size={compact ? 96 : 116}
                        />
                        <div className="min-w-0 space-y-2">
                            {health.hasData ? (
                                <StatusPillRow
                                    riskLevel={health.riskLevel}
                                    drawdownStatus={health.drawdownStatus}
                                    marginStatus={health.marginStatus}
                                    exposureStatus={health.exposureStatus}
                                />
                            ) : (
                                <NoDataPill />
                            )}
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[10px]">
                                <dt className="text-muted-foreground">Drawdown</dt>
                                <dd className="text-right font-mono tabular-nums text-foreground">
                                    {metrics.drawdown.toFixed(1)}%
                                </dd>
                                <dt className="text-muted-foreground">Max drawdown</dt>
                                <dd className="text-right font-mono tabular-nums text-foreground">
                                    {metrics.maxDrawdown.toFixed(1)}%
                                </dd>
                                <dt className="text-muted-foreground">Margin used</dt>
                                <dd className="text-right font-mono tabular-nums text-foreground">
                                    {metrics.marginUtilization.toFixed(1)}%
                                </dd>
                                <dt className="text-muted-foreground">At risk</dt>
                                <dd className="text-right font-mono tabular-nums text-foreground">
                                    {metrics.positionsAtRisk}/{metrics.totalPositions}
                                </dd>
                            </dl>
                        </div>
                    </div>
                </SectionCard>

                <SectionCard title="Score breakdown">
                    <BreakdownBars breakdown={health.breakdown} hasData={health.hasData} />
                    <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
                        Drawdown, margin, exposure and position count are deductions; open P/L and
                        signal quality are credits. A filled bar is worse unless it is marked{" "}
                        <span className="text-muted-foreground/70">+</span>.
                    </p>
                </SectionCard>
            </div>

            {health.accounts.length > 0 && (
                <SectionCard title={`Broker accounts (${health.accounts.length})`}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead>
                                <tr className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                    <th className="pb-1.5 text-left font-medium">Account</th>
                                    <th className="pb-1.5 text-right font-medium">Balance</th>
                                    <th className="pb-1.5 text-right font-medium">Equity</th>
                                    <th className="pb-1.5 text-right font-medium">Margin</th>
                                    <th className="pb-1.5 text-right font-medium">Positions</th>
                                    <th className="pb-1.5 text-right font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {health.accounts.map((a) => (
                                    <tr key={a.accountId}>
                                        <td className="py-1.5 font-medium text-foreground">
                                            {a.accountId}
                                            <span className="ml-1.5 text-[9px] text-muted-foreground">
                                                {a.currency}
                                            </span>
                                        </td>
                                        <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                                            {a.balance.toFixed(2)}
                                        </td>
                                        <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                                            {a.equity.toFixed(2)}
                                        </td>
                                        <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                                            {a.margin > 0
                                                ? `${a.margin.toFixed(2)} (${a.marginLevel.toFixed(0)}%)`
                                                : "—"}
                                        </td>
                                        <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                                            {a.positions}
                                        </td>
                                        <td className="py-1.5 text-right">
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                <Radio
                                                    size={9}
                                                    className={a.status === "connected" ? "text-emerald-400" : "text-muted-foreground"}
                                                />
                                                {a.status === "connected"
                                                    ? relativeTime(a.lastHeartbeatAt)
                                                    : a.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            )}

            <SectionCard title="Metrics">
                <AccountMetrics metrics={metrics} />
            </SectionCard>

            {health.positions.length > 0 && (
                <SectionCard
                    title={`Open positions (${health.positions.length})`}
                    action={
                        metrics.positionsAtRisk > 0 ? (
                            <span className="rounded-md border border-rose-500/25 bg-rose-500/10 px-1.5 py-[3px] text-[10px] font-medium text-rose-400">
                                {metrics.positionsAtRisk} above 5% risk
                            </span>
                        ) : null
                    }
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead>
                                <tr className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                    <th className="pb-1.5 text-left font-medium">Symbol</th>
                                    <th className="pb-1.5 text-left font-medium">Side</th>
                                    <th className="pb-1.5 text-right font-medium">Size</th>
                                    <th className="pb-1.5 text-right font-medium">P/L</th>
                                    <th className="pb-1.5 text-right font-medium">Risk</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {health.positions.map((p, i) => (
                                    <tr key={`${p.symbol}-${i}`}>
                                        <td className="py-1.5 font-medium text-foreground">{p.symbol}</td>
                                        <td className="py-1.5 uppercase text-muted-foreground">{p.type}</td>
                                        <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                                            {p.volume}
                                        </td>
                                        <td
                                            className={cn(
                                                "py-1.5 text-right font-mono tabular-nums",
                                                p.profit > 0 ? "text-emerald-400" : p.profit < 0 ? "text-rose-400" : "text-muted-foreground",
                                            )}
                                        >
                                            {p.profit > 0 ? "+" : ""}{p.profit.toFixed(2)}
                                        </td>
                                        <td
                                            className={cn(
                                                "py-1.5 text-right font-mono tabular-nums",
                                                p.atRisk ? "text-rose-400" : "text-muted-foreground",
                                            )}
                                        >
                                            {p.risk.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            )}

            <div className="rounded-2xl border border-border/30 bg-muted/50 p-3.5">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted-foreground">
                    {hasSignalSample ? (
                        <>
                            <span>
                                Signal library win rate:{" "}
                                <span className="font-mono text-foreground">{trading.winRate}%</span>
                            </span>
                            <span>
                                Average R:{" "}
                                <span className="font-mono text-foreground">
                                    {trading.averageR ?? "—"}R
                                </span>
                            </span>
                        </>
                    ) : (
                        // The library exists but nothing has closed yet. Saying
                        // "0%" here would read as a 0% win rate and is not one.
                        <span className="text-amber-400/90">
                            No resolved signals yet — {trading.totalSignals} tracked, all still open.
                        </span>
                    )}
                    <span>
                        Signals tracked:{" "}
                        <span className="font-mono text-foreground">{trading.totalSignals}</span>
                    </span>
                    {hasSignalSample && (
                        <span>
                            Resolved:{" "}
                            <span className="font-mono text-foreground">{trading.resolvedSignals}</span>
                        </span>
                    )}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground/80">
                    Win rate and average R describe the platform-wide signal library, not this
                    account&apos;s own execution. It is weighted as a quality signal, and it earns no
                    credit until a signal actually resolves.
                </p>
            </div>

            {footer}
        </div>
    );
}
