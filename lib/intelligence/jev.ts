/**
 * Jev Decision Engine — structured decision/validation layer.
 *
 * Jev is NOT the risk engine and NOT the execution engine. It turns a
 * MarketIntelligenceContext into a fixed question set answered as
 * yes/no/unclear, a BUY/SELL/HOLD decision and a confidence — all structured,
 * all auditable, all versioned.
 *
 * Provider mapping (in order of preference):
 *  1. A dedicated Jev endpoint (JEV_API_URL + JEV_API_KEY) when configured —
 *     the fabric POSTs the market context and expects the Jev JSON schema.
 *  2. Otherwise a Jev-profiled LLM call through the unified router
 *     (fast + structured), strictly schema-validated.
 *  3. When neither is available, the result is UNAVAILABLE with an explicit
 *     reason — never a fabricated decision.
 *
 * Answers are derived deterministically from the market context facts whenever
 * possible; the model only adjudicates the ambiguous ones and the final
 * decision. Free-form text never reaches the decision path.
 */

import type { AIRequest, JevResult, JevAnswer, JevAnswerValue, MarketIntelligenceContext } from "./types";
import { INTELLIGENCE_VERSION } from "./versions";
import { getUnifiedRouter } from "./router";
import { isJevEnabled } from "./flags";
import { FINANCIAL_TONE_CLAUSE } from "./safety";

// ── Question set ─────────────────────────────────────────────────────────────

export interface JevQuestionDef {
    id: string;
    question: string;
    factKey?: string;
}

export const JEV_QUESTIONS: JevQuestionDef[] = [
    { id: "structure_aligned", question: "Is market structure aligned with the proposed direction?", factKey: "structure.bias" },
    { id: "htf_aligned", question: "Is the setup aligned with HTF direction?", factKey: "htf.bias" },
    { id: "liquidity_swept", question: "Was liquidity swept in the setup's favor?", factKey: "liquidity.sweeps" },
    { id: "fvg_valid", question: "Is a valid FVG present?", factKey: "fvg.active" },
    { id: "ob_valid", question: "Is a valid Order Block present?", factKey: "orderBlocks.active" },
    { id: "volatility_ok", question: "Is volatility acceptable (not extreme)?", factKey: "volatility.state" },
    { id: "regime_compatible", question: "Is the market regime compatible with the setup?", factKey: "regime" },
    { id: "internally_consistent", question: "Is the setup internally consistent?", factKey: "structure.bias" },
    { id: "quality", question: "Is this a high-quality setup?", factKey: "setup.quality" },
];

// ── Schema (for LLM-profiled Jev) ────────────────────────────────────────────

export const JEV_SCHEMA = {
    type: "object",
    properties: {
        decision: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        answers: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    answer: { type: "string", enum: ["yes", "no", "unclear"] },
                    confidence: { type: "number" },
                },
                required: ["id", "answer"],
            },
        },
        reasoning_summary: { type: "string" },
    },
    required: ["decision", "confidence"],
};

// ── Deterministic pre-answers from market facts ──────────────────────────────

function getPath(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);
}

interface DerivedAnswer {
    answer: JevAnswerValue;
    confidence: number;
    evidence: string;
}

