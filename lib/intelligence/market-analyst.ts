/**
 * AI Market Analyst — evidence-first, structured-output analyst.
 * Interprets deterministic market-state (MarketSnapshot + indicators + smart-money
 * + setup + strategy + risk) but NEVER invents candles, prices, indicator values,
 * SM events, historical results, or account balances.
 *
 * Output is always AITradeAnalysis (analysis-contract.ts), never bare text.
 */

import type { AITradeAnalysis, AIAnalysisRequest, Scenario, EvidenceItem, Invalidation, RiskNote } from "./analysis-contract";
import { buildMarketIntelligenceContext, marketContextUsableForAI } from "./market-context";
import { getUnifiedRouter } from "./router";
import type { AIRequest } from "./types";

export interface AnalystInput {
  symbol: string;
  timeframe: string;
  marketSnapshot?: {
    price?: number;
    trend?: string;
    regime?: string;
    structure?: { bias?: string; label?: string };
    htf?: { timeframe?: string; bias?: string };
    liquidity?: { sweeps?: unknown[]; levels?: unknown[] };
    FVG?: unknown[];
    orderBlocks?: unknown[];
    volatility?: { atr?: number; state?: string };
    marketSession?: string;
  };
  indicators?: unknown[];
  smartMoney?: unknown;
  setupMemory?: unknown;
  strategy?: unknown;
  /** Phase 16 §28 — structured cross-asset context (relationships, regime, impact). */
  crossAsset?: unknown;
  positions?: unknown[];
  orders?: unknown[];
  account?: unknown;
  dataAgeMs?: number;
  timestamp?: number;
}

function buildEvidenceFromFacts(input: AnalystInput): { bullish: EvidenceItem[]; bearish: EvidenceItem[]; neutral: EvidenceItem[] } {
  const bull: EvidenceItem[] = [];
  const bear: EvidenceItem[] = [];
  const neu: EvidenceItem[] = [];

  const snap = input.marketSnapshot;
  if (snap?.trend === "bullish") bull.push({ source: "market_trend", claim: "Trend is bullish", direction: "bullish", confidence: 0.7 });
  else if (snap?.trend === "bearish") bear.push({ source: "market_trend", claim: "Trend is bearish", direction: "bearish", confidence: 0.7 });
  else neu.push({ source: "market_trend", claim: "Trend unclear / neutral", direction: "neutral", confidence: 0.5 });

  if (snap?.regime === "trending") bull.push({ source: "market_regime", claim: "Regime is trending", direction: "bullish", confidence: 0.6 });
  else if (snap?.regime === "ranging") neu.push({ source: "market_regime", claim: "Regime is ranging", direction: "neutral", confidence: 0.6 });

  if (snap?.htf?.bias === "bullish") bull.push({ source: "htf_bias", claim: `HTF ${snap.htf?.timeframe ?? ""} bias bullish`, direction: "bullish", confidence: 0.65 });
  else if (snap?.htf?.bias === "bearish") bear.push({ source: "htf_bias", claim: `HTF ${snap.htf?.timeframe ?? ""} bias bearish`, direction: "bearish", confidence: 0.65 });

  if (snap?.structure?.bias === "higher_highs") bull.push({ source: "structure", claim: "Structure shows higher highs", direction: "bullish", confidence: 0.7 });
  else if (snap?.structure?.bias === "lower_lows") bear.push({ source: "structure", claim: "Structure shows lower lows", direction: "bearish", confidence: 0.7 });

  const liq = snap?.liquidity;
  if (Array.isArray(liq?.sweeps) && liq.sweeps.length > 0) {
    bull.push({ source: "smart_money_liquidity", claim: `Liquidity sweep detected (${liq.sweeps.length})`, direction: "bullish", confidence: 0.6 });
  }

  if (Array.isArray(snap?.FVG) && snap.FVG.length > 0) {
    bull.push({ source: "smart_money_fvg", claim: `Active FVG count ${snap.FVG.length}`, direction: "bullish", confidence: 0.55 });
  }

  if (snap?.volatility?.state === "low") neu.push({ source: "volatility", claim: "Low volatility — range conditions likely", direction: "neutral", confidence: 0.5 });
  else if (snap?.volatility?.state === "high") neu.push({ source: "volatility", claim: "High volatility — wider stops needed", direction: "neutral", confidence: 0.55 });

  /* Cross-asset context (Phase 16 §28). Structured, measured, always neutral
     confluence: it never swings the action by itself (§57). */
  const cross = input.crossAsset as {
    relationships?: Array<{ symbol?: string; coefficient?: number | null; stability?: string }>;
    regime?: { activeStates?: string[] } | null;
    portfolioImpact?: { relatedExposureWeight?: number; correlatedHoldings?: string[] } | null;
    limitations?: string[];
  } | null | undefined;
  if (cross && typeof cross === "object") {
    for (const rel of (cross.relationships ?? []).slice(0, 3)) {
      if (typeof rel?.coefficient !== "number") continue;
      neu.push({
        source: "cross_asset_relationship",
        claim: `${input.symbol} ↔ ${rel.symbol} rolling correlation ${rel.coefficient.toFixed(2)} (stability ${rel.stability ?? "UNKNOWN"}) — measured association, not a signal`,
        direction: "neutral",
        confidence: 0.6,
      });
    }
    const states = cross.regime?.activeStates ?? [];
    if (states.length > 0) {
      neu.push({
        source: "cross_asset_regime",
        claim: `Global regime: ${states.join(", ")} (multi-axis measurement)`,
        direction: "neutral",
        confidence: 0.6,
      });
    }
    const weight = cross.portfolioImpact?.relatedExposureWeight;
    if (typeof weight === "number" && weight > 0) {
      neu.push({
        source: "cross_asset_portfolio",
        claim: `${(weight * 100).toFixed(1)}% of gross exposure sits in positions correlated with ${input.symbol}`,
        direction: "neutral",
        confidence: 0.6,
      });
    }
  }

  return { bullish: bull, bearish: bear, neutral: neu };
}

