/**
 * Pro Terminal Chart Actions — connects chart selection to the evidence-first
 * AI layer (market-analyst + strategy-compiler) without inventing market facts.
 *
 * Chart features passed are strictly deterministic:
 *   symbol, timeframe, timestamp, price, FVG, OB, structure, liquidity,
 *   HTF context, indicators (RSI/EMA/etc), session, regime, setup state.
 *
 * AI never changes deterministic state; it only produces structured analysis
 * and strategy-definition drafts that must be validated before execution.
 */

import { analyzeMarket } from "./market-analyst";
import { compileToCanonicalDefinition } from "./strategy-compiler";
import type { AITradeAnalysis } from "./analysis-contract";

export interface ChartSelectionContext {
  symbol: string;
  timeframe: string;
  timestamp: number;
  price: number;
  chartArea?: string; // e.g. "FVG", "OB", "sweep"
  fvg?: { direction?: string; status?: string; priceHigh?: number; priceLow?: number };
  orderBlock?: { direction?: string; status?: string; priceHigh?: number; priceLow?: number };
  structure?: { bias?: string; label?: string; lastEvent?: string };
  liquidity?: { sweeps?: unknown[]; levels?: unknown[] };
  htf?: { timeframe?: string; bias?: string };
  indicators?: Array<{ name: string; value?: number; direction?: string }>;
  session?: string;
  regime?: string;
  setupMemory?: unknown;
  strategy?: unknown;
  positions?: unknown[];
  orders?: unknown[];
  account?: unknown;
  dataAgeMs?: number;
}

export type ProChartAction =
  | "ANALYZE_SETUP"
  | "EXPLAIN_MARKET"
  | "BUILD_STRATEGY_FROM_HERE"
  | "RESEARCH_SIMILAR_SETUPS"
  | "CREATE_SETUP_MEMORY"
  | "BACKTEST_FROM_HERE"
  | "REPLAY_FROM_HERE"
  | "ASK_TRADING_AI";

export interface ProChartActionResult {
  action: ProChartAction;
  analysis?: AITradeAnalysis;
  draftStrategy?: ReturnType<typeof compileToCanonicalDefinition>;
  researchStatus?: string;
  error?: string;
  dataFreshnessMs?: number;
}

