/**
 * AI Decision Orchestrator.
 *
 * Combines, in strict order:
 *   A. deterministic market facts (MarketIntelligenceContext)
 *   B. deterministic intelligence (structure/HTF/liquidity alignment)
 *   C. Jev validation (optional structured layer)
 *   D. LLM reasoning (optional interpretation)
 *   E. setup memory / historical context (factual notes)
 *   F. strategy rules
 *   G. Risk Engine — ALWAYS AUTHORITATIVE
 *
 * Policy (versioned, INTELLIGENCE_VERSION.decisionPolicy):
 *  - Risk FAIL          → decision is BLOCKED. Jev/LLM opinions are recorded
 *                         for audit but NEVER override the risk engine.
 *  - Jev disagreement   → HOLD regardless of LLM lean (Jev is the validator).
 *  - Jev unavailable    → proceeds only when policy allows (AI_JEV_POLICY:
 *                         "strict" blocks, "degraded" continues marked
 *                         DEGRADED, default strict for execution-adjacent
 *                         paths, degraded for informational ones).
 *  - All AI unavailable → AI_UNAVAILABLE state, empty direction, no result
 *                         fabricated. Deterministic engines keep running.
 *  - Missing/stale market facts → INVALID.
 *
 * The orchestrator is PURE: the caller supplies a risk-evaluation closure so
 * this module never imports the risk engine (or Firebase) itself. That keeps
 * it unit-testable and prevents AI modules from reaching into account state.
 */

import type {
    AIRequest,
    AIResponse,
    DecisionFactor,
    IntelligenceDecision,
    JevResult,
    MarketIntelligenceContext,
    RiskEvaluation,
} from "./types";
import { INTELLIGENCE_VERSION } from "./versions";
import { runJevValidation } from "./jev";
import { marketContextUsableForAI } from "./market-context";
import { isJevEnabled } from "./flags";
import { getUnifiedRouter } from "./router";
import { FINANCIAL_TONE_CLAUSE, checkFinancialLanguage, sanitizeFinancialLanguage } from "./safety";

export type JevUnavailablePolicy = "strict" | "degraded";

export function jevUnavailablePolicy(): JevUnavailablePolicy {
    const raw = (process.env.AI_JEV_POLICY || "strict").trim().toLowerCase();
    return raw === "degraded" ? "degraded" : "strict";
}

export interface OrchestratorInput {
    ctx: MarketIntelligenceContext;
    /** Proposed direction from deterministic intelligence (structure/HTF). */
    proposedDirection: "BUY" | "SELL" | "HOLD";
    /** Deterministic setup quality 0..1, when available. */
    setupQuality?: number;
    /** Deterministic confluence score 0..100, when available. */
    deterministicScore?: number;
    /** Factual notes from Setup Memory (no inference). */
    memoryNotes?: string[];
    /** Strategy rule notes (factual constraints). */
    strategyNotes?: string[];
    /**
     * Risk evaluation closure — usually `() => evaluateOrder(...)`. The
     * orchestrator treats it as authoritative: approved=false ⇒ BLOCKED.
     * Omit ONLY for purely informational paths that never touch execution.
     */
    evaluateRisk?: () => RiskEvaluation;
    /** True when this decision feeds execution-adjacent flows (stricter Jev policy). */
    executionAdjacent?: boolean;
    userId?: string;
    userTier?: "free" | "pro" | "admin";
    /** Skip the LLM stage (Jev-only fast path). */
    skipLLM?: boolean;
}

export interface OrchestratorOptions {
    /** Force the LLM stage off/on (tests, admin dry-runs). */
    disableLLM?: boolean;
}

// ── Deterministic direction scoring ──────────────────────────────────────────

interface DeterministicLean {
    direction: "BUY" | "SELL" | "HOLD";
    alignment: { structure: boolean | null; htf: boolean | null; liquidity: boolean | null; fvg: boolean | null; ob: boolean | null };
    score: number; // 0..100 deterministic confluence
    factors: DecisionFactor[];
}