function buildConfirmations(input: AnalystInput, evidence: ReturnType<typeof buildEvidenceFromFacts>): EvidenceItem[] {
  const conf: EvidenceItem[] = [];
  // Confirm only when multiple independent sources agree; never overstate.
  const b = evidence.bullish.length;
  const be = evidence.bearish.length;
  if (b >= 2 && be === 0) {
    conf.push({ source: "confirmation", claim: "Multiple bullish signals agree with no bearish contradiction", direction: "bullish", confidence: 0.6 });
  } else if (be >= 2 && b === 0) {
    conf.push({ source: "confirmation", claim: "Multiple bearish signals agree with no bullish contradiction", direction: "bearish", confidence: 0.6 });
  } else if (b > 0 && be > 0) {
    conf.push({ source: "confirmation", claim: "Conflicting signals — confirmation insufficient; WAIT or NO_TRADE preferred", direction: "neutral", confidence: 0.4 });
  } else {
    conf.push({ source: "confirmation", claim: "Insufficient confirmation — only one direction present or data partial", direction: "neutral", confidence: 0.35 });
  }
  return conf;
}

function buildInvalidation(input: AnalystInput): Invalidation {
  const snap = input.marketSnapshot;
  const conditions: string[] = [];
  if (snap?.trend === "bearish" && !snap?.htf) conditions.push("HTF bias missing; trend bearish conflicts with bullish setup");
  if (snap?.regime === "ranging" && snap?.liquidity?.sweeps?.length === 0) conditions.push("No liquidity sweep in ranging regime — mean-reversion setup unconfirmed");
  if (!snap?.price) conditions.push("Price unavailable — cannot confirm entry level");
  if (input.dataAgeMs !== undefined && input.dataAgeMs > 300_000) conditions.push("Data stale (>5 min)");
  const price = snap?.price ?? 0;
  return { price: price > 0 ? price : undefined, conditions };
}

function buildRiskNote(input: AnalystInput, confidence: number): RiskNote {
  const notes = [];
  if (confidence < 0.5) notes.push("Low confidence — do not size aggressively.");
  if (input.account) notes.push("Account context present — review exposure before execution.");
  if (input.positions && input.positions.length > 0) notes.push("Open positions exist — check correlation / exposure.");
  return { riskLevel: confidence < 0.5 ? "HIGH" : confidence < 0.7 ? "MEDIUM" : "LOW", notes };
}

function buildScenarios(input: AnalystInput): Scenario[] {
  return [
    { scenario: "Trend continues in direction of dominant signal", probability: undefined, outcome: "positive", trigger: "Confirm with price close above key level / below key support", notes: ["Requires validation; not predictive."] },
    { scenario: "Setup invalidates due to conflicting HTF / liquidity / regression", probability: undefined, outcome: "negative", trigger: "Price rejects setup, stale data, or opposing signal activates", notes: ["Always plan for invalidation."] },
    { scenario: "Insufficient data / stale data / missing context", probability: undefined, outcome: "neutral", trigger: "Data age > threshold or missing symbol/timeframe facts", notes: ["AI must say WAIT; never fabricate a trade."] },
  ];
}

function buildLimitations(input: AnalystInput, ctxUsable: ReturnType<typeof marketContextUsableForAI>): string[] {
  const limits = [
    "AI analysis is interpretation of deterministic facts, not a source of truth.",
    "No future prices, candles, or execution outcomes are predicted.",
    "Setup quality depends on data freshness and completeness.",
  ];
  if (!ctxUsable.ok) limits.push((ctxUsable as { ok: false; reason: string }).reason);
  if ((input.dataAgeMs ?? 0) > 120_000) limits.push("Market data is stale; analysis reflects past state, not current.");
  if (input.setupMemory) limits.push("Setup Memory state may not fully reflect live conditions.");
  if (input.crossAsset) limits.push("Cross-asset context is measured historical association only — it is confluence, never causation or prediction (Phase 16 §56/§57).");
  return limits;
}

