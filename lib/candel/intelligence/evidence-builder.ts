/**
 * AlgoVault Candel Intelligence — Evidence Builder
 *
 * Normalizes raw observations from existing engines into the unified
 * `CandelEvidence` format and builds the fact/interpretation/limitation model.
 *
 * Design rules (Phase 4 §8, §40, §41):
 *   • Evidence is normalized from authoritative sources, not invented.
 *   • Every evidence item traces to a source module + referenceId.
 *   • Facts, interpretations, and recommendations are kept separate.
 *   • If a source is missing/unavailable, that is reported as such — never
 *     fabricated.
 */

import type { CandelEvidence, CandelAccountContext } from "@/lib/candel/types";
import type {
  Fact,
  Interpretation,
  Limitation,
  ContextSource,
  Recommendation,
  ContextSourceType,
  CandelConclusion,
  ContextStaleness,
  SourceResult,
  CandelIntelligenceContext,
} from "./types";

// ─── Evidence normalization ─────────────────────────────────────────────────

const SOURCE_TYPE_MAP: Record<string, ContextSourceType> = {
  market_intelligence: "market_intelligence",
  strategy_lab: "strategy_lab",
  risk_engine: "risk_engine",
  account: "account",
  challenge: "challenge",
  terminal: "terminal",
  memory: "memory",
  tradingview: "tradingview",
  ea: "ea",
  system: "system",
};

export function normalizeToUnifiedEvidence(evidence: CandelEvidence[]): Fact[] {
  return evidence.map((e) => {
    const source: ContextSource = {
      type: SOURCE_TYPE_MAP[e.sourceType] ?? "system",
      id: e.sourceId,
      generatedAt: e.timestamp,
    };
    const value = e.value;
    const text =
      typeof value === "string" && value.length > 0
        ? value
        : JSON.stringify(value);
    return {
      evidenceId: e.id,
      text,
      source,
    };
  });
}

// ─── Evidence from Market Intelligence (Phase 4 §6) ────────────────────────

export interface MarketIntelligenceSource {
  snapshotId?: string;
  symbol?: string;
  trend?: string;
  structure?: string;
  liquidity?: string;
  fvgCount?: number;
  orderBlockCount?: number;
  volatility?: string;
  dataAgeMs?: number;
  asOf?: number;
}

export function buildMarketEvidence(
  src: MarketIntelligenceSource,
  observations: { id?: string }[] = [],
): CandelEvidence[] {
  const evidence: CandelEvidence[] = [];
  const mk = (
    path: string,
    value: unknown,
    sourceId: string,
    category: string = "market_intelligence",
  ) => {
    if (value === undefined || value === null) return;
    evidence.push({
      id: `${category}-${sourceId}-${path}-${Date.now()}`,
      sourceType: category,
      sourceId,
      timestamp: src.asOf ?? src.dataAgeMs ?? Date.now(),
      path,
      value,
    });
  };

  if (src.snapshotId) {
    mk("snapshotId", src.snapshotId, src.snapshotId);
  }
  if (src.symbol) {
    mk("symbol", src.symbol, src.symbol);
  }
  if (src.trend) {
    mk("trend", src.trend, src.symbol ?? src.snapshotId ?? "market");
  }
  if (src.structure) {
    mk("structure", src.structure, src.snapshotId ?? "market");
  }
  if (src.liquidity !== undefined && src.liquidity !== null) {
    mk("liquidity", src.liquidity, src.snapshotId ?? "market");
  }
  if (src.fvgCount !== undefined && src.fvgCount !== null) {
    mk("fvgCount", src.fvgCount, src.snapshotId ?? "market");
  }
  if (src.orderBlockCount !== undefined && src.orderBlockCount !== null) {
    mk("orderBlockCount", src.orderBlockCount, src.snapshotId ?? "market");
  }
  if (src.volatility) {
    mk("volatility", src.volatility, src.snapshotId ?? "market");
  }

  for (const o of observations) {
    if (o.id) {
      evidence.push({
        id: `observation-${o.id}-${Date.now()}`,
        sourceType: "market_intelligence",
        sourceId: o.id,
        timestamp: Date.now(),
        path: "observation",
        value: { observationId: o.id },
      });
    }
  }

  return evidence;
}

