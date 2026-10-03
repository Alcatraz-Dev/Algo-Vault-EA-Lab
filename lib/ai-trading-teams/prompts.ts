/**
 * Prompt construction for AI Trading Teams.
 *
 * Prompts are context-minimized: each agent receives only its own dossier
 * slice, the evidence protocol and its structured output contract. The Chief
 * Analyst receives SUMMARIES of the other agents — never their raw payloads
 * again — plus the deterministic dossier summary and conflict analysis.
 */

import type { AgentRunOutput, AITradingTeam, TeamAgentDefinition, TeamConsensus, TeamConfig } from "./types";
import type { AgentContextSlice, IntelligenceDossier } from "./context";
import { summarizeDossierForChief } from "./context";
import { safeStringify } from "./context";

export const OUTPUT_PROTOCOL = `Return ONLY one valid JSON object (no markdown fences, no commentary) with this exact shape:
{
  "summary": "1-3 sentence finding",
  "observations": [{ "id": "obs_1", "kind": "FACT|INTERPRETATION|HYPOTHESIS|RISK|INVALIDATION|UNKNOWN", "text": "...", "reference": "source.id" }],
  "evidence": [{ "id": "ev_1", "source": "dossier section or source id actually read", "note": "optional" }],
  "interpretation": "what the evidence means for your specialty",
  "stance": "bullish|bearish|neutral|mixed|unclear",
  "confidence": 0.0,
  "invalidations": ["condition that invalidates this view"],
  "risks": ["risk factor"],
  "toolsUsed": ["sections/tools actually consumed"],
  "limitations": ["what could not be verified"],
  "reasoningSummary": "concise, user-safe summary of how you reached this (never hidden chain-of-thought)"
}
FACT observations MUST carry a "reference" that appears verbatim in the provided source ids. If you cannot cite it, do not mark it FACT.`;

export const CHIEF_OUTPUT_PROTOCOL = `Return ONLY one valid JSON object (no markdown fences) with this exact shape:
{
  "status": "final|partial|blocked",
  "setupState": "WAITING|WATCHING|VALIDATING|CONFIRMED|INVALIDATED|CANCELLED",
  "marketContext": "current market context synthesized from provided evidence",
  "evidence": [{ "id": "e1", "kind": "FACT|INTERPRETATION|HYPOTHESIS|RISK|INVALIDATION|UNKNOWN", "text": "...", "reference": "agentId or dossier source" }],
  "bullishCase": ["evidence-backed point"],
  "bearishCase": ["evidence-backed point"],
  "risks": ["risk factor"],
  "invalidations": ["invalidation condition"],
  "researchNextStep": "single actionable research action (never a trade instruction)",
  "confidence": 0.0,
  "missingEvidence": ["what the team could not establish"],
  "blockedReason": "required when status is blocked",
  "synthesisNotes": "how conflicts were reconciled"
}
You may NOT introduce market facts that are not present in the provided agent outputs or dossier summary. Setup state is a RESEARCH state, never a trade recommendation.`;

function configBlock(config: TeamConfig): string {
    return [
        `Market: ${config.market}`,
        `Style: ${config.style}`,
        `Entry timeframe: ${config.entryTimeframe}`,
        `Confirmation timeframe: ${config.confirmationTimeframe}`,
        `Context timeframe: ${config.contextTimeframe}`,
        `Risk profile: ${config.riskProfile}`,
        `Team behavior: ${config.behavior}`,
    ].join("\n");
}

export function buildAgentSystemPrompt(agent: TeamAgentDefinition, team?: Pick<AITradingTeam, "name" | "config">): string {
    const teamLine = team ? `\nYou are one member of the "${team.name}" AI Trading Team. Your output is reviewed by a Chief Analyst and cannot become a final conclusion on its own.` : "";
    const toolLine = `\nTools you may cite: ${agent.tools.join(", ")}. Sections you were given: see the dossier payload.`;
    const limitationLine = agent.limitations.length ? `\nYour declared limitations:\n- ${agent.limitations.join("\n- ")}` : "";
    return `${agent.systemInstructions}${teamLine}${toolLine}${limitationLine}\n${OUTPUT_PROTOCOL}`;
}

export interface AgentPromptInput {
    agent: TeamAgentDefinition;
    team: AITradingTeam;
    request?: string;
    slice: AgentContextSlice;
    dataMode: string;
    dataTimestamp: string;
    dossierLimitations: string[];
    missingSections: string[];
}