export async function analyzeMarket(input: AnalystInput): Promise<AITradeAnalysis> {
  const now = Date.now();
  const snap = input.marketSnapshot;
  const dataTs = input.timestamp ?? (now - (input.dataAgeMs ?? 0));

  // Build structured context (reuse existing deterministic builder)
  const marketCtx = buildMarketIntelligenceContext({
    symbol: input.symbol,
    timeframe: input.timeframe,
    timestamp: input.timestamp ?? dataTs,
    dataAgeMs: input.dataAgeMs,
    currentPrice: snap?.price,
    trend: snap?.trend,
    regime: snap?.regime,
    marketStructure: snap?.structure,
    higherTimeframeContext: snap?.htf,
    liquidity: snap?.liquidity,
    FVG: Array.isArray(snap?.FVG) ? snap.FVG as any[] : undefined,
    orderBlocks: Array.isArray(snap?.orderBlocks) ? snap.orderBlocks as any[] : undefined,
    volatility: snap?.volatility,
    marketSession: snap?.marketSession,
  });

  const ctxCheck = marketContextUsableForAI(marketCtx, { expectFresh: true });

  // Evidence-first structured assessment (deterministic, never fabricated)
  const evidence = buildEvidenceFromFacts(input);
  const confirmations = buildConfirmations(input, evidence);
  const invalidation = buildInvalidation(input);
  const scenarios = buildScenarios(input);

  // Decision synthesis — preserve disagreements, never force a trade
  let action: AITradeAnalysis["action"] = "WAIT";
  let confidence = 0.4;
  const bull = evidence.bullish.length;
  const bear = evidence.bearish.length;
  if (bull > 0 && bear === 0 && confirmations.some(c => c.direction === "bullish" && c.confidence >= 0.55) && ctxCheck.ok) {
    action = "LONG"; confidence = Math.min(0.75, 0.55 + confirmations.filter(c => c.direction === "bullish").length * 0.05);
  } else if (bear > 0 && bull === 0 && confirmations.some(c => c.direction === "bearish" && c.confidence >= 0.55) && ctxCheck.ok) {
    action = "SHORT"; confidence = Math.min(0.75, 0.55 + confirmations.filter(c => c.direction === "bearish").length * 0.05);
  } else if (bull > 0 && bear > 0) {
    action = "WAIT"; confidence = 0.35; // conflicting evidence
  } else if (!ctxCheck.ok) {
    action = "WAIT"; confidence = 0.2; // stale / missing
  }
  // If no price / missing context — never force
  if (!snap?.price || !input.timeframe) {
    action = "WAIT"; confidence = 0.15;
  }

  const riskNote = buildRiskNote(input, confidence);
  const limitations = buildLimitations(input, ctxCheck);

  const result: AITradeAnalysis = {
    action,
    confidence: Math.round(confidence * 100) / 100,
    marketContext: {
      symbol: input.symbol,
      timeframe: input.timeframe,
      timestamp: now,
      dataTimestamp: dataTs,
      session: snap?.marketSession,
      regime: snap?.regime,
      trend: snap?.trend,
      volatility: snap?.volatility?.state,
    },
    evidence,
    confirmations,
    invalidation,
    risk: riskNote,
    scenarios,
    limitations,
    generatedAt: now,
    dataTimestamp: dataTs,
    dataQuality: marketCtx.dataQuality ? { status: marketCtx.dataQuality.status ?? "unknown", issues: marketCtx.dataQuality.issues } : undefined,
    version: "7.0.0-intelligence",
  };

  // Optional AI interpretation layer (via router, evidence-only, structured)
  try {
    const router = getUnifiedRouter();
    const aiReq: AIRequest = {
      task: "SIGNAL_EXPLANATION",
      messages: [{ role: "system", content: "You are an evidence-first trading analyst. Explain the structured evidence; never invent prices or future outcomes." },
        { role: "user", content: `Symbol=${input.symbol} Timeframe=${input.timeframe} Context=${JSON.stringify(marketCtx)} Evidence=${JSON.stringify(result.evidence)} Action=${action} Confidence=${confidence}` }],
      marketContext: marketCtx as unknown as Record<string, unknown>,
      structuredSchema: { type: "object", properties: { explanation: { type: "string" }, caution: { type: "string" } }, required: ["explanation", "caution"] },
      userTier: (input as { userTier?: string }).userTier as any,
      maxLatencyMs: 3000,
      maxTokens: 600,
    };
    const aiRes = await router.execute(aiReq);
    if (aiRes.validationStatus === "ok" && aiRes.structuredData?.explanation) {
      // Merge explanation into limitations only if it reinforces caution; never overwrite evidence.
      const caution = String(aiRes.structuredData.caution ?? "");
      if (caution) limitations.push("AI interpretation caution: " + caution);
    }
  } catch {
    // Degrade gracefully — deterministic result preserved
  }

  return result;
}
