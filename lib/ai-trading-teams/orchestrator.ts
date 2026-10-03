/**
 * AI Trading Team orchestrator (spec §8, §12, §13).
 *
 * Pipeline:
 *   team + request → relevance selection → dependency waves (parallel where
 *   safe) → agent execution with timeout/retry/cancellation → evidence
 *   collection → deterministic conflict detection → risk/quant validation gate
 *   → Chief Analyst synthesis → structured TeamRun.
 *
 * The orchestrator is dependency-injected (AI call, dossier, progress writer,
 * cancellation) so it is fully testable offline and safe to run under a
 * feature flag with no side effects when disabled.
 */

import type {
    AgentRunOutput,
    AITradingTeam,
    ChiefSynthesis,
    ConflictGroup,
    Stance,
    TeamAgentDefinition,
    TeamConsensus,
    TeamRun,
    TeamTimelineEntry,
    TeamDataMode,
    SetupState,
} from "./types";
import { CHIEF_AGENT_ID, QUANT_AGENT_IDS, RISK_AGENT_IDS } from "./agent-library";
import { executeAgent, type AIFn } from "./agent-executor";
import { buildChiefUserPrompt } from "./prompts";
import { validateAgentOutput, validateSynthesis, clamp, extractIntentsFromRequest } from "./validation";
import type { IntelligenceDossier } from "./context";

// ─── configuration ──────────────────────────────────────────────────────────

export const ORCHESTRATOR_LIMITS = {
    /** Hard cap on agents executed per run (cost control, spec §26). */
    get maxAgentsPerRun(): number {
        const parsed = parseInt(process.env.AI_TEAMS_MAX_AGENTS_PER_RUN || "12", 10);
        return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 20) : 12;
    },
    /** Hard cap on total AI calls per run (attempts included). */
    get maxAICallsPerRun(): number {
        const parsed = parseInt(process.env.AI_TEAMS_MAX_AI_CALLS || "30", 10);
        return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 60) : 30;
    },
    get waveTimeoutMs(): number {
        const parsed = parseInt(process.env.AI_TEAMS_WAVE_TIMEOUT_MS || "60000", 10);
        return Number.isFinite(parsed) && parsed > 1000 ? parsed : 60000;
    },
    get totalBudgetMs(): number {
        const parsed = parseInt(process.env.AI_TEAMS_TOTAL_BUDGET_MS || "240000", 10);
        return Number.isFinite(parsed) && parsed > 10000 ? parsed : 240000;
    },
};

// ─── relevance selection ────────────────────────────────────────────────────

export interface SelectionInput {
    agents: TeamAgentDefinition[];
    request?: string;
    config: AITradingTeam["config"];
}

/**
 * Chooses which team members are relevant for this request (spec §8):
 * a technical-only question must not wake Macro, Quant and everyone else.
 *
 * Deterministic and conservative — when in doubt the full team runs.
 */
export function selectRelevantAgents(input: SelectionInput): { selected: TeamAgentDefinition[]; skipped: { agentId: string; reason: string }[]; intents: string[] } {
    const skipped: { agentId: string; reason: string }[] = [];
    const { agents, config } = input;

    const intents = Array.from(
        new Set([
            ...(config.intents ?? []),
            ...extractIntentsFromRequest(input.request ?? ""),
        ]),
    );

    const chief = agents.filter((a) => a.isChief || a.id === CHIEF_AGENT_ID);
    const members = agents.filter((a) => !a.isChief && a.id !== CHIEF_AGENT_ID);

    const activeMembers = members.filter((a) => a.enabled !== false);
    for (const member of members) {
        if (member.enabled === false) skipped.push({ agentId: member.id, reason: "Agent disabled." });
    }

    let chosen = activeMembers;
    if (intents.length > 0) {
        const matched = activeMembers.filter((a) => a.activationTags.some((tag) => intents.includes(tag)));
        // Zero matches → full team (conservative default). One or more matches
        // → run only the relevant agents: a technical-only question must not
        // wake Macro and Quant (spec §8).
        if (matched.length >= 1 && matched.length < activeMembers.length) {
            chosen = matched;
            for (const member of activeMembers) {
                if (!matched.some((m) => m.id === member.id)) {
                    skipped.push({ agentId: member.id, reason: `Not relevant for intents: ${intents.join(", ")}.` });
                }
            }
        }
    }

    const chosenIds = new Set(chosen.map((a) => a.id));

    // Behavior guarantees (risk-first / research-first).
    if (config.behavior === "risk-first" || config.behaviorRules?.requireRiskValidation) {
        for (const riskId of RISK_AGENT_IDS) {
            const agent = activeMembers.find((a) => a.id === riskId);
            if (agent && !chosenIds.has(agent.id)) {
                chosen.push(agent);
                chosenIds.add(agent.id);
                const index = skipped.findIndex((s) => s.agentId === agent.id);
                if (index >= 0) skipped.splice(index, 1);
            }
        }
    }
    if (config.behavior === "research-first" || config.behaviorRules?.requireQuantValidation) {
        for (const quantId of QUANT_AGENT_IDS) {
            const agent = activeMembers.find((a) => a.id === quantId);
            if (agent && !chosenIds.has(agent.id)) {
                chosen.push(agent);
                chosenIds.add(agent.id);
                const index = skipped.findIndex((s) => s.agentId === agent.id);
                if (index >= 0) skipped.splice(index, 1);
            }
        }
    }

    const selected = [...chosen, ...chief].slice(0, ORCHESTRATOR_LIMITS.maxAgentsPerRun);
    const selectedIds = new Set(selected.map((a) => a.id));
    // Only agents that were actually chosen but fell off the run limit get
    // this reason — never agents already skipped by the relevance filter.
    for (const member of chosen) {
        if (!selectedIds.has(member.id)) {
            skipped.push({ agentId: member.id, reason: "Agent limit reached for this run." });
        }
    }

    return { selected, skipped, intents };
}

