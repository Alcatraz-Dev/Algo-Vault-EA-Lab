"use client";

/**
 * RiskHud — Phase 5 §20.
 *
 * Compact account-risk status driven entirely by the canonical Risk Engine
 * through /api/terminal/risk: daily loss, open risk, exposure and the
 * SAFE → WARNING → RESTRICTED → HALTED ladder. When the engine reports
 * HALTED, the terminal's execution controls lock (see TerminalShell) — the
 * HUD is a read-out, not the enforcement point.
 */

import { ShieldCheck, ShieldAlert, ShieldX, Shield, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalData } from "./TerminalData";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

const STATUS_ICON = {
    SAFE: ShieldCheck,
    WARNING: ShieldAlert,
    RESTRICTED: ShieldX,
    HALTED: ShieldX,
} as const;

const STATUS_STYLE = {
    SAFE: "border-positive/40 bg-positive/10 text-positive",
    WARNING: "border-warning/40 bg-warning/10 text-warning",
    RESTRICTED: "border-warning/40 bg-warning/10 text-warning",
    HALTED: "border-negative/50 bg-negative/10 text-negative",
} as const;

function pct(v: number | null | undefined, digits = 1): string {
    return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;
}

export function RiskHud() {
    const { risk, riskError, riskLoading } = useTerminalData();

    return (
        <section className="rounded-xl border border-border bg-card p-3" aria-label="Risk">
            <PanelErrorBoundary name="Risk" compact>
                <div className="flex items-start justify-between gap-2">
                    <h2 className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-foreground">
                        <Shield className="size-3 text-primary" />
                        Risk
                    </h2>
                    {riskLoading && !risk ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
                </div>

                {riskError ? (
                    <p className="mt-2 text-micro leading-4 text-warning">
                        Risk state unavailable — trading status cannot be verified.
                    </p>
                ) : !risk || !risk.status ? (
                    <p className="mt-2 text-micro leading-4 text-muted-foreground">
                        No connected account — no risk state to report.
                    </p>
                ) : (
                    <>
                        {(() => {
                            const Icon = STATUS_ICON[risk.status] ?? Shield;
                            return (
                                <div
                                    className={cn(
                                        "mt-2 flex items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-bold tracking-wider",
                                        STATUS_STYLE[risk.status] ?? "border-border text-muted-foreground"
                                    )}
                                    role="status"
                                >
                                    <Icon className="size-3.5" />
                                    {risk.status}
                                </div>
                            );
                        })()}

                        <dl className="mt-2 grid grid-cols-2 gap-1.5">
                            <Cell label="Daily loss" value={pct(risk.metrics?.dailyLossPct)} />
                            <Cell label="Drawdown" value={pct(risk.metrics?.drawdownPct)} />
                            <Cell
                                label="Open risk"
                                value={
                                    risk.limits?.riskPercent !== null && risk.limits?.riskPercent !== undefined
                                        ? `${risk.limits.riskPercent}% /trade`
                                        : "—"
                                }
                            />
                            <Cell
                                label="Exposure"
                                value={
                                    risk.metrics?.symbolExposureLots !== null &&
                                    risk.metrics?.symbolExposureLots !== undefined
                                        ? `${risk.metrics.symbolExposureLots} lots`
                                        : "—"
                                }
                            />
                            <Cell
                                label="Available margin"
                                value={
                                    risk.metrics?.availableMargin !== null && risk.metrics?.availableMargin !== undefined
                                        ? risk.metrics.availableMargin.toFixed(2)
                                        : "—"
                                }
                            />
                            <Cell
                                label="Used margin"
                                value={
                                    risk.metrics?.usedMargin !== null && risk.metrics?.usedMargin !== undefined
                                        ? risk.metrics.usedMargin.toFixed(2)
                                        : "—"
                                }
                            />
                        </dl>

                        {risk.reasons.length > 0 ? (
                            <ul className="mt-2 space-y-0.5 border-t border-border pt-1.5">
                                {risk.reasons.map((r) => (
                                    <li key={r} className="text-micro leading-4 text-warning">
                                        • {r}
                                    </li>
                                ))}
                            </ul>
                        ) : null}

                        <p className="mt-2 border-t border-border pt-1.5 text-micro leading-4 text-muted-foreground">
                            Evaluated by the AlgoVault canonical Risk Engine. Limits shown as “—” are not configured on
                            this account, not zero.
                        </p>
                    </>
                )}
            </PanelErrorBoundary>
        </section>
    );
}

function Cell({ label, value }: { label: string; value: string }) {
    const unavailable = value === "—";
    return (
        <div className="rounded-md border border-border/70 bg-background px-2 py-1.5">
            <div className="text-micro uppercase tracking-wide text-muted-foreground">{label}</div>
            <div
                className={cn(
                    "font-mono text-micro font-medium tabular-nums",
                    unavailable ? "italic text-muted-foreground/70" : "text-foreground"
                )}
            >
                {value}
            </div>
        </div>
    );
}