// ─── Evidence from Strategy Lab (Phase 4 §6) ───────────────────────────────

export interface StrategyLabSource {
  strategyId?: string;
  strategyName?: string;
  mode?: string;
  version?: string;
  backtestId?: string;
  oosVerdict?: string;
  walkForwardStatus?: string;
  monteCarloStatus?: string;
  metrics?: Record<string, unknown>;
  dataAgeMs?: number;
  asOf?: number;
}

export function buildStrategyEvidence(
  src: StrategyLabSource,
  facts: CandelEvidence[] = [],
): CandelEvidence[] {
  const evidence: CandelEvidence[] = [...facts];

  const mk = (
    path: string,
    value: unknown,
    sourceId: string,
  ) => {
    if (value === undefined || value === null) return;
    evidence.push({
      id: `strategy-${sourceId}-${path}-${Date.now()}`,
      sourceType: "strategy_lab",
      sourceId,
      timestamp: src.asOf ?? src.dataAgeMs ?? Date.now(),
      path,
      value,
    });
  };

  if (src.strategyId) {
    mk("strategyId", src.strategyId, src.strategyId);
  }
  if (src.strategyName) {
    mk("strategyName", src.strategyName, src.strategyId ?? "strategy");
  }
  if (src.mode) {
    mk("mode", src.mode, src.strategyId ?? "strategy");
  }
  if (src.version) {
    mk("version", src.version, src.strategyId ?? "strategy");
  }
  if (src.backtestId) {
    mk("backtestId", src.backtestId, src.strategyId ?? "strategy");
  }
  if (src.oosVerdict) {
    mk("oosVerdict", src.oosVerdict, src.strategyId ?? "strategy");
  }
  if (src.walkForwardStatus) {
    mk("walkForwardStatus", src.walkForwardStatus, src.strategyId ?? "strategy");
  }
  if (src.monteCarloStatus) {
    mk("monteCarloStatus", src.monteCarloStatus, src.strategyId ?? "strategy");
  }
  if (src.metrics && Object.keys(src.metrics).length > 0) {
    mk("metrics", src.metrics, src.strategyId ?? "strategy");
  }

  return evidence;
}

// ─── Evidence from Risk Engine (Phase 4 §6) ────────────────────────────────

export interface RiskEngineSource {
  status?: string;
  exposure?: string;
  metrics?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  dataAgeMs?: number;
  asOf?: number;
}

export function buildRiskEvidence(src: RiskEngineSource): CandelEvidence[] {
  const evidence: CandelEvidence[] = [];

  const mk = (
    path: string,
    value: unknown,
    sourceId: string,
  ) => {
    if (value === undefined || value === null) return;
    evidence.push({
      id: `risk-${sourceId}-${path}-${Date.now()}`,
      sourceType: "risk_engine",
      sourceId,
      timestamp: src.asOf ?? src.dataAgeMs ?? Date.now(),
      path,
      value,
    });
  };

  if (src.status) {
    mk("status", src.status, src.status);
  }
  if (src.exposure) {
    mk("exposure", src.exposure, src.status ?? "risk");
  }
  if (src.metrics && Object.keys(src.metrics).length > 0) {
    mk("metrics", src.metrics, "risk");
  }
  if (src.limits && Object.keys(src.limits).length > 0) {
    mk("limits", src.limits, "risk");
  }

  return evidence;
}

// ─── Evidence from Account (Phase 4 §6) ────────────────────────────────────

export interface AccountSource {
  accountId?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  openPositionsCount?: number;
  openOrdersCount?: number;
  exposure?: unknown;
  dataAgeMs?: number;
  asOf?: number;
}

