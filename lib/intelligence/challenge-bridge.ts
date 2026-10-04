/**
 * Performance Arena ⇄ Intelligence Fabric bridge — AI Challenge Review.
 *
 * The Performance Arena (lib/performance-arena) is the platform's challenge
 * system. It already produces, deterministically and server-side:
 *   - Guardian insights (rule-discipline + risk-behavior facts)
 *   - ChallengeMetrics (drawdown, daily loss, consistency, rule utilization)
 *   - PassRequirement[] (deterministic progress vs policy)
 * and a full AI pass exists in service.runGuardianAI (credit-charged).
 *
 * THIS module is an additive composition layer on top of that deterministic
 * state. It does NOT evaluate rules, alter accounting, or override settlement.
 * It asks the unified router for a structured behavioral narrative (task
 * CHALLENGE_REVIEW) from the deterministic facts the caller passes in —
 * typically fetched server-side via getAttemptState().
 *
 * Guarantees:
 *  - AI is commentary only; challenge accounting is untouched.
 *  - Flag-gated: AI_CHALLENGE_REVIEW (via isChallengeReviewEnabled).
 *  - Honest failure: AI_UNAVAILABLE, never fabricated content.
 *  - Financial-safety language enforced on all free text.
 */

import type { AIRequest } from "./types";
import { INTELLIGENCE_VERSION } from "./versions";
import { getUnifiedRouter } from "./router";
import { isChallengeReviewEnabled } from "./flags";
import { FINANCIAL_TONE_CLAUSE, checkFinancialLanguage, sanitizeFinancialLanguage } from "./safety";

/**
 * Deterministic challenge-behavior facts. The caller (API route) builds this
 * from `getAttemptState()` — metrics + Guardian insights + requirements.
 */
export interface ChallengeReviewInput {
    attemptId: string;
    definitionKey: string;
    status: string;
    metrics: {
        equityCents: number | null;
        startingBalanceCents: number | null;
        totalReturnPct: number | null;
        currentDrawdownPct: number | null;
        drawdownUsedPct: number | null;
        dailyLossUsedPct: number | null;
        totalTrades: number | null;
        winRatePct: number | null;
        profitFactor: number | null;
        consistencyPassed: boolean | null;
    };
    /** Deterministic Guardian insights (rule-discipline facts). */
    guardianInsights: Array<{ id: string; title: string; severity: string; message: string }>;
    /** Deterministic pass requirements with current utilization. */
    requirements: Array<{ id: string; label: string; current: number; target: number; met: boolean }>;
    /** Rule events already emitted by the deterministic rule engine. */
    recentRuleEvents: Array<{ ruleId: string; type: string; severity: string }>;
}

export type ChallengeReviewStatus = "VALIDATED" | "AI_UNAVAILABLE" | "DISABLED";

export interface ChallengeReview {
    requestId: string;
    attemptId: string;
    validationStatus: ChallengeReviewStatus;
    /** Model's overall behavioral narrative (2–4 sentences, informational). */
    narrative: string | null;
    /** Concrete behaviors to change — advisory only. */
    focusAreas: string[];
    /** Deterministic items the trader must satisfy — NOT AI-generated. */
    ruleCompliance: string[];
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

interface ParsedReview {
    narrative: string;
    focusAreas: string[];
}

function stringList(v: unknown, max: number, maxLen: number): string[] {
    if (!Array.isArray(v)) return [];
    return v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, max)
        .map((s) => s.trim().slice(0, maxLen));
}

export function parseChallengeReview(payload: unknown): ParsedReview | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const narrative = typeof p.narrative === "string" ? p.narrative.trim() : "";
    if (!narrative) return null;
    return { narrative: narrative.slice(0, 800), focusAreas: stringList(p.focusAreas, 5, 200) };
}

function sanitizeList(items: string[]): string[] {
    return items.map((s) => (checkFinancialLanguage(s).safe ? s : sanitizeFinancialLanguage(s)));
}

/** Type-safe projection of the parts of GuardianInsight we display. */
interface GuardianLike {
    id: string;
    title?: string;
    severity?: string;
    message?: string;
}

/** Type-safe projection of the parts of PassRequirement we display. */
interface RequirementLike {
    id?: string;
    label: string;
    current: number;
    target: number;
    met?: boolean;
}

/**
 * Build the deterministic review input from the Arena's own state objects.
 * Pure projection: no evaluation, no thresholds recomputed here.
 */
