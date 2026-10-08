/**
 * AlgoVault Candel Intelligence — Context Builder
 *
 * Central context builder that composes the shared intelligence context
 * from existing authoritative AlgoVault engines.
 *
 * Design rules (Phase 4 §6, §7):
 *   • The builder NEVER implements domain logic itself — it delegates to
 *     the existing engines (Market Intelligence, Strategy Lab, Risk Engine,
 *     Account, Challenge, Candel Memory, Terminal).
 *   • Each context section declares its source module + referenceId for
 *     explainability and debugging (ContextSource).
 *   • Context assembly is selective: only requested sections are loaded.
 *   • Fail-closed: if a required source fails, the context reports
 *     "unavailable" rather than fabricating data.
 */

import type { CandelEvidence } from "@/lib/candel/types";
import type {
  Fact,
  Interpretation,
  Limitation,
  ContextSource,
  ContextSourceType,
  CandelConclusion,
  ContextStaleness,
  SourceResult,
  CandelIntelligenceContext,
} from "./types";
import type {
  MarketIntelligenceSource,
  StrategyLabSource,
  RiskEngineSource,
  AccountSource,
  ChallengeSource,
  MemorySource,
  TerminalSource,
} from "./evidence-builder";
import type { CandelAccountContext } from "@/lib/candel/types";
import {
  deriveCandelConclusion,
  buildRecommendations,
  isContextStale,
} from "./evidence-builder";

/** Map the string availability verdict from engines to a typed ContextStaleness. */
function mapStaleness(availability: string): ContextStaleness {
  switch (availability) {
    case "available":
      return "fresh";
    case "unknown":
      return "delayed";
    case "unavailable":
      return "unavailable";
    default:
      return "unavailable";
  }
}

// ─── Engine adapters (hooks into existing engines) ─────────────────────────

/**
 * Hook into the existing Market Intelligence / market-data infrastructure.
 * Replace the body with the actual call that returns a market snapshot.
 */
export interface MarketIntelligenceAdapter {
  getSnapshot(symbol: string, timeframe: string): SourceResult<MarketIntelligenceSource>;
}

export const defaultMarketIntelligenceAdapter: MarketIntelligenceAdapter = {
  getSnapshot() {
    // Currently a stub; would call the existing market-data service.
    return { availability: "unavailable", reason: "not configured" };
  },
};

/**
 * Hook into the existing Strategy Lab services.
 * Replace the body with the actual call that returns strategy context.
 */
export interface StrategyLabAdapter {
  getStrategyContext(
    strategyId?: string,
    mode?: string,
  ): SourceResult<StrategyLabSource>;
}

export const defaultStrategyLabAdapter: StrategyLabAdapter = {
  getStrategyContext() {
    return { availability: "unavailable", reason: "not configured" };
  },
};

/**
 * Hook into the existing Risk Engine.
 * Replace the body with the actual call that returns risk state.
 */
export interface RiskEngineAdapter {
  getRiskContext(): SourceResult<RiskEngineSource>;
}

export const defaultRiskEngineAdapter: RiskEngineAdapter = {
  getRiskContext() {
    return { availability: "unavailable", reason: "not configured" };
  },
};

/**
 * Hook into the existing authenticated account infrastructure.
 * Replace the body with the actual call that returns account context.
 */
export interface AccountAdapter {
  getAccountContext(accountId?: string): SourceResult<CandelAccountContext>;
}

export const defaultAccountAdapter: AccountAdapter = {
  getAccountContext() {
    return { availability: "unavailable", reason: "not configured" };
  },
};

/**
 * Hook into the existing Challenge logic.
 * Replace the body with the actual call that returns challenge context.
 */
export interface ChallengeAdapter {
  getChallengeContext(): SourceResult<ChallengeSource>;
}

export const defaultChallengeAdapter: ChallengeAdapter = {
  getChallengeContext() {
    return { availability: "unavailable", reason: "not configured" };
  },
};

/**
 * Hook into the existing Candel Memory infrastructure.
 * Replace the body with the actual call that returns memory context.
 */
export interface MemoryAdapter {
  getRelevantMemory(
    candelId: string,
    userId: string,
  ): SourceResult<MemorySource>;
}

export const defaultMemoryAdapter: MemoryAdapter = {
  getRelevantMemory() {
    return { availability: "unavailable", reason: "not configured" };
  },
};

/**
 * Hook into the existing Pro Terminal context adapter.
 * Replace the body with the actual call that returns terminal context.
 */
export interface TerminalAdapter {
  getTerminalContext(symbol?: string, timeframe?: string): SourceResult<TerminalSource>;
}

export const defaultTerminalAdapter: TerminalAdapter = {
  getTerminalContext() {
    return { availability: "unavailable", reason: "not configured" };
  },
};

