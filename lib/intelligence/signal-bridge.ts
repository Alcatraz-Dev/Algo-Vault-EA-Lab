/**
 * Bridge: Unified Intelligence Fabric → AI Signal engine.
 *
 * Additive by design: `enrichSignalWithIntelligence` is called by the signal
 * engine AFTER the deterministic candidate passes all existing validation and
 * BEFORE the signal object is returned. It can only ADD fields to the signal
 * (decision state, Jev validation, factors, rationale) — it can never change
 * entry/SL/TP numbers, never flip the direction, and never fail generation:
 * any fabric error is swallowed into `degraded: true` metadata.
 *
 * Risk integration stays at the EXECUTION layer (pro-signals/execute →
 * evaluateOrder), which is where the deterministic risk engine is already
 * authoritative. The signal-level decision records a risk note only when the
 * caller supplies an account context; otherwise the field stays undefined so
 * the UI can show "risk: evaluated at execution".
 */

import type { MarketSnapshot } from "@/lib/market-data/market-truth";
import type { SignalDirection } from "../ai-signals/types";
import type { SignalIntelligence, MarketIntelligenceContext, IntelligenceDecision } from "./types";
import { buildMarketIntelligenceContext, type MarketContextInput } from "./market-context";
import { orchestrateDecision } from "./orchestrator";
import { isUnifiedIntelligenceEnabled, isProScalpingIntelligenceEnabled } from "./flags";
import { INTELLIGENCE_VERSION } from "./versions";
import { recordDecisionAudit } from "./store";

export interface SignalEnrichmentResult {
    intelligence: SignalIntelligence;
    degraded: boolean;
}

/** Build the compressed context from the existing MarketSnapshot (no candles). */
export function signalMarketContext(snapshot: MarketSnapshot, setupQuality?: number): MarketIntelligenceContext {
    const input: MarketContextInput = {
        symbol: snapshot.symbol,
        timeframe: snapshot.timeframe,
        timestamp: snapshot.timestamp,
        dataAgeMs: snapshot.dataAgeMs,
        currentPrice: snapshot.currentPrice,
        trend: snapshot.trend,
        regime: snapshot.regime,
        marketStructure: snapshot.marketStructure,
        higherTimeframeContext: snapshot.higherTimeframeContext,
        liquidity: snapshot.liquidity,
        FVG: snapshot.FVG,
        orderBlocks: snapshot.orderBlocks,
        volatility: { atr: snapshot.ATR, state: snapshot.volatility?.state },
        marketSession: snapshot.marketSession,
    };
    const ctx = buildMarketIntelligenceContext(input);
    if (ctx.setup) ctx.setup.quality = setupQuality;
    else if (setupQuality !== undefined) ctx.setup = { quality: setupQuality };
    return ctx;
}

/**
 * Enrich a validated signal candidate with fabric intelligence.
 * Never throws; on any internal failure returns a degraded marker so the
 * deterministic signal path continues untouched.
 */
export async function enrichSignalWithIntelligence(params: {
    snapshot: MarketSnapshot;
    direction: SignalDirection;
    confidence: number;
    symbol: string;
    timeframe: string;
    userId?: string;
    userTier?: "free" | "pro" | "admin";
    /** Execution-adjacent generation (auto-execution paths) → strict Jev. */
    executionAdjacent?: boolean;
    memoryNotes?: string[];
    strategyNotes?: string[];
    evaluateRisk?: () => { approved: boolean; code: string; reason?: string };
}): Promise<SignalEnrichmentResult> {
    const fallback: SignalIntelligence = {
        decisionState: "AI_UNAVAILABLE",
        intelligenceVersion: INTELLIGENCE_VERSION.signalPolicy,
        evaluatedAt: Date.now(),
    };

    try {
        if (!isUnifiedIntelligenceEnabled()) return { intelligence: fallback, degraded: true };

        const ctx = signalMarketContext(params.snapshot, params.confidence / 100);
        const decision: IntelligenceDecision = await orchestrateDecision({
            ctx,
            proposedDirection: params.direction,
            setupQuality: params.confidence / 100,
            executionAdjacent: params.executionAdjacent,
            userId: params.userId,
            userTier: params.userTier,
            memoryNotes: params.memoryNotes,
            strategyNotes: params.strategyNotes,
            evaluateRisk: params.evaluateRisk,
        });

        const intelligence: SignalIntelligence = {
            decisionState: decision.state,
            jev: decision.jev
                ? {
                      decision: decision.jev.decision,
                      confidence: decision.jev.confidence,
                      status: decision.jev.validationStatus,
                  }
                : undefined,
            llm: decision.llm
                ? {
                      provider: decision.llm.provider,
                      model: decision.llm.model,
                      summary: decision.llm.summary,
                      confidence: decision.llm.confidence,
                  }
                : undefined,
            risk: decision.risk,
            factors: decision.factors,
            rationale: decision.rationale,
            intelligenceVersion: INTELLIGENCE_VERSION.signalPolicy,
            evaluatedAt: decision.timestamp,
        };

        // Audit trail (best-effort; never blocks the signal).
        if (process.env.AI_INTELLIGENCE_AUDIT === "true") {
            void recordDecisionAudit(decision);
        }

        return { intelligence, degraded: false };
    } catch {
        return { intelligence: fallback, degraded: true };
    }
}

/** Flag gate for callers that want to skip the call entirely. */
export function signalIntelligenceEnabled(): boolean {
    return isUnifiedIntelligenceEnabled() && isProScalpingIntelligenceEnabled();
}