export function deterministicLean(ctx: MarketIntelligenceContext, proposed: "BUY" | "SELL" | "HOLD"): DeterministicLean {
    const factors: DecisionFactor[] = [];
    const check = (bias: string | undefined, dir: "BUY" | "SELL"): boolean | null => {
        if (!bias) return null;
        const b = bias.toLowerCase();
        if (b === "bullish") return dir === "BUY";
        if (b === "bearish") return dir === "SELL";
        return null;
    };

    const structure = check(ctx.structure?.bias, proposed === "HOLD" ? "BUY" : proposed);
    const htf = check(ctx.htf?.bias, proposed === "HOLD" ? "BUY" : proposed);

    const liquiditySweeps = ctx.liquidity?.sweeps;
    const liquidity = typeof liquiditySweeps === "number" ? liquiditySweeps > 0 : null;
    const fvgActive = typeof ctx.fvg?.active === "number" ? ctx.fvg.active > 0 : null;
    const obActive = typeof ctx.orderBlocks?.active === "number" ? ctx.orderBlocks.active > 0 : null;
    const fvg: number | undefined = ctx.fvg?.active;
    const ob: number | undefined = ctx.orderBlocks?.active;

    let score = 0;
    if (structure !== null) {
        score += structure ? 25 : -25;
        factors.push({ source: "deterministic", label: "Structure", value: `${ctx.structure?.bias} vs ${proposed}`, negative: !structure });
    }
    if (htf !== null) {
        score += htf ? 25 : -25;
        factors.push({ source: "deterministic", label: "HTF alignment", value: `${ctx.htf?.bias ?? "unknown"} vs ${proposed}`, negative: !htf });
    }
    if (liquidity !== null) {
        score += liquidity ? 15 : 0;
        factors.push({ source: "market_facts", label: "Liquidity", value: liquidity ? `${liquiditySweeps} sweep(s)` : "no sweep" });
    }
    if (fvgActive !== null) {
        score += fvgActive ? 15 : 0;
        factors.push({ source: "market_facts", label: "FVG", value: fvgActive ? `${fvg ?? 0} active` : "none active" });
    }
    if (obActive !== null) {
        score += obActive ? 15 : 0;
        factors.push({ source: "market_facts", label: "Order Block", value: obActive ? `${ob ?? 0} active` : "none active" });
    }
    if (ctx.regime) {
        factors.push({ source: "market_facts", label: "Regime", value: ctx.regime });
    }
    if (ctx.volatility?.state) {
        const extreme = ctx.volatility.state.toLowerCase().includes("extreme");
        if (extreme) score -= 10;
        factors.push({ source: "market_facts", label: "Volatility", value: ctx.volatility.state, negative: extreme });
    }

    const finalScore = Math.max(0, Math.min(100, 50 + score));
    return {
        direction: proposed,
        alignment: { structure, htf, liquidity, fvg: fvg !== undefined ? fvg > 0 : null, ob: ob !== undefined ? ob > 0 : null },
        score: finalScore,
        factors,
    };
}

// ── LLM interpretation stage ─────────────────────────────────────────────────

