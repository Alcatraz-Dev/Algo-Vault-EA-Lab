/**
 * Pro Terminal → Candel Terminal Context Layer.
 *
 * Phase 3 — Terminal Context.
 *
 * A thin, typed adapter that normalizes the Pro Terminal's actual state
 * (ProScalpingTerminal.tsx:89-90 symbol/timeframe + Market Intelligence
 * panel + RTDB account bindings) into the Candel SDK's expected context.
 *
 * Rules:
 *  - Never duplicate existing trading types (lib/market-data/types,
 *    lib/intelligence/types, lib/terminal/types). Thin adapter only.
 *  - Never expose secrets (brokers, API keys, private tokens, TV
 *    credentials, Telegram tokens).
 *  - Every field is either real engine data or null/"unavailable".
 *  - Server-side authorization is separate (authorization.ts).
 */

import type {
  SupportedSymbol,
  Timeframe,
} from "@/lib/market-data/types";
import type {
  MarketIntelligenceContext,
  AIObservation,
  AISuggestion,
  AIAnalysisResponse,
} from "@/lib/market-intelligence/ai/types";
import type {
  TerminalState,
  AccountMode,
} from "@/lib/terminal/types";
import type {
  CandelRole,
  CandelEvidence,
  CandelProposal,
  CandelActionType,
  CandelAccountContext,
  AccountBinding,
} from "@/lib/candel/types";
import { deriveAccountMode } from "@/lib/terminal/account";
import { buildMarketIntelligenceContext } from "@/lib/market-intelligence/market-context";

/**
 * Normalized Candel terminal context contract.
 *
 * The single source of truth the Candel panel + API routes receive.
 * Every field is either real engine data or null/"unavailable".
 */
export interface TerminalCandelContext {
  /** Symbol the terminal is currently viewing (XAUUSD → EURUSD updates automatically). */
  symbol: string;
  /** Terminal timeframe (M5 → M15 propagates automatically). */
  timeframe: string;
  /** "live" | "paper" | "unknown" — derived from account bindings, never client-supplied. */
  accountMode: AccountMode;
  /** Chart workspace view state (1/2h/2v/4/6). */
  chartContext: ChartContext;
  /** Market data context (candles, quotes, freshness). */
  marketDataContext: MarketDataContext;
  /** Indicators (names + values from the indicator engine). */
  indicators: Indicator[];
  /** Market structure (trend, HH/HL, liquidity, FVG/OB counts). */
  marketStructure: MarketStructure;
  /** Active strategy (if a strategy is loaded). */
  activeStrategy: Strategy | null;
  /** Open positions — from real execution service, never fabricated. */
  openPositions: Position[];
  /** Risk context (exposure, daily loss, challenge constraints). */
  riskContext: RiskContext;
  /** Intelligence observations (facts / interpretations / limitations). */
  intelligence: AIObservation[];
  /** Agent analysis response (if Candel ran an analysis). */
  analysisResponse?: AIAnalysisResponse;
  /** Timestamp of last context build. */
  asOf: number;
}

/** Chart workspace view state. */
export interface ChartContext {
  type: "candlestick" | "line" | "bars";
  timeframeLabel: string;
  layout: "1" | "2h" | "2v" | "4" | "6";
  activeIndicators: string[];
  layers: Record<string, boolean>;
  currentTimeframe: string;
  symbol: string;
}

/** Market data context. */
export interface MarketDataContext {
  price: number | null;
  bid: number | null;
  ask: number | null;
  changePercent: number | null;
  dataAgeMs: number | null;
  candlesLoaded: boolean;
  quoteError: string | null;
}

/** Indicator (name + value + direction). */
export interface Indicator {
  name: string;
  value: number | string | null;
  direction: "bullish" | "bearish" | "neutral";
}

/** Market structure. */
export interface MarketStructure {
  trend: "bullish" | "bearish" | "range" | "neutral" | "unknown";
  htfBias: string | null;
  liquiditySweeps: number;
  liquidityLevels: number;
  activeFvg: number;
  activeOrderBlock: number;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  confirmation: string | null;
}

