"use client";

import { AlertCircle, BarChart3, CheckCircle2, Clock, Layers, Target } from "lucide-react";
import type { SignalAnalyticsSegment } from "../types";

interface AnalyticsViewProps {
    analytics: SignalAnalyticsSegment;
}

export function AnalyticsView({ analytics }: AnalyticsViewProps) {
    return (
        <div className="space-y-6">
            {analytics.lowSampleSizeWarning && (
                <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>
                        Small sample size ({analytics.sampleSize} signals). Metrics will gain statistical significance as more signals accumulate.
                    </span>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-border/30 bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Total Signals</span>
                        <Target className="h-4 w-4 text-amber-400" />
                    </div>
                    <div className="mt-2 text-3xl font-black text-foreground">{analytics.totalSignals}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                        {analytics.wins} W / {analytics.losses} L / {analytics.expired} Expired
                    </div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Measured Win Rate</span>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="mt-2 text-3xl font-black text-emerald-400">{analytics.winRate}%</div>
                    <div className="mt-1 text-xs text-muted-foreground">Completed trade outcomes</div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Average R:R</span>
                        <Layers className="h-4 w-4 text-blue-400" />
                    </div>
                    <div className="mt-2 text-3xl font-black text-foreground">
                        1:{analytics.avgRiskReward}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Risk-to-Reward ratio</div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-card p-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Avg Trade Duration</span>
                        <Clock className="h-4 w-4 text-purple-400" />
                    </div>
                    <div className="mt-2 text-3xl font-black text-foreground">
                        {analytics.avgDurationMinutes}m
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Time from entry to close</div>
                </div>
            </div>

            {/* Target Hit Rates Breakdown */}
            <div className="rounded-2xl border border-border/30 bg-card p-6">
                <h3 className="text-sm font-bold text-foreground mb-4">Target Progression Rates</h3>
                <div className="grid gap-3 sm:grid-cols-5">
                    <div className="rounded-xl border border-border/20 bg-muted/5 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP1</span>
                        <p className="mt-1 text-lg font-bold text-emerald-400">{analytics.tp1HitRate}%</p>
                    </div>
                    <div className="rounded-xl border border-border/20 bg-muted/5 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP2</span>
                        <p className="mt-1 text-lg font-bold text-emerald-400">{analytics.tp2HitRate}%</p>
                    </div>
                    <div className="rounded-xl border border-border/20 bg-muted/5 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP3</span>
                        <p className="mt-1 text-lg font-bold text-emerald-400">{analytics.tp3HitRate}%</p>
                    </div>
                    <div className="rounded-xl border border-border/20 bg-muted/5 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP4</span>
                        <p className="mt-1 text-lg font-bold text-emerald-400">{analytics.tp4HitRate}%</p>
                    </div>
                    <div className="rounded-xl border border-border/20 bg-muted/5 p-3 text-center">
                        <span className="text-xs text-muted-foreground">TP5 / Open Runner</span>
                        <p className="mt-1 text-lg font-bold text-emerald-400">{analytics.tp5RunnerRate}%</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
