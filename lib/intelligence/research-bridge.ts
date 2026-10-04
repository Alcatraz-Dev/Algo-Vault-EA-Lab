/**
 * Strategy Research ⇄ Intelligence Fabric bridge.
 *
 * The research pipeline (lib/strategy-research) is fully deterministic:
 * backtest → OOS/walk-forward → Monte Carlo → robustness → score → lifecycle.
 * THIS module never recomputes, overrides or re-ranks any of it. It only asks
 * the unified router to INTERPRET the deterministic evidence a candidate
 * already carries, so researchers get a plain-language read on their own
 * results (strengths / concerns / what to verify next).
 *
 * Guarantees:
 *  - Interpretation-only: the model receives the compact numeric snapshot the
 *    caller passes in and may only explain it. Its verdict is never merged
 *    into ResearchScore and can never change a lifecycle decision.
 *  - Flag-gated: AI_STRATEGY_RESEARCH (via isStrategyResearchIntelligenceEnabled).
 *  - Honest failure: when no provider can serve, the result is AI_UNAVAILABLE
 *    — no fabricated assessment.
 *  - Financial-safety language enforced on every free-text field.
 */

import type { AIRequest } from "./types";
import { INTELLIGENCE_VERSION } from "./versions";
import { getUnifiedRouter } from "./router";
import { isStrategyResearchIntelligenceEnabled } from "./flags";
import { FINANCIAL_TONE_CLAUSE, checkFinancialLanguage, sanitizeFinancialLanguage } from "./safety";

/** Compact, provider-agnostic view of a research candidate's evidence. */
export interface ResearchCandidateSnapshot {
    id: string;
    name: string;
    market: string;
    timeframe: string;
    direction: string;
    concepts: string[];
    lifecycle: string;
    rejectedReason: string | null;
    backtest: {
        totalTrades: number;
        winRatePct: number;
        profitFactor: number;
        maxDrawdownPct: number;
        expectancyR: number;
    } | null;
    oos: { verdict: string; degradationPct: number; stable: boolean } | null;
    walkForward: { windows: number; stable: boolean; stabilityScore: number } | null;
    monteCarlo: { simulations: number; profitProbabilityPct: number | null; drawdownP95Pct: number | null } | null;
    score: { total: number; verdict: string; factors: Record<string, number> } | null;
    /** Deterministic warnings already attached by the research engine. */
    warnings: string[];
}

export type ResearchAssessmentStatus = "VALIDATED" | "AI_UNAVAILABLE" | "DISABLED";

export interface ResearchAIAssessment {
    requestId: string;
    candidateId: string;
    validationStatus: ResearchAssessmentStatus;
    /** Model's one-line interpretation — informational only. */
    verdict: string | null;
    strengths: string[];
    concerns: string[];
    nextChecks: string[];
    provider: string;
    model: string;
    latencyMs: number;
    versions: {
        signalPolicy: string;
        promptTemplates: string;
        decisionPolicy: string;
    };
    reason?: string;
}

interface ParsedAssessment {
    verdict: string;
    strengths: string[];
    concerns: string[];
    nextChecks: string[];
}

function stringList(v: unknown, max: number, maxLen: number): string[] {
    if (!Array.isArray(v)) return [];
    return v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, max)
        .map((s) => s.trim().slice(0, maxLen));
}

export function parseResearchAssessment(payload: unknown): ParsedAssessment | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const verdict = typeof p.verdict === "string" ? p.verdict.trim() : "";
    if (!verdict) return null;
    return {
        verdict: verdict.slice(0, 300),
        strengths: stringList(p.strengths, 5, 200),
        concerns: stringList(p.concerns, 5, 200),
        nextChecks: stringList(p.nextChecks, 5, 200),
    };
}

function sanitizeList(items: string[]): string[] {
    return items.map((s) => (checkFinancialLanguage(s).safe ? s : sanitizeFinancialLanguage(s)));
}

/**
 * Run the AI assessment for one candidate. Pure over its inputs, never
 * throws, never mutates the candidate. `snapshot` MUST come from the
 * deterministic evaluation — the caller (API route) builds it from storage,
 * never from client input.
 */
export async function runResearchAssessment(
    snapshot: ResearchCandidateSnapshot,
    opts: { userId?: string; userTier?: "free" | "pro" | "admin" } = {},
): Promise<ResearchAIAssessment> {
    const started = Date.now();
    const requestId = `res_${started.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const base = {
        requestId,
        candidateId: snapshot.id,
        provider: "",
        model: "",
        latencyMs: 0,
        versions: {
            signalPolicy: INTELLIGENCE_VERSION.signalPolicy,
            promptTemplates: INTELLIGENCE_VERSION.promptTemplates,
            decisionPolicy: INTELLIGENCE_VERSION.decisionPolicy,
        },
    };

    if (!isStrategyResearchIntelligenceEnabled()) {
        return { ...base, validationStatus: "DISABLED", verdict: null, strengths: [], concerns: [], nextChecks: [], reason: "AI_STRATEGY_RESEARCH disabled" };
    }

    const messages: AIRequest["messages"] = [
        {
            role: "user",
            content: [
                "Interpret this deterministic research evidence for its owner. Do NOT invent numbers; every number you may mention is in the evidence block.",
                "",
                "Evidence:",
                JSON.stringify(snapshot),
                "",
                'Answer ONLY with JSON: {"verdict":"<=1 sentence overall read","strengths":["..."],"concerns":["..."],"nextChecks":["what to verify next"]}',
            ].join("\n"),
        },
    ];

    const req: AIRequest = {
        task: "DEEP_STRATEGY_RESEARCH",
        systemPrompt: `${FINANCIAL_TONE_CLAUSE} You are a quantitative research reviewer. Interpret ONLY the provided deterministic evidence. Never re-rank, never predict future performance, never give investment advice. This is research output, not a trading recommendation.`,
        messages,
        userTier: opts.userTier,
        maxTokens: 800,
        temperature: 0.2,
    };

    const res = await getUnifiedRouter().execute(req, { source: "system", userId: opts.userId });
    if (res.validationStatus !== "ok" || !res.structuredData) {
        return {
            ...base,
            validationStatus: "AI_UNAVAILABLE",
            verdict: null,
            strengths: [],
            concerns: [],
            nextChecks: [],
            latencyMs: Date.now() - started,
            reason: `No AI provider available: ${res.errors?.join(", ") ?? res.validationStatus}`,
        };
    }

    const parsed = parseResearchAssessment(res.structuredData);
    if (!parsed) {
        return {
            ...base,
            validationStatus: "AI_UNAVAILABLE",
            verdict: null,
            strengths: [],
            concerns: [],
            nextChecks: [],
            latencyMs: Date.now() - started,
            reason: "AI output failed schema validation",
        };
    }

    return {
        ...base,
        validationStatus: "VALIDATED",
        verdict: checkFinancialLanguage(parsed.verdict).safe ? parsed.verdict : sanitizeFinancialLanguage(parsed.verdict),
        strengths: sanitizeList(parsed.strengths),
        concerns: sanitizeList(parsed.concerns),
        nextChecks: sanitizeList(parsed.nextChecks),
        provider: res.provider,
        model: res.model,
        latencyMs: Date.now() - started,
    };
}
