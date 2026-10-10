"use client";

import { AlertCircle, CheckCircle2, Clock, Layers, Target } from "lucide-react";
import type { SignalAnalyticsSegment } from "../types";

interface AnalyticsViewProps {
    analytics: SignalAnalyticsSegment;
}

export function AnalyticsView({ analytics }: AnalyticsViewProps) {
    return (
        <div className="space-y-6">
            {analytics.lowSampleSizeWarning && (
                <div className="flex items-center gap-2.5 rounded-lg border border-warning/20 bg-warning/10 p-3.5 text-xs text-warning-foreground">
                    <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
                    <span className="font-numeric">
                        Small sample size ({analytics.sampleSize} signals). Metrics will gain statistical significance as more signals accumulate.
                    </span>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Total Signals</span>
                        <Target className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 font-numeric text-3xl font-semibold text-foreground">{analytics.totalSignals}</div>
                    <div className="mt-1 text-xs text-muted-foreground font-numeric">
                        {analytics.wins} W / {analytics.losses} L / {analytics.expired} Expired
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Measured Win Rate</span>
                        <CheckCircle2 className="h-4 w-4 text-positive" />
                    </div>
                    <div className="mt-2 font-numeric text-3xl font-semibold text-positive-foreground">{analytics.winRate}%</div>
                    <div className="mt-1 text-xs text-muted-foreground">Completed trade outcomes</div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Average R:R</span>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 font-numeric text-3xl font-semibold text-foreground">
                        1:{analytics.avgRiskReward}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Risk-to-Reward ratio</div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Avg Trade Duration</span>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 font-numeric text-3xl font-semibold text-foreground">
                        {analytics.avgDurationMinutes}m
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Time from entry to close</div>
                </div>
            </div>

            {/* Target Hit Rates Breakdown */}
            <div className="rounded-lg border border-border bg-card p-6">
                <h3 className="text-sm font-semibold text-foreground mb-4">Target Progression Rates</h3>
                <div className="grid gap-3 sm:grid-cols-5">
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP1</span>
                        <p className="mt-1 font-numeric text-lg font-semibold text-positive-foreground">{analytics.tp1HitRate}%</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP2</span>
                        <p className="mt-1 font-numeric text-lg font-semibold text-positive-foreground">{analytics.tp2HitRate}%</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP3</span>
                        <p className="mt-1 font-numeric text-lg font-semibold text-positive-foreground">{analytics.tp3HitRate}%</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP4</span>
                        <p className="mt-1 font-numeric text-lg font-semibold text-positive-foreground">{analytics.tp4HitRate}%</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP5 / Open Runner</span>
                        <p className="mt-1 font-numeric text-lg font-semibold text-positive-foreground">{analytics.tp5RunnerRate}%</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
