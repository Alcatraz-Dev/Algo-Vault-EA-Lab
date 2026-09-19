/**
 * Chart Intelligence — the enrichment layer between the browser-detected
 * ChartContext and AlgoVault's market-data analytics.
 *
 * Responsibilities:
 *  - Validate the browser price against market data (never mix candles from a
 *    different instrument with a chart).
 *  - Backfill indicator values (EMA/RSI/MACD/VWAP/BB/Supertrend/Volume) from
 *    real market candles when TradingView cannot expose them.
 *  - Derive support/resistance from structure events + liquidity levels.
 *  - Produce a deterministic setup verdict ("long/short/neutral").
 *  - Build the structured context string that features send to the AI.
 *
 * Everything here is computed from real data — never invented.
 */
import type {
  ChartContext,
  DetectedIndicator,
  MarketSyncStatus,
} from "@/types";
import type { MarketContext } from "@/types/market-context";
import type { MarketCandle, Timeframe } from "../../../lib/market-data/types";
import { computeSeriesIndicator } from "../../../lib/analytics/indicators";
import { TIMEFRAME_INTERVALS } from "../../../lib/market-data/types";

/* ── types ───────────────────────────────────────────────────────────── */

export interface PriceValidation {
  browserPrice: number | null;
  marketPrice: number | null;
  deviationPct: number | null;
  matched: boolean;
  state: "matched" | "mismatched" | "unavailable";
}

export interface KeyLevel {
  price: number;
  strength: "strong" | "medium" | "weak";
  source: "structure" | "liquidity" | "swing";
  side: "support" | "resistance";
}

export interface SetupVerdict {
  direction: "long" | "short" | "neutral";
  label: string;
  confidence: "high" | "medium" | "low";
  /** -100 (strong short) … +100 (strong long) */
  score: number;
  reasons: string[];
}

export interface EnrichedChartContext {
  chart: ChartContext;
  market: MarketContext | null;
  priceValidation: PriceValidation;
  indicators: DetectedIndicator[];
  levels: { support: KeyLevel[]; resistance: KeyLevel[] };
  setup: SetupVerdict;
  marketSync: MarketSyncStatus;
  enrichedAt: number;
}

const PRICE_TOLERANCE_PCT = 10;

/* ── price validation ────────────────────────────────────────────────── */

export function validatePrice(
  browserPrice: number | null,
  marketPrice: number | null
): PriceValidation {
  if (browserPrice === null || marketPrice === null || marketPrice <= 0) {
    return {
      browserPrice,
      marketPrice,
      deviationPct: null,
      matched: false,
      state: "unavailable",
    };
  }
  const deviationPct = ((browserPrice - marketPrice) / marketPrice) * 100;
  return {
    browserPrice,
    marketPrice,
    deviationPct,
    matched: Math.abs(deviationPct) <= PRICE_TOLERANCE_PCT,
    state: Math.abs(deviationPct) <= PRICE_TOLERANCE_PCT ? "matched" : "mismatched",
  };
}

/* ── indicator backfill ──────────────────────────────────────────────── */

function candlesFor(
  market: MarketContext | null,
  timeframe: string | null
): MarketCandle[] {
  if (!market) return [];
  const tf = (timeframe as Timeframe) in TIMEFRAME_INTERVALS
    ? (timeframe as Timeframe)
    : "H1";
  return market.candlesByTimeframe[tf] ?? [];
}

export function backfillIndicators(
  indicators: DetectedIndicator[],
  market: MarketContext | null,
  timeframe: string | null
): DetectedIndicator[] {
  const candles = candlesFor(market, timeframe);
  if (candles.length === 0) return indicators;

  return indicators.map((ind) => {
    if (ind.available) return ind;
    if (ind.source === "unavailable" || ind.source === "tradingview-legend") {
      const computed = computeSeriesIndicator(ind.type, candles, ind.parameters);
      if (computed.value != null) {
        return {
          ...ind,
          source: "market-computed",
          value: computed.value,
          displayValue: String(computed.value),
          available: true,
          timeframe,
        };
      }
    }
    return ind;
  });
}

/* ── support / resistance ────────────────────────────────────────────── */

export function deriveLevels(market: MarketContext | null): {
  support: KeyLevel[];
  resistance: KeyLevel[];
} {
  const support: KeyLevel[] = [];
  const resistance: KeyLevel[] = [];

  if (!market) return { support, resistance };

  const { marketStructure, liquidity } = market;

  // Structure events (BOS / CHOCH / swings).
  for (const ev of marketStructure.events) {
    const side = ev.direction === "bearish" ? "support" : "resistance";
    const list = side === "support" ? support : resistance;
    if (!list.some((l) => Math.abs(l.price - ev.price) / ev.price < 0.002)) {
      list.push({
        price: ev.price,
        strength: ev.type === "swing_high" || ev.type === "swing_low" ? "weak" : "medium",
        source: "structure",
        side,
      });
    }
  }

  // Liquidity levels.
  for (const lvl of liquidity.levels) {
    const side = (lvl as unknown as { side?: "buy" | "sell" }).side === "buy" ? "support" : "resistance";
    const list = side === "support" ? support : resistance;
    if (!list.some((l) => Math.abs(l.price - lvl.price) / lvl.price < 0.002)) {
      list.push({
        price: lvl.price,
        strength: lvl.strength >= 0.8 ? "strong" : lvl.strength >= 0.5 ? "medium" : "weak",
        source: "liquidity",
        side,
      });
    }
  }

  const sortDesc = (arr: KeyLevel[]) => arr.sort((a, b) => b.price - a.price);
  return {
    support: sortDesc(support).slice(0, 5).reverse(),
    resistance: sortDesc(resistance).slice(0, 5),
  };
}