async function llmInterpretation(
    ctx: MarketIntelligenceContext,
    lean: DeterministicLean,
    jev: JevResult | undefined,
    input: OrchestratorInput,
): Promise<{ provider: string; model: string; summary: string; confidence?: number; fallbackUsed?: boolean } | undefined> {
    if (input.skipLLM) return undefined;
    const router = getUnifiedRouter();
    const facts = {
        symbol: ctx.symbol,
        timeframe: ctx.timeframe,
        price: ctx.price,
        trend: ctx.trend,
        regime: ctx.regime,
        structure: ctx.structure?.bias,
        htf: ctx.htf?.bias,
        liquiditySweeps: ctx.liquidity?.sweeps,
        fvgActive: ctx.fvg?.active,
        obActive: ctx.orderBlocks?.active,
        volatility: ctx.volatility?.state,
        session: ctx.session,
    };
    const messages: AIRequest["messages"] = [
        {
            role: "user",
            content: [
                `Task: interpret this deterministic market state for a ${lean.direction} scenario in <=3 sentences.`,
                `Deterministic facts: ${JSON.stringify(facts)}`,
                `Deterministic confluence: ${lean.score}/100`,
                jev ? `Jev validation: ${jev.decision} ${jev.confidence}% (${jev.validationStatus})` : "Jev validation: unavailable",
                input.memoryNotes?.length ? `Setup memory notes: ${input.memoryNotes.join("; ")}` : "",
                input.strategyNotes?.length ? `Strategy rules: ${input.strategyNotes.join("; ")}` : "",
                "Answer ONLY with JSON: {\"summary\":\"...\",\"confidence\":0-100,\"direction\":\"BUY\"|\"SELL\"|\"HOLD\"}",
            ]
                .filter(Boolean)
                .join("\n"),
        },
    ];
    const req: AIRequest = {
        task: "SIGNAL_EXPLANATION",
        systemPrompt: `${FINANCIAL_TONE_CLAUSE} Interpret the provided deterministic facts. Never contradict them: your role is interpretation, not prediction.`,
        messages,
        userTier: input.userTier,
        maxTokens: 400,
        temperature: 0.3,
    };
    const res: AIResponse = await router.execute(req, { source: "system", userId: input.userId });
    if (res.validationStatus !== "ok" || !res.content) return undefined;
    const parsed = res.structuredData as { summary?: unknown; confidence?: unknown } | undefined;
    let summary = typeof parsed?.summary === "string" ? parsed.summary : res.content.slice(0, 300);
    // Safety language guard: sanitize or drop the summary entirely.
    const safety = checkFinancialLanguage(summary);
    if (!safety.safe) summary = sanitizeFinancialLanguage(summary);
    return {
        provider: res.provider,
        model: res.model,
        summary,
        confidence: typeof parsed?.confidence === "number" ? parsed.confidence : res.confidence,
        fallbackUsed: res.fallbackUsed,
    };
}

// ── Main orchestration ───────────────────────────────────────────────────────

