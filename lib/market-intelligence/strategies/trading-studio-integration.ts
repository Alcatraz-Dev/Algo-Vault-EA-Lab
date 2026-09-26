/**
 * Trading Studio Integration — Phase 5.5
 *
 * Connects Strategy Builder (Phase 4), Backtest (Phase 3), Replay (Phase 3),
 * Smart Money (Phase 2), AI (Phase 5), and Chart into one workspace.
 *
 * Does NOT replace Trading Studio, React Flow, or Strategy Lab.
 * Provides shared context and cross-highlighting contracts.
 */

import { SmartMoneyEvent } from "../types";
import { BacktestResult } from "../backtesting/adapter";

export interface TradingStudioContext {
  strategyId?: string;
  symbol?: string;
  timeframe?: string;
  chartFocus?: { eventId?: string; tradeId?: string; timestamp?: number };
  replayIndex?: number;
  replayPlaying?: boolean;
  replaySpeed?: number;
  aiPanelOpen?: boolean;
  aiMode?: "market_analyst" | "strategy_copilot" | "backtest_analyst" | "strategy_generator";
}

export function highlightFromNode(nodeType: string, smartMoneyEvents: SmartMoneyEvent[]): TradingStudioContext["chartFocus"] {
  // Real mapping: node type → event type
  const match = smartMoneyEvents.find((e) => {
    if (nodeType.includes("bos") || nodeType.includes("BOS")) return e.type === "BOS";
    if (nodeType.includes("mss") || nodeType.includes("MSS")) return e.type === "MSS";
    if (nodeType.includes("fvg") || nodeType.includes("FVG")) return e.type === "FVG";
    if (nodeType.includes("liquidity") || nodeType.includes("sweep")) return e.type === "LIQUIDITY_SWEEP";
    return false;
  });
  return match ? { eventId: match.id, timestamp: match.timestamp } : undefined;
}
