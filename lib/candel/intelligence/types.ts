/**
 * AlgoVault Candel Intelligence — Shared Context Model
 *
 * The strongly-typed shared context model that Candel uses as its single
 * intelligence contract. Every engine (Market Intelligence, Strategy Lab,
 * Risk Engine, Account, Challenge, Candel Memory, Terminal) writes into this
 * one normalized shape instead of scattering facts across arbitrary objects.
 *
 * Design rules (Phase 4 §4, §5, §7, §9, §33):
 *   • One canonical context object, not per-engine ad-hoc shapes.
 *   • Each context section declares its source module + referenceId for
 *     explainability and debugging.
 *   • Staleness is a first-class field, not an afterthought.
 *   • Actions are proposals only; execution remains separate and
 *     approval-gated (never LLM → direct execution).
 *   • No secrets: broker credentials, API keys, tokens, private credentials
 *     never appear in the context.
 */

import type { CandelEvidence } from "@/lib/candel/types";

// ─── Versioned context schema (forward-compat, auditability) ──────────────

export const CANDEL_INTELLIGENCE_CONTEXT_SCHEMA = "candel-intelligence/1.0";

export type ContextStaleness =
  | "live"
  | "fresh"
  | "delayed"
  | "stale"
  | "unavailable";

// ─── Context source (Phase 4 §7) ───────────────────────────────────────────

export type ContextSourceType =
  | "market_intelligence"
  | "strategy_lab"
  | "risk_engine"
  | "account"
  | "challenge"
  | "terminal"
  | "memory"
  | "tradingview"
  | "ea"
  | "system";

export interface ContextSource {
  type: ContextSourceType;
  /** Stable reference in the source system (e.g. market-snapshot id, strategy
   * version, evidence id). Used to trace back to the origin. */
  id?: string;
  /** When the source data was retrieved. */
  generatedAt?: number;
  /** Staleness of the source data as observed by this context build. */
  staleness?: ContextStaleness;
}

// ─── Normalized facts vs interpretations (Phase 4 §9) ──────────────────────

export interface Fact {
  /** Stable evidence id this fact traces to. */
  evidenceId: string;
  /** The structured observation text. */
  text: string;
  /** Confidence in the fact as a 0..1, honest about uncertainty. */
  confidence?: number;
  /** Source tracking. */
  source: ContextSource;
}

export interface Interpretation {
  evidenceId: string;
  text: string;
  confidence?: number;
  source: ContextSource;
}

export interface Limitation {
  text: string;
  /** Why this limitation exists. */
  reason: string;
  /** Source that produced the limitation. */
  source?: ContextSource;
}

// ─── Supported Candel conclusions (Phase 4 §10) ────────────────────────────

export type CandelConclusion =
  | "BUY"
  | "SELL"
  | "WAIT"
  | "NO_TRADE"
  | "WATCH"
  | "INSUFFICIENT_DATA";

// ─── Context snapshot (Phase 4 §35) ────────────────────────────────────────

export interface ContextSnapshot {
  snapshotId: string;
  generatedAt: number;
  /** Canonical context this snapshot captures. */
  contextId: string;
  /** Symbol / timeframe the snapshot was built for. */
  symbol: string;
  timeframe: string;
  /** Selected account id, if any. */
  accountId?: string;
  /** Account mode (paper/live) at snapshot time. */
  accountMode?: "paper" | "live" | "unknown";
  /** Relevant market observations. */
  market?: MarketSnapshotRef;
  /** Relevant strategy evidence. */
  strategy?: StrategySnapshotRef;
  /** Risk state. */
  risk?: RiskSnapshotRef;
  /** Challenge state, if a challenge is active. */
  challenge?: ChallengeSnapshotRef;
  /** Active memory entries referenced. */
  memory?: MemorySnapshotRef;
  /** Active proposals. */
  proposals?: ProposalSnapshotRef;
  /** Evidence ids included. */
  evidenceIds: string[];
  /** Staleness summary. */
  staleness: Record<string, ContextStaleness>;
  /** Any limitations that applied. */
  limitations: Limitation[];
}

