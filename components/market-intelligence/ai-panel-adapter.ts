/**
 * Intelligence Panel Adapter — Phase 7.4
 * Connects existing AI modules to the workspace.
 * No new AI router / budget / provider.
 */
import { buildIntelligenceContext, isReplaySafe } from "../../../lib/market-intelligence/ai/intelligence-layer";
import { analyzeMarket } from "../../../lib/market-intelligence/ai/market-analyst";
import type { WorkspaceContext } from "./workspace-context";

export interface IntelligencePanelState {
  available: boolean;
  safe: boolean;
  replaySafe: boolean;
  facts: string[];
  interpretations: string[];
  limitations: string[];
  actions: string[];
  mode?: string;
}

export function buildIntelligencePanel(
  workspace: Partial<WorkspaceContext>,
  marketStructure?: any,
  smartMoney?: any,
  backtest?: any,
  replay?: any,
  dataQuality?: any
): IntelligencePanelState {
  const ctx = buildIntelligenceContext(workspace, marketStructure, smartMoney, backtest, replay, dataQuality);
  const replaySafe = isReplaySafe(ctx);
  const analysis = analyzeMarket({
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    mode: (ctx.mode as any) || "historical",
    timestamp: ctx.replayState?.timestamp,
    marketStructure: ctx.marketStructure,
    smartMoney: smartMoney,
    indicators: ctx.indicators ? Object.entries(ctx.indicators).map(([name, value]) => ({ name, value, direction: "neutral" })) : undefined,
    sessions: ctx.sessions ? { name: ctx.sessions.join(", ") } : undefined,
    mtf: Object.entries(ctx.mtf ?? {}).map(([tf, bias]) => ({ timeframe: tf, bias: bias as any })),
    dataQuality: ctx.dataQuality,
    limitations: ctx.limitations,
  } as any);
  return {
    available: true,
    safe: replaySafe,
    replaySafe,
    facts: analysis.observations.filter((o) => o.type === "fact").map((o) => o.text),
    interpretations: analysis.observations.filter((o) => o.type === "interpretation").map((o) => o.text),
    limitations: analysis.limitations,
    actions: ["Backtest Setup", "Continue Research", "Inspect Smart Money", "Open Trading Studio"],
    mode: analysis.mode,
  };
}