export function deriveAnswer(
    q: JevQuestionDef,
    ctx: MarketIntelligenceContext,
    direction: "BUY" | "SELL" | "HOLD",
): DerivedAnswer | undefined {
    const val = getPath(ctx, q.factKey ?? "");
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v.toLowerCase() : undefined);
    const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

    switch (q.id) {
        case "structure_aligned": {
            const bias = str(val);
            if (!bias || bias === "unknown" || bias === "neutral" || bias === "range") return undefined;
            if (bias === "bullish") {
                return direction === "BUY"
                    ? { answer: "yes", confidence: 0.9, evidence: `structure ${bias}` }
                    : { answer: "no", confidence: 0.9, evidence: `structure ${bias} vs ${direction}` };
            }
            return direction === "SELL"
                ? { answer: "yes", confidence: 0.9, evidence: `structure ${bias}` }
                : { answer: "no", confidence: 0.9, evidence: `structure ${bias} vs ${direction}` };
        }
        case "htf_aligned": {
            const bias = str(val);
            if (!bias || bias === "neutral" || bias === "unknown") return undefined;
            if (bias === "bullish") {
                return direction === "BUY"
                    ? { answer: "yes", confidence: 0.85, evidence: `HTF ${bias}` }
                    : { answer: "no", confidence: 0.85, evidence: `HTF ${bias} vs ${direction}` };
            }
            return direction === "SELL"
                ? { answer: "yes", confidence: 0.85, evidence: `HTF ${bias}` }
                : { answer: "no", confidence: 0.85, evidence: `HTF ${bias} vs ${direction}` };
        }
        case "liquidity_swept": {
            const n = num(val);
            if (n === undefined) return undefined;
            return n > 0
                ? { answer: "yes", confidence: 0.8, evidence: `${n} sweep(s)` }
                : { answer: "no", confidence: 0.6, evidence: "no recent sweep" };
        }
        case "fvg_valid": {
            const n = num(val);
            if (n === undefined) return undefined;
            return n > 0
                ? { answer: "yes", confidence: 0.75, evidence: `${n} active FVG` }
                : { answer: "no", confidence: 0.7, evidence: "no active FVG" };
        }
        case "ob_valid": {
            const n = num(val);
            if (n === undefined) return undefined;
            return n > 0
                ? { answer: "yes", confidence: 0.75, evidence: `${n} active OB` }
                : { answer: "no", confidence: 0.7, evidence: "no active OB" };
        }
        case "volatility_ok": {
            const s = str(val);
            if (!s) return undefined;
            if (s.includes("extreme") || s === "very_high") {
                return { answer: "no", confidence: 0.8, evidence: `volatility ${s}` };
            }
            return { answer: "yes", confidence: 0.7, evidence: `volatility ${s}` };
        }
        case "regime_compatible": {
            const s = str(val);
            if (!s) return undefined;
            if (s.includes("trending")) {
                return direction === "HOLD"
                    ? { answer: "no", confidence: 0.6, evidence: `regime ${s} favors direction` }
                    : { answer: "yes", confidence: 0.7, evidence: `regime ${s}` };
            }
            if (s === "ranging") {
                return direction === "HOLD"
                    ? { answer: "yes", confidence: 0.6, evidence: "ranging favors HOLD" }
                    : { answer: "unclear", confidence: 0.4, evidence: `regime ${s}` };
            }
            return undefined;
        }
        default:
            return undefined;
    }
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export interface JevValidationInput {
    ctx: MarketIntelligenceContext;
    direction: "BUY" | "SELL" | "HOLD";
    /** Extra deterministic fact (setup quality 0..1) shown to the validator. */
    setupQuality?: number;
    userId?: string;
    userTier?: "free" | "pro" | "admin";
}

function unavailableResult(input: JevValidationInput, reason: string, startedAt: number): JevResult {
    return {
        decision: "HOLD",
        confidence: 0,
        answers: [],
        reasoningSummary: reason,
        validationStatus: "UNAVAILABLE",
        provider: "",
        model: "",
        latency: Date.now() - startedAt,
        timestamp: Date.now(),
        jevPolicyVersion: INTELLIGENCE_VERSION.jevPolicy,
        reason,
    };
}

/**
 * Run Jev validation. Never throws — callers get UNAVAILABLE on failure.
 * `direction` is the PROPOSED direction from deterministic intelligence; Jev
 * can agree (BUY/SELL) or disagree (HOLD).
 */