// ─── dependency waves ───────────────────────────────────────────────────────

export interface WavePlan {
    waves: string[][];
    skipped: { agentId: string; reason: string }[];
}

/**
 * Topologically buckets agents into parallel waves. Agents with unsatisfiable
 * or cyclic dependencies are skipped with a reason (never silently dropped).
 */
export function planWaves(selected: TeamAgentDefinition[]): WavePlan {
    const skipped: { agentId: string; reason: string }[] = [];
    const byId = new Map(selected.map((a) => [a.id, a]));
    const waveOf = new Map<string, number>();
    const remaining = new Set(selected.map((a) => a.id));

    const resolve = (id: string, trail: string[]): number | null => {
        if (waveOf.has(id)) return waveOf.get(id)!;
        if (trail.includes(id)) return null; // cycle
        const agent = byId.get(id);
        if (!agent) return null;
        let base = 0;
        for (const dep of agent.dependsOn ?? []) {
            if (!byId.has(dep)) {
                // Dependency not part of this run — treat as satisfied only if
                // it is not selected (external), otherwise fail the agent.
                continue;
            }
            const depWave = resolve(dep, [...trail, id]);
            if (depWave === null) return null;
            base = Math.max(base, depWave + 1);
        }
        waveOf.set(id, base);
        return base;
    };

    for (const id of Array.from(remaining)) {
        const wave = resolve(id, []);
        if (wave === null) {
            skipped.push({ agentId: id, reason: "Dependency cycle or missing dependency." });
            remaining.delete(id);
        }
    }

    // Chief analyst always runs in the final wave.
    const chiefIds = selected.filter((a) => a.isChief || a.id === CHIEF_AGENT_ID).map((a) => a.id);
    const memberWaves = new Map<string, number>();
    for (const id of remaining) {
        if (chiefIds.includes(id)) continue;
        memberWaves.set(id, waveOf.get(id) ?? 0);
    }
    const maxMemberWave = memberWaves.size ? Math.max(...Array.from(memberWaves.values())) : 0;

    const waves: string[][] = [];
    for (const id of remaining) {
        const wave = chiefIds.includes(id) ? maxMemberWave + 1 : (memberWaves.get(id) ?? 0);
        if (!waves[wave]) waves[wave] = [];
        waves[wave].push(id);
    }
    // Normalize (holes → empty) and drop empty waves so consumers always get
    // a dense array of non-empty parallel batches.
    const dense = Array.from({ length: waves.length }, (_, i) => waves[i] ?? []).filter(
        (w) => w.length > 0,
    );
    return { waves: dense, skipped };
}

// ─── deterministic conflict analysis ────────────────────────────────────────

const STANCE_ORDER: Stance[] = ["bullish", "bearish", "neutral", "mixed", "unclear"];

