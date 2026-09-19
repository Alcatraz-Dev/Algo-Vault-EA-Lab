import { getAuthToken } from "@/storage/storage";
import { getAlgoVaultUrl } from "@/config/environment";
import type { MarketContext, AnalysisResult, AnalysisStage, DebugInfo, LiveEvent } from "@/types/market-context";
import { buildMarketContext, buildAIContextMessage, buildDebugInfo } from "@/services/market-service";

const EXT_PREFIX = "[AlgoVault Extension]";

async function apiGet<T>(path: string): Promise<T> {
  const base = getAlgoVaultUrl();
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = `${base}${path}`;
  console.log(`${EXT_PREFIX} GET ${url}`);
  const res = await fetch(url, { headers, method: "GET" });
  console.log(`${EXT_PREFIX} GET ${url} -> ${res.status}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const base = getAlgoVaultUrl();
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = `${base}${path}`;
  console.log(`${EXT_PREFIX} POST ${url}`, body);
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  console.log(`${EXT_PREFIX} POST ${url} -> ${res.status}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

export async function fetchMarketContext(
  symbol: string | null,
  timeframe: string | null,
  options: { forceFetch?: boolean; onStage?: (stage: AnalysisStage) => void; signal?: AbortSignal } = {}
): Promise<MarketContext> {
  return buildMarketContext(symbol, timeframe, options);
}

export async function analyzeChartEnhanced(
  symbol: string,
  timeframe: string,
  context?: { exchange?: string | null; price?: number | null }
): Promise<AnalysisResult> {
  const stages: AnalysisStage[] = [];
  const addStage = (name: string, status: AnalysisStage["status"], message: string, duration?: number) => {
    stages.push({ name, status, message, duration });
  };

  addStage("Detecting Chart", "running", "Analyzing page context...");

  const t0 = Date.now();
  let ctx: MarketContext = {
    symbol: null, exchange: null, timeframe: null, status: "loading", error: null,
    currentPrice: null, timestamp: null, candlesByTimeframe: {}, trend: { direction: "neutral", state: "unknown" },
    marketRegime: { regime: "transitional", confidence: 0, factors: [] }, marketStructure: { events: [], bosCount: 0, chochCount: 0, overall: "neutral" },
    liquidity: { levels: [], sweeps: [] }, volatility: { atr: 0, atrPercent: 0, state: "normal", rangeExpansion: 0, lookbackPeriods: 0 },
    vwap: { vwap: 0, upperBand1: 0, lowerBand1: 0, upperBand2: 0, lowerBand2: 0, distance: 0, distancePercent: 0, period: "session" },
    volume: { current: 0, average: 0, relative: 0, state: "normal" }, fvg: { count: 0, direction: "neutral" },
    orderBlock: { count: 0, direction: "neutral" }, score: { total: 50, bias: "neutral", confidence: "low", components: [] },
    mtfAlignment: [], dataFetch: { provider: "none", lastUpdate: null, candleCount: 0, timeframes: [], freshness: "N/A" },
    aiContext: { sent: false, contextHash: null, lastSent: null },
  };
  try {
    ctx = await buildMarketContext(symbol, timeframe, {
      onStage: (stage) => {
        addStage(stage.name, stage.status, stage.message, stage.duration);
      },
    });
  } catch (err) {
    addStage("Market Data", "error", err instanceof Error ? err.message : "Failed");
    return { marketContext: ctx, aiAnalysis: null, error: err instanceof Error ? err.message : "Failed" };
  }

  if (!ctx || ctx.status === "error") {
    return { marketContext: ctx, aiAnalysis: null, error: ctx.error || "Market data unavailable" };
  }

  addStage("AI Analysis", "running", "Sending structured context to AI...");

  try {
    const aiContextMsg = buildAIContextMessage(ctx);
    const result = await apiPost<{ success: boolean; responses?: { market_regime?: string; overview?: string; content?: string } }>("/api/ai-copilot", {
      question: `Analyze this market context and provide a structured trading analysis: ${aiContextMsg}`,
      symbol,
      timeframe,
    });
    addStage("AI Analysis", "complete", "Analysis complete", Date.now() - t0);
    ctx.aiContext = { sent: true, contextHash: ctx.aiContext.contextHash, lastSent: Date.now() };

    const serverSummary = result.responses?.market_regime || result.responses?.overview || "";
    const GENERIC_PATTERNS = ["analysis complete", "processed via", "quantitative", "ok.", "thank you", "done"];
    const isGeneric = GENERIC_PATTERNS.some((p) => serverSummary.toLowerCase().includes(p));

    const summary = isGeneric
      ? buildAIContextMessage(ctx)
      : serverSummary;

    const supportLevels = ctx.marketStructure.events
      .filter((e) => e.direction === "bearish")
      .map((e) => ({
        price: e.price,
        strength: "strong",
        source: "structure",
      }))
      .slice(0, 5);

    const resistanceLevels = ctx.marketStructure.events
      .filter((e) => e.direction === "bullish")
      .map((e) => ({
        price: e.price,
        strength: "strong",
        source: "structure",
      }))
      .slice(0, 5);

    const liquidityLevels = (ctx.liquidity.levels as unknown as Array<{ price: number; side: "buy" | "sell"; strength: string }>).slice(0, 5).map((l) => ({
      price: l.price,
      side: l.side === "buy" ? "buy_side" : "sell_side",
      strength: l.strength,
    }));

    const fvgLevels: Array<{ price: number; direction: string; strength: string }> = ctx.fvg.count > 0
      ? [{ price: ctx.currentPrice || 0, direction: ctx.fvg.direction, strength: "high" }]
      : [];

    const obLevels: Array<{ price: number; direction: string; strength: string }> = ctx.orderBlock.count > 0
      ? [{ price: ctx.currentPrice || 0, direction: ctx.orderBlock.direction, strength: "high" }]
      : [];

    const scenarios = ctx.marketRegime.regime !== "transitional"
      ? [{
          type: ctx.trend.direction,
          description: `${ctx.trend.direction} bias on ${ctx.marketRegime.regime.replace(/_/g, " ")} regime with ${ctx.marketRegime.confidence}% confidence.`,
          invalidation: ctx.marketStructure.events.length > 0
            ? `Break of ${ctx.trend.direction === "bullish" ? "support" : "resistance"} level`
            : "Structure shift",
          probability: `${ctx.marketRegime.confidence}%`,
        }]
      : [];

    const aiAnalysis: AnalysisResult["aiAnalysis"] = {
      summary,
      keyLevels: {
        support: supportLevels,
        resistance: resistanceLevels,
        liquidity: liquidityLevels,
        fvg: fvgLevels,
        orderBlock: obLevels,
      },
      scenarios,
      confluences: ctx.score.components.filter((c) => c.value !== 0).length,
      structureConfirmations: ctx.marketStructure.bosCount + ctx.marketStructure.chochCount,
      mtfAlignmentCount: ctx.mtfAlignment.filter((m) => m.bias !== "neutral").length,
    };

    return { marketContext: ctx, aiAnalysis, error: null };
  } catch (err) {
    addStage("AI Analysis", "error", err instanceof Error ? err.message : "AI failed");
    return { marketContext: ctx, aiAnalysis: null, error: err instanceof Error ? err.message : "AI analysis failed" };
  }
}

export async function fetchDiagnostics(): Promise<DebugInfo> {
  const ctx: MarketContext = {
    symbol: null, exchange: null, timeframe: null, status: "loading", error: null,
    currentPrice: null, timestamp: null, candlesByTimeframe: {}, trend: { direction: "neutral", state: "unknown" },
    marketRegime: { regime: "transitional", confidence: 0, factors: [] }, marketStructure: { events: [], bosCount: 0, chochCount: 0, overall: "neutral" },
    liquidity: { levels: [], sweeps: [] }, volatility: { atr: 0, atrPercent: 0, state: "normal", rangeExpansion: 0, lookbackPeriods: 0 },
    vwap: { vwap: 0, upperBand1: 0, lowerBand1: 0, upperBand2: 0, lowerBand2: 0, distance: 0, distancePercent: 0, period: "session" },
    volume: { current: 0, average: 0, relative: 0, state: "normal" }, fvg: { count: 0, direction: "neutral" },
    orderBlock: { count: 0, direction: "neutral" }, score: { total: 50, bias: "neutral", confidence: "low", components: [] },
    mtfAlignment: [], dataFetch: { provider: "none", lastUpdate: null, candleCount: 0, timeframes: [], freshness: "N/A" },
    aiContext: { sent: false, contextHash: null, lastSent: null },
  };
  return buildDebugInfo(ctx, [], [], null, null);
}

export async function detectLiveEvent(symbol: string, timeframe: string): Promise<LiveEvent | null> {
  try {
    const ctx = await buildMarketContext(symbol, timeframe);
    if (ctx.status !== "ready" || ctx.liquidity.sweeps.length === 0) return null;

    const sweep = ctx.liquidity.sweeps[ctx.liquidity.sweeps.length - 1];
    const event: LiveEvent = {
      id: `evt_${Date.now()}`,
      type: "liquidity_sweep",
      symbol: ctx.symbol || symbol,
      timeframe: ctx.timeframe || timeframe,
      price: sweep.sweepPrice,
      previousPrice: sweep.level,
      timestamp: sweep.timestamp,
      description: `${sweep.side === "buy_side" ? "Buy-side" : "Sell-side"} liquidity sweep detected. Previous ${sweep.side === "buy_side" ? "low" : "high"}: ${sweep.level.toFixed(5)}, sweep reached: ${sweep.sweepPrice.toFixed(5)}.`,
      mtfBias: ctx.mtfAlignment.find(m => m.bias !== "neutral")?.bias,
    };
    return event;
  } catch {
    return null;
  }
}
