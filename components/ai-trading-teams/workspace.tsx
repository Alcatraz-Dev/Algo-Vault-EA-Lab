"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    Activity,
    ArrowLeft,
    Ban,
    History,
    Loader2,
    Play,
    Radio,
    Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentCarousel, TeamGraph } from "./team-graph";
import { AgentDetailPanel } from "./agent-detail-panel";
import { AgentEvidenceCard, ConsensusBar, SynthesisBrief } from "./evidence-panel";
import { TeamTimeline } from "./timeline";
import { stateFromRunStatus, stateLabel, AgentStateDot, type AgentVisualState } from "./agent-visual";
import { teamsApi, TeamsApiError } from "./api";
import { subscribeToRun } from "./run-subscription";
import type { AgentRunOutput, AITradingTeam, TeamAgentDefinition, TeamRun, TeamRunSummary } from "@/lib/ai-trading-teams/types";

interface WorkspaceProps {
    team: AITradingTeam;
    agents: TeamAgentDefinition[];
    canRun: boolean;
    isAuthenticated: boolean;
    initialRunId?: string | null;
    onRunChanged?: (runId: string) => void;
}

type DataMode = "live" | "replay" | "backtest" | "research";

const MODE_OPTIONS: { value: DataMode; label: string; hint: string }[] = [
    { value: "live", label: "LIVE", hint: "Current market data" },
    { value: "replay", label: "HISTORICAL REPLAY", hint: "Point-in-time snapshot (requires cutoff)" },
    { value: "backtest", label: "BACKTEST", hint: "Historical window (requires cutoff)" },
    { value: "research", label: "RESEARCH", hint: "Research mode (requires cutoff)" },
];

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "partial"]);

export function TeamWorkspace(props: WorkspaceProps & { uid: string | null }) {
    return <TeamWorkspaceView {...props} />;
}