export function analyzeConsensus(
    outputs: AgentRunOutput[],
    skipped: { agentId: string; reason: string }[],
): TeamConsensus {
    const agentsByStance: Record<Stance, string[]> = {
        bullish: [],
        bearish: [],
        neutral: [],
        mixed: [],
        unclear: [],
    };

    for (const output of outputs) {
        const stance = STANCE_ORDER.includes(output.stance) ? output.stance : "unclear";
        agentsByStance[stance].push(output.agentId);
    }

    const voters = outputs.filter((o) => o.status === "completed" && o.stance !== "unclear");
    const counts = STANCE_ORDER.map((s) => ({ stance: s, count: agentsByStance[s].length }));
    const sorted = [...counts].sort((a, b) => b.count - a.count);
    const totalVoted = voters.length || outputs.length || 1;

    let stance: TeamConsensus["stance"] = "unclear";
    if (sorted[0].count > 0) {
        if (sorted.length > 1 && sorted[0].count === sorted[1].count) {
            stance = "split";
        } else {
            stance = sorted[0].stance as Stance;
        }
    }
    const agreementRatio = sorted[0].count / totalVoted;

    const conflicts: ConflictGroup[] = [];

    const bull = agentsByStance.bullish;
    const bear = agentsByStance.bearish;
    if (bull.length > 0 && bear.length > 0) {
        conflicts.push({
            id: "stance-bull-bear",
            label: "Bullish vs bearish disagreement",
            kind: "stance",
            positions: Object.fromEntries(
                [...bull, ...bear].map((id) => [id, (outputs.find((o) => o.agentId === id)?.stance ?? "unclear") as Stance]),
            ),
            detail: `${bull.join(", ")} read bullish while ${bear.join(", ")} read bearish from the same market data.`,
        });
    }
    const mixedStances = STANCE_ORDER.filter((s) => s !== "unclear" && agentsByStance[s].length > 0);
    if (mixedStances.length >= 3) {
        conflicts.push({
            id: "stance-split",
            label: "Multi-directional disagreement",
            kind: "stance",
            positions: Object.fromEntries(
                mixedStances.flatMap((s) => agentsByStance[s].map((id) => [id, s])),
            ),
            detail: `No directional consensus: ${mixedStances.join(", ")} positions were all represented.`,
        });
    }

    const missingEvidence: string[] = [];
    for (const output of outputs) {
        for (const obs of output.observations) {
            if (obs.kind === "UNKNOWN" && missingEvidence.length < 12) {
                missingEvidence.push(`${output.agentId}: ${obs.text}`);
            }
        }
        if (output.status !== "completed" && missingEvidence.length < 12) {
            missingEvidence.push(`${output.agentId}: did not produce a validated result.`);
        }
    }
    for (const skip of skipped) {
        if (missingEvidence.length < 12) missingEvidence.push(`${skip.agentId}: ${skip.reason}`);
    }

    const criticalRisks: string[] = [];
    const riskOutputs = outputs.filter((o) => RISK_AGENT_IDS.includes(o.agentId));
    for (const risk of riskOutputs) {
        for (const r of risk.risks) if (!criticalRisks.includes(r)) criticalRisks.push(r);
    }
    for (const output of outputs) {
        if (riskOutputs.some((r) => r.agentId === output.agentId)) continue;
        for (const r of output.risks) {
            if (criticalRisks.length >= 10) break;
            if (!criticalRisks.includes(r)) criticalRisks.push(r);
        }
    }

    if (criticalRisks.length >= 3 || (riskOutputs.length > 0 && riskOutputs.every((r) => r.stance === "bearish" || r.stance === "unclear" || r.status !== "completed"))) {
        conflicts.push({
            id: "critical-risk",
            label: "Critical risk concentration",
            kind: "critical-risk",
            detail: `${criticalRisks.length} risk factor(s) reported${riskOutputs.length ? ", including the Risk Manager" : ""}. Team behavior requires explicit risk review before any conclusion.`,
        });
    }

    if (missingEvidence.length > 0) {
        conflicts.push({
            id: "missing-evidence",
            label: "Missing evidence",
            kind: "missing-evidence",
            detail: `${missingEvidence.length} evidence gap(s) — see the missing evidence list.`,
        });
    }

    const invalidations: string[] = [];
    for (const output of outputs) {
        for (const inv of output.invalidations) {
            if (invalidations.length >= 12) break;
            if (!invalidations.includes(inv)) invalidations.push(inv);
        }
    }

    return {
        stance,
        agreementRatio: Number(agreementRatio.toFixed(2)),
        agentsByStance,
        missingEvidence,
        criticalRisks: criticalRisks.slice(0, 10),
        invalidations,
        conflicts,
    };
}

// ─── behavior gate ──────────────────────────────────────────────────────────

export interface GateResult {
    blocked: boolean;
    reason?: string;
    notes: string[];
    maxSetupState: SetupState;
}

export function evaluateBehaviorGate(params: {
    config: AITradingTeam["config"];
    outputs: AgentRunOutput[];
    consensus: TeamConsensus;
}): GateResult {
    const { config, outputs, consensus } = params;
    const notes: string[] = [];
    let blocked = false;
    let reason: string | undefined;
    const maxSetupState: SetupState = "CONFIRMED";

    const byId = (ids: string[]) => outputs.filter((o) => ids.some((id) => id === o.agentId));
    const failed = (o: AgentRunOutput) => o.status !== "completed";

    if (config.behavior === "risk-first" || config.behaviorRules?.requireRiskValidation) {
        const riskOutputs = byId(RISK_AGENT_IDS);
        if (riskOutputs.length === 0 || riskOutputs.every(failed)) {
            blocked = true;
            reason = "Chief Analyst requires Risk validation before finalizing.";
        } else {
            notes.push("Risk validation gate: satisfied.");
        }
    }
    if (config.behaviorRules?.requireQuantValidation) {
        const quantOutputs = byId(QUANT_AGENT_IDS);
        if (quantOutputs.length === 0 || quantOutputs.every(failed)) {
            blocked = true;
            reason = reason ?? "Chief Analyst requires Quant validation before finalizing.";
        } else {
            notes.push("Quant validation gate: satisfied.");
        }
    }

    const completed = outputs.filter((o) => o.status === "completed");
    if (completed.length === 0) {
        blocked = true;
        reason = reason ?? "No agent produced a validated result.";
    }

    const meanConfidence = completed.length
        ? completed.reduce((sum, o) => sum + o.confidence, 0) / completed.length
        : 0;
    const minConsensus = config.behaviorRules?.minConsensusConfidence;
    if (minConsensus !== undefined && meanConfidence < minConsensus) {
        notes.push(
            `Mean agent confidence ${meanConfidence.toFixed(2)} below required ${minConsensus} — CONFIRMED state withheld.`,
        );
    }

    if (consensus.criticalRisks.length >= 5) {
        notes.push("Elevated risk concentration — Chief Analyst must weigh risks explicitly.");
    }

    return { blocked, reason, notes, maxSetupState };
}