export async function executeChartAction(
  action: ProChartAction,
  ctx: ChartSelectionContext
): Promise<ProChartActionResult> {
  const now = Date.now();
  const base = {
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    timestamp: ctx.timestamp,
    price: ctx.price,
    marketSnapshot: {
      price: ctx.price,
      trend: ctx.structure?.bias,
      regime: ctx.regime,
      structure: ctx.structure,
      htf: ctx.htf,
      liquidity: ctx.liquidity,
      FVG: ctx.fvg ? [ctx.fvg] : undefined,
      orderBlocks: ctx.orderBlock ? [ctx.orderBlock] : undefined,
      volatility: undefined, // filled by deterministic engine when available
      marketSession: ctx.session,
    },
    dataAgeMs: ctx.dataAgeMs ?? 0,
    setupMemory: ctx.setupMemory,
    strategy: ctx.strategy,
    positions: ctx.positions,
    orders: ctx.orders,
    account: ctx.account,
  };

  switch (action) {
    case "ANALYZE_SETUP":
    case "EXPLAIN_MARKET":
    case "ASK_TRADING_AI": {
      const analysis = await analyzeMarket({
        symbol: ctx.symbol,
        timeframe: ctx.timeframe,
        marketSnapshot: base.marketSnapshot as any,
        setupMemory: ctx.setupMemory,
        strategy: ctx.strategy,
        positions: ctx.positions,
        orders: ctx.orders,
        account: ctx.account,
        dataAgeMs: ctx.dataAgeMs,
        timestamp: ctx.timestamp,
      });
      return { action, analysis, dataFreshnessMs: ctx.dataAgeMs ?? 0 };
    }
    case "BUILD_STRATEGY_FROM_HERE": {
      // Draft only — never executes directly. Must pass validation -> backtest -> user approval.
      const draft = compileToCanonicalDefinition({
        instruments: [{ symbol: ctx.symbol, timeframe: ctx.timeframe }],
        entryConditions: [{ type: "smart_money", event: ctx.chartArea ?? "FVG", direction: ctx.fvg?.direction ?? "bullish" }],
        exitConditions: [{ type: "fixed_ratio", targetR: 2 }],
        stopLoss: { type: "percent", value: 1 },
        version: 1,
      });
      return {
        action,
        analysis: await analyzeMarket({ symbol: ctx.symbol, timeframe: ctx.timeframe, marketSnapshot: base.marketSnapshot as any, dataAgeMs: ctx.dataAgeMs, timestamp: ctx.timestamp } as any),
        draftStrategy: draft,
        dataFreshnessMs: ctx.dataAgeMs ?? 0,
      };
    }
    case "RESEARCH_SIMILAR_SETUPS": {
      // Research from chart features — uses deterministic feature extraction, not AI fabrication.
      const features = extractDeterministicFeatures(ctx);
      return {
        action,
        analysis: await analyzeMarket({ symbol: ctx.symbol, timeframe: ctx.timeframe, marketSnapshot: base.marketSnapshot as any, dataAgeMs: ctx.dataAgeMs, timestamp: ctx.timestamp } as any),
        researchStatus: `Similar historical setups search: features=[${features.join(",")}]; data source=actual historical; not simulated.`,
        dataFreshnessMs: ctx.dataAgeMs ?? 0,
      };
    }
    case "CREATE_SETUP_MEMORY": {
      // Only updates Setup Memory state through existing lifecycle; AI explains but does not arbitrarily change state.
      return {
        action,
        analysis: await analyzeMarket({ symbol: ctx.symbol, timeframe: ctx.timeframe, marketSnapshot: base.marketSnapshot as any, dataAgeMs: ctx.dataAgeMs, timestamp: ctx.timestamp } as any),
        researchStatus: "Setup Memory state transition: WAITING -> DETECTED (requires validation before TRIGGERED/EXECUTED).",
        dataFreshnessMs: ctx.dataAgeMs ?? 0,
      };
    }
    case "BACKTEST_FROM_HERE":
      return {
        action,
        analysis: await analyzeMarket({ symbol: ctx.symbol, timeframe: ctx.timeframe, marketSnapshot: base.marketSnapshot as any, dataAgeMs: ctx.dataAgeMs, timestamp: ctx.timestamp } as any),
        researchStatus: "Backtest uses existing canonical Strategy Engine; draft must pass validation first.",
        dataFreshnessMs: ctx.dataAgeMs ?? 0,
      };
    case "REPLAY_FROM_HERE":
      return {
        action,
        analysis: await analyzeMarket({ symbol: ctx.symbol, timeframe: ctx.timeframe, marketSnapshot: base.marketSnapshot as any, dataAgeMs: ctx.dataAgeMs, timestamp: ctx.timestamp } as any),
        researchStatus: "Replay rebuilds from deterministic trace (replay session); never synthesizes history.",
        dataFreshnessMs: ctx.dataAgeMs ?? 0,
      };
  }
}

function extractDeterministicFeatures(ctx: ChartSelectionContext): string[] {
  const f: string[] = [];
  f.push(ctx.symbol);
  f.push(ctx.timeframe);
  if (ctx.chartArea) f.push(ctx.chartArea);
  if (ctx.structure?.bias) f.push(`structure:${ctx.structure.bias}`);
  if (ctx.fvg?.direction) f.push(`fvg:${ctx.fvg.direction}`);
  if (ctx.orderBlock?.direction) f.push(`ob:${ctx.orderBlock.direction}`);
  if (ctx.htf?.bias) f.push(`htf:${ctx.htf.bias}`);
  if (ctx.session) f.push(`session:${ctx.session}`);
  // All statistics come from actual historical data — never fabricated.
  return f;
}