export function buildAgentUserPrompt(input: AgentPromptInput): string {
    const parts: string[] = [];
    parts.push(`TASK\n${input.request?.trim() || `Analyze ${input.team.config.market} for the ${input.team.config.style} team and report findings from your specialty.`}`);
    parts.push(`\nTEAM CONFIG\n${configBlock(input.team.config)}`);
    parts.push(`\nRUN CONTEXT\nMode: ${input.dataMode} | Data timestamp: ${input.dataTimestamp}`);
    if (input.slice.missingSections.length) {
        parts.push(`Sections unavailable for you: ${input.slice.missingSections.join(", ")} — treat anything depending on them as UNKNOWN.`);
    }
    if (input.dossierLimitations.length) {
        parts.push(`\nDATA LIMITATIONS (must be reflected in your limitations):\n- ${input.dossierLimitations.slice(0, 8).join("\n- ")}`);
    }
    const refs = Object.entries(input.slice.refs);
    if (refs.length) {
        parts.push(`\nALLOWED FACT REFERENCES (cite these verbatim):\n${refs.map(([id, label]) => `- ${id}: ${label}`).join("\n")}`);
    }
    parts.push(`\nDOSSIER DATA (only these sections were provided to you)\n${safeStringify(input.slice.data)}`);
    return parts.join("\n");
}

export interface ChiefPromptInput {
    chief: TeamAgentDefinition;
    team: AITradingTeam;
    request?: string;
    outputs: AgentRunOutput[];
    consensus: TeamConsensus;
    dossier: IntelligenceDossier;
    skipped: { agentId: string; reason: string }[];
    behaviorNotes: string[];
    dataMode: string;
}

function summarizeAgentOutput(output: AgentRunOutput, name?: string): string {
    const obs = output.observations
        .slice(0, 12)
        .map((o) => `- [${o.kind}]${o.reference ? ` (${o.reference})` : ""} ${o.text}`)
        .join("\n");
    return [
        `### ${name ?? output.agentId} [${output.agentVersion}] — ${output.status}`,
        `stance: ${output.stance} | confidence: ${output.confidence}`,
        `summary: ${output.summary}`,
        `interpretation: ${output.interpretation || "-"}`,
        `observations:\n${obs || "- none"}`,
        `risks: ${output.risks.join("; ") || "-"}`,
        `invalidations: ${output.invalidations.join("; ") || "-"}`,
        `limitations: ${output.limitations.join("; ") || "-"}`,
        output.error ? `error: ${output.error}` : "",
    ].filter(Boolean).join("\n");
}

export function buildChiefUserPrompt(input: ChiefPromptInput): string {
    const parts: string[] = [];
    parts.push(`TASK\n${input.request?.trim() || `Synthesize the team's research on ${input.team.config.market}.`}`);
    parts.push(`\nTEAM CONFIG\n${configBlock(input.team.config)}`);

    parts.push(`\nAGENT OUTPUTS (structured evidence from this run)`);
    if (input.outputs.length === 0) {
        parts.push("No agent outputs were produced.");
    } else {
        for (const out of input.outputs) {
            const agentName = out.agentName ?? out.agentId;
            parts.push(summarizeAgentOutput(out, agentName));
        }
    }

    parts.push(`\nCONFLICT ANALYSIS (computed deterministically, not by you)`);
    parts.push(safeStringify({
        stance: input.consensus.stance,
        agreementRatio: input.consensus.agreementRatio,
        agentsByStance: input.consensus.agentsByStance,
        conflicts: input.consensus.conflicts,
        missingEvidence: input.consensus.missingEvidence,
        criticalRisks: input.consensus.criticalRisks,
        invalidations: input.consensus.invalidations,
    }));

    if (input.skipped.length) {
        parts.push(`\nSKIPPED AGENTS\n${input.skipped.map((s) => `- ${s.agentId}: ${s.reason}`).join("\n")}`);
    }
    if (input.behaviorNotes.length) {
        parts.push(`\nBEHAVIOR RULES (enforced by the orchestrator)\n- ${input.behaviorNotes.join("\n- ")}`);
    }

    parts.push(`\nDETERMINISTIC DOSSIER SUMMARY (computed from market data, no LLM)`);
    parts.push(safeStringify(summarizeDossierForChief(input.dossier)));

    parts.push(`\nRUN CONTEXT\nMode: ${input.dataMode} | Data timestamp: ${input.dossier.meta.dataTimestamp}`);
    parts.push(`\n${CHIEF_OUTPUT_PROTOCOL}`);
    return parts.join("\n");
}