export async function orchestrateDecision(
    input: OrchestratorInput,
    _opts: OrchestratorOptions = {},
): Promise<IntelligenceDecision> {
    const started = Date.now();
    const requestId = `dec_${started.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ctx = input.ctx;
    const versions = {
        marketContextSchema: INTELLIGENCE_VERSION.marketContextSchema,
        decisionPolicy: INTELLIGENCE_VERSION.decisionPolicy,
        jevPolicy: INTELLIGENCE_VERSION.jevPolicy,
        signalPolicy: INTELLIGENCE_VERSION.signalPolicy,
    };

    // ── 0. Market facts gate (fail-closed) ──────────────────────────────────
    const usable = marketContextUsableForAI(ctx, { expectFresh: input.executionAdjacent });
    if (!usable.ok) {
        return {
            requestId,
            symbol: ctx.symbol ?? "",
            timeframe: ctx.timeframe ?? "",
            direction: "HOLD",
            state: "INVALID",
            confidence: 0,
            factors: [{ source: "policy", label: "Market facts", value: usable.reason, negative: true }],
            rationale: usable.reason,
            validationStatus: "INVALID",
            timestamp: Date.now(),
            versions,
        };
    }

    const lean = deterministicLean(ctx, input.proposedDirection);
    const factors: DecisionFactor[] = [...lean.factors];

    // ── 1. Jev validation ───────────────────────────────────────────────────
    let jev: JevResult | undefined;
    let jevDegraded = false;
    if (isJevEnabled()) {
        const res = await runJevValidation({
            ctx,
            direction: lean.direction,
            setupQuality: input.setupQuality,
            userId: input.userId,
            userTier: input.userTier,
        });
        if (res.validationStatus === "VALIDATED") {
            jev = res;
            factors.push({ source: "jev", label: "Jev validation", value: `${res.decision} ${res.confidence}%` });
        } else {
            jevDegraded = true;
            factors.push({ source: "jev", label: "Jev validation", value: `unavailable (${res.reason ?? "no provider"})`, negative: true });
        }
    } else {
        jevDegraded = true;
    }

    // ── 2. LLM reasoning (interpretation only) ──────────────────────────────
    let llm: IntelligenceDecision["llm"];
    if (!input.skipLLM) {
        llm = await llmInterpretation(ctx, lean, jev, input);
        if (llm) {
            factors.push({ source: "llm", label: "AI interpretation", value: `${llm.summary.slice(0, 80)}${llm.summary.length > 80 ? "…" : ""}` });
        } else {
            factors.push({ source: "llm", label: "AI interpretation", value: "unavailable", negative: true });
        }
    }

    // ── 3. Memory / strategy notes (factual) ────────────────────────────────
    for (const note of input.memoryNotes ?? []) {
        factors.push({ source: "memory", label: "Setup memory", value: note.slice(0, 120) });
    }
    for (const note of input.strategyNotes ?? []) {
        factors.push({ source: "policy", label: "Strategy rule", value: note.slice(0, 120) });
    }

    // ── 4. Compose base state from AI stages ────────────────────────────────
    // Priority: AI unavailable → AI_UNAVAILABLE; Jev disagrees → HOLD;
    // Jev agrees + deterministic score healthy → READY-ish; else WAITING.
    const aiAllUnavailable = !jev && !llm;
    let state: IntelligenceDecision["state"];
    let confidence: number;
    let direction: IntelligenceDecision["direction"] = lean.direction;

    if (aiAllUnavailable) {
        state = "AI_UNAVAILABLE";
        confidence = 0;
        direction = "HOLD";
    } else if (jev && jev.decision !== lean.direction && jev.decision === "HOLD") {
        state = "HOLD";
        confidence = jev.confidence;
        direction = "HOLD";
    } else if (jev && jev.decision !== lean.direction && jev.decision !== "HOLD") {
        // Jev proposes the opposite direction → treat as disagreement → HOLD.
        state = "HOLD";
        confidence = jev.confidence;
        direction = "HOLD";
    } else {
        // Jev agrees (or is absent in degraded mode).
        const base = lean.score; // 0..100 deterministic
        const jevBoost = jev ? (jev.confidence - 50) * 0.3 : 0;
        confidence = Math.round(Math.max(0, Math.min(100, base * 0.7 + 30 * 0.3 + jevBoost)));
        state = confidence >= 65 && lean.alignment.structure !== false && lean.alignment.htf !== false ? "READY" : "WAITING";
    }

    if (jevDegraded && state === "READY") {
        // Jev absent: never present a fully-validated READY.
        state = "VALIDATING";
        confidence = Math.min(confidence, 60);
    }

    // ── 5. RISK ENGINE — ALWAYS AUTHORITATIVE ───────────────────────────────
    let risk: RiskEvaluation | undefined;
    if (input.evaluateRisk) {
        risk = input.evaluateRisk();
        factors.push({
            source: "risk",
            label: "Risk engine",
            value: risk.approved ? `PASS (${risk.code})` : `FAIL (${risk.code})`,
            negative: !risk.approved,
        });
        if (!risk.approved) {
            return {
                requestId,
                symbol: ctx.symbol,
                timeframe: ctx.timeframe,
                direction,
                state: "BLOCKED",
                confidence,
                factors,
                jev,
                llm,
                risk,
                rationale: `Blocked by deterministic risk engine: ${risk.code}${risk.reason ? ` — ${risk.reason}` : ""}. AI opinion recorded but not applied.`,
                validationStatus: "RISK_BLOCKED",
                timestamp: Date.now(),
                versions,
            };
        }
    }

    // ── 6. Final state + rationale ──────────────────────────────────────────
    const rationaleParts: string[] = [];
    if (state === "AI_UNAVAILABLE") {
        rationaleParts.push("All AI providers unavailable; deterministic facts retained, no AI interpretation applied.");
    } else {
        if (jev) rationaleParts.push(`Jev ${jev.decision} ${jev.confidence}%`);
        if (llm) rationaleParts.push("AI interpretation available");
        rationaleParts.push(`deterministic confluence ${lean.score}/100`);
        if (risk) rationaleParts.push("risk PASS");
    }
    if (jevDegraded && state !== "AI_UNAVAILABLE") rationaleParts.push("Jev unavailable — validation degraded");

    return {
        requestId,
        symbol: ctx.symbol,
        timeframe: ctx.timeframe,
        direction,
        state,
        confidence,
        factors,
        jev,
        llm,
        risk,
        rationale: rationaleParts.join(" · "),
        validationStatus: aiAllUnavailable ? "AI_UNAVAILABLE" : jevDegraded ? "DEGRADED" : "VALIDATED",
        timestamp: Date.now(),
        versions,
    };
}