// ─── synthesis post-processing ──────────────────────────────────────────────

const DISCLAIMER =
    "AlgoVault AI Trading Teams provide analytical and research assistance only. Outputs are research observations based on the data available at the run timestamp — not financial advice, and not guaranteed or certain outcomes.";

function deriveSetupState(
    consensus: TeamConsensus,
    chiefState: SetupState,
    gate: GateResult,
    meanConfidence: number,
    minConsensus?: number,
): SetupState {
    if (chiefState === "INVALIDATED" || chiefState === "CANCELLED") return chiefState;
    if (gate.blocked) return chiefState === "CONFIRMED" ? "VALIDATING" : chiefState;
    if (minConsensus !== undefined && meanConfidence < minConsensus && chiefState === "CONFIRMED") {
        return "VALIDATING";
    }
    if (chiefState === "CONFIRMED" && consensus.stance === "split") return "VALIDATING";
    return chiefState;
}

// ─── orchestrator ───────────────────────────────────────────────────────────

export interface RunTeamAnalysisParams {
    runId: string;
    userId: string;
    team: AITradingTeam;
    agents: TeamAgentDefinition[];
    request?: string;
    dataMode: TeamDataMode;
    asOf: number | null;
    dossier: IntelligenceDossier;
    ai: AIFn;
    isCancelled?: () => Promise<boolean>;
    /** Called after every meaningful state change (drives the live UI). */
    onProgress?: (patch: Partial<TeamRun>) => Promise<void> | void;
    now?: () => number;
}

function initialRun(params: RunTeamAnalysisParams): TeamRun {
    const now = (params.now ?? Date.now)();
    return {
        id: params.runId,
        userId: params.userId,
        teamId: params.team.id,
        teamName: params.team.name,
        teamVersion: params.team.version,
        status: "queued",
        request: params.request,
        dataMode: params.dataMode,
        asOf: params.asOf,
        market: params.team.config.market,
        config: params.team.config,
        agentVersions: Object.fromEntries(params.agents.map((a) => [a.id, a.version])),
        startedAt: now,
        finishedAt: null,
        durationMs: null,
        waves: [],
        agentOutputs: {},
        skipped: [],
        timeline: [],
        consensus: null,
        synthesis: null,
        dossierMeta: {
            sources: Object.keys(params.dossier.sections).filter((k) => params.dossier.payloads[k as keyof typeof params.dossier.payloads]),
            mode: params.dataMode,
            asOf: params.asOf,
            dataTimestamp: params.dossier.meta.dataTimestamp,
            candleCounts: params.dossier.meta.candleCounts,
            quality: params.dossier.meta.quality,
            limitations: params.dossier.meta.limitations,
        },
        budget: { agentsSelected: 0, agentsExecuted: 0, agentsSkipped: 0, aiCalls: 0, aiFailures: 0 },
        errors: [],
        createdAt: now,
    };
}