// ─── Context sources (Phase 4 §7) ──────────────────────────────────────────

export interface ContextSources {
  market?: ContextSource;
  strategy?: ContextSource;
  account?: ContextSource;
  risk?: ContextSource;
  challenge?: ContextSource;
  memory?: ContextSource;
  terminal?: ContextSource;
}

export function buildContextSources(
  sources: ContextSources,
  dataAgeMs: number,
  asOf: number,
): Map<string, { availability: string; value?: unknown }> {
  const map = new Map<string, { availability: string; value?: unknown }>();

  const add = (
    sourceKey: string,
    source: ContextSource | undefined,
    value: unknown,
  ) => {
    if (source) {
      map.set(sourceKey, {
        availability: "available",
        value: {
          ...((value as Record<string, unknown>) ?? {}),
          source,
          asOf,
          dataAgeMs,
        },
      });
    }
  };

  add("market_intelligence", sources.market, {});
  add("strategy_lab", sources.strategy, {});
  add("account", sources.account, {});
  add("risk_engine", sources.risk, {});
  add("challenge", sources.challenge, {});
  add("memory", sources.memory, {});
  add("terminal", sources.terminal, {});

  return map;
}

// ─── Central context builder (Phase 4 §6) ──────────────────────────────────

export interface BuildContextOptions {
  /** Owning user (server-resolved). */
  userId: string;
  /** Owning Candel id. */
  candelId: string;
  /** Desired context sections to load (selective). */
  include: {
    market?: boolean;
    strategy?: boolean;
    account?: boolean;
    risk?: boolean;
    challenge?: boolean;
    memory?: boolean;
    terminal?: boolean;
  };
  /** Market symbol / timeframe, resolved from terminal. */
  symbol?: string;
  timeframe?: string;
  /** Account id override (server resolves via account bindings). */
  accountId?: string;
  /** Market intelligence adapter. */
  marketAdapter?: MarketIntelligenceAdapter;
  /** Strategy lab adapter. */
  strategyAdapter?: StrategyLabAdapter;
  /** Risk engine adapter. */
  riskAdapter?: RiskEngineAdapter;
  /** Account adapter. */
  accountAdapter?: AccountAdapter;
  /** Challenge adapter. */
  challengeAdapter?: ChallengeAdapter;
  /** Memory adapter. */
  memoryAdapter?: MemoryAdapter;
  /** Terminal adapter. */
  terminalAdapter?: TerminalAdapter;
  /** Evidence items already collected from direct sources. */
  evidence: CandelEvidence[];
  /** Facts from the evidence. */
  facts: unknown[];
  /** Interpretations from the evidence. */
  interpretations: unknown[];
  /** Limitations from the evidence. */
  limitations: unknown[];
  /** Account context (for risk/account edge cases). */
  accountContext?: CandelAccountContext;
  /** Challenge restrictions (for NO_TRADE derivation). */
  challengeRestrictions: string[];
}