export function buildAccountEvidence(src: AccountSource): CandelEvidence[] {
  const evidence: CandelEvidence[] = [];

  const mk = (
    path: string,
    value: unknown,
    sourceId: string,
  ) => {
    if (value === undefined || value === null) return;
    evidence.push({
      id: `account-${sourceId}-${path}-${Date.now()}`,
      sourceType: "account",
      sourceId,
      timestamp: src.asOf ?? src.dataAgeMs ?? Date.now(),
      path,
      value,
    });
  };

  if (src.accountId) {
    mk("accountId", src.accountId, src.accountId);
  }
  if (src.balance !== undefined && src.balance !== null) {
    mk("balance", src.balance, src.accountId ?? "account");
  }
  if (src.equity !== undefined && src.equity !== null) {
    mk("equity", src.equity, src.accountId ?? "account");
  }
  if (src.margin !== undefined && src.margin !== null) {
    mk("margin", src.margin, src.accountId ?? "account");
  }
  if (src.openPositionsCount !== undefined && src.openPositionsCount !== null) {
    mk("openPositionsCount", src.openPositionsCount, src.accountId ?? "account");
  }
  if (src.openOrdersCount !== undefined && src.openOrdersCount !== null) {
    mk("openOrdersCount", src.openOrdersCount, src.accountId ?? "account");
  }
  if (src.exposure !== undefined && src.exposure !== null) {
    mk("exposure", src.exposure, src.accountId ?? "account");
  }

  return evidence;
}

// ─── Evidence from Challenge (Phase 4 §23) ─────────────────────────────────

export interface ChallengeSource {
  challengeId?: string;
  status?: string;
  dailyLossRemaining?: number;
  remainingDrawdown?: number;
  restrictions?: string[];
  challenge?: Record<string, unknown>;
  dataAgeMs?: number;
  asOf?: number;
}

export function buildChallengeEvidence(src: ChallengeSource): CandelEvidence[] {
  const evidence: CandelEvidence[] = [];

  const mk = (
    path: string,
    value: unknown,
    sourceId: string,
  ) => {
    if (value === undefined || value === null) return;
    evidence.push({
      id: `challenge-${sourceId}-${path}-${Date.now()}`,
      sourceType: "challenge",
      sourceId,
      timestamp: src.asOf ?? src.dataAgeMs ?? Date.now(),
      path,
      value,
    });
  };

  if (src.challengeId) {
    mk("challengeId", src.challengeId, src.challengeId);
  }
  if (src.status) {
    mk("status", src.status, src.challengeId ?? "challenge");
  }
  if (src.dailyLossRemaining !== undefined && src.dailyLossRemaining !== null) {
    mk("dailyLossRemaining", src.dailyLossRemaining, src.challengeId ?? "challenge");
  }
  if (src.remainingDrawdown !== undefined && src.remainingDrawdown !== null) {
    mk("remainingDrawdown", src.remainingDrawdown, src.challengeId ?? "challenge");
  }
  if (src.restrictions && src.restrictions.length > 0) {
    mk("restrictions", src.restrictions, src.challengeId ?? "challenge");
  }
  if (src.challenge) {
    mk("challenge", src.challenge, src.challengeId ?? "challenge");
  }

  return evidence;
}

// ─── Evidence from Candel Memory (Phase 4 §16) ─────────────────────────────

export interface MemorySource {
  relevantEntries?: unknown[];
  previousSetups?: unknown[];
  previousOutcomes?: unknown[];
  dataAgeMs?: number;
  asOf?: number;
}

export function buildMemoryEvidence(src: MemorySource): CandelEvidence[] {
  const evidence: CandelEvidence[] = [];

  const mk = (
    path: string,
    value: unknown,
    sourceId: string,
  ) => {
    if (value === undefined || value === null) return;
    evidence.push({
      id: `memory-${sourceId}-${path}-${Date.now()}`,
      sourceType: "memory",
      sourceId,
      timestamp: src.asOf ?? src.dataAgeMs ?? Date.now(),
      path,
      value,
    });
  };

  if (src.relevantEntries && src.relevantEntries.length > 0) {
    mk("relevantEntries", src.relevantEntries, "memory");
  }
  if (src.previousSetups && src.previousSetups.length > 0) {
    mk("previousSetups", src.previousSetups, "memory");
  }
  if (src.previousOutcomes && src.previousOutcomes.length > 0) {
    mk("previousOutcomes", src.previousOutcomes, "memory");
  }

  return evidence;
}

// ─── Evidence from Terminal (Phase 4 §6) ───────────────────────────────────