/** Main workspace body (requires the authenticated uid for realtime reads). */
function TeamWorkspaceView(props: WorkspaceProps & { uid: string | null }) {
    const { team, agents, canRun, uid, initialRunId, onRunChanged } = props;
    const [run, setRun] = useState<TeamRun | null>(null);
    const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
    const [history, setHistory] = useState<TeamRunSummary[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [mode, setMode] = useState<DataMode>("live");
    const [asOf, setAsOf] = useState<string>("");
    const [starting, setStarting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mobileTab, setMobileTab] = useState<"team" | "evidence">("team");
    const unsubRef = useRef<(() => void) | null>(null);

    const loadHistory = useCallback(async () => {
        try {
            const data = await teamsApi<{ runs: TeamRunSummary[] }>(`/${team.id}/run`);
            setHistory(data.runs ?? []);
        } catch {
            setHistory([]);
        }
    }, [team.id]);

    useEffect(() => {
        let cancelled = false;
        const fetchHistory = async () => {
            try {
                const data = await teamsApi<{ runs: TeamRunSummary[] }>(`/${team.id}/run`);
                if (!cancelled) setHistory(data.runs ?? []);
            } catch {
                if (!cancelled) setHistory([]);
            }
        };
        void fetchHistory();
        return () => {
            cancelled = true;
        };
    }, [team.id]);

    useEffect(() => {
        unsubRef.current?.();
        unsubRef.current = null;
        if (!runId || !uid) return;
        const unsub = subscribeToRun(uid, runId, (next) => {
            setRun(next);
            if (next && TERMINAL_STATUSES.has(next.status)) {
                void loadHistory();
            }
        });
        unsubRef.current = unsub;
        return () => {
            unsub();
            unsubRef.current = null;
        };
    }, [runId, uid, loadHistory]);

    const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

    const states: Record<string, AgentVisualState> = useMemo(() => {
        const map: Record<string, AgentVisualState> = {};
        for (const agent of agents) {
            const output = run?.agentOutputs?.[agent.id];
            if (output) {
                map[agent.id] = stateFromRunStatus(output.status);
            } else if (run && (run.status === "running" || run.status === "queued")) {
                map[agent.id] = "waiting";
            } else if (run?.skipped?.some((s) => s.agentId === agent.id)) {
                map[agent.id] = "skipped";
            } else {
                map[agent.id] = "idle";
            }
        }
        return map;
    }, [agents, run]);

    const findings = useMemo(() => {
        const map: Record<string, string> = {};
        for (const [id, output] of Object.entries(run?.agentOutputs ?? {})) {
            if (output.summary) map[id] = output.summary;
        }
        return map;
    }, [run]);

    const confidences = useMemo(() => {
        const map: Record<string, number> = {};
        for (const [id, output] of Object.entries(run?.agentOutputs ?? {})) {
            if (output.status === "completed") map[id] = output.confidence;
        }
        return map;
    }, [run]);

    const conflictIds = useMemo(() => {
        const ids = new Set<string>();
        for (const conflict of run?.consensus?.conflicts ?? []) {
            if (conflict.kind === "stance" && conflict.positions) {
                for (const id of Object.keys(conflict.positions)) ids.add(id);
            }
        }
        for (const [id, output] of Object.entries(run?.agentOutputs ?? {})) {
            if (output.status === "completed" && run?.consensus && run.consensus.stance === "split") {
                const top = run.consensus.agentsByStance;
                if (top.bullish.includes(id) && top.bearish.length > 0) ids.add(id);
                if (top.bearish.includes(id) && top.bullish.length > 0) ids.add(id);
            }
        }
        return Array.from(ids);
    }, [run]);

    const evidenceOutputs = useMemo(() => {
        const outputs = Object.values(run?.agentOutputs ?? {});
        return outputs.filter((o) => o.status === "completed" && o.agentId !== "chief-analyst");
    }, [run]);

    const chiefOutput = run?.agentOutputs?.["chief-analyst"];
    const isRunning = Boolean(run && (run.status === "running" || run.status === "queued"));

    const startRun = useCallback(async () => {
        setError(null);
        setStarting(true);
        try {
            const body: Record<string, unknown> = { mode, request: undefined };
            if (mode !== "live") {
                const parsed = Date.parse(asOf);
                if (Number.isNaN(parsed)) {
                    setError("Select an as-of cutoff for non-live modes.");
                    setStarting(false);
                    return;
                }
                body.asOf = parsed;
            }
            const res = await teamsApi<{ runId: string; status: string }>(`/${team.id}/run`, {
                method: "POST",
                body,
            });
            setRunId(res.runId);
            onRunChanged?.(res.runId);
            setRun({
                id: res.runId,
                userId: uid ?? "",
                teamId: team.id,
                teamName: team.name,
                teamVersion: team.version,
                status: "queued",
                dataMode: mode,
                asOf: mode !== "live" ? Date.parse(asOf) : null,
                market: team.config.market,
                config: team.config,
                agentVersions: team.pinnedAgentVersions ?? {},
                startedAt: Date.now(),
                finishedAt: null,
                durationMs: null,
                waves: [],
                agentOutputs: {},
                skipped: [],
                timeline: [{ t: Date.now(), text: "Run queued…", kind: "info" }],
                consensus: null,
                synthesis: null,
                dossierMeta: null,
                budget: { agentsSelected: 0, agentsExecuted: 0, agentsSkipped: 0, aiCalls: 0, aiFailures: 0 },
                errors: [],
                createdAt: Date.now(),
            });
        } catch (err) {
            setError(err instanceof TeamsApiError ? err.message : "Failed to start run.");
        } finally {
            setStarting(false);
        }
    }, [mode, asOf, team, onRunChanged, uid]);

    const cancelRun = useCallback(async () => {
        if (!runId) return;
        setCancelling(true);
        try {
            await teamsApi(`/runs/${runId}/cancel`, { method: "POST" });
        } catch (err) {
            setError(err instanceof TeamsApiError ? err.message : "Failed to cancel run.");
        } finally {
            setCancelling(false);
        }
    }, [runId]);

    const openHistoryRun = useCallback((id: string) => {
        setRunId(id);
        onRunChanged?.(id);
    }, [onRunChanged]);

    const selectedAgent = selectedAgentId ? agentById.get(selectedAgentId) : undefined;
    const selectedOutput = selectedAgentId ? run?.agentOutputs?.[selectedAgentId] : undefined;

    const runStatusTone =
        run?.status === "completed"
            ? "positive"
            : run?.status === "failed"
                ? "error"
                : run?.status === "partial"
                    ? "warning"
                    : run?.status === "cancelled"
                        ? "neutral"
                        : isRunning
                            ? "live"
                            : "neutral";

    return (
        <div className="flex flex-col gap-3">
            {/* ── Team header ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Link
                                href="/ai-trading-teams"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                                <ArrowLeft className="size-3.5" /> Teams
                            </Link>
                            <span className="text-muted-foreground/50">/</span>
                            <h1 className="text-lg font-bold tracking-tight">{team.name}</h1>
                            {run ? <StatusBadge tone={runStatusTone as never} label={run.status} dot pulse={isRunning} /> : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
                            <Badge variant="outline">{team.config.market}</Badge>
                            <Badge variant="outline">Entry {team.config.entryTimeframe}</Badge>
                            <Badge variant="outline">Confirm {team.config.confirmationTimeframe}</Badge>
                            <Badge variant="outline">Context {team.config.contextTimeframe}</Badge>
                            <Badge variant="outline" className="capitalize">{team.config.style}</Badge>
                            <Badge variant="outline" className="capitalize">{team.config.riskProfile}</Badge>
                            <Badge variant="secondary" className="capitalize">{team.config.behavior}</Badge>
                            {run ? (
                                <Badge variant="outline" className={run.dataMode === "live" ? "border-positive/50 text-positive" : "border-warning/50 text-warning"}>
                                    {run.dataMode === "replay" ? "HISTORICAL REPLAY" : run.dataMode.toUpperCase()}
                                </Badge>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-micro text-muted-foreground">
                            Mode
                            <select
                                value={mode}
                                onChange={(e) => setMode(e.target.value as DataMode)}
                                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
                                aria-label="Run data mode"
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {mode !== "live" ? (
                            <label className="flex items-center gap-1.5 text-micro text-muted-foreground">
                                As of
                                <input
                                    type="datetime-local"
                                    value={asOf}
                                    onChange={(e) => setAsOf(e.target.value)}
                                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
                                    aria-label="Point-in-time cutoff"
                                />
                            </label>
                        ) : null}
                        {isRunning ? (
                            <Button variant="destructive" size="sm" onClick={cancelRun} disabled={cancelling}>
                                {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
                                Cancel
                            </Button>
                        ) : (
                            <Button size="sm" onClick={startRun} disabled={!canRun || starting}>
                                {starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                                Run analysis
                            </Button>
                        )}
                    </div>
                </div>

                {error ? (
                    <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        {error}
                    </p>
                ) : null}
                {!canRun ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                        Running team analyses requires an active AlgoVault Pro subscription.
                    </p>
                ) : null}
                {run?.status === "failed" ? (
                    <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        {run.errors[0] ?? "The run failed before any agent produced validated results."}
                    </p>
                ) : null}
            </div>

            {/* ── Mobile tab switch ───────────────────────────────────── */}
            <div className="flex gap-1 rounded-lg bg-muted p-1 md:hidden" role="tablist" aria-label="Workspace views">
                <button
                    type="button"
                    role="tab"
                    aria-selected={mobileTab === "team"}
                    onClick={() => setMobileTab("team")}
                    className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium", mobileTab === "team" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
                >
                    Team
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={mobileTab === "evidence"}
                    onClick={() => setMobileTab("evidence")}
                    className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium", mobileTab === "evidence" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
                >
                    Evidence
                </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-12">
                {/* ── LEFT: team members ──────────────────────────────── */}
                <aside className={cn("lg:col-span-3", mobileTab !== "team" && "hidden md:block")}>
                    <div className="rounded-xl border border-border/60 bg-card/60 p-3">
                        <SectionHeader
                            title="Agents"
                            meta={<span className="text-micro text-muted-foreground">{agents.length} members</span>}
                        />
                        <ul className="mt-2 space-y-1">
                            {agents.map((agent) => {
                                const state = states[agent.id] ?? "idle";
                                const output = run?.agentOutputs?.[agent.id];
                                return (
                                    <li key={agent.id}>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedAgentId(agent.id)}
                                            className={cn(
                                                "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
                                                selectedAgentId === agent.id
                                                    ? "border-primary/50 bg-primary/5"
                                                    : "border-transparent hover:border-border/60 hover:bg-muted/40",
                                            )}
                                        >
                                            <AgentStateDot state={state} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-medium text-foreground">{agent.name}</span>
                                                <span className="block truncate text-micro text-muted-foreground">
                                                    {output?.status === "failed"
                                                        ? output.error ?? "failed"
                                                        : output?.summary || stateLabel(state)}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>

                        {run?.skipped?.length ? (
                            <div className="mt-3 border-t border-border/50 pt-2">
                                <p className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">Not executed</p>
                                <ul className="mt-1 space-y-0.5">
                                    {run.skipped.map((s) => (
                                        <li key={s.agentId} className="text-micro leading-snug text-muted-foreground">
                                            {agentById.get(s.agentId)?.name ?? s.agentId}: {s.reason}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </div>
                </aside>

                {/* ── CENTER: command center graph ────────────────────── */}
                <section className={cn("lg:col-span-6", mobileTab !== "team" && "hidden md:block")}>
                    <div className="rounded-xl border border-border/60 bg-card/40 p-3 sm:p-4">
                        <SectionHeader
                            title="AI command center"
                            description={
                                isRunning
                                    ? "Agents are executing — evidence flows toward the Chief Analyst"
                                    : run
                                        ? `Run ${run.status} · ${(run.durationMs ?? 0) / 1000 >= 1 ? `${((run.durationMs ?? 0) / 1000).toFixed(1)}s` : "done"}`
                                        : "Ready — start an analysis to activate the desk"
                            }
                            icon={<Radio className="size-4" />}
                            meta={
                                run?.budget ? (
                                    <span className="hidden text-micro text-muted-foreground tabular-nums sm:inline">
                                        {run.budget.agentsExecuted} executed · {run.budget.aiCalls} AI calls
                                    </span>
                                ) : undefined
                            }
                        />

                        <div className="mt-3">
                            <TeamGraph
                                agents={agents}
                                states={states}
                                selectedId={selectedAgentId}
                                conflictIds={conflictIds}
                                findings={findings}
                                confidences={confidences}
                                onSelect={(id) => setSelectedAgentId(id)}
                            />
                        </div>

                        <div className="mt-3 md:hidden">
                            <AgentCarousel agents={agents} states={states} onSelect={(id) => setSelectedAgentId(id)} />
                        </div>

                        {run?.consensus ? (
                            <div className="mt-4 border-t border-border/50 pt-3">
                                <ConsensusBar consensus={run.consensus} />
                            </div>
                        ) : null}
                        {!run ? (
                            <p className="mt-3 flex items-center gap-1.5 text-center text-micro text-muted-foreground justify-center">
                                <Activity className="size-3.5" /> No run selected. Press “Run analysis” to activate the desk.
                            </p>
                        ) : null}
                    </div>

                    {/* Run history */}
                    <div className="mt-3 rounded-xl border border-border/60 bg-card/40 p-3">
                        <SectionHeader title="Team runs" icon={<History className="size-4" />} />
                        {history.length === 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">No runs yet for this team.</p>
                        ) : (
                            <ul className="mt-2 space-y-1">
                                {history.slice(0, 8).map((item) => (
                                    <li key={String(item.id)}>
                                        <button
                                            type="button"
                                            onClick={() => item.id && openHistoryRun(String(item.id))}
                                            className={cn(
                                                "flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-micro hover:bg-muted/40",
                                                item.id === runId ? "border-primary/50 bg-primary/5" : "border-border/50",
                                            )}
                                        >
                                            <span className="truncate text-foreground/85">
                                                {new Date(item.startedAt ?? 0).toLocaleString()} · {item.status}
                                            </span>
                                            <span className="flex shrink-0 items-center gap-1.5">
                                                <Badge variant="outline" className="text-micro">{item.dataMode ?? "live"}</Badge>
                                                {item.setupState ? (
                                                    <Badge variant="secondary" className="text-micro">{item.setupState}</Badge>
                                                ) : null}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>

                {/* ── RIGHT: live evidence + synthesis ─────────────────── */}
                <aside className={cn("lg:col-span-3", mobileTab !== "evidence" && "hidden md:block")}>
                    <div className="flex flex-col gap-3">
                        {run?.synthesis ? (
                            <div className="rounded-xl border border-primary/30 bg-card/70 p-3">
                                <SectionHeader
                                    title="Chief Analyst brief"
                                    icon={<Sparkles className="size-4 text-primary" />}
                                />
                                <div className="mt-2">
                                    <SynthesisBrief synthesis={run.synthesis} />
                                </div>
                            </div>
                        ) : null}

                        <div className="rounded-xl border border-border/60 bg-card/60 p-3">
                            <SectionHeader
                                title="Live evidence"
                                description="Classified observations with sources"
                                meta={
                                    isRunning ? (
                                        <StatusBadge tone="live" label="streaming" dot pulse />
                                    ) : undefined
                                }
                            />
                            <div className="mt-2 max-h-[520px] space-y-2 overflow-y-auto pr-0.5">
                                {evidenceOutputs.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={<Activity className="size-4" />}
                                        title="No evidence yet"
                                        description="Agent observations appear here as they complete, each with its FACT / INTERPRETATION / HYPOTHESIS classification."
                                    />
                                ) : (
                                    evidenceOutputs.map((output: AgentRunOutput) => (
                                        <AgentEvidenceCard key={output.agentId} output={output} compact />
                                    ))
                                )}
                                {chiefOutput && chiefOutput.status !== "completed" ? (
                                    <p className="rounded border border-warning/40 bg-warning/5 px-2 py-1.5 text-micro text-warning">
                                        Chief Analyst: {chiefOutput.status === "failed" ? chiefOutput.error ?? "failed" : chiefOutput.summary || chiefOutput.status}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </aside>

                {/* ── BOTTOM: execution timeline ───────────────────────── */}
                <div className="lg:col-span-12">
                    <div className="rounded-xl border border-border/60 bg-card/60 p-3">
                        <SectionHeader
                            title="Team timeline"
                            description="Execution order, completions and failures"
                            meta={
                                run?.waves?.length ? (
                                    <span className="text-micro text-muted-foreground">{run.waves.length} wave(s)</span>
                                ) : undefined
                            }
                        />
                        <div className="max-h-56 overflow-y-auto">
                            <TeamTimeline entries={run?.timeline ?? []} />
                        </div>
                    </div>
                </div>
            </div>

            {selectedAgent ? (
                <AgentDetailPanel
                    agent={selectedAgent}
                    state={states[selectedAgent.id] ?? "idle"}
                    output={selectedOutput}
                    open
                    onClose={() => setSelectedAgentId(null)}
                />
            ) : null}
        </div>
    );
}
