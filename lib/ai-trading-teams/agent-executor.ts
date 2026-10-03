/**
 * Single-agent execution for AI Trading Teams.
 *
 * Pipeline per agent:
 *   dossier slice → prompt → AI router (existing provider abstraction) →
 *   strict JSON parse → protocol validation (FACT reference checking) →
 *   retry on invalid output → structured success OR structured failure.
 *
 * A failed agent NEVER produces fabricated analysis: it returns
 * status "failed" with an error the Chief Analyst must account for.
 */

import type { AgentRunOutput, AITradingTeam, TeamAgentDefinition } from "./types";
import { validateAgentOutput } from "./validation";
import { buildAgentSystemPrompt, buildAgentUserPrompt } from "./prompts";
import { sliceDossierForAgent, type IntelligenceDossier } from "./context";

export interface AICallRequest {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    /** Accounting/observability context only — never forwarded to a provider. */
    sourceId: string;
    userId?: string;
    responseFormat?: "json_object" | "text";
}

export interface AICallResult {
    ok: boolean;
    content: string;
    provider?: string;
    model?: string;
    error?: string;
}

export type AIFn = (request: AICallRequest) => Promise<AICallResult>;

export interface ExecuteAgentParams {
    agent: TeamAgentDefinition;
    team: AITradingTeam;
    dossier: IntelligenceDossier;
    request?: string;
    ai: AIFn;
    userId: string;
    /** Cooperative cancellation check — called before each attempt. */
    isCancelled?: () => Promise<boolean>;
    /** Overrides agent-declared timeout (ms). */
    timeoutMs?: number;
    onEvent?: (event: { state: AgentRunOutput["status"]; detail?: string }) => void;
}

function nowIso(): string {
    return new Date().toISOString();
}

function parseJsonLoose(text: string): unknown | null {
    if (!text) return null;
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const candidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function failedOutput(
    agent: TeamAgentDefinition,
    error: string,
    startedAt: number,
    extra?: Partial<AgentRunOutput>,
): AgentRunOutput {
    return {
        agentId: agent.id,
        agentName: agent.name,
        agentVersion: agent.version,
        status: "failed",
        summary: `${agent.name} could not complete analysis.`,
        observations: [],
        evidence: [],
        interpretation: "",
        stance: "unclear",
        confidence: 0,
        invalidations: [],
        risks: [],
        dataTimestamp: nowIso(),
        toolsUsed: [],
        limitations: ["Agent did not produce a validated result."],
        error: error.slice(0, 500),
        durationMs: Date.now() - startedAt,
        ...extra,
    };
}

/**
 * Executes one agent. Always resolves — never throws — so the orchestrator can
 * continue with partial completion.
 */
export async function executeAgent(params: ExecuteAgentParams): Promise<AgentRunOutput> {
    const { agent, team, dossier, request, ai, userId } = params;
    const startedAt = Date.now();
    const timeoutMs = params.timeoutMs ?? agent.timeoutMs ?? 30000;
    const maxAttempts = Math.max(1, (agent.maxRetries ?? 1) + 1);

    params.onEvent?.({ state: "analyzing", detail: `Analyzing ${agent.name}` });

    const slice = sliceDossierForAgent(dossier, agent);
    const system = buildAgentSystemPrompt(agent, { name: team.name, config: team.config });
    const user = buildAgentUserPrompt({
        agent,
        team,
        request,
        slice,
        dataMode: dossier.meta.mode,
        dataTimestamp: dossier.meta.dataTimestamp,
        dossierLimitations: dossier.meta.limitations,
        missingSections: slice.missingSections,
    });

    const allowedRefs = new Set(Object.keys(slice.refs));
    const errors: string[] = [];
    let lastResult: AgentRunOutput | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (params.isCancelled && (await params.isCancelled())) {
            return {
                ...failedOutput(agent, "Run cancelled before completion.", startedAt),
                status: "skipped",
                summary: "Cancelled before completion.",
            };
        }

        let aiResult: AICallResult;
        try {
            aiResult = await withTimeout(
                ai({
                    system,
                    user: attempt === 1 ? user : `${user}\n\nYour previous response was invalid: ${errors.join("; ")}\nReturn ONLY the JSON object described in the protocol.`,
                    maxTokens: agent.maxOutputTokens ?? 1600,
                    temperature: agent.temperature ?? 0.2,
                    sourceId: agent.id,
                    userId,
                    responseFormat: "json_object",
                }),
                timeoutMs,
                agent.name,
            );
        } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
            continue;
        }

        if (!aiResult.ok) {
            errors.push(aiResult.error || "AI provider returned no content.");
            continue;
        }

        const parsed = parseJsonLoose(aiResult.content);
        if (parsed === null) {
            errors.push("Response was not valid JSON.");
            continue;
        }

        const validation = validateAgentOutput(agent.id, parsed, allowedRefs, { agentVersion: agent.version });
        if (!validation.valid || !validation.value) {
            errors.push(...validation.errors);
            continue;
        }

        const output = validation.value;
        output.agentName = agent.name;
        output.durationMs = Date.now() - startedAt;
        output.provider = aiResult.provider;
        output.model = aiResult.model;
        output.status = "completed";

        const warnings: string[] = [];
        if (validation.demoted.length) {
            warnings.push(
                `${validation.demoted.length} observation(s) lacked a verifiable source reference and were reclassified as UNKNOWN.`,
            );
        }
        if (aiResult.provider === "local") {
            warnings.push(
                "Narrative came from the local heuristic fallback (all cloud providers unavailable) — treat the interpretation as low-trust.",
            );
            output.limitations = [
                ...output.limitations,
                "AI provider unavailable: local heuristic fallback used for narration.",
            ];
        }
        if (slice.missingSections.length) {
            output.limitations = [
                ...output.limitations,
                `Sections unavailable for this agent: ${slice.missingSections.join(", ")}.`,
            ];
        }
        if (warnings.length) output.warnings = warnings;

        // Evidence must be grounded: keep only sources we actually provided or
        // that the agent declared from its tool set.
        const sectionKeys = slice.includedSections as string[];
        output.evidence = output.evidence.filter(
            (ev) => allowedRefs.has(ev.source) || sectionKeys.includes(ev.source.split(".")[0]),
        );

        params.onEvent?.({ state: "completed", detail: output.summary.slice(0, 160) });
        return output;
    }

    lastResult = failedOutput(agent, errors.slice(-1)[0] || "Agent produced no valid output.", startedAt);
    params.onEvent?.({ state: "failed", detail: lastResult.error });
    return lastResult;
}