export interface TerminalSource {
  symbol?: string;
  timeframe?: string;
  accountMode?: "paper" | "live" | "unknown";
  accountContext?: CandelAccountContext;
  dataAgeMs?: number;
  asOf?: number;
}

export function buildTerminalEvidence(src: TerminalSource): CandelEvidence[] {
  const evidence: CandelEvidence[] = [];

  const mk = (
    path: string,
    value: unknown,
    sourceId: string,
  ) => {
    if (value === undefined || value === null) return;
    evidence.push({
      id: `terminal-${sourceId}-${path}-${Date.now()}`,
      sourceType: "terminal",
      sourceId,
      timestamp: src.asOf ?? src.dataAgeMs ?? Date.now(),
      path,
      value,
    });
  };

  if (src.symbol) {
    mk("symbol", src.symbol, src.symbol);
  }
  if (src.timeframe) {
    mk("timeframe", src.timeframe, src.symbol ?? "terminal");
  }
  if (src.accountMode) {
    mk("accountMode", src.accountMode, src.symbol ?? "terminal");
  }
  if (src.accountContext) {
    mk("accountContext", src.accountContext, src.symbol ?? "terminal");
  }

  return evidence;
}

// ─── Recommendation construction (Phase 4 §9) ──────────────────────────────

export function buildRecommendations(
  conclusion: CandelConclusion,
  evidenceIds: string[],
  stale: boolean,
  accountContext?: CandelAccountContext,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const mk = (
    action: Recommendation["action"],
    summary: string,
    reason: string,
  ): void => {
    recs.push({
      action,
      summary,
      evidenceIds: [...evidenceIds],
      confidence: 0.5,
      staleness: stale ? "stale" : "fresh",
      requiresApproval: true,
      reason,
    });
  };

  switch (conclusion) {
    case "BUY":
      mk(
        "CREATE_ORDER_PROPOSAL",
        "Candel proposes a BUY order proposal. Review and approve before execution.",
        "Candel concluded BUY with supporting evidence but requires human approval.",
      );
      break;
    case "SELL":
      mk(
        "CREATE_ORDER_PROPOSAL",
        "Candel proposes a SELL order proposal. Review and approve before execution.",
        "Candel concluded SELL with supporting evidence but requires human approval.",
      );
      break;
    case "WAIT":
      mk(
        "CREATE_ALERT",
        "Candel recommends watching and will re-evaluate when confirmation arrives.",
        "Candel concluded WAIT: confirmation is still missing.",
      );
      break;
    case "NO_TRADE":
      mk(
        null,
        "No trade proposed: Candel concluded that trading is not appropriate at this time.",
        "Candel concluded NO_TRADE based on system constraints (challenge rules, risk limits, stale data, insufficient data, etc.).",
      );
      break;
    case "WATCH":
      mk(
        "CREATE_ALERT",
        "Candel recommends monitoring this setup and creating an alert for confirmation.",
        "Candel concluded WATCH: data is insufficient to act decisively.",
      );
      break;
    case "INSUFFICIENT_DATA":
      mk(
        null,
        "No action proposed: Candel lacks sufficient data to make a recommendation.",
        "Candel concluded INSUFFICIENT_DATA; missing context prevents a reliable recommendation.",
      );
      break;
    default:
      break;
  }

  return recs;
}

// ─── Conclusion derivation from facts (Phase 4 §10) ────────────────────────