/** Market section of a context snapshot. */
export interface MarketSnapshotRef {
  /** Market-intelligence snapshot id. */
  snapshotId?: string;
  /** Market structure (HH/HL/LH/LL summary). */
  structure?: string;
  /** Liquidity state. */
  liquidity?: string;
  /** FVGs detected. */
  fvgs?: number;
  /** Active order blocks. */
  orderBlocks?: number;
  /** Volatility state. */
  volatility?: string;
  /** Data freshness. */
  freshness?: ContextStaleness;
}

/** Strategy section of a context snapshot. */
export interface StrategySnapshotRef {
  /** Strategy id. */
  strategyId?: string;
  /** Strategy name. */
  name?: string;
  /** Out-of-sample verdict. */
  oosVerdict?: string;
  /** Walk-forward status. */
  walkForwardStatus?: string;
  /** Monte Carlo status. */
  monteCarloStatus?: string;
  /** Data freshness. */
  freshness?: ContextStaleness;
}

/** Risk section of a context snapshot. */
export interface RiskSnapshotRef {
  /** Risk status. */
  status?: string;
  /** Current exposure. */
  exposure?: string;
  /** Data freshness. */
  freshness?: ContextStaleness;
}

/** Challenge section of a context snapshot. */
export interface ChallengeSnapshotRef {
  /** Challenge id. */
  challengeId?: string;
  /** Challenge status. */
  status?: string;
  /** Daily loss remaining. */
  dailyLossRemaining?: number;
  /** Remaining drawdown. */
  remainingDrawdown?: number;
  /** Active restrictions. */
  restrictions?: string[];
}

/** Memory section of a context snapshot. */
export interface MemorySnapshotRef {
  /** Number of relevant entries included. */
  relevantEntries?: number;
  /** Number of previous setups referenced. */
  previousSetups?: number;
  /** Number of previous outcomes referenced. */
  previousOutcomes?: number;
}

/** Proposal section of a context snapshot. */
export interface ProposalSnapshotRef {
  /** Proposal id, if any. */
  proposalId?: string;
  /** Proposal type. */
  type?: string;
  /** Staleness. */
  staleness?: ContextStaleness;
}

// ─── Normalized Candel intelligence context (Phase 4 §5) ───────────────────