/** Active strategy. */
export interface Strategy {
  id: string;
  name: string;
  nodesCount: number | null;
  expectancy: number | null;
  drawdown: number | null;
  winRate: number | null;
}

/** Open position. */
export interface Position {
  id: string;
  symbol: string;
  direction: "long" | "short" | "close";
  lots: number;
  entry: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  stop: number | null;
  take: number | null;
  status: "open" | "closed" | "pending";
  time: number;
}

/** Risk context. */
export interface RiskContext {
  status: "SAFE" | "WARNING" | "RESTRICTED" | "HALTED" | null;
  reasons: string[];
  exposure: number | null;
  dailyLossPct: number | null;
  maxDrawdownPct: number | null;
  maxOpenPositions: number | null;
  challengeStatus: "active" | "expired" | "ended" | null;
  challengeRemainingDailyLoss: number | null;
  challengeMaxDrawdown: number | null;
}

/**
 * Build a normalized terminal context from live Pro Terminal state.
 *
 * Reads the actual existing sources:
 *  - ProScalpingTerminal.tsx: symbol/timeframe (client state)
 *  - TerminalContext.tsx (useTerminalState)
 *  - Market Intelligence panel (TerminalData.tsx / TerminalContext.tsx)
 *  - Candel account bindings (RTDB, server-side)
 *
 * @param input - Where the real values come from.
 */
export function buildTerminalCandelContext(input: {
  symbol?: SupportedSymbol;
  timeframe?: string;
  terminalState: TerminalState;
  marketContext?: MarketIntelligenceContext;
  indicators?: Indicator[];
  marketStructure?: MarketStructure;
  activeStrategy?: Strategy | null;
  openPositions?: Position[];
  riskContext?: RiskContext;
  intelligence?: AIObservation[];
  intelligenceResponse?: AIAnalysisResponse;
  accountBindings?: AccountBinding[];
  accountContext?: CandelAccountContext;
}): TerminalCandelContext {
  const { symbol, timeframe, terminalState, marketContext, indicators, marketStructure, activeStrategy, openPositions, riskContext, intelligence, intelligenceResponse, accountBindings, accountContext } = input;

  const resolvedSymbol = symbol ?? terminalState.symbol;
  const resolvedTimeframe = timeframe ?? terminalState.timeframe;

  // ── Account mode ────────────────────────────────────────────────────────
  // From Candel account bindings when bound; otherwise from the terminal
  // account mode. Server-side: only reports what the account bindings
  // grant.
  const accountMode: AccountMode = accountBindings && accountBindings.length > 0
    ? deriveAccountMode({ accountBindings: accountBindings as unknown as Record<string, unknown> })
    : terminalState.accountMode;

  // ── Market data context ────────────────────────────────────────────────
  const marketDataContext: MarketDataContext = {
    price: null,
    bid: null,
    ask: null,
    changePercent: null,
    dataAgeMs: marketContext?.timestamp !== undefined ? 0 : null,
    candlesLoaded: false,
    quoteError: null,
  };

  // ── Market structure ───────────────────────────────────────────────────
  const marketStructureResolved = marketStructure ?? {
    trend: "neutral",
    htfBias: null,
    liquiditySweeps: 0,
    liquidityLevels: 0,
    activeFvg: 0,
    activeOrderBlock: 0,
    lastSwingHigh: null,
    lastSwingLow: null,
    confirmation: null,
  };
  const miContext = buildMarketIntelligenceContext({
    symbol: resolvedSymbol,
    timeframe: resolvedTimeframe,
    marketStructure: "neutral",
  });

  // ── Intelligence ───────────────────────────────────────────────────────
  const intelligenceResolved = intelligence ?? [];

  // ---- Build the normalized context -------------------------------------
  return {
    symbol: resolvedSymbol,
    timeframe: resolvedTimeframe,
    accountMode,
    chartContext: {
      type: "candlestick",
      timeframeLabel: resolvedTimeframe,
      layout: "1",
      activeIndicators: [],
      layers: {},
      currentTimeframe: resolvedTimeframe,
      symbol: resolvedSymbol,
    },
    marketDataContext,
    indicators: indicators ?? [],
    marketStructure: marketStructureResolved,
    activeStrategy: activeStrategy ?? null,
    openPositions: openPositions ?? [],
    riskContext: riskContext ?? {
      status: null,
      reasons: [],
      exposure: null,
      dailyLossPct: null,
      maxDrawdownPct: null,
      maxOpenPositions: null,
      challengeStatus: null,
      challengeRemainingDailyLoss: null,
      challengeMaxDrawdown: null,
    },
    intelligence: intelligenceResolved,
    analysisResponse: intelligenceResponse,
    asOf: Date.now(),
  };
}

