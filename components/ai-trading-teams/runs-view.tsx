"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, FileSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SynthesisBrief, AgentEvidenceCard, ConsensusBar } from "./evidence-panel";
import { TeamTimeline } from "./timeline";
import { teamsApi } from "./api";
import type { TeamRun, TeamRunSummary } from "@/lib/ai-trading-teams/types";

/**
 * TeamRunsView — historical run records (spec §32). Opening a run preserves
 * the ORIGINAL data timestamp, mode label and agent versions used at
 * execution time; historical runs are never rewritten.
 */
export function TeamRunsView({ onOpenRun }: { onOpenRun?: (run: TeamRun) => void }) {
    const [runs, setRuns] = useState<TeamRunSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<TeamRun | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const fetchRuns = async () => {
            try {
                const data = await teamsApi<{ runs: TeamRunSummary[] }>("/runs");
                if (!cancelled) {
                    setRuns(data.runs ?? []);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load runs.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void fetchRuns();
        return () => {
            cancelled = true;
        };
    }, []);

    const openRun = useCallback(
        async (runId: string) => {
            setLoadingDetail(true);
            try {
                const data = await teamsApi<{ run: TeamRun }>(`/runs/${runId}`);
                setDetail(data.run);
                onOpenRun?.(data.run);
            } catch {
                setError("Failed to load the run.");
            } finally {
                setLoadingDetail(false);
            }
        },
        [onOpenRun],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> <span className="ml-2 text-xs">Loading runs…</span>
            </div>
        );
    }

    return (
    <div className="space-y-3">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {runs.length === 0 ? (
            <EmptyState
                icon={<FileSearch className="size-5" />}
                title="No team runs yet"
                description="Run an analysis from a team workspace — every run is persisted with its configuration, agent versions and data timestamp."
            />
        ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="bg-muted/40 text-micro tracking-wide text-muted-foreground uppercase">
                        <tr>
                            <th className="px-3 py-2">Timestamp</th>
                            <th className="px-3 py-2">Market</th>
                            <th className="px-3 py-2">Team</th>
                            <th className="px-3 py-2">Mode</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Setup state</th>
                            <th className="px-3 py-2">Duration</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map((run) => (
                            <tr key={String(run.id)} className="border-t border-border/50 hover:bg-muted/30">
                                <td className="px-3 py-2 tabular-nums text-foreground/85">
                                    {new Date(run.startedAt ?? 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2">{run.market}</td>
                                <td className="max-w-[180px] truncate px-3 py-2">{run.teamName}</td>
                                <td className="px-3 py-2">
                                    <Badge variant="outline" className={run.dataMode === "live" ? "border-positive/50 text-positive" : "border-warning/50 text-warning"}>
                                        {(run.dataMode ?? "live").toUpperCase()}
                                    </Badge>
                                </td>
                                <td className="px-3 py-2">
                                    <StatusBadge
                                        tone={
                                            run.status === "completed"
                                                ? "positive"
                                                : run.status === "failed"
                                                    ? "error"
                                                    : run.status === "partial"
                                                        ? "warning"
                                                        : "neutral"
                                        }
                                        label={run.status ?? "—"}
                                        dot
                                    />
                                </td>
                                <td className="px-3 py-2">{run.setupState ?? "—"}</td>
                                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                                    {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <Button
                                        variant="outline"
                                        size="xs"
                                        onClick={() => run.id && void openRun(String(run.id))}
                                        disabled={loadingDetail}
                                    >
                                        Open
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}

        <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
                {detail ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <DialogTitle className="text-base">{detail.teamName}</DialogTitle>
                            <StatusBadge
                                tone={detail.status === "completed" ? "positive" : detail.status === "failed" ? "error" : detail.status === "partial" ? "warning" : "neutral"}
                                label={detail.status}
                            />
                            <Badge variant="outline" className={detail.dataMode === "live" ? "border-positive/50 text-positive" : "border-warning/50 text-warning"}>
                                {detail.dataMode === "replay" ? "HISTORICAL REPLAY" : detail.dataMode.toUpperCase()}
                            </Badge>
                            <span className="text-micro text-muted-foreground">
                                run {detail.id} · team v{detail.teamVersion} · started {new Date(detail.startedAt).toLocaleString()}
                            </span>
                        </div>

                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-micro text-muted-foreground">
                            <p className="mb-1 font-semibold tracking-wide text-foreground/70 uppercase">Configuration at execution time</p>
                            <p>
                                {detail.market} · entry {detail.config.entryTimeframe} · confirm {detail.config.confirmationTimeframe} · context{" "}
                                {detail.config.contextTimeframe} · {detail.config.style} · {detail.config.riskProfile} · {detail.config.behavior}
                            </p>
                            <p className="mt-1">
                                Agent versions:{" "}
                                {Object.entries(detail.agentVersions ?? {})
                                    .map(([id, version]) => `${id}@${version}`)
                                    .join(", ") || "—"}
                            </p>
                            {detail.dossierMeta ? (
                                <p className="mt-1">
                                    Data timestamp {detail.dossierMeta.dataTimestamp} · quality {detail.dossierMeta.quality} · candles{" "}
                                    {JSON.stringify(detail.dossierMeta.candleCounts)}
                                </p>
                            ) : null}
                        </div>

                        {detail.consensus ? <ConsensusBar consensus={detail.consensus} /> : null}
                        {detail.synthesis ? <SynthesisBrief synthesis={detail.synthesis} /> : null}

                        <div className="space-y-2">
                            {Object.values(detail.agentOutputs ?? {})
                                .filter((output) => output.agentId !== "chief-analyst")
                                .map((output) => (
                                    <AgentEvidenceCard key={output.agentId} output={output} />
                                ))}
                        </div>

                        <div>
                            <p className="mb-1 flex items-center gap-1.5 text-micro font-semibold tracking-wide text-muted-foreground uppercase">
                                <Clock className="size-3" /> Execution timeline
                            </p>
                            <div className="max-h-52 overflow-y-auto rounded-lg border border-border/60">
                                <TeamTimeline entries={detail.timeline ?? []} />
                            </div>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    </div>
    );
}