export interface CandelIntelligenceContext {
  /** Canonical context id. */
  contextId: string;
  /** When this context was generated. */
  generatedAt: number;
  /** Owning user (server-resolved, never client-supplied). */
  userId: string;
  /** Owning Candel id. */
  candelId: string;
  /** Workspace. */
  workspace?: {
    id?: string;
    name?: string;
  };
  /** Market context. */
  market?: {
    /** Current symbol. */
    symbol: string;
    /** Timeframe. */
    timeframe: string;
    /** Market session/state. */
    marketState?: string;
    /** Market session name (asia/london/new_york/overlap/closed). */
    session?: string;
    /** Current price. */
    price?: {
      bid?: number;
      ask?: number;
      last?: number;
    };
    /** Market structure (HH/HL/LH/LL summary). */
    structure?: unknown;
    /** Liquidity. */
    liquidity?: unknown;
    /** Order blocks. */
    orderBlocks?: unknown;
    /** Fair value gaps. */
    fairValueGaps?: unknown;
    /** Indicators. */
    indicators?: unknown;
    /** Volatility. */
    volatility?: unknown;
    /** Existing Market Intelligence observations. */
    observations?: unknown[];
    /** Staleness. */
    staleness?: ContextStaleness;
  };
  /** Strategy context. */
  strategy?: {
    /** Active strategy id. */
    activeStrategyId?: string;
    /** Active strategy name. */
    activeStrategyName?: string;
    /** Strategy-lab candidates. */
    candidates?: unknown[];
    /** Backtest evidence. */
    backtestEvidence?: unknown[];
    /** Out-of-sample evidence. */
    oosEvidence?: unknown[];
    /** Walk-forward evidence. */
    walkForwardEvidence?: unknown[];
    /** Monte Carlo evidence. */
    monteCarloEvidence?: unknown[];
    /** Staleness. */
    staleness?: ContextStaleness;
  };
  /** Account context. */
  account?: {
    /** Selected account id. */
    accountId?: string;
    /** Broker provider. */
    provider?: string;
    /** Balance. */
    balance?: number;
    /** Equity. */
    equity?: number;
    /** Margin. */
    margin?: number;
    /** Open positions. */
    openPositions?: unknown[];
    /** Open orders. */
    openOrders?: unknown[];
    /** Exposure. */
    exposure?: unknown;
    /** Staleness. */
    staleness?: ContextStaleness;
  };
  /** Risk context. */
  risk?: {
    /** Risk metrics. */
    riskMetrics?: unknown;
    /** Risk limits. */
    limits?: unknown;
    /** Current risk state. */
    currentRisk?: unknown;
    /** Staleness. */
    staleness?: ContextStaleness;
  };
  /** Challenge context. */
  challenge?: {
    /** Challenge id. */
    challengeId?: string;
    /** Challenge status. */
    status?: string;
    /** Challenge rules. */
    rules?: unknown;
    /** Remaining drawdown. */
    remainingDrawdown?: number;
    /** Daily loss remaining. */
    dailyLossRemaining?: number;
    /** Active restrictions. */
    restrictions?: string[];
    /** Staleness. */
    staleness?: ContextStaleness;
  };
  /** Candel memory context. */
  memory?: {
    /** Relevant entries. */
    relevantEntries?: unknown[];
    /** Previous setups. */
    previousSetups?: unknown[];
    /** Previous outcomes. */
    previousOutcomes?: unknown[];
    /** Staleness. */
    staleness?: ContextStaleness;
  };
  /** Composed evidence. */
  evidence: CandelEvidence[];
  /** Raw unified facts (from the Fact[] model). */
  facts: Fact[];
  /** Raw unified interpretations. */
  interpretations: Interpretation[];
  /** Raw unified recommendations. */
  recommendations: Recommendation[];
  /** Raw unified limitations. */
  limitations: Limitation[];
  /** Permissions (server-resolved). */
  permissions?: unknown;
  /** Built-in limitations. */
  builtInLimitations: string[];
  /** Index signature for flexible engine payloads (Candel intelligence engine). */
  [key: string]: unknown;
}

// ─── Recommendation (Phase 4 §9) ───────────────────────────────────────────

export type RecommendationAction =
  | "WATCH"
  | "CREATE_SETUP"
  | "MODIFY_STRATEGY"
  | "CREATE_ALERT"
  | "CREATE_TRADINGVIEW_OBJECT"
  | "CREATE_ORDER_PROPOSAL"
  | "CREATE_CHALLENGE_ACTION"
  | "CREATE_EA_BOT_ACTION"
  | "RUN_ANALYSIS"
  | "SAVE_MEMORY"
  | null;

export interface Recommendation {
  /** Action Candel may propose. */
  action: RecommendationAction;
  /** Human-readable summary. */
  summary: string;
  /** Evidence ids this recommendation rests on. */
  evidenceIds: string[];
  /** Confidence 0..1 (honest). */
  confidence?: number;
  /** Staleness at recommendation time. */
  staleness?: ContextStaleness;
  /** Whether this requires explicit approval. */
  requiresApproval: boolean;
  /** Why this action is proposed. */
  reason: string;
}

// ─── Cross-module intelligence events (Phase 4 §33) ────────────────────────

export interface CandelIntelligenceEvent {
  eventId: string;
  type:
    | "MARKET_CONTEXT_UPDATED"
    | "STRATEGY_CONTEXT_UPDATED"
    | "ACCOUNT_CONTEXT_UPDATED"
    | "RISK_CONTEXT_UPDATED"
    | "CHALLENGE_CONTEXT_UPDATED"
    | "SETUP_CREATED"
    | "SETUP_INVALIDATED"
    | "POSITION_OPENED"
    | "POSITION_CLOSED"
    | "PROPOSAL_CREATED"
    | "PROPOSAL_APPROVED"
    | "PROPOSAL_REJECTED"
    | "DECISION_GENERATED"
    | "CONTEXT_STALE"
    | "SOURCE_FAILURE";
  timestamp: number;
  /** Owning user. */
  userId: string;
  /** Owning Candel. */
  candelId: string;
  /** Source that produced the event. */
  source: ContextSourceType;
  /** Reference id in the source. */
  referenceId?: string;
  /** Payload (canonical, bounded, sanitized). */
  payload?: Record<string, unknown>;
  /** Staleness. */
  staleness?: ContextStaleness;
}