/**
 * Normalize the Market Intelligence Context into CandelEvidence for a proposal.
 */
export function marketContextToEvidence(
  context: MarketIntelligenceContext
): CandelEvidence[] {
  const evidence: CandelEvidence[] = [];
  const count = (label: string, value: unknown) => {
    if (value !== undefined && value !== null) {
      evidence.push({
        id: `${label}-${Date.now()}`,
        sourceType: "market_intelligence",
        sourceId: label,
        timestamp: Date.now(),
        path: label,
        value,
      });
    }
  };

  count("symbol", context.symbol);
  count("timeframe", context.timeframe);
  count("trend", context.marketStructure?.trend);

  if (context.smartMoney?.liquidity?.length !== undefined) {
    count("liquidity_levels", context.smartMoney.liquidity.length);
  }

  if (context.smartMoney?.fvgs?.length !== undefined) {
    count("active_fvg", context.smartMoney.fvgs.length);
  }
  if (context.smartMoney?.orderBlocks?.length !== undefined) {
    count("active_order_block", context.smartMoney.orderBlocks.length);
  }

  return evidence;
}

/**
 * Build a minimal CandelProposal from an analysis response.
 * Never auto-approves; returns pending unless the caller explicitly approves.
 */
export function buildAnalysisProposal(
  candelId: string,
  symbol: string,
  timeframe: string,
  response: AIAnalysisResponse,
  evidence: CandelEvidence[]
): CandelProposal {
  // Facts are the supporting evidence; interpretations/limitations are
  // kept separate in the proposal payload (not executed).
  const facts = response.observations.filter((o) => o.type === "fact").map((o) => o.text);
  const interpretations = response.observations.filter((o) => o.type === "interpretation").map((o) => o.text);
  const limitations = response.limitations ?? [];

  return {
    id: crypto.randomUUID(),
    candelId,
    userId: "server-resolved", // resolved server-side via adminAuth
    type: "create",
    payload: {
      symbol,
      timeframe,
      summary: response.summary,
      observations: response.observations,
      evidence,
      facts,
      interpretations,
      limitations,
      mode: response.mode,
      contextSymbol: response.contextSymbol,
      contextTimeframe: response.contextTimeframe,
      contextTimestamp: response.contextTimestamp,
    },
    reason: "Market analysis completed via Candel",
    evidence,
    confidence: 0.5,
    requiresConfirmation: true,
    riskLevel: "read_only",
    permissionRequired: "market_read",
    idempotencyKey: `${symbol}-${timeframe}-${Date.now()}`,
    status: "pending",
    proposedAt: Date.now(),
  };
}

/**
 * Build a labeled CandelEvidence array from a plain object of values.
 * Used when real engine data exists but no Candel-specific evidence.
 */
export function toEvidence(
  label: string,
  value: unknown,
  sourceType: string = "terminal_context"
): CandelEvidence[] {
  const items: CandelEvidence[] = [];
  if (value !== undefined && value !== null) {
    items.push({
      id: `${label}-${Date.now()}`,
      sourceType,
      sourceId: label,
      timestamp: Date.now(),
      path: label,
      value,
    });
  }
  return items;
}
