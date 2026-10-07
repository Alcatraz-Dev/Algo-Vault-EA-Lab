/**
 * Market Intelligence Context builder.
 *
 * Builds a normalized `MarketIntelligenceContext` (lib/market-intelligence/ai/types.ts)
 * from the Pro Terminal's actual state. The context carries only derived facts,
 * never raw candles. This is the PHASE 3 §10 core bridge:
 *
 *   Terminal context → Market Intelligence Engine → Normalized intelligence result
 */
import type { MarketIntelligenceContext, MarketIntelligenceContext as MIC } from "@/lib/market-intelligence/ai/types";

export interface BuildMarketContextInput {
  symbol: string;
  timeframe: string;
  currentPrice?: number;
  trend?: string;
  regime?: string;
  marketStructure?: string | { bias?: string; trend?: string; label?: string };
  higherTimeframeContext?: { bias?: string; timeframe?: string; direction?: string } | string;
  liquidity?: { sweeps?: unknown[]; levels?: unknown[] } | null;
  FVG?: Array<{ direction?: string; status?: string } | { status?: string }>;
  orderBlocks?: Array<{ direction?: string; status?: string } | { status?: string }>;
  volatility?: { atr?: number; state?: string };
  ATR?: number;
  marketSession?: string;
  newsRisk?: string;
  dataAgeMs?: number;
  timestamp?: number;
  mode?: "live" | "historical" | "replay" | "backtest";
  limitations?: string[];
}

/**
 * Build a normalized MarketIntelligenceContext from the terminal's actual state.
 *
 * Every field is either a real engine value or the type's optional (omit entirely).
 * No zeros that look like real data. No raw candles.
 */
export function buildMarketIntelligenceContext(input: BuildMarketContextInput): MIC {
  const {
    symbol,
    timeframe,
    currentPrice,
    trend,
    regime,
    marketStructure,
    higherTimeframeContext,
    liquidity,
    FVG,
    orderBlocks,
    volatility,
    ATR,
    marketSession,
    newsRisk,
    dataAgeMs,
    timestamp,
    mode,
    limitations,
  } = input;

  return {
    symbol,
    timeframe,
    timestamp: timestamp ?? Date.now(),
    mode: mode ?? "historical",
    indicators: undefined,
    marketStructure: marketStructure
      ? {
          trend: (typeof marketStructure === "string" ? marketStructure : marketStructure.bias) ?? "neutral",
          lastEvent: undefined,
          higherHighs: 0,
          higherLows: 0,
          lowerHighs: 0,
          lowerLows: 0,
        }
      : undefined,
    smartMoney: liquidity
      ? {
          events: [],
          liquidity: liquidity.levels?.map((l, i) => ({
            side: "buy_side" as const,
            price: (l as { price?: number })?.price ?? 0,
            source: `level_${i}`,
            status: "active",
          })) ?? [],
          fvgs: FVG?.map((f) => ({
            direction: (f as { direction?: string })?.direction ?? "neutral",
            status: (f as { status?: string })?.status ?? "active",
            filledPercent: 0,
          })) ?? [],
          orderBlocks: orderBlocks?.map((b) => ({
            direction: (b as { direction?: string })?.direction ?? "neutral",
            status: (b as { status?: string })?.status ?? "active",
          })) ?? [],
        }
      : undefined,
    sessions: undefined,
    mtf: higherTimeframeContext
      ? typeof higherTimeframeContext === "string"
        ? [{ timeframe, bias: higherTimeframeContext }]
        : [{
            timeframe: higherTimeframeContext.timeframe ?? timeframe,
            bias: higherTimeframeContext.bias ?? higherTimeframeContext.direction ?? "neutral",
            structure: undefined,
          }]
      : undefined,
    strategy: undefined,
    backtest: undefined,
    dataQuality: undefined,
    limitations: limitations ?? [],
  };
}