export async function runTeamAnalysis(params: RunTeamAnalysisParams): Promise<TeamRun> {
    const run = initialRun(params);
    const startedAt = Date.now();
    let aiCalls = 0;
    let aiFailures = 0;

    const timeline = (text: string, kind: TeamTimelineEntry["kind"] = "info", agentId?: string) => {
        run.timeline.push({ t: Date.now(), text, kind, ...(agentId ? { agentId } : {}) });
    };
    const progress = async (patch: Partial<TeamRun> = {}) => {
        if (params.onProgress) {
            await params.onProgress({ ...run, ...patch, timeline: run.timeline, agentOutputs: run.agentOutputs });
        }
    };
    const cancelled = async () => (params.isCancelled ? await params.isCancelled() : false);

    run.status = "running";
    timeline("Market context loaded", "info");
    await progress({ status: "running" });

    // ── fail-safe: no market data → structured failure, never fake results ──
    if (params.dossier.meta.quality === "unavailable") {
        run.status = "failed";
        run.errors.push("Market data unavailable — analysis cannot start.");
        timeline("Market data unavailable — run failed safely.", "error");
        run.finishedAt = Date.now();
        run.durationMs = run.finishedAt - startedAt;
        run.budget.agentsSkipped = params.agents.length;
        await progress({ status: "failed", errors: run.errors, finishedAt: run.finishedAt, durationMs: run.durationMs });
        return run;
    }

    // ── relevance selection ────────────────────────────────────────────────
    const selection = selectRelevantAgents({
        agents: params.agents,
        request: params.request,
        config: params.team.config,
    });
    run.skipped = [...selection.skipped];
    run.budget.agentsSelected = selection.selected.length;
    timeline(
        `Relevance filter selected ${selection.selected.length} agent(s) for intents: ${selection.intents.join(", ") || "general"}.`,
        "info",
    );

    // ── dependency waves ───────────────────────────────────────────────────
    const plan = planWaves(selection.selected);
    run.waves = plan.waves;
    for (const skip of plan.skipped) run.skipped.push(skip);
    timeline(`Execution plan: ${plan.waves.length} wave(s).`, "info");

    // Mark non-selected agents for the live UI.
    for (const skip of run.skipped) {
        run.agentOutputs[skip.agentId] = {
            agentId: skip.agentId,
            agentVersion: params.agents.find((a) => a.id === skip.agentId)?.version ?? "n/a",
            status: "skipped",
            summary: skip.reason,
            observations: [],
            evidence: [],
            interpretation: "",
            stance: "unclear",
            confidence: 0,
            invalidations: [],
            risks: [],
            dataTimestamp: new Date().toISOString(),
            toolsUsed: [],
            limitations: [],
        };
    }
    run.budget.agentsSkipped = run.skipped.length;
    await progress({ skipped: run.skipped, waves: run.waves, agentOutputs: run.agentOutputs });

    const budgetExhausted = () => aiCalls >= ORCHESTRATOR_LIMITS.maxAICallsPerRun || Date.now() - startedAt > ORCHESTRATOR_LIMITS.totalBudgetMs;

    const wrappedAi: AIFn = async (request) => {
        aiCalls += 1;
        const result = await params.ai(request);
        if (!result.ok) aiFailures += 1;
        return result;
    };

    const outputs: AgentRunOutput[] = [];
    const byId = new Map(params.agents.map((a) => [a.id, a]));

    // ── execute waves ──────────────────────────────────────────────────────
    for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex++) {
        const wave = plan.waves[waveIndex];

        if (await cancelled()) {
            run.status = "cancelled";
            run.errors.push("Run cancelled by user.");
            timeline("Run cancelled.", "warning");
            break;
        }
        if (budgetExhausted()) {
            run.status = "partial";
            run.errors.push("Execution budget exhausted before all agents ran.");
            timeline("Execution budget exhausted — remaining agents skipped.", "warning");
            for (const id of wave) {
                run.skipped.push({ agentId: id, reason: "Execution budget exhausted." });
                run.budget.agentsSkipped += 1;
            }
            continue;
        }

        const isChiefWave = wave.some((id) => byId.get(id)?.isChief || id === CHIEF_AGENT_ID);
        // The chief wave runs after consensus is computed below.
        if (isChiefWave) break;

        timeline(`Wave ${waveIndex + 1} started: ${wave.join(", ")}.`, "started");
        await progress({ timeline: run.timeline });

        const results = await Promise.all(
            wave.map(async (agentId) => {
                const agent = byId.get(agentId);
                if (!agent) {
                    return null;
                }
                run.agentOutputs[agentId] = {
                    agentId,
                    agentVersion: agent.version,
                    status: "analyzing",
                    summary: "",
                    observations: [],
                    evidence: [],
                    interpretation: "",
                    stance: "unclear",
                    confidence: 0,
                    invalidations: [],
                    risks: [],
                    dataTimestamp: new Date().toISOString(),
                    toolsUsed: [],
                    limitations: [],
                    agentName: agent.name,
                } as AgentRunOutput;
                await progress({ agentOutputs: run.agentOutputs, timeline: run.timeline });

                const output = await executeAgent({
                    agent,
                    team: params.team,
                    dossier: params.dossier,
                    request: params.request,
                    ai: wrappedAi,
                    userId: params.userId,
                    isCancelled: cancelled,
                });
                return output;
            }),
        );

        for (const output of results) {
            if (!output) continue;
            run.agentOutputs[output.agentId] = output;
            outputs.push(output);
            if (output.status === "completed") {
                run.budget.agentsExecuted += 1;
                timeline(`${output.agentName ?? output.agentId}: ${output.summary.slice(0, 140)}`, "completed", output.agentId);
            } else if (output.status === "failed") {
                run.budget.agentsSkipped += 1;
                timeline(`${output.agentName ?? output.agentId} failed: ${output.error ?? "unknown error"}`, "error", output.agentId);
            } else {
                timeline(`${output.agentName ?? output.agentId} skipped.`, "warning", output.agentId);
            }
        }
        run.budget.aiCalls = aiCalls;
        run.budget.aiFailures = aiFailures;
        await progress({ agentOutputs: run.agentOutputs, timeline: run.timeline, budget: run.budget });
    }

    // ── deterministic conflict analysis (no LLM) ───────────────────────────
    const consensus = analyzeConsensus(outputs, run.skipped);
    run.consensus = consensus;
    timeline(
        `Consensus: ${consensus.stance} (${Math.round(consensus.agreementRatio * 100)}% agreement), ${consensus.conflicts.length} conflict group(s).`,
        "info",
    );

    const gate = evaluateBehaviorGate({ config: params.team.config, outputs, consensus });
    if (gate.blocked) {
        timeline(gate.reason ?? "Behavior gate blocked finalization.", "warning");
    }

    // ── Chief Analyst ──────────────────────────────────────────────────────
    const chief = [...selection.selected, ...params.agents].find((a) => a.isChief || a.id === CHIEF_AGENT_ID);
    if (chief && !run.skipped.some((s) => s.agentId === chief.id)) {
        if (await cancelled()) {
            run.status = "cancelled";
        } else if (budgetExhausted()) {
            run.status = "partial";
            run.errors.push("Execution budget exhausted before Chief Analyst ran.");
            timeline("Execution budget exhausted — Chief Analyst did not run.", "warning");
        } else {
            run.agentOutputs[chief.id] = {
                agentId: chief.id,
                agentName: chief.name,
                agentVersion: chief.version,
                status: "analyzing",
                summary: "",
                observations: [],
                evidence: [],
                interpretation: "",
                stance: "unclear",
                confidence: 0,
                invalidations: [],
                risks: [],
                dataTimestamp: new Date().toISOString(),
                toolsUsed: [],
                limitations: [],
            };
            timeline(`${chief.name}: synthesizing evidence.`, "started", chief.id);
            await progress({ agentOutputs: run.agentOutputs, timeline: run.timeline });

            const chiefOutput = await executeChief({
                chief,
                team: params.team,
                outputs,
                consensus,
                gate,
                dossier: params.dossier,
                request: params.request,
                ai: wrappedAi,
                userId: params.userId,
                isCancelled: cancelled,
                dataMode: params.dataMode,
                skipped: run.skipped,
                behaviorNotes: gate.notes,
            });
            run.agentOutputs[chief.id] = chiefOutput;
            outputs.push(chiefOutput);
            if (chiefOutput.status === "completed") {
                run.budget.agentsExecuted += 1;
            } else {
                run.budget.agentsSkipped += 1;
                timeline(`${chief.name} failed: ${chiefOutput.error ?? "no output"}`, "error", chief.id);
            }
            run.budget.aiCalls = aiCalls;
            run.budget.aiFailures = aiFailures;
        }
    }

    // ── assemble synthesis ─────────────────────────────────────────────────
    const chiefOutput = chief ? run.agentOutputs[chief.id] : undefined;
    const completed = outputs.filter((o) => o.status === "completed" && !(chief && o.agentId === chief.id));
    const meanConfidence = completed.length
        ? completed.reduce((sum, o) => sum + o.confidence, 0) / completed.length
        : 0;

    let synthesis: ChiefSynthesis | null = null;
    if (chiefOutput && chiefOutput.status === "completed") {
        synthesis = (chiefOutput as AgentRunOutput & { raw_synthesis?: ChiefSynthesis }).raw_synthesis ?? null;
    }

    const runAgo = Date.now() - (params.dossier.meta.asOf ?? params.dossier.meta.generatedAt);
    const cancelledRun = run.status === "cancelled";
    const baseSynthesis: ChiefSynthesis = synthesis ?? (cancelledRun
        ? {
              status: "blocked",
              setupState: "CANCELLED",
              marketContext: "Run cancelled by user before synthesis completed.",
              evidence: [],
              bullishCase: [],
              bearishCase: [],
              risks: [],
              invalidations: [],
              researchNextStep: "Start a new run when ready.",
              dataFreshness: {
                  mode: params.dataMode,
                  asOf: params.asOf,
                  dataTimestamp: params.dossier.meta.dataTimestamp,
                  ageMs: runAgo,
                  stale: runAgo > 15 * 60 * 1000,
              },
              confidence: 0,
              missingEvidence: [],
              disclaimer: DISCLAIMER,
          }
        : {
        status: gate.blocked ? "blocked" : "partial",
        setupState: gate.blocked ? "WAITING" : "WATCHING",
        marketContext: "Chief Analyst did not produce a synthesis for this run.",
        evidence: [],
        bullishCase: [],
        bearishCase: [],
        risks: consensus.criticalRisks,
        invalidations: consensus.invalidations,
        researchNextStep: "Re-run the team once the blocking conditions above are resolved.",
        dataFreshness: {
            mode: params.dataMode,
            asOf: params.asOf,
            dataTimestamp: params.dossier.meta.dataTimestamp,
            ageMs: runAgo,
            stale: runAgo > 15 * 60 * 1000,
        },
        confidence: Number(meanConfidence.toFixed(2)),
        missingEvidence: consensus.missingEvidence.slice(0, 8),
        ...(gate.blocked && gate.reason ? { blockedReason: gate.reason } : {}),
        disclaimer: DISCLAIMER,
    });

    if (gate.blocked) {
        baseSynthesis.status = "blocked";
        baseSynthesis.blockedReason = gate.reason ?? baseSynthesis.blockedReason;
    } else if (run.errors.length > 0 || run.skipped.some((s) => s.reason.includes("budget"))) {
        baseSynthesis.status = baseSynthesis.status === "final" ? "partial" : baseSynthesis.status;
    }

    synthesis = {
        ...baseSynthesis,
        setupState: deriveSetupState(
            consensus,
            baseSynthesis.setupState,
            gate,
            meanConfidence,
            params.team.config.behaviorRules?.minConsensusConfidence,
        ),
        disclaimer: DISCLAIMER,
    };
    run.synthesis = synthesis;

    timeline(`Chief Analyst produced setup state: ${synthesis.setupState}.`, "synthesis", chief?.id);

    // ── final status ───────────────────────────────────────────────────────
    if (run.status === "cancelled") {
        // keep
    } else if (run.status !== "partial") {
        const completedCount = outputs.filter((o) => o.status === "completed").length;
        const failedCount = outputs.filter((o) => o.status === "failed").length;
        // Relevance-filtered agents are EXPECTED, not partial results.
        const structuralSkips = run.skipped.filter((s) => !s.reason.startsWith("Not relevant"));
        if (completedCount === 0) {
            run.status = "failed";
            run.errors.push("No agent completed successfully.");
        } else if (failedCount > 0 || gate.blocked || structuralSkips.length > 0) {
            run.status = "partial";
        } else {
            run.status = "completed";
        }
    }

    run.finishedAt = Date.now();
    run.durationMs = run.finishedAt - startedAt;
    run.budget.aiCalls = aiCalls;
    run.budget.aiFailures = aiFailures;

    timeline(`Run ${run.status} in ${(run.durationMs / 1000).toFixed(1)}s.`, "info");
    await progress({
        status: run.status,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        consensus: run.consensus,
        synthesis: run.synthesis,
        budget: run.budget,
        errors: run.errors,
        timeline: run.timeline,
        agentOutputs: run.agentOutputs,
    });

    return run;
}