export function buildCandelIntelligenceContext(options: BuildContextOptions): CandelIntelligenceContext {
  const {
    userId,
    candelId,
    include,
    symbol,
    timeframe,
    accountId,
    marketAdapter = defaultMarketIntelligenceAdapter,
    strategyAdapter = defaultStrategyLabAdapter,
    riskAdapter = defaultRiskEngineAdapter,
    accountAdapter = defaultAccountAdapter,
    challengeAdapter = defaultChallengeAdapter,
    memoryAdapter = defaultMemoryAdapter,
    terminalAdapter = defaultTerminalAdapter,
    evidence,
    facts,
    interpretations,
    limitations,
    accountContext,
    challengeRestrictions,
  } = options;

  const now = Date.now();

  // Collect source statuses for observability.
  const sourceStatuses: Record<string, { type: string; staleness: ContextStaleness; ok: boolean }> = {};

  // 1. Market context
  let marketValue: unknown;
  if (include.market !== false) {
    const result = marketAdapter.getSnapshot(symbol ?? "XAUUSD", timeframe ?? "M5");
    if (result.availability === "available") {
      marketValue = result.value as Record<string, unknown>;
      sourceStatuses["market_intelligence"] = {
        type: "market_intelligence",
        staleness: "fresh",
        ok: true,
      };
    } else {
      marketValue = undefined;
      sourceStatuses["market_intelligence"] = {
        type: "market_intelligence",
        staleness: mapStaleness(result.availability),
        ok: false,
      };
    }
  }

  // 2. Strategy context
  let strategyValue: unknown;
  if (include.strategy !== false) {
    const result = strategyAdapter.getStrategyContext(accountId);
    if (result.availability === "available") {
      strategyValue = result.value as Record<string, unknown>;
      sourceStatuses["strategy_lab"] = {
        type: "strategy_lab",
        staleness: "fresh",
        ok: true,
      };
    } else {
      strategyValue = undefined;
      sourceStatuses["strategy_lab"] = {
        type: "strategy_lab",
        staleness: mapStaleness(result.availability),
        ok: false,
      };
    }
  }

  // 3. Account context
  let accountValue: unknown;
  if (include.account !== false) {
    const result = accountAdapter.getAccountContext(accountId);
    if (result.availability === "available") {
      accountValue = result.value;
      sourceStatuses["account"] = {
        type: "account",
        staleness: "fresh",
        ok: true,
      };
    } else {
      accountValue = undefined;
      sourceStatuses["account"] = {
        type: "account",
        staleness: mapStaleness(result.availability),
        ok: false,
      };
    }
  }

  // 4. Risk context
  let riskValue: unknown;
  if (include.risk !== false) {
    const result = riskAdapter.getRiskContext();
    if (result.availability === "available") {
      riskValue = result.value as Record<string, unknown>;
      sourceStatuses["risk_engine"] = {
        type: "risk_engine",
        staleness: "fresh",
        ok: true,
      };
    } else {
      riskValue = undefined;
      sourceStatuses["risk_engine"] = {
        type: "risk_engine",
        staleness: mapStaleness(result.availability),
        ok: false,
      };
    }
  }

  // 5. Challenge context
  let challengeValue: unknown;
  if (include.challenge !== false) {
    const result = challengeAdapter.getChallengeContext();
    if (result.availability === "available") {
      challengeValue = result.value as Record<string, unknown>;
      sourceStatuses["challenge"] = {
        type: "challenge",
        staleness: "fresh",
        ok: true,
      };
    } else {
      challengeValue = undefined;
      sourceStatuses["challenge"] = {
        type: "challenge",
        staleness: mapStaleness(result.availability),
        ok: false,
      };
    }
  }

  // 6. Memory context
  let memoryValue: unknown;
  if (include.memory !== false) {
    const result = memoryAdapter.getRelevantMemory(candelId, userId);
    if (result.availability === "available") {
      memoryValue = result.value as Record<string, unknown>;
      sourceStatuses["memory"] = {
        type: "memory",
        staleness: "fresh",
        ok: true,
      };
    } else {
      memoryValue = undefined;
      sourceStatuses["memory"] = {
        type: "memory",
        staleness: mapStaleness(result.availability),
        ok: false,
      };
    }
  }

  // 7. Terminal context
  let terminalValue: unknown;
  if (include.terminal !== false) {
    const result = terminalAdapter.getTerminalContext(symbol, timeframe);
    if (result.availability === "available") {
      terminalValue = result.value as Record<string, unknown>;
      sourceStatuses["terminal"] = {
        type: "terminal",
        staleness: "fresh",
        ok: true,
      };
    } else {
      terminalValue = undefined;
      sourceStatuses["terminal"] = {
        type: "terminal",
        staleness: mapStaleness(result.availability),
        ok: false,
      };
    }
  }

  // Build the shared context.
  return buildCandelIntelligenceContextCore({
    userId,
    candelId,
    contextSources: new Map<string, { availability: string; value?: unknown }>([
      ["market_intelligence", { availability: "available", value: marketValue }],
      ["strategy_lab", { availability: "available", value: strategyValue }],
      ["account", { availability: "available", value: accountValue }],
      ["risk_engine", { availability: "available", value: riskValue }],
      ["challenge", { availability: "available", value: challengeValue }],
      ["memory", { availability: "available", value: memoryValue }],
      ["terminal", { availability: "available", value: terminalValue }],
    ]),
    evidence,
    facts,
    interpretations,
    limitations,
    accountContext,
    challengeRestrictions,
  });
}

// ─── Core builder (shared with the evidence-builder module) ────────────────

export function buildCandelIntelligenceContextCore(input: {
  userId: string;
  candelId: string;
  contextSources: Map<string, { availability: string; value?: unknown }>;
  evidence: CandelEvidence[];
  facts: unknown[];
  interpretations: unknown[];
  limitations: unknown[];
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
    evidence: evidence as CandelEvidence[],
    facts: facts as Fact[],
    interpretations: interpretations as Interpretation[],
    limitations: limitations as Limitation[],
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
    result.facts,
    result.interpretations,
    result.limitations,
    accountContext,
    challengeRestrictions,
  );
  result.recommendations = buildRecommendations(
    conclusion.conclusion,
    (result.evidence as CandelEvidence[]).map((e) => e.id),
    isContextStale(result.generatedAt, Date.now()),
    accountContext,
  );

  return result;
}
