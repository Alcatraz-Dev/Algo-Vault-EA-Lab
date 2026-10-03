"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Eraser, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { teamsApi, TeamsApiError } from "./api";
import type { TeamMemoryRecord } from "@/lib/ai-trading-teams/types";

/**
 * Team memory view (spec §17): structured records only — preferences,
 * validated/rejected setups, research notes and agent performance metadata.
 * Raw conversations are never stored.
 */
export function TeamMemoryView({ teamId, canRun }: { teamId: string; canRun: boolean }) {
    const [memory, setMemory] = useState<TeamMemoryRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notes, setNotes] = useState("");
    const [strategyPrefs, setStrategyPrefs] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [cleared, setCleared] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const loadMemory = async () => {
            try {
                const data = await teamsApi<{ memory: TeamMemoryRecord }>(`/${teamId}/memory`);
                if (cancelled) return;
                setMemory(data.memory);
                setNotes(data.memory.notes ?? "");
                setStrategyPrefs((data.memory.strategyPreferences ?? []).join(", "));
                setError(null);
            } catch (err) {
                if (!cancelled) setError(err instanceof TeamsApiError ? err.message : "Failed to load memory.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void loadMemory();
        return () => {
            cancelled = true;
        };
    }, [teamId]);

    const save = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            const data = await teamsApi<{ memory: TeamMemoryRecord }>(`/${teamId}/memory`, {
                method: "PUT",
                body: {
                    notes,
                    strategyPreferences: strategyPrefs.split(",").map((s) => s.trim()).filter(Boolean),
                },
            });
            setMemory(data.memory);
        } catch (err) {
            setError(err instanceof TeamsApiError ? err.message : "Failed to save memory.");
        } finally {
            setSaving(false);
        }
    }, [teamId, notes, strategyPrefs]);

    const clear = useCallback(async () => {
        setSaving(true);
        try {
            await teamsApi(`/${teamId}/memory`, { method: "DELETE" });
            setMemory(null);
            setNotes("");
            setStrategyPrefs("");
            setCleared(true);
        } catch (err) {
            setError(err instanceof TeamsApiError ? err.message : "Failed to clear memory.");
        } finally {
            setSaving(false);
        }
    }, [teamId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <SectionHeader
                title="Team memory"
                description="Structured, durable records — never raw conversations"
                icon={<Brain className="size-4" />}
                action={
                    canRun ? (
                        <div className="flex items-center gap-2">
                            <Button size="xs" variant="outline" onClick={() => void clear()} disabled={saving}>
                                <Eraser className="size-3.5" /> Clear memory
                            </Button>
                            <Button size="xs" onClick={() => void save()} disabled={saving}>
                                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                                Save preferences
                            </Button>
                        </div>
                    ) : undefined
                }
            />

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {cleared ? <p className="text-xs text-muted-foreground">Memory cleared for this team.</p> : null}

            {!memory || (memory.previousResearch.length === 0 && memory.validatedSetups.length === 0 && memory.rejectedSetups.length === 0) ? (
                <EmptyState
                    compact
                    icon={<Brain className="size-4" />}
                    title="No memory yet"
                    description="Memory accumulates automatically from completed runs: validated/rejected setups, research notes and agent performance metadata."
                />
            ) : (
                <div className="grid gap-3 md:grid-cols-3">
                    <MemoryList
                        title="Validated setups"
                        items={memory.validatedSetups.map((s) => ({ id: s.id, label: `${s.market} · ${new Date(s.at).toLocaleDateString()}`, note: s.note }))}
                        tone="positive"
                    />
                    <MemoryList
                        title="Rejected setups"
                        items={memory.rejectedSetups.map((s) => ({ id: s.id, label: `${s.market} · ${new Date(s.at).toLocaleDateString()}`, note: s.note }))}
                        tone="negative"
                    />
                    <MemoryList
                        title="Research notes"
                        items={memory.previousResearch.map((r) => ({ id: r.id, label: r.title, note: r.summary }))}
                        tone="neutral"
                    />
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Preferences</p>
                    <label className="mt-2 block">
                        <span className="mb-1 block text-[11px] text-muted-foreground">Strategy preferences (comma separated)</span>
                        <input
                            value={strategyPrefs}
                            onChange={(e) => setStrategyPrefs(e.target.value)}
                            disabled={!canRun}
                            className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring disabled:opacity-60"
                        />
                    </label>
                    <label className="mt-3 block">
                        <span className="mb-1 block text-[11px] text-muted-foreground">Team notes</span>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={4}
                            disabled={!canRun}
                            placeholder="Preferences the Chief Analyst should account for…"
                            className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-ring disabled:opacity-60"
                        />
                    </label>
                </div>

                <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Agent performance metadata</p>
                    {memory && Object.keys(memory.agentPerformance).length > 0 ? (
                        <ul className="mt-2 space-y-1.5">
                            {Object.entries(memory.agentPerformance).map(([agentId, perf]) => (
                                <li key={agentId} className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="truncate text-foreground/85">{agentId}</span>
                                    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
                                        <Badge variant="outline" className="text-[9px]">{perf.runs} runs</Badge>
                                        <Badge variant="outline" className="text-[9px]">{perf.completed} ok</Badge>
                                        <Badge variant="outline" className="text-[9px]">{perf.failed} failed</Badge>
                                        {Math.round(perf.avgConfidence * 100)}%
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-2 text-xs text-muted-foreground">No performance data yet.</p>
                    )}
                    <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                        Preferred markets: {memory?.preferredMarkets.join(", ") || "—"}
                        <br />
                        Preferred timeframes: {memory?.preferredTimeframes.join(", ") || "—"}
                    </p>
                </div>
            </div>
        </div>
    );
}

function MemoryList({
    title,
    items,
    tone,
}: {
    title: string;
    items: { id: string; label: string; note: string }[];
    tone: "positive" | "negative" | "neutral";
}) {
    const toneClass =
        tone === "positive" ? "border-positive/40" : tone === "negative" ? "border-destructive/40" : "border-border/60";
    return (
        <div className={`rounded-xl border ${toneClass} bg-card/60 p-3`}>
            <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {title} ({items.length})
            </p>
            <ul className="mt-2 space-y-1.5">
                {items.slice(0, 6).map((item) => (
                    <li key={item.id} className="rounded border border-border/50 bg-background/40 px-2 py-1.5">
                        <p className="text-[11px] font-medium text-foreground/85">{item.label}</p>
                        <p className="line-clamp-2 text-[10px] text-muted-foreground">{item.note}</p>
                    </li>
                ))}
                {items.length === 0 ? <li className="text-[11px] text-muted-foreground">None recorded.</li> : null}
            </ul>
        </div>
    );
}