/* ── setup verdict ───────────────────────────────────────────────────── */

export function determineSetup(
  chart: ChartContext,
  market: MarketContext | null,
  indicators: DetectedIndicator[]
): SetupVerdict {
  const reasons: string[] = [];
  let score = 0;

  if (!market || market.status !== "ready") {
    return {
      direction: "neutral",
      label: "Insufficient data",
      confidence: "low",
      score: 0,
      reasons: ["Market data unavailable"],
    };
  }

  // Trend direction from market structure.
  const trend = market.trend.direction;
  if (trend === "bullish") { score += 30; reasons.push("Structure is bullish"); }
  else if (trend === "bearish") { score -= 30; reasons.push("Structure is bearish"); }
  else reasons.push("Structure is neutral");

  // Market score.
  if (market.score.bias === "bullish") { score += market.score.total / 10; reasons.push(`Market score ${market.score.total} (bullish)`); }
  else if (market.score.bias === "bearish") { score -= market.score.total / 10; reasons.push(`Market score ${market.score.total} (bearish)`); }

  // Regime.
  const regime = market.marketRegime.regime;
  if (regime === "trending_bullish") { score += 15; reasons.push("Trending bullish regime"); }
  else if (regime === "trending_bearish") { score -= 15; reasons.push("Trending bearish regime"); }
  else if (regime === "ranging") reasons.push("Ranging regime — expect mean reversion");

  // Indicator confluences.
  const rsi = indicators.find((i) => i.type === "rsi")?.value;
  if (rsi != null) {
    if (rsi < 30) { score += 10; reasons.push(`RSI ${rsi.toFixed(1)} oversold`); }
    else if (rsi > 70) { score -= 10; reasons.push(`RSI ${rsi.toFixed(1)} overbought`); }
    else reasons.push(`RSI ${rsi.toFixed(1)} neutral`);
  }
  const st = indicators.find((i) => i.type === "supertrend")?.value;
  if (st != null) {
    const price = chart.price ?? market.currentPrice;
    if (price != null) {
      score += price >= st ? 8 : -8;
      reasons.push(`Supertrend ${price >= st ? "bullish" : "bearish"} (${st.toFixed(price >= 100 ? 2 : 5)})`);
    }
  }

  // VWAP position.
  if (market.vwap.vwap > 0 && chart.price != null) {
    if (chart.price > market.vwap.vwap) { score += 5; reasons.push("Price above VWAP"); }
    else { score -= 5; reasons.push("Price below VWAP"); }
  }

  // Liquidity sweeps suggest reversal interest.
  if (market.liquidity.sweeps.length > 0) {
    const lastSweep = market.liquidity.sweeps[market.liquidity.sweeps.length - 1];
    const sweepDir = (lastSweep as unknown as { side: "buy_side" | "sell_side" }).side;
    if (sweepDir === "buy_side") { score += 8; reasons.push("Buy-side liquidity swept (short fuel)"); }
    else { score -= 8; reasons.push("Sell-side liquidity swept (long fuel)"); }
  }

  score = Math.max(-100, Math.min(100, Math.round(score)));
  const direction = score >= 20 ? "long" : score <= -20 ? "short" : "neutral";
  const confidence = Math.abs(score) >= 50 ? "high" : Math.abs(score) >= 20 ? "medium" : "low";

  const label = [
    direction === "long" ? "Long" : direction === "short" ? "Short" : "Neutral",
    confidence === "high" ? "setup" : "bias",
  ].join(" ");

  return { direction, label, confidence, score, reasons };
}

/* ── full enrichment pipeline ────────────────────────────────────────── */

export function enrichChartContext(
  chart: ChartContext,
  market: MarketContext | null
): EnrichedChartContext {
  const priceValidation = validatePrice(chart.price, market?.currentPrice ?? null);
  const indicators = backfillIndicators(chart.indicators ?? [], market, chart.timeframe);
  const levels = deriveLevels(market);
  const setup = determineSetup(chart, market, indicators);

  let marketSync: MarketSyncStatus = chart.marketSync ?? "unknown";
  if (market && market.status === "ready") {
    if (market.symbol && chart.marketSymbol) {
      marketSync = market.symbol.toUpperCase() === chart.marketSymbol.toUpperCase()
        ? "matched"
        : "mismatched";
    }
  }

  return {
    chart: {
      ...chart,
      indicators,
      marketSync,
      status: chart.symbol ? "active" : chart.status ?? "unknown",
      dataAgeMs: Date.now() - (chart.timestamp ?? Date.now()),
    },
    market,
    priceValidation,
    indicators,
    levels,
    setup,
    marketSync,
    enrichedAt: Date.now(),
  };
}

