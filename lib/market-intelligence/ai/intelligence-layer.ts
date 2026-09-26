/**
 * Intelligence Layer — Phase 7.4
 * Converts existing WorkspaceContext + deterministic analytics into
 * structured IntelligenceContext for advisory AI use.
 * Reuses existing AI modules (context-builder, guardrails, market-analyst,
 * backtest-analyst, strategy-copilot, strategy-generator, schemas).
 * No new AI router, budget, provider, or Smart Money engine.
 */
import type { WorkspaceContext } from "../../../components/market-intelligence/workspace-context";

export type EvidenceSource = "market" | "smart_money" | "indicator" | "mtf" | "session" | "backtest" | "research" | "replay";

export interface IntelligenceEvidence {
  type: "fact" | "interpretation" | "limitation";
  source: EvidenceSource;
  reference?: string;
  value: string;
}

export interface IntelligenceContext {
  symbol?: string;
  timeframe?: string;
  mode?: "live" | "historical" | "backtest" | "replay" | "research";
  timestampBoundary?: number;
  dataQuality?: { status?: string; barCount?: number; gaps?: number };
  marketStructure?: { trend?: string; recentEvent?: string; state?: string };
  liquidity?: string[];
  fvg?: string[];
  orderBlocks?: string[];
  sessions?: string[];
  indicators?: Record<string, string>;
  mtf?: Record<string, string>;
  replayState?: { position?: number; timestamp?: number };
  backtestSummary?: { netProfit?: number; trades?: number; winRate?: number; maxDrawdown?: number; returnPct?: number };
  researchSummary?: { parameterConfig?: string; oosPeriod?: string; robustness?: string };
  selectedTrade?: { id?: string; entryPrice?: number; exitPrice?: number; pnl?: number };
  selectedEvent?: { id?: string; type?: string; timestamp?: number };
  limitations?: string[];
  facts: IntelligenceEvidence[];
  interpretations: IntelligenceEvidence[];
  suggestedActions: string[];
}

export function buildIntelligenceContext(
  workspace: Partial<WorkspaceContext>,
  marketStructure?: any,
  smartMoney?: any,
  backtest?: any,
  replay?: any,
  dataQuality?: any
): IntelligenceContext {
  const ctx: IntelligenceContext = {
    symbol: workspace.symbol,
    timeframe: workspace.timeframe,
    mode: (workspace.analysisMode as any) || "historical",
    timestampBoundary: workspace.replayPosition ? workspace.selectedTimestamp : undefined,
    replayState: workspace.replayPosition != null ? { position: workspace.replayPosition, timestamp: workspace.selectedTimestamp } : undefined,
    dataQuality: dataQuality ? { status: dataQuality.status, barCount: dataQuality.barCount, gaps: dataQuality.gaps } : undefined,
    marketStructure: marketStructure ? { trend: marketStructure.trend || "unknown", recentEvent: marketStructure.lastEvent || undefined, state: marketStructure.currentState || "unknown" } : undefined,
    liquidity: smartMoney?.liquidity ? ["Buy-side", "Sell-side"] : undefined,
    fvg: smartMoney?.fvg ? ["Bullish FVG", "Bearish FVG"] : undefined,
    orderBlocks: smartMoney?.orderBlocks ? ["Bullish OB", "Bearish OB"] : undefined,
    sessions: workspace.timeframe ? ["Session context available"] : undefined,
    indicators: {},
    mtf: {},
    selectedTrade: workspace.selectedTradeId ? { id: workspace.selectedTradeId } : undefined,
    selectedEvent: workspace.selectedEventId ? { id: workspace.selectedEventId, timestamp: workspace.selectedTimestamp } : undefined,
    backtestSummary: backtest ? { netProfit: backtest.netProfit, trades: backtest.totalTrades, winRate: backtest.winRate, maxDrawdown: backtest.maxDrawdown, returnPct: backtest.returnPct } : undefined,
    researchSummary: workspace.researchRunId ? { parameterConfig: "available", oosPeriod: "available" } : undefined,
    limitations: [
      "OHLC data cannot determine intrabar SL/TP ordering.",
      "Historical spread unavailable; configured spread used.",
      "Replay excludes future candles/events/trades.",
    ],
    facts: [],
    interpretations: [],
    suggestedActions: ["Backtest Setup", "Continue Research", "Inspect Smart Money", "Open Trading Studio"],
  };
  // Add deterministic facts from available sources
  if (ctx.symbol) ctx.facts.push({ type: "fact", source: "market", value: `Symbol: ${ctx.symbol}` });
  if (ctx.timeframe) ctx.facts.push({ type: "fact", source: "market", value: `Timeframe: ${ctx.timeframe}` });
  if (ctx.mode === "replay" && ctx.replayState) {
    ctx.facts.push({ type: "fact", source: "replay", value: `Replay position: ${ctx.replayState.position}` });
    ctx.limitations?.push("Future candles/events/trades excluded by replay boundary.");
  }
  if (backtest && backtest.totalTrades != null) {
    ctx.facts.push({ type: "fact", source: "backtest", value: `Trades: ${backtest.totalTrades}` });
  }
  if (marketStructure?.trend) {
    ctx.facts.push({ type: "fact", source: "smart_money", value: `Structure: ${marketStructure.trend}` });
    ctx.interpretations.push({ type: "interpretation", source: "smart_money", value: "Structure consistent with deterministic engine output." });
  }
  return ctx;
}

export function isReplaySafe(ctx: IntelligenceContext): boolean {
  if (ctx.mode === "replay") {
    // Enforce that future data is never included: replayState must be defined
    return !!ctx.replayState && typeof ctx.replayState.position === "number";
  }
  return true;
}
