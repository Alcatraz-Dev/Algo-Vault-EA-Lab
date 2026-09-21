import { fetchCandles } from "../../../lib/market-data/normalizer";
import { validateSymbol, validateTimeframe } from "../../../lib/market-data/validation";
import type { MarketCandle, MarketRegime, Timeframe, SupportedSymbol } from "../../../lib/market-data/types";
import { TIMEFRAME_INTERVALS, SUPPORTED_SYMBOLS } from "../../../lib/market-data/types";
import { detectStructure, getOverallStructureBias } from "../../../lib/analytics/market-structure";
import { detectLiquidity } from "../../../lib/analytics/liquidity";
import { analyzeVolatility } from "../../../lib/analytics/volatility";
import { calculateVWAP, getVWAPPosition } from "../../../lib/analytics/vwap";
import { analyzeVolume } from "../../../lib/analytics/volume";
import { detectRegime, getRegimeLabel } from "../../../lib/analytics/market-regime";
import { calculateMarketScore } from "../../../lib/analytics/market-score";
import { getMultiTimeframeBias } from "../../../lib/analytics/multi-timeframe";
import { analyzeVolume as analyzeVol } from "../../../lib/analytics/volume";
import { getAlgoVaultUrl } from "@/config/environment";
import { getAuthToken } from "@/storage/storage";
import type { ChartContext, Market } from "@/types";
import { resolveMarketSymbol } from "@/utils/symbols";
import type {
  MarketContext,
  AnalysisStage,
  DebugInfo,
  MarketContextStatus,
} from "@/types/market-context";

const MTF_TIMEFRAMES: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4"];

/**
 * Fetch candles local-first, falling back to the AlgoVault server proxy
 * (`GET /api/analytics/ohlc`). The server resolves the configured provider
 * without exposing provider credentials to the extension.
 */