export function deriveCandelConclusion(
  facts: Fact[],
  interpretations: Interpretation[],
  limitations: Limitation[],
  accountContext?: CandelAccountContext,
  challengeRestrictions: string[] = [],
): { conclusion: CandelConclusion; confidence: number } {
  // Fail-closed: if the context is stale, downgrade to WATCH/NO_TRADE.
  if (limitations.some((l) => l.text.includes("stale") || l.text.includes("Stale"))) {
    return { conclusion: "WAIT", confidence: 0.3 };
  }

  // If there are no facts at all, return INSUFFICIENT_DATA.
  if (facts.length === 0) {
    return { conclusion: "INSUFFICIENT_DATA", confidence: 0 };
  }

  // If challenge restrictions invalidate the setup, NO_TRADE.
  const hasChallengeRestrictions = challengeRestrictions.includes("position");

  if (hasChallengeRestrictions) {
    return { conclusion: "NO_TRADE", confidence: 0.6 };
  }

  // If risk is flagged elevated, NO_TRADE or WAIT.
  const riskMetrics = (accountContext?.riskMetrics as Record<string, unknown> | undefined);
  const riskStatus = riskMetrics?.status;
  if (riskStatus === "RESTRICTED" || riskStatus === "HALTED") {
    return { conclusion: "NO_TRADE", confidence: 0.7 };
  }
  if (riskStatus === "WARNING") {
    return { conclusion: "WAIT", confidence: 0.4 };
  }

  // Default: if we have a clear trend fact, derive BUY/SELL.
  const bullFact = facts.some(
    (f) => typeof f.text === "string" && /bullish/i.test(f.text),
  );
  const bearFact = facts.some(
    (f) => typeof f.text === "string" && /bearish/i.test(f.text),
  );

  if (bullFact && !bearFact) {
    return { conclusion: "BUY", confidence: 0.55 };
  }
  if (bearFact && !bullFact) {
    return { conclusion: "SELL", confidence: 0.55 };
  }

  return { conclusion: "WAIT", confidence: 0.5 };
}

// ─── Build the shared intelligence context (Phase 4 §6) ────────────────────

export function buildCandelIntelligenceContext(input: {
  userId: string;
  candelId: string;
  contextSources: Map<string, { availability: string; value?: unknown }>;
  evidence: CandelEvidence[];
  facts: Fact[];
  interpretations: Interpretation[];
  limitations: Limitation[];
  accountContext?: CandelAccountContext;
  challengeRestrictions: string[];
}): CandelIntelligenceContext {
  const {
    userId,
    candelId,
    contextSources,
    evidence,
    facts,
    interpretations,
    limitations,
    accountContext,
    challengeRestrictions,
  } = input;

  const result = {
    contextId: `ctx_${userId}_${candelId}_${Date.now()}`,
    generatedAt: Date.now(),
    userId,
    candelId,
    evidence,
    facts,
    interpretations,
    limitations,
    recommendations: [],
    builtInLimitations: [
      "This context is advisory only. Execution requires a separate approval step.",
      "Only existing AlgoVault engines were used; no new trading/market/risk engine was introduced.",
      "Stale or unavailable data is reported as such, never synthesized.",
    ],
  } as CandelIntelligenceContext;

  // Populate the optional context sections if available.
  const fillSection =
    (key: "market" | "strategy" | "risk" | "challenge" | "memory") =>
    (sectionKey: string) => {
      if (contextSources.has(sectionKey)) {
        const r = contextSources.get(sectionKey)!;
        if (r.availability === "available" && r.value) {
          // Engine payloads are flexible records; cast through unknown to
          // satisfy the structural check while keeping the data flowing.
          const casted = r.value as unknown;
          (result as Record<string, unknown>)[sectionKey] = casted;
        }
      }
    };

  fillSection("market")("market_intelligence");
  fillSection("strategy")("strategy_lab");
  fillSection("risk")("risk_engine");
  fillSection("challenge")("challenge");
  fillSection("memory")("memory");

  if (contextSources.has("account") || contextSources.has("terminal")) {
    if (accountContext) {
      result.account = {
        accountId: accountContext.accountId,
        provider: "demo",
        balance: accountContext.balance,
        equity: accountContext.equity,
        margin: accountContext.margin,
        openPositions: accountContext.openPositions as unknown as unknown[],
        openOrders: accountContext.openOrders as unknown as unknown[],
        exposure: accountContext.riskMetrics,
      };
    }
  }

  // Build recommendations.
  const conclusion = deriveCandelConclusion(
    facts,
    interpretations,
    limitations,
    accountContext,
    challengeRestrictions,
  );
  result.recommendations = buildRecommendations(
    conclusion.conclusion,
    evidence.map((e) => e.id),
    isContextStale(result.generatedAt, Date.now()),
    accountContext,
  );

  return result;
}

// ─── Staleness helpers ─────────────────────────────────────────────────────

export function isContextStale(generatedAt: number, now: number): boolean {
  const ageMs = now - generatedAt;
  // 120s for trading-adjacent context (fail-closed).
  return ageMs > 120_000;
}