// ─── chief analyst execution ────────────────────────────────────────────────

interface ExecuteChiefParams {
    chief: TeamAgentDefinition;
    team: AITradingTeam;
    outputs: AgentRunOutput[];
    consensus: TeamConsensus;
    gate: GateResult;
    dossier: IntelligenceDossier;
    request?: string;
    ai: AIFn;
    userId: string;
    isCancelled?: () => Promise<boolean>;
    dataMode: TeamDataMode;
    skipped: { agentId: string; reason: string }[];
    behaviorNotes: string[];
}

async function executeChief(params: ExecuteChiefParams): Promise<AgentRunOutput> {
    const { chief, team, dossier } = params;
    const startedAt = Date.now();

    const memberOutputs = params.outputs.filter((o) => o.agentId !== chief.id);
    const user = buildChiefUserPrompt({
        chief,
        team,
        request: params.request,
        outputs: memberOutputs,
        consensus: params.consensus,
        dossier,
        skipped: params.skipped,
        behaviorNotes: params.behaviorNotes,
        dataMode: params.dataMode,
    });

    const attempts = Math.max(1, (chief.maxRetries ?? 1) + 1);
    const errors: string[] = [];

    for (let attempt = 1; attempt <= attempts; attempt++) {
        if (params.isCancelled && (await params.isCancelled())) {
            return emptyChiefOutput(chief, startedAt, "skipped", "Cancelled before synthesis.");
        }

        let result;
        try {
            result = await params.ai({
                system: `${chief.systemInstructions}\nTeam: ${team.name}. You receive conflict analysis computed deterministically by the orchestrator — trust it over your own re-derivation.`,
                user: attempt === 1 ? user : `${user}\n\nPrevious response was invalid: ${errors.join("; ")}. Return ONLY the JSON object.`,
                maxTokens: chief.maxOutputTokens ?? 2600,
                temperature: chief.temperature ?? 0.2,
                sourceId: chief.id,
                userId: params.userId,
                responseFormat: "json_object",
            });
        } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
            continue;
        }

        if (!result.ok) {
            errors.push(result.error || "AI provider returned no content.");
            continue;
        }

        const parsed = parseJson(result.content);
        if (!parsed) {
            errors.push("Response was not valid JSON.");
            continue;
        }

        const synthValidation = validateSynthesis(parsed);
        if (!synthValidation.valid || !synthValidation.value) {
            errors.push(...synthValidation.errors);
            continue;
        }

        const partial = synthValidation.value as Omit<ChiefSynthesis, "evidence" | "dataFreshness" | "missingEvidence" | "disclaimer" | "status">;

        // Evidence chain: agent summaries + chief's own evidence list, validated
        // against known agent ids / dossier refs.
        const allowed = new Set([...Object.keys(dossier.refs), ...params.outputs.map((o) => o.agentId)]);
        const outputValidation = validateAgentOutput(chief.id, parsed, allowed, { agentVersion: chief.version });
        const chiefEvidence = outputValidation.value?.observations ?? [];

        const synthesis: ChiefSynthesis = {
            status: (parsed.status === "blocked" || parsed.status === "partial" ? parsed.status : "final") as ChiefSynthesis["status"],
            setupState: partial.setupState,
            marketContext: partial.marketContext,
            evidence: chiefEvidence,
            bullishCase: partial.bullishCase,
            bearishCase: partial.bearishCase,
            risks: partial.risks,
            invalidations: partial.invalidations,
            researchNextStep: partial.researchNextStep,
            dataFreshness: {
                mode: params.dataMode,
                asOf: params.dossier.meta.asOf,
                dataTimestamp: dossier.meta.dataTimestamp,
                ageMs: Math.max(0, Date.now() - (dossier.meta.asOf ?? dossier.meta.generatedAt)),
                stale: Math.max(0, Date.now() - (dossier.meta.asOf ?? dossier.meta.generatedAt)) > 15 * 60 * 1000,
            },
            confidence: clamp(partial.confidence, 0, 1),
            missingEvidence: Array.isArray(parsed.missingEvidence)
                ? (parsed.missingEvidence as unknown[]).filter((m): m is string => typeof m === "string").slice(0, 10)
                : [],
            disclaimer: DISCLAIMER,
            synthesisNotes: typeof parsed.synthesisNotes === "string" ? parsed.synthesisNotes.slice(0, 1200) : undefined,
            ...(typeof parsed.blockedReason === "string" ? { blockedReason: parsed.blockedReason.slice(0, 500) } : {}),
        };

        const output: AgentRunOutput = {
            agentId: chief.id,
            agentName: chief.name,
            agentVersion: chief.version,
            status: "completed",
            summary: synthesis.setupState ? `Setup state: ${synthesis.setupState}` : "Synthesis complete.",
            observations: synthesis.evidence,
            evidence: outputValidation.value?.evidence ?? [],
            interpretation: synthesis.marketContext,
            stance: synthesis.bullishCase.length > synthesis.bearishCase.length
                ? "bullish"
                : synthesis.bearishCase.length > synthesis.bullishCase.length
                    ? "bearish"
                    : synthesis.bullishCase.length === 0 && synthesis.bearishCase.length === 0
                        ? "neutral"
                        : "mixed",
            confidence: synthesis.confidence,
            invalidations: synthesis.invalidations,
            risks: synthesis.risks,
            dataTimestamp: dossier.meta.dataTimestamp,
            toolsUsed: ["chief-synthesis"],
            limitations: synthesis.missingEvidence.map((m) => m.slice(0, 200)),
            durationMs: Date.now() - startedAt,
            provider: result.provider,
            model: result.model,
        };

        // Attach synthesis so the orchestrator can persist it atomically.
        (output as AgentRunOutput & { raw_synthesis?: ChiefSynthesis }).raw_synthesis = synthesis;
        return output;
    }

    return emptyChiefOutput(
        chief,
        startedAt,
        "failed",
        errors.slice(-1)[0] || "Chief Analyst produced no valid synthesis.",
    );
}

function emptyChiefOutput(
    chief: TeamAgentDefinition,
    startedAt: number,
    status: AgentRunOutput["status"],
    error: string,
): AgentRunOutput {
    return {
        agentId: chief.id,
        agentName: chief.name,
        agentVersion: chief.version,
        status,
        summary: status === "skipped" ? "Synthesis skipped." : "Chief Analyst could not finalize.",
        observations: [],
        evidence: [],
        interpretation: "",
        stance: "unclear",
        confidence: 0,
        invalidations: [],
        risks: [],
        dataTimestamp: new Date().toISOString(),
        toolsUsed: [],
        limitations: ["No validated synthesis was produced."],
        error,
        durationMs: Date.now() - startedAt,
    };
}

function parseJson(text: string): Record<string, unknown> | null {
    if (!text) return null;
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const candidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    try {
        const parsed = JSON.parse(candidate);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

// NOTE: `safeStringify` / `sliceDossierForAgent` / `summarizeDossierForChief`
// are imported from ./context for internal use and are intentionally NOT
// re-exported here to keep the package barrel (`index.ts`) conflict-free.