export async function fetchCandlesWithFallback(
  symbol: SupportedSymbol,
  timeframe: Timeframe,
  forceServer = false
): Promise<{ candles: MarketCandle[]; provider: string }> {
  let candles: MarketCandle[] = [];
  let provider = "none";

  if (!forceServer) {
    try {
      candles = await fetchCandles(symbol, timeframe);
      if (candles.length > 0) provider = "Twelve Data/Biquote (local)";
    } catch { /* fall through to proxy */ }
  }

  if (candles.length < 20) {
    try {
      const base = getAlgoVaultUrl();
      const token = await getAuthToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const url = `${base}/api/analytics/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`ohlc proxy ${res.status}`);
      const json = (await res.json()) as { candles?: MarketCandle[]; error?: string };
      if (Array.isArray(json.candles) && json.candles.length > 0) {
        candles = json.candles;
        provider = "AlgoVault server proxy (Twelve Data)";
      }
    } catch {
      provider = provider === "none" ? "none" : provider;
    }
  }

  return { candles, provider };
}

let _ctxHash = 0;
function contextHash(symbol: string | null, tf: string | null, candles: MarketCandle[]): string {
  const len = candles.reduce((s, c) => s + Math.floor(c.close * 100), 0);
  return `${symbol}-${tf}-${candles.length}-${len}-${_ctxHash++}`;
}

export async function detectTradingViewContext(
  forcedSymbol?: string,
  forcedTimeframe?: string
): Promise<{ symbol: string | null; exchange: string | null; timeframe: string | null; source: "auto" | "manual" }> {
  if (forcedSymbol && forcedTimeframe) {
    const sym = validateSymbol(forcedSymbol);
    const tf = validateTimeframe(forcedTimeframe);
    if (sym && tf) {
      return { symbol: sym, exchange: null, timeframe: tf, source: "manual" };
    }
  }

  try {
    const isTV = window.location.hostname.includes("tradingview.com");
    if (!isTV) {
      return { symbol: null, exchange: null, timeframe: null, source: "manual" };
    }

    const sym = detectSymbolFromPage();
    const tf = detectTimeframeFromPage();
    return { symbol: sym, exchange: null, timeframe: tf, source: "auto" };
  } catch {
    return { symbol: null, exchange: null, timeframe: null, source: "manual" };
  }
}

function detectSymbolFromPage(): string | null {
  try {
    const url = window.location.href;
    const match = url.match(/\/symbol\/([A-Za-z0-9%._-]+)/);
    if (match) {
      const raw = decodeURIComponent(match[1]);
      const parts = raw.split(":");
      if (parts.length >= 2) return parts[1].toUpperCase();
      return raw.toUpperCase();
    }
    const title = document.title;
    if (title && title !== "TradingView") {
      const prefix = title.split(" — ")[0]?.trim();
      if (prefix) {
        for (const [p, _ex] of Object.entries({ FX: "FX", BINANCE: "BINANCE", OANDA: "OANDA" })) {
          if (prefix.startsWith(p)) return prefix.slice(p.length).toUpperCase();
        }
        if (/^[A-Z0-9]{1,10}$/.test(prefix)) return prefix.toUpperCase();
      }
    }
    const legend = document.querySelector("[data-name='legend-source-item'] [data-name='legend-source-title-value']");
    if (legend?.textContent) return legend.textContent.trim().toUpperCase();
  } catch { /* ignore */ }
  return null;
}

function detectTimeframeFromPage(): string | null {
  try {
    const selectors = [
      "[data-name='legend-source-item'] [data-name='legend-timeframe-value']",
      "button[data-name='timeframe'][aria-pressed='true']",
      ".chart-markup-table .timeAxis .apply-overflow-tooltip",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent) {
        const text = el.textContent.trim();
        if (/^(\d+\s*[mMhHdDwWyY]|tick)$/i.test(text)) return text.toUpperCase().replace(" ", "");
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function buildMarketContext(
  symbol: string | null,
  timeframe: string | null,
  options: {
    forceFetch?: boolean;
    onStage?: (stage: AnalysisStage) => void;
    signal?: AbortSignal;
    chart?: ChartContext | null;
  } = {}
): Promise<MarketContext> {
  const stages: AnalysisStage[] = [];
  const addStage = (name: string, status: AnalysisStage["status"], message: string, duration?: number) => {
    const stage: AnalysisStage = { name, status, message, duration };
    stages.push(stage);
    options.onStage?.(stage);
  };

  addStage("Detecting Chart", "running", "Analyzing page context...");

  if (!symbol || !timeframe) {
    addStage("Detecting Chart", "error", "No symbol or timeframe detected. Use manual selector below.");
    return {
      symbol: null, exchange: null, timeframe: null, status: "error", error: "No symbol or timeframe detected",
      currentPrice: null, timestamp: null, candlesByTimeframe: {}, trend: { direction: "neutral", state: "unknown" },
      marketRegime: { regime: "transitional", confidence: 0, factors: ["No data"] }, marketStructure: { events: [], bosCount: 0, chochCount: 0, overall: "neutral" },
      liquidity: { levels: [], sweeps: [] }, volatility: { atr: 0, atrPercent: 0, state: "normal", rangeExpansion: 0, lookbackPeriods: 0 },
      vwap: { vwap: 0, upperBand1: 0, lowerBand1: 0, upperBand2: 0, lowerBand2: 0, distance: 0, distancePercent: 0, period: "session" },
      volume: { current: 0, average: 0, relative: 0, state: "normal" }, fvg: { count: 0, direction: "neutral" },
      orderBlock: { count: 0, direction: "neutral" }, score: { total: 50, bias: "neutral", confidence: "low", components: [] },
      mtfAlignment: [], dataFetch: { provider: "none", lastUpdate: null, candleCount: 0, timeframes: [], freshness: "N/A" },
      aiContext: { sent: false, contextHash: null, lastSent: null },
    };
  }

  // Resolve through the canonical symbol normalizer so browser-sourced
  // identifiers (exchange prefixes, crypto USDT suffixes) map to market data.
  const resolution = resolveMarketSymbol(symbol);
  const resolvedSymbol = "symbol" in resolution ? resolution.symbol : null;
  const sym = resolvedSymbol ? validateSymbol(resolvedSymbol) : null;
  const tf = validateTimeframe(timeframe);
  if (!sym) {
    const reason = "reason" in resolution ? resolution.reason : `Unsupported symbol: ${symbol}`;
    addStage("Detecting Chart", "error", `${reason}. Supported: ${SUPPORTED_SYMBOLS.join(", ")}`);
    return {
      symbol, exchange: options.chart?.exchange ?? null, timeframe, status: "error", error: reason,
      currentPrice: null, timestamp: null, candlesByTimeframe: {}, trend: { direction: "neutral", state: "unknown" },
      marketRegime: { regime: "transitional", confidence: 0, factors: ["No data"] }, marketStructure: { events: [], bosCount: 0, chochCount: 0, overall: "neutral" },
      liquidity: { levels: [], sweeps: [] }, volatility: { atr: 0, atrPercent: 0, state: "normal", rangeExpansion: 0, lookbackPeriods: 0 },
      vwap: { vwap: 0, upperBand1: 0, lowerBand1: 0, upperBand2: 0, lowerBand2: 0, distance: 0, distancePercent: 0, period: "session" },
      volume: { current: 0, average: 0, relative: 0, state: "normal" }, fvg: { count: 0, direction: "neutral" },
      orderBlock: { count: 0, direction: "neutral" }, score: { total: 50, bias: "neutral", confidence: "low", components: [] },
      mtfAlignment: [], dataFetch: { provider: "none", lastUpdate: null, candleCount: 0, timeframes: [], freshness: "N/A" },
      aiContext: { sent: false, contextHash: null, lastSent: null },
    };
  }

  if (!tf) {
    addStage("Detecting Chart", "error", `Unsupported timeframe: ${timeframe}`);
    return {
      symbol, exchange: options.chart?.exchange ?? null, timeframe, status: "error", error: `Unsupported timeframe: ${timeframe}`,
      currentPrice: null, timestamp: null, candlesByTimeframe: {}, trend: { direction: "neutral", state: "unknown" },
      marketRegime: { regime: "transitional", confidence: 0, factors: ["No data"] }, marketStructure: { events: [], bosCount: 0, chochCount: 0, overall: "neutral" },
      liquidity: { levels: [], sweeps: [] }, volatility: { atr: 0, atrPercent: 0, state: "normal", rangeExpansion: 0, lookbackPeriods: 0 },
      vwap: { vwap: 0, upperBand1: 0, lowerBand1: 0, upperBand2: 0, lowerBand2: 0, distance: 0, distancePercent: 0, period: "session" },
      volume: { current: 0, average: 0, relative: 0, state: "normal" }, fvg: { count: 0, direction: "neutral" },
      orderBlock: { count: 0, direction: "neutral" }, score: { total: 50, bias: "neutral", confidence: "low", components: [] },
      mtfAlignment: [], dataFetch: { provider: "none", lastUpdate: null, candleCount: 0, timeframes: [], freshness: "N/A" },
      aiContext: { sent: false, contextHash: null, lastSent: null },
    };
  }

  addStage("Detecting Chart", "complete", `${sym} ${tf} detected`, 0);
  addStage("Loading Market Data", "running", "Fetching OHLCV candles...");

  const t0 = Date.now();
  let candles: MarketCandle[] = [];
  let provider = "unknown";
  try {
    const fetched = await fetchCandlesWithFallback(sym, tf, options.forceFetch);
    candles = fetched.candles;
    provider = fetched.provider;
    if (candles.length === 0) {
      const altTF = Object.keys(TIMEFRAME_INTERVALS) as Timeframe[];
      for (const alt of altTF) {
        if (alt === tf) continue;
        const altFetch = await fetchCandlesWithFallback(sym, alt, options.forceFetch);
        if (altFetch.candles.length > 0) {
          candles = altFetch.candles;
          provider = `${altFetch.provider} (fallback ${alt})`;
          break;
        }
      }
    }
  } catch (err) {
    addStage("Loading Market Data", "error", `Provider error: ${err instanceof Error ? err.message : "unknown"}`);
  }
  addStage("Loading Market Data", candles.length > 0 ? "complete" : "error",
    candles.length > 0 ? `${candles.length} candles retrieved` : "No candles returned",
    Date.now() - t0);

  if (candles.length < 20) {
    addStage("Building Context", "error", "Insufficient candle data for analysis (need 20+)");
    return buildPartialContext({
      symbol, exchange: null, timeframe, candles, provider, status: "error",
      error: candles.length < 20 ? `Only ${candles.length} candles available — need 20+ for analysis` : "No data",
    });
  }

  addStage("Building Context", "running", "Computing analytics...");
  await sleep(50);
  const structure = detectStructure(candles, tf);
  const structureBias = getOverallStructureBias(structure);
  const regime = detectRegime(candles, tf);
  const volatility = analyzeVolatility(candles);
  const vwap = calculateVWAP(candles, "session");
  const volume = analyzeVol(candles);
  const liquidity = detectLiquidity(candles, tf);
  const score = calculateMarketScore(candles, tf);
    const mtfBias = getMultiTimeframeBias({ [tf as Timeframe]: candles } as Record<Timeframe, MarketCandle[]>);
  addStage("Building Context", "complete", `Structure: ${structureBias}, Regime: ${regime.regime}`, 0);

  addStage("Running Analytics", "running", "Calculating indicators...");
  await sleep(30);
  addStage("Running Analytics", "complete", `ATR: ${volatility.atr.toFixed(5)}, VWAP: ${vwap.vwap.toFixed(5)}, Score: ${score.total}`, 0);

  addStage("AI Analysis", "running", "Preparing AI context...");
  const ctxH = contextHash(symbol, timeframe, candles);
  addStage("AI Analysis", "complete", "Context ready", 0);

  const ctx: MarketContext = {
    symbol, exchange: options.chart?.exchange ?? null, timeframe, status: "ready", error: null,
    currentPrice: candles[candles.length - 1].close,
    timestamp: Date.now(),
    candlesByTimeframe: { [tf]: candles },
    trend: { direction: structureBias, state: regime.regime },
    marketRegime: { regime: regime.regime, confidence: regime.confidence, factors: regime.factors },
    marketStructure: { events: structure, bosCount: structure.filter(e => e.type === "BOS").length, chochCount: structure.filter(e => e.type === "CHOCH").length, overall: structureBias },
    liquidity: { levels: liquidity.levels, sweeps: liquidity.sweeps },
    volatility, vwap,
    volume: { current: volume.volume, average: volume.averageVolume, relative: volume.relativeVolume, state: volume.state },
    fvg: { count: 0, direction: "neutral" }, orderBlock: { count: 0, direction: "neutral" },
    score, mtfAlignment: mtfBias,
    dataFetch: { provider, lastUpdate: Date.now(), candleCount: candles.length, timeframes: [tf], freshness: "Live" },
    aiContext: { sent: false, contextHash: ctxH, lastSent: null },
  };

  const zones = detectFVGAndOB(candles, tf);
  ctx.fvg = zones.fvg;
  ctx.orderBlock = zones.ob;

  return ctx;
}

interface ZoneResult { fvg: MarketContext["fvg"]; ob: MarketContext["orderBlock"]; }
function detectFVGAndOB(candles: MarketCandle[], tf: Timeframe): ZoneResult {
  let fvgBull = 0, fvgBear = 0, obBull = 0, obBear = 0;
  for (let i = 2; i < candles.length; i++) {
    const c2 = candles[i - 2], c1 = candles[i - 1], c3 = candles[i];
    if (c3.low > c2.high) fvgBull++;
    if (c3.high < c2.low) fvgBear++;
    if (c1.close > c1.open && c2.close < c2.open && Math.abs(c1.close - c2.open) > Math.abs(c2.close - c2.open) * 1.5) obBull++;
    if (c1.close < c1.open && c2.close > c2.open && Math.abs(c1.close - c2.open) > Math.abs(c2.close - c2.open) * 1.5) obBear++;
  }
  return {
    fvg: { count: fvgBull + fvgBear, direction: fvgBull >= fvgBear ? "bullish" : "bearish" },
    ob: { count: obBull + obBear, direction: obBull >= obBear ? "bullish" : "bearish" },
  };
}

async function buildPartialContext(partial: {
  symbol?: string; exchange?: string | null; timeframe?: string;
  candles?: MarketCandle[]; provider?: string;
  status: MarketContextStatus; error: string;
}): Promise<MarketContext> {
  const base: MarketContext = {
    symbol: null, exchange: null, timeframe: null, status: "error", error: "No data",
    currentPrice: null, timestamp: null, candlesByTimeframe: {}, trend: { direction: "neutral", state: "unknown" },
    marketRegime: { regime: "transitional", confidence: 0, factors: ["No data"] }, marketStructure: { events: [], bosCount: 0, chochCount: 0, overall: "neutral" },
    liquidity: { levels: [], sweeps: [] }, volatility: { atr: 0, atrPercent: 0, state: "normal", rangeExpansion: 0, lookbackPeriods: 0 },
    vwap: { vwap: 0, upperBand1: 0, lowerBand1: 0, upperBand2: 0, lowerBand2: 0, distance: 0, distancePercent: 0, period: "session" },
    volume: { current: 0, average: 0, relative: 0, state: "normal" }, fvg: { count: 0, direction: "neutral" },
    orderBlock: { count: 0, direction: "neutral" }, score: { total: 50, bias: "neutral", confidence: "low", components: [] },
    mtfAlignment: [], dataFetch: { provider: "none", lastUpdate: null, candleCount: 0, timeframes: [], freshness: "N/A" },
    aiContext: { sent: false, contextHash: null, lastSent: null },
  };
  if (partial.symbol) base.symbol = partial.symbol;
  if (partial.exchange !== undefined) base.exchange = partial.exchange;
  if (partial.timeframe) base.timeframe = partial.timeframe;
  base.status = partial.status;
  base.error = partial.error;
  if (partial.candles && partial.candles.length > 0) {
    base.currentPrice = partial.candles[partial.candles.length - 1].close;
    base.dataFetch.candleCount = partial.candles.length;
    base.dataFetch.timeframes = [partial.timeframe || "M5" as Timeframe];
    base.dataFetch.provider = partial.provider || "unknown";
    base.dataFetch.lastUpdate = Date.now();
    base.dataFetch.freshness = "Live";
    base.marketRegime = detectRegime(partial.candles, (partial.timeframe as Timeframe) || "M5");
    base.status = partial.status;
    base.error = partial.error;
    base.vwap = calculateVWAP(partial.candles);
    base.volatility = analyzeVolatility(partial.candles);
    base.score = calculateMarketScore(partial.candles, (partial.timeframe as Timeframe) || "M5");
    return base;
  }
  return base;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function buildAIContextMessage(ctx: MarketContext): string {
  const lines: string[] = [];
  lines.push(`AlgoVault Market Context for ${ctx.symbol || "Unknown"} ${ctx.timeframe || "Unknown"}:`);
  if (ctx.currentPrice) lines.push(`Current Price: ${ctx.currentPrice.toFixed(ctx.currentPrice >= 1000 ? 1 : ctx.currentPrice >= 100 ? 2 : 4)}`);
  if (ctx.marketRegime.regime !== "transitional") lines.push(`Market Regime: ${ctx.marketRegime.regime.replace(/_/g, " ")} (${ctx.marketRegime.confidence}% confidence)`);
  if (ctx.marketStructure.events.length > 0) {
    lines.push(`Structure: ${ctx.marketStructure.overall} (${ctx.marketStructure.bosCount} BOS, ${ctx.marketStructure.chochCount} CHOCH)`);
  }
  if (ctx.volatility.state !== "normal") lines.push(`Volatility: ${ctx.volatility.state} (ATR ${ctx.volatility.atrPercent.toFixed(2)}%)`);
  if (ctx.score.bias !== "neutral") lines.push(`Market Score: ${ctx.score.total} (${ctx.score.bias})`);
  if (ctx.mtfAlignment.length > 0) {
    const aligned = ctx.mtfAlignment.filter((m: { bias: string }) => m.bias !== "neutral").length;
    lines.push(`MTF Alignment: ${aligned}/${ctx.mtfAlignment.length} aligned`);
    ctx.mtfAlignment.forEach((m: { timeframe: string; bias: string }) => { if (m.bias !== "neutral") lines.push(`  ${m.timeframe}: ${m.bias}`); });
  }
  if (ctx.volume.relative > 1.5) lines.push(`Volume: ${ctx.volume.relative}x average (expanded)`);
  if (ctx.vwap.distancePercent > 0.05) lines.push(`Price ${ctx.vwap.distancePercent > 0 ? "above" : "below"} VWAP by ${Math.abs(ctx.vwap.distancePercent).toFixed(3)}%`);
  if (ctx.liquidity.sweeps.length > 0) lines.push(`Liquidity sweeps: ${ctx.liquidity.sweeps.length}`);
  lines.push("This data is structured market data from AlgoVault's analytics engine. Visual TradingView canvas data is NOT available.");
  return lines.join("\n");
}

export function buildDebugInfo(
  ctx: MarketContext,
  stages: AnalysisStage[],
  errors: string[],
  apiStatus: number | null,
  latency: number | null
): DebugInfo {
  return {
    stages,
    symbolDetected: ctx.symbol,
    timeframeDetected: ctx.timeframe,
    marketApi: ctx.dataFetch.provider,
    marketApiStatus: apiStatus,
    candleCount: ctx.dataFetch.candleCount,
    timeframesAvailable: ctx.dataFetch.timeframes,
    analyticsStatus: ctx.status === "ready" ? "ready" : "error",
    aiStatus: "ready",
    requestLatency: latency,
    errors,
  };
}