/* ── structured AI context ───────────────────────────────────────────── */

export function buildStructuredContext(e: EnrichedChartContext): string {
  const { chart, market, priceValidation, indicators, levels, setup } = e;
  const lines: string[] = [];

  lines.push(`CHART CONTEXT`);
  lines.push(`Symbol: ${chart.marketSymbol || chart.symbol || "unknown"}${chart.exchange ? ` (${chart.exchange})` : ""}`);
  lines.push(`Raw browser symbol: ${chart.rawSymbol || chart.symbol || "unknown"}`);
  lines.push(`Timeframe: ${chart.timeframe || "unknown"}`);
  if (chart.price != null) lines.push(`Last price (browser): ${chart.price}`);
  if (market?.currentPrice != null) lines.push(`Last price (market data): ${market.currentPrice}`);

  if (priceValidation.deviationPct != null) {
    lines.push(`Price validation: ${priceValidation.deviationPct.toFixed(2)}% deviation from market data (${priceValidation.state})`);
  } else {
    lines.push(`Price validation: unavailable`);
  }

  lines.push(`Market sync: ${e.marketSync}`);

  if (market && market.status === "ready") {
    lines.push(``);
    lines.push(`MARKET ANALYSIS (AlgoVault analytics)`);
    lines.push(`Trend: ${market.trend.direction} (${market.trend.state})`);
    lines.push(`Regime: ${market.marketRegime.regime.replace(/_/g, " ")}, ${market.marketRegime.confidence}% confidence`);
    lines.push(`Structure: ${market.marketStructure.overall} (${market.marketStructure.bosCount} BOS, ${market.marketStructure.chochCount} CHOCH)`);
    lines.push(`Market score: ${market.score.total}/100 ${market.score.bias} (${market.score.confidence} confidence)`);
    if (market.volatility.atr > 0) {
      lines.push(`Volatility: ${market.volatility.state} (ATR ${market.volatility.atr.toFixed(market.volatility.atr < 1 ? 5 : 2)}, ${market.volatility.atrPercent.toFixed(2)}%)`);
    }
    if (market.vwap.vwap > 0) {
      lines.push(`VWAP: ${market.vwap.vwap.toFixed(2)} (price ${chart.price != null && chart.price > market.vwap.vwap ? "above" : "below"})`);
    }
    if (market.volume.relative > 0) {
      lines.push(`Volume: ${market.volume.relative.toFixed(2)}x average (${market.volume.state})`);
    }
    if (market.liquidity.sweeps.length > 0) {
      lines.push(`Liquidity sweeps: ${market.liquidity.sweeps.length} (last: ${market.liquidity.sweeps[market.liquidity.sweeps.length - 1].sweepPrice})`);
    }
  } else {
    lines.push(``);
    lines.push(`MARKET ANALYSIS: unavailable (${market?.error || "no market data"})`);
  }

  if (indicators.length > 0) {
    lines.push(``);
    lines.push(`DETECTED INDICATORS`);
    for (const ind of indicators) {
      const params = ind.parameters.length > 0
        ? ` [${ind.parameters.map((p) => `${p.key}=${p.value}`).join(", ")}]`
        : "";
      lines.push(`${ind.name}${params}: ${ind.available ? ind.displayValue : "not available from browser / computed"}`);
    }
  }

  if (levels.support.length > 0 || levels.resistance.length > 0) {
    lines.push(``);
    lines.push(`KEY LEVELS`);
    if (levels.support.length > 0) lines.push(`Support: ${levels.support.map((l) => l.price.toFixed(2)).join(", ")}`);
    if (levels.resistance.length > 0) lines.push(`Resistance: ${levels.resistance.map((l) => l.price.toFixed(2)).join(", ")}`);
  }

  lines.push(``);
  lines.push(`SETUP VERDICT: ${setup.label} (${setup.direction}, confidence ${setup.confidence})`);
  if (setup.reasons.length > 0) lines.push(`Reasons: ${setup.reasons.join("; ")}`);

  lines.push(``);
  lines.push("Data provenance: browser detection (TradingView public widget API + legend DOM) and AlgoVault market analytics. No values were invented; unavailable data is marked as such.");

  return lines.join("\n");
}

/* ── helper for the overlay / popup summary ──────────────────────────── */

export function chartDisplayLabel(chart: ChartContext | null | undefined): string {
  if (!chart) return "No chart detected";
  const sym = chart.marketSymbol || chart.symbol || chart.rawSymbol || "Unknown";
  const tf = chart.timeframe || "";
  return `${sym}${tf ? ` · ${tf}` : ""}`;
}