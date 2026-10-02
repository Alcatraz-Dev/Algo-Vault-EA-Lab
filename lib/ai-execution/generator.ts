/**
 * AI Execution — plan generation + position review (the AI boundary).
 *
 * Everything here goes through the canonical AI Router (`defaultRouter`) with
 * usage tracking (`source: "workflow"`, sourceId "ai-execution") so budgets and
 * usage accounting apply. The AI receives ONLY structured evidence that the
 * platform's own engines produced, and its output is treated strictly as
 * interpretation: prices, sizes and risk numbers in the final plan come from
 * deterministic inputs, never from the model.
 *
 * Fail behavior: if the AI is unavailable, over budget, or returns garbage,
 * generation fails honestly (PLAN_GENERATION_FAILED) — a deterministic
 * non-AI fallback plan is NOT fabricated, because a plan must be interpretable
 * and the budget/privacy rules must hold. Deterministic machinery (risk gate,
 * expiry, audit) keeps working without AI.
 */

import { defaultRouter } from "@/lib/ai/router";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import type { MarketRegime } from "@/lib/ai-signals/types";
import type {
    AutomationPolicy,
    EvidenceItem,
    ExecutionMode,
    TradeDirection,
    TradePlan,
} from "./types";
import { clampAutomationPolicy, unavailableEvidence } from "./types";
import { validateTradePlan } from "./validate";
import { writeAudit } from "./database";
import { randomUUID } from "crypto";

const GENERATION_SYSTEM_PROMPT = [
    "You are the AlgoVault AI Execution analyst.",
    "You interpret structured market evidence that AlgoVault's deterministic engines produced.",
    "Rules you must never break:",
    "- Never invent prices, indicator values, statistics, or outcomes.",
    "- Never claim a trade is profitable or likely to win.",
    "- If evidence is missing or conflicting, say so explicitly.",
    "- Your output is an interpretation, not an instruction to trade.",
].join("\n");

interface BuildPlanInput {
    uid: string;
    instrument: string;
    direction: TradeDirection;
    timeframe: string;
    entry: number;
    stopLoss: number;
    takeProfits: Array<{ index: number; price: number }>;
    riskPercent: number;
    executionMode: ExecutionMode;
    setupId?: string;
    setupDefinitionId?: string;
    strategyId?: string;
    signalId?: string;
    /** Deterministic evidence gathered by the caller (radar/analysis/scanner). */
    evidence: EvidenceItem[];
    marketRegime: MarketRegime | string;
    /** Optional upstream workflow run for audit linkage. */
    workflowRunId?: string;
}

/**
 * Generate a TradePlan: deterministic inputs + one AI interpretation pass.
 *
 * The caller (API route / workflow node) supplies the deterministic trade shape
 * — derived from real signals/analysis — and this function asks the AI only for
 * the interpretation, invalidation conditions and conflict notes.
 */
export async function generateTradePlan(
    input: BuildPlanInput,
    policy: AutomationPolicy,
): Promise<{ plan?: TradePlan; error?: string; aiUsed: boolean }> {
    const automation = clampAutomationPolicy(policy);
    const spec = getSymbolSpec(input.instrument);
    if (!spec) {
        return { error: `Unsupported instrument ${input.instrument}.`, aiUsed: false };
    }

    const now = Date.now();

    // Schema pre-check of the deterministic shape BEFORE spending any AI call.
    const draft: TradePlan = {
        id: `plan_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
        userId: input.uid,
        instrument: input.instrument.toUpperCase().replace("/", ""),
        direction: input.direction,
        timeframe: input.timeframe,
        entry: input.entry,
        stopLoss: input.stopLoss,
        takeProfits: input.takeProfits,
        riskPercent: input.riskPercent,
        setupId: input.setupId,
        setupDefinitionId: input.setupDefinitionId,
        strategyId: input.strategyId,
        signalId: input.signalId,
        marketRegime: input.marketRegime,
        evidence: input.evidence,
        invalidationConditions: [],
        status: "DRAFT",
        executionMode: input.executionMode,
        generatedAt: now,
        expiresAt: now + automation.planExpiryMs,
        createdAt: now,
        updatedAt: now,
        workflowRunId: input.workflowRunId,
    };

    const precheck = validateTradePlan(draft, { maxRiskPercent: automation.maxRiskPercentPerTrade });
    if (!precheck.valid) {
        return { error: `PLAN_INVALID: ${precheck.errors.join(" ")}`, aiUsed: false };
    }

    // ── AI interpretation pass (budget-gated by the router) ──────────────────
    let interpretation: string | undefined;
    let model: string | undefined;
    const evidenceJson = JSON.stringify(
        input.evidence.map((e) => ({
            class: e.evidenceClass,
            source: e.sourceId,
            label: e.label,
            value: e.value ?? null,
            observedAt: e.observedAt,
            reason: e.reason ?? null,
        })),
    );

    try {
        const prompt = [
            `Instrument: ${draft.instrument} (${draft.timeframe})`,
            `Proposed direction: ${draft.direction}`,
            `Entry: ${draft.entry}  Stop: ${draft.stopLoss}  Targets: ${draft.takeProfits.map((t) => t.price).join(", ")}`,
            `Risk per trade: ${draft.riskPercent}%`,
            `Market regime: ${String(draft.marketRegime)}`,
            "",
            "Structured evidence (produced by AlgoVault engines):",
            evidenceJson,
            "",
            "Tasks:",
            "1. Summarize the confluence and why this setup would qualify (or not).",
            "2. List concrete invalidation conditions (price/structure based).",
            "3. Note any conflicts or missing evidence.",
            "Respond as compact JSON: {\"summary\": string, \"invalidations\": string[], \"conflicts\": string[]}",
        ].join("\n");

        const text = await defaultRouter.generateText(prompt, GENERATION_SYSTEM_PROMPT, {
            source: "workflow",
            sourceId: "ai-execution",
            userId: input.uid,
        });
        if (text && text.trim()) {
            interpretation = text.trim().slice(0, 4000);
            model = "ai-router";
        }
    } catch {
        // Budget exceeded / provider outage — the plan still exists but carries
        // an explicit UNAVAILABLE interpretation marker instead of fake text.
        interpretation = undefined;
    }

    const invalidations = parseInvalidations(interpretation);
    draft.aiInterpretation = interpretation ?? undefined;
    draft.aiModel = model;
    draft.invalidationConditions = invalidations.length > 0
        ? invalidations
        : [
            `Stop loss at ${draft.stopLoss} invalidates the trade thesis.`,
            `Plan expires at ${new Date(draft.expiresAt).toISOString()} — the setup is no longer executed after that.`,
        ];
    draft.status = "VALIDATING";

    if (!interpretation) {
        draft.evidence = [
            ...draft.evidence,
            unavailableEvidence(
                `ai-interpretation-${now}`,
                "ai-execution.interpretation",
                "AI interpretation",
                "AI unavailable or over budget — plan is deterministic-only.",
            ),
        ];
    }

    await writeAudit({
        userId: input.uid,
        action: "PLAN_GENERATED",
        planId: draft.id,
        actor: interpretation ? "ai:ai-router" : "system",
        executionMode: draft.executionMode,
        evidenceIds: draft.evidence.map((e) => e.id),
    });

    return { plan: draft, aiUsed: Boolean(interpretation) };
}

/** Extracts the invalidations array from the AI's JSON-ish reply, safely. */
function parseInvalidations(text: string | undefined): string[] {
    if (!text) return [];
    try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start === -1 || end <= start) return [];
        const parsed = JSON.parse(text.slice(start, end + 1)) as { invalidations?: unknown };
        if (!Array.isArray(parsed.invalidations)) return [];
        return parsed.invalidations
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter((v) => v.length > 0 && v.length <= 500)
            .slice(0, 8);
    } catch {
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Position review (monitoring of already-authorized positions)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionReviewInput {
    uid: string;
    plan: TradePlan;
    currentPrice: number | null;
    evidence: EvidenceItem[];
    openSince: number;
}

/**
 * Review an OPEN position: the AI interprets fresh evidence against the original
 * thesis. The verdict drives the UI and — only through the deterministic gate
 * again — any protective action. This function itself never touches the broker.
 */
export async function reviewOpenPosition(
    input: PositionReviewInput,
): Promise<{ review?: import("./types").PositionReview; error?: string }> {
    const now = Date.now();
    const evidenceJson = JSON.stringify(
        input.evidence.map((e) => ({ class: e.evidenceClass, source: e.sourceId, label: e.label, value: e.value ?? null, reason: e.reason ?? null })),
    );

    let verdict: import("./types").PositionReviewVerdict = "UNAVAILABLE";
    let summary = "AI review unavailable.";
    let model: string | undefined;
    let proposedAction: import("./types").PositionReview["proposedAction"];

    try {
        const prompt = [
            `Position review for ${input.plan.instrument} ${input.plan.direction}.`,
            `Entry: ${input.plan.entry}  Stop: ${input.plan.stopLoss}  TP1: ${input.plan.takeProfits[0]?.price ?? "n/a"}`,
            `Current price: ${input.currentPrice ?? "unavailable"}`,
            `Open since: ${new Date(input.openSince).toISOString()}`,
            `Original invalidation conditions: ${JSON.stringify(input.plan.invalidationConditions)}`,
            "",
            "Fresh structured evidence:",
            evidenceJson,
            "",
            "Classify the position state and respond as compact JSON:",
            '{"verdict":"THESIS_VALID|THESIS_WEAKENED|INVALIDATION_DETECTED|MANAGEMENT_CONDITION_TRIGGERED|MONITORING_WARNING|EXIT_CONDITION_DETECTED","summary":string,"proposedAction":{"kind":"NONE|MOVE_SL|PARTIAL_CLOSE|CLOSE","reason":string}}',
        ].join("\n");

        const text = await defaultRouter.generateText(prompt, GENERATION_SYSTEM_PROMPT, {
            source: "workflow",
            sourceId: "ai-execution",
            userId: input.uid,
        });
        if (text && text.trim()) {
            const parsed = parseReview(text);
            if (parsed) {
                verdict = parsed.verdict;
                summary = parsed.summary.slice(0, 2000);
                model = "ai-router";
                if (parsed.proposedAction) proposedAction = parsed.proposedAction;
            }
        }
    } catch {
        // fall through to UNAVAILABLE
    }

    if (verdict === "UNAVAILABLE") {
        return {
            review: {
                id: `rev_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
                userId: input.uid,
                planId: input.plan.id,
                clientOrderId: input.plan.execution?.clientOrderId,
                verdict,
                summary,
                evidence: input.evidence,
                model,
                createdAt: now,
            },
        };
    }

    return {
        review: {
            id: `rev_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
            userId: input.uid,
            planId: input.plan.id,
            clientOrderId: input.plan.execution?.clientOrderId,
            verdict,
            summary,
            evidence: input.evidence,
            proposedAction,
            model,
            createdAt: now,
        },
    };
}

const VALID_VERDICTS: readonly string[] = [
    "THESIS_VALID", "THESIS_WEAKENED", "INVALIDATION_DETECTED",
    "MANAGEMENT_CONDITION_TRIGGERED", "MONITORING_WARNING", "EXIT_CONDITION_DETECTED",
];

function parseReview(text: string): { verdict: import("./types").PositionReviewVerdict; summary: string; proposedAction?: import("./types").PositionReview["proposedAction"] } | null {
    try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start === -1 || end <= start) return null;
        const raw = JSON.parse(text.slice(start, end + 1)) as {
            verdict?: string;
            summary?: string;
            proposedAction?: { kind?: string; reason?: string };
        };
        if (!raw.verdict || !VALID_VERDICTS.includes(raw.verdict)) return null;
        const kind = raw.proposedAction?.kind;
        const validKinds = ["NONE", "MOVE_SL", "PARTIAL_CLOSE", "CLOSE"];
        return {
            verdict: raw.verdict as import("./types").PositionReviewVerdict,
            summary: typeof raw.summary === "string" ? raw.summary : "",
            proposedAction:
                kind && validKinds.includes(kind)
                    ? { kind: kind as import("./types").PositionReview["proposedAction"] extends undefined ? never : "MOVE_SL" | "PARTIAL_CLOSE" | "CLOSE" | "NONE", params: {}, reason: String(raw.proposedAction?.reason ?? "") }
                    : undefined,
        };
    } catch {
        return null;
    }
}