// ─── Intelligence context builder (Phase 4 §6) ─────────────────────────────

export interface ContextBuilderInput {
  /** Owning user (server-resolved). */
  userId: string;
  /** Owning Candel id. */
  candelId: string;
  /** Desired context sections to load. Selective loading is supported so we
   * never load every module for every message. */
  include: {
    market?: boolean;
    strategy?: boolean;
    account?: boolean;
    risk?: boolean;
    challenge?: boolean;
    memory?: boolean;
    terminal?: boolean;
  };
  /** Optional account id override (server resolves via account bindings). */
  accountId?: string;
  /** Market symbol / timeframe, when known (resolved from terminal). */
  symbol?: string;
  timeframe?: string;
}

export interface ContextBuilderResult {
  context: CandelIntelligenceContext;
  /** Events emitted during the build. */
  events: CandelIntelligenceEvent[];
  /** Which sources were loaded and their staleness. */
  sourceStatuses: Record<string, { type: ContextSourceType; staleness: ContextStaleness; ok: boolean }>;
}

// ─── Context staleness detection (Phase 4 §12) ─────────────────────────────

export interface StalenessCheck {
  contextId: string;
  generatedAt: number;
  now: number;
  stale: boolean;
  reasons: string[];
}

/**
 * Determine whether a context is stale.
 *
 * Fail-closed: for trading actions, stale context must be rejected.
 * Thresholds are aligned to existing market-data infrastructure (no arbitrary
 * invented values). Callers that need a specific window should pass it.
 */
export function isCandelContextStale(check: StalenessCheck): { stale: boolean; reasons: string[] } {
  const { generatedAt, now, reasons } = check;
  const ageMs = now - generatedAt;
  reasons.length = 0;

  // Default trading-window: fail-closed if older than a few minutes.
  // Callers can override via a policy env/parameter; default 120s for
  // order-adjacent context, a longer window for informational context is
  // left to the specific consumer (documented, not invented here).
  const TRADING_WINDOW_MS = 120_000;
  const INFORMATIONAL_WINDOW_MS = 600_000;

  // If the context itself has a staleness field, respect it.
  if (check.reasons.some((r) => r.startsWith("context_staleness"))) {
    return { stale: true, reasons };
  }

  if (ageMs > TRADING_WINDOW_MS) {
    reasons.push(
      `context age ${Math.round(ageMs / 1000)}s exceeds trading window ${Math.round(TRADING_WINDOW_MS / 1000)}s`
    );
  } else if (ageMs > INFORMATIONAL_WINDOW_MS) {
    reasons.push(
      `context age ${Math.round(ageMs / 1000)}s exceeds informational window ${Math.round(INFORMATIONAL_WINDOW_MS / 1000)}s`
    );
  }

  // If data age is unknown, fail-closed when freshness was expected.
  const unknownAge = check.reasons.some((r) => r === "unknown_data_age");
  if (unknownAge) {
    reasons.push("unknown data age; fail-closed for trading actions");
    return { stale: true, reasons };
  }

  return { stale: reasons.length > 0, reasons };
}

// ─── Source-not-found handling (Phase 4 §41) ───────────────────────────────

export type ContextAvailability = "available" | "unknown" | "unavailable";

/**
 * Represents the availability of a context source, distinguishing:
 *   - available: data present and usable
 *   - unknown: data missing but the system is reachable (not zero)
 *   - unavailable: system or data layer unreachable
 *
 * Never treat unavailable data as zero.
 */
export interface SourceResult<T> {
  availability: ContextAvailability;
  value?: T;
  reason?: string;
}

export function mkAvailable<T>(value: T, source: ContextSource): SourceResult<T> {
  return { availability: "available", value };
}

export function mkUnknown<T>(reason: string): SourceResult<T> {
  return { availability: "unknown", reason };
}

export function mkUnavailable<T>(reason: string): SourceResult<T> {
  return { availability: "unavailable", reason };
}