export function buildChallengeReviewInput(state: {
    attempt: { id: string; definitionKey: string; status: string };
    metrics: ChallengeReviewInput["metrics"] | Record<string, unknown>;
    guardian: GuardianLike[];
    requirements: RequirementLike[];
    /** ChallengeEvents from the Arena; RULE_* ones become rule telemetry. */
    recentEvents?: Array<{ type?: string; severity?: string }>;
}): ChallengeReviewInput {
    const m = (state.metrics ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
        attemptId: state.attempt.id,
        definitionKey: state.attempt.definitionKey,
        status: state.attempt.status,
        metrics: {
            equityCents: num(m.equityCents),
            startingBalanceCents: num(m.startingBalanceCents),
            totalReturnPct: num(m.totalReturnPct),
            currentDrawdownPct: num(m.currentDrawdownPct),
            drawdownUsedPct: num(m.drawdownUsedPct),
            dailyLossUsedPct: num(m.dailyLossUsedSide ?? m.dailyLossUsedPct),
            totalTrades: num(m.totalTrades),
            winRatePct: num(m.winRatePct),
            profitFactor: num(m.profitFactor),
            consistencyPassed: typeof m.consistencyPassed === "boolean" ? m.consistencyPassed : null,
        },
        guardianInsights: (state.guardian ?? []).slice(0, 8).map((g) => ({
            id: g.id,
            title: (g.title ?? "").slice(0, 120),
            severity: (g.severity ?? "info").slice(0, 20),
            message: (g.message ?? "").slice(0, 240),
        })),
        requirements: (state.requirements ?? []).slice(0, 8).map((r) => ({
            id: r.id ?? r.label,
            label: r.label.slice(0, 120),
            current: r.current,
            target: r.target,
            met: Boolean(r.met),
        })),
        recentRuleEvents: (state.recentEvents ?? [])
            .filter((e) => typeof e.type === "string" && e.type.startsWith("RULE_"))
            .slice(0, 10)
            .map((e) => ({
                ruleId: String((e as { payload?: { ruleId?: unknown } })?.payload?.ruleId ?? ""),
                type: String(e.type),
                severity: String(e.severity ?? "info"),
            })),
    };
}

/**
 * Run the AI challenge review. Never throws, never charges credits (the
 * existing credit-charged Guardian AI pass remains the deeper tool), never
 * mutates challenge state.
 */
export async function runChallengeReview(
    input: ChallengeReviewInput,
    opts: { userId?: string; userTier?: "free" | "pro" | "admin" } = {},
): Promise<ChallengeReview> {
    const started = Date.now();
    const requestId = `chr_${started.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const base = {
        requestId,
        attemptId: input.attemptId,
        provider: "",
        model: "",
        latencyMs: 0,
        versions: {
            signalPolicy: INTELLIGENCE_VERSION.signalPolicy,
            promptTemplates: INTELLIGENCE_VERSION.promptTemplates,
            decisionPolicy: INTELLIGENCE_VERSION.decisionPolicy,
        },
    };

    if (!isChallengeReviewEnabled()) {
        return {
            ...base,
            validationStatus: "DISABLED",
            narrative: null,
            focusAreas: [],
            ruleCompliance: input.requirements.map((r) => `${r.label}: ${r.current}/${r.target} — ${r.met ? "met" : "not met"}`),
            reason: "AI_CHALLENGE_REVIEW disabled",
        };
    }

    const messages: AIRequest["messages"] = [
        {
            role: "user",
            content: [
                "Review this trader's deterministic challenge telemetry. Comment ONLY on behaviors the evidence shows (risk discipline, drawdown management, consistency, rule utilization).",
                "You are reviewing behavior, not predicting results and not giving investment advice.",
                "",
                "Telemetry:",
                JSON.stringify(input),
                "",
                'Answer ONLY with JSON: {"narrative":"2-4 sentences","focusAreas":["<=3 concrete behavioral adjustments"]}',
            ].join("\n"),
        },
    ];

    const req: AIRequest = {
        task: "CHALLENGE_REVIEW",
        systemPrompt: `${FINANCIAL_TONE_CLAUSE} You are a trading-discipline reviewer for a SIMULATED challenge. Interpret ONLY the provided deterministic telemetry. You never alter rules, accounting or settlement, never predict outcomes, never promise performance.`,
        messages,
        userTier: opts.userTier,
        maxTokens: 600,
        temperature: 0.2,
    };

    const res = await getUnifiedRouter().execute(req, { source: "system", userId: opts.userId });
    if (res.validationStatus !== "ok" || !res.structuredData) {
        return {
            ...base,
            validationStatus: "AI_UNAVAILABLE",
            narrative: null,
            focusAreas: [],
            ruleCompliance: input.requirements.map((r) => `${r.label}: ${r.current}/${r.target} — ${r.met ? "met" : "not met"}`),
            reason: `No AI provider available: ${res.errors?.join(", ") ?? res.validationStatus}`,
        };
    }

    const parsed = parseChallengeReview(res.structuredData);
    if (!parsed) {
        return {
            ...base,
            validationStatus: "AI_UNAVAILABLE",
            narrative: null,
            focusAreas: [],
            ruleCompliance: input.requirements.map((r) => `${r.label}: ${r.current}/${r.target} — ${r.met ? "met" : "not met"}`),
            reason: "AI output failed schema validation",
        };
    }

    return {
        ...base,
        validationStatus: "VALIDATED",
        narrative: checkFinancialLanguage(parsed.narrative).safe ? parsed.narrative : sanitizeFinancialLanguage(parsed.narrative),
        focusAreas: sanitizeList(parsed.focusAreas),
        ruleCompliance: input.requirements.map((r) => `${r.label}: ${r.current}/${r.target} — ${r.met ? "met" : "not met"}`),
        provider: res.provider,
        model: res.model,
        latencyMs: Date.now() - started,
    };
}