export async function runJevValidation(input: JevValidationInput): Promise<JevResult> {
    const started = Date.now();

    if (!isJevEnabled()) {
        return unavailableResult(input, "Jev disabled by flag", started);
    }

    if (!input.ctx.symbol || !input.ctx.timeframe) {
        return unavailableResult(input, "MISSING_MARKET_FACTS: symbol/timeframe absent", started);
    }

    // ── Path 1: dedicated Jev endpoint ──────────────────────────────────────
    const jevUrl = process.env.JEV_API_URL;
    const jevKey = process.env.JEV_API_KEY;
    if (jevUrl && jevKey) {
        try {
            const res = await fetch(jevUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${jevKey}` },
                body: JSON.stringify({
                    schema: INTELLIGENCE_VERSION.jevPolicy,
                    direction: input.direction,
                    setupQuality: input.setupQuality,
                    context: input.ctx,
                }),
                signal: AbortSignal.timeout(Number(process.env.JEV_TIMEOUT_MS || "8000") || 8000),
            });
            if (res.ok) {
                const body = (await res.json()) as Record<string, unknown>;
                const parsed = parseJevPayload(body, "jev", "jev-engine");
                if (parsed) return finalize(parsed, input, started, "jev", "jev-engine");
            }
        } catch {
            // fall through to the LLM-profiled path
        }
    }

    // ── Path 2: LLM-profiled Jev through the unified router ─────────────────
    const router = getUnifiedRouter();
    const answersSeed = JEV_QUESTIONS.map((q) => {
        const derived = deriveAnswer(q, input.ctx, input.direction);
        return { id: q.id, question: q.question, derived };
    });

    const messages: AIRequest["messages"] = [
        {
            role: "user",
            content: [
                `Direction under evaluation: ${input.direction}`,
                input.setupQuality !== undefined
                    ? `Setup quality (deterministic): ${(input.setupQuality * 100).toFixed(0)}%`
                    : "",
                "Market context (facts only):",
                JSON.stringify(input.ctx),
                "",
                "Questions:",
                ...answersSeed.map(
                    (a) =>
                        `- ${a.id}: ${a.question}${a.derived ? ` [fact: ${a.derived.answer} (${a.derived.evidence})]` : " [adjudicate]"}`,
                ),
                "",
                'Answer ONLY with JSON: {"decision":"BUY"|"SELL"|"HOLD","confidence":0-100,"answers":[{"id":"...","answer":"yes"|"no"|"unclear","confidence":0-1}],"reasoning_summary":"<=2 sentences"}',
            ]
                .filter(Boolean)
                .join("\n"),
        },
    ];

    const req: AIRequest = {
        task: "PRO_SCALPING_DECISION",
        systemPrompt: `${FINANCIAL_TONE_CLAUSE} You are Jev, a structured validation layer. Use the provided facts; when a fact is marked [adjudicate], infer it from the market context. Answer strictly in the requested JSON shape.`,
        messages,
        structuredSchema: JEV_SCHEMA as unknown as Record<string, unknown>,
        userTier: input.userTier,
        maxTokens: 500,
        priority: "high",
        temperature: 0.1,
    };

    const res = await router.execute(req, { source: "system", userId: input.userId });
    if (res.validationStatus !== "ok" || !res.structuredData) {
        return unavailableResult(
            input,
            `Jev LLM path unavailable: ${res.errors?.join(", ") ?? res.validationStatus}`,
            started,
        );
    }
    const parsed = parseJevPayload(res.structuredData, res.provider, res.model);
    if (!parsed) {
        return unavailableResult(input, "Jev LLM output failed schema validation", started);
    }
    return finalize(parsed, input, started, res.provider, res.model, res.latencyMs);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ParsedJev {
    decision: "BUY" | "SELL" | "HOLD";
    confidence: number;
    answers: JevAnswer[];
    reasoningSummary: string;
}

export function parseJevPayload(payload: unknown, provider: string, model: string): ParsedJev | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const decision = p.decision;
    const confidence = typeof p.confidence === "number" ? p.confidence : undefined;
    if (decision !== "BUY" && decision !== "SELL" && decision !== "HOLD") return null;
    if (confidence === undefined || confidence < 0 || confidence > 100) return null;

    const answers: JevAnswer[] = Array.isArray(p.answers)
        ? (p.answers as Array<Record<string, unknown>>)
              .map((a) => {
                  const id = typeof a?.id === "string" ? a.id : "";
                  const raw = a?.answer;
                  const answer: JevAnswerValue = raw === "yes" || raw === "no" || raw === "unclear" ? raw : "unclear";
                  const conf =
                      typeof a?.confidence === "number" && a.confidence >= 0 && a.confidence <= 1 ? a.confidence : 0.5;
                  return {
                      id,
                      question: JEV_QUESTIONS.find((q) => q.id === id)?.question ?? id,
                      answer,
                      confidence: conf,
                      evidence: typeof a?.evidence === "string" ? a.evidence : undefined,
                  };
              })
              .filter((a) => a.id)
        : [];

    const summary = typeof p.reasoning_summary === "string" ? p.reasoning_summary.slice(0, 400) : "";
    return { decision, confidence, answers, reasoningSummary: summary };
}

function finalize(
    parsed: ParsedJev,
    _input: JevValidationInput,
    started: number,
    provider: string,
    model: string,
    latency?: number,
): JevResult {
    // Blend the model's confidence with deterministic answer coverage.
    const nonUnclear = parsed.answers.filter((a) => a.answer !== "unclear").length;
    const coverage = parsed.answers.length > 0 ? nonUnclear / JEV_QUESTIONS.length : 0.5;
    const blendedConfidence = Math.round(parsed.confidence * (0.85 + 0.15 * coverage));

    return {
        decision: parsed.decision,
        confidence: Math.max(0, Math.min(100, blendedConfidence)),
        answers: parsed.answers,
        reasoningSummary: parsed.reasoningSummary,
        validationStatus: "VALIDATED",
        provider,
        model,
        latency: latency ?? Date.now() - started,
        timestamp: Date.now(),
        jevPolicyVersion: INTELLIGENCE_VERSION.jevPolicy,
    };
}
