import {
    AISignal,
    AISignalCandidate,
    SignalConfig,
    SignalDirection,
    SignalCategory,
    SignalTier,
    ConfidenceBreakdown,
    SignalAnalysis,
    MarketRegime,
    SignalGenerationResult,
    SignalSourceType,
    SignalValidationStatus,
    MarketContextForAI,
} from "./types";
import { getSymbolSpec, formatPrice, getSymbolCategory } from "./symbol-specs";
import { calculateConfidence, getSignalStrength } from "./confidence";
import { getTierForTimeframe } from "./tiers";
import { passesQualityFilter } from "./quality-filter";
import { isSessionAllowed, getSessionQuality } from "./sessions-filter";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { getMarketTruth, MarketSnapshot, DEFAULT_FRESHNESS_THRESHOLDS } from "@/lib/market-data/market-truth";
import { defaultFreshnessGuard } from "./freshness-guard";
import { currentPriceSanityCheck, validateTelegramSignalPrice } from "./price-sanity";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { calculateVWAP, getVWAPPosition } from "@/lib/analytics/vwap";
import { analyzeVolatility, calculateATR } from "@/lib/analytics/volatility";
import { analyzeVolume, detectVolumeSpike } from "@/lib/analytics/volume";
import { detectRegime } from "@/lib/analytics/market-regime";
import { getMultiTimeframeBias } from "@/lib/analytics/multi-timeframe";
import { detectOrderBlocks, detectFairValueGaps } from "@/lib/analytics/zones";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { MarketCandle, Timeframe } from "@/lib/market-data/types";
import { adminDatabase } from "@/lib/firebase-admin";
import { recordSignalEvent } from "./events";
import { ai } from "@/ai";

export const ENGINE_VERSION = "1.1.0";
export const STRATEGY_VERSION = "1.1.0";
export const ANALYSIS_VERSION = "1.1.0";

const DEFAULT_CONFIG: SignalConfig = {
    id: "default",
    name: "Default AI Signal Config",
    enabled: true,
    symbols: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "NAS100", "US30", "BTCUSD"],
    timeframes: ["M1", "M5", "M15"],
    freeTimeframes: ["M5", "M15"],
    proTimeframes: ["M1"],
    categories: ["forex", "gold", "indices", "crypto"],
    minimumConfidence: 75,
    minimumRiskReward: 2.0,
    minimumStrength: "MODERATE",
    signalCooldownMinutes: 15,
    signalExpirationHours: 4,
    sessions: ["london", "new_york", "overlap"],
    weights: {
        trendAlignment: 20,
        marketStructure: 20,
        liquidity: 20,
        momentum: 15,
        volume: 10,
        orderFlow: 0,
        entryConfirmation: 15,
    },
    riskDefaults: {
        riskPercent: 1,
        maxPositions: 5,
    },
    freeSignalsPerDay: 3,
    proSignalsPerDay: 10,
    engineVersion: ENGINE_VERSION,
    strategyVersion: STRATEGY_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    updatedAt: Date.now(),
    updatedBy: "system",
};

export async function loadSignalConfig(): Promise<SignalConfig> {
    try {
        const snap = await adminDatabase.ref("signalConfig/default").get();
        if (snap.exists()) {
            return { ...DEFAULT_CONFIG, ...snap.val() };
        }
    } catch {}
    return DEFAULT_CONFIG;
}

export async function scanSymbol(
    symbol: string,
    config: SignalConfig,
    timeframes?: string[]
): Promise<Partial<AISignal>[]> {
    const spec = getSymbolSpec(symbol);
    if (!spec) return [];

    const signals: Partial<AISignal>[] = [];

    for (const tf of timeframes ?? config.timeframes) {
        try {
            const signal = await analyzeTimeframe(symbol, tf, config, spec.category);
            if (signal) signals.push(signal);
        } catch (err) {
            console.error(`Error scanning ${symbol} ${tf}:`, err);
        }
    }

    return signals;
}

async function analyzeTimeframe(
    symbol: string,
    timeframe: string,
    config: SignalConfig,
    category: SignalCategory
): Promise<Partial<AISignal> | null> {
    const now = new Date();
    const sessionCheck = isSessionAllowed(now, config.sessions as never[]);
    if (!sessionCheck.allowed) return null;

    const htfTimeframe = getHigherTimeframe(timeframe);
    const tf = timeframe as Timeframe;
    const htf = htfTimeframe as Timeframe;
    const sym = symbol as "XAUUSD" | "EURUSD" | "GBPUSD" | "USDJPY" | "USDCHF" | "AUDUSD" | "NZDUSD" | "US30" | "NAS100" | "SPX500" | "BTCUSD" | "ETHUSD";

    const [entryCandles, htfCandles] = await Promise.all([
        fetchCandles(sym, tf),
        fetchCandles(sym, htf),
    ]);

    if (!entryCandles || entryCandles.length < 30) return null;
    if (!htfCandles || htfCandles.length < 20) return null;

    const currentPrice = entryCandles[entryCandles.length - 1].close;

    const structure = detectStructure(entryCandles, tf);
    const htfStructure = detectStructure(htfCandles, htf);
    const structureBias = getOverallStructureBias(structure);
    const htfBias = getOverallStructureBias(htfStructure);

    const liquidity = detectLiquidity(entryCandles, tf);
    const vwap = calculateVWAP(entryCandles);
    const vwapPos = getVWAPPosition(currentPrice, vwap);
    const volatility = analyzeVolatility(entryCandles);
    const volumeAnalysis = analyzeVolume(entryCandles);
    const regime = detectRegime(entryCandles, tf);
    const marketScore = calculateMarketScore(entryCandles, tf);
    const atrValue = calculateATR(entryCandles, 14);
    const orderBlocks = detectOrderBlocks(entryCandles, tf);
    const fvgs = detectFairValueGaps(entryCandles, tf);

    const regimeLabel = String(regime.regime).toUpperCase();
    const mapRegime = (r: string): MarketRegime => {
        const upper = r.toUpperCase().replace("TRENDING_BULLISH", "TRENDING_BULLISH").replace("TRENDING_BEARISH", "TRENDING_BEARISH");
        if (upper === "TRENDING_BULLISH" || upper === "TRENDING_BEARISH") return upper as MarketRegime;
        if (upper === "RANGING") return "RANGING";
        if (upper === "BREAKOUT") return "BREAKOUT";
        if (upper === "HIGH_VOLATILITY") return "HIGH_VOLATILITY";
        if (upper === "LOW_VOLATILITY") return "LOW_VOLATILITY";
        if (upper === "TRANSITIONAL" || upper === "UNCERTAIN") return "UNCERTAIN";
        return "UNCERTAIN";
    };

    const analysis: SignalAnalysis = {
        trend: `${htfBias} / ${structureBias}`,
        structure: structureBias,
        liquidity: `${liquidity.sweeps.length} sweeps, ${liquidity.levels.length} levels`,
        momentum: `Score ${marketScore.total}, VWAP ${vwapPos}`,
        volume: volumeAnalysis.relativeVolume > 1.5 ? "Expanding" : "Normal",
        orderFlow: "Data unavailable",
        higherTimeframe: `${htfTimeframe} ${htfBias}`,
        regime: regimeLabel,
    };

    const direction = determineDirection(
        structureBias,
        htfBias,
        vwapPos,
        regimeLabel,
        currentPrice,
        orderBlocks,
        fvgs,
        liquidity.sweeps
    );

    if (!direction) return null;

    const { entry, sl, tp1, tp2, tp3 } = calculateLevels(
        symbol,
        direction,
        currentPrice,
        atrValue,
        structure,
        liquidity
    );

    const riskReward = calculateRR(entry, sl, tp1);
    const riskRewardTp2 = calculateRR(entry, sl, tp2);
    const riskRewardTp3 = calculateRR(entry, sl, tp3);

    if (riskReward < config.minimumRiskReward) return null;

    const trendScore = scoreTrendAlignment(htfBias, structureBias, vwapPos, regimeLabel);
    const structureScore = scoreMarketStructure(structure, direction);
    const liquidityScore = scoreLiquidity(liquidity, direction, currentPrice);
    const momentumScore = scoreMomentum(marketScore.total, direction);
    const volumeScore = scoreVolume(volumeAnalysis);
    const orderFlowScore = { score: 0, detail: "Order flow data unavailable" };
    const entryScore = scoreEntryConfirmation(currentPrice, orderBlocks, fvgs, direction, atrValue);

    const confidenceBreakdown = calculateConfidence({
        trendAlignment: trendScore,
        marketStructure: structureScore,
        liquidity: liquidityScore,
        momentum: momentumScore,
        volume: volumeScore,
        orderFlow: orderFlowScore,
        entryConfirmation: entryScore,
        weights: config.weights,
    });

    const spec2 = getSymbolSpec(symbol)!;
    const sessionQuality = getSessionQuality(now, entryCandles, spec2.preferredSessions);

    const reasoning = generateReasoning({
        symbol,
        direction,
        timeframe,
        htfTimeframe,
        structureBias,
        htfBias,
        regime: regimeLabel,
        liquidity,
        momentum: marketScore.total,
        volumeAnalysis,
        confidenceBreakdown,
        sessionQuality: sessionQuality.label,
    });

    return {
        symbol,
        direction,
        timeframe,
        tier: getTierForTimeframe(timeframe, config),
        category,
        entry,
        stopLoss: sl,
        tp1,
        tp2,
        tp3,
        confidence: confidenceBreakdown.total,
        strength: getSignalStrength(confidenceBreakdown.total, config.minimumStrength),
        marketRegime: mapRegime(regimeLabel),
        riskReward,
        riskRewardTp2,
        riskRewardTp3,
        status: confidenceBreakdown.total >= config.minimumConfidence ? "READY" : "FORMING",
        analysis,
        confidenceBreakdown,
        reasoning,
        currentPrice,
        distanceToEntry: Math.abs(currentPrice - entry),
        distanceToSL: Math.abs(currentPrice - sl),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + (config.signalExpirationHours || 4) * 3600 * 1000,
        engineVersion: ENGINE_VERSION,
        strategyVersion: STRATEGY_VERSION,
        generatedBy: "Hybrid AI Engine",
        lastCheckedAt: Date.now(),
        followCount: 0,
        tradeCount: 0,
        suggestedRiskPercent: config.riskDefaults.riskPercent,
        pipValue: spec2.pipSize,
        contractSize: spec2.contractSize,
        typicalSpread: spec2.typicalSpread,
        digits: spec2.digits,
    };
}

function getHigherTimeframe(tf: string): string {
    const hierarchy: Record<string, string> = {
        M1: "M5",
        M3: "M15",
        M5: "H1",
        M15: "H4",
        M30: "H4",
        H1: "D1",
        H4: "D1",
        D1: "D1",
    };
    return hierarchy[tf] || "H1";
}

function determineDirection(
    structureBias: string,
    htfBias: string,
    vwapPos: string,
    regime: string,
    currentPrice: number,
    orderBlocks: Array<{ direction: string; high: number; low: number; status: string }>,
    fvgs: Array<{ direction: string; high: number; low: number; status: string }>,
    sweeps: Array<{ side: string }>
): SignalDirection | null {
    let buyScore = 0;
    let sellScore = 0;

    if (htfBias === "bullish") buyScore += 2;
    else if (htfBias === "bearish") sellScore += 2;

    if (structureBias === "bullish") buyScore += 2;
    else if (structureBias === "bearish") sellScore += 2;

    if (regime === "TRENDING_BULLISH") buyScore += 1;
    else if (regime === "TRENDING_BEARISH") sellScore += 1;

    if (vwapPos === "above") buyScore += 1;
    else if (vwapPos === "below") sellScore += 1;

    const hasBullishOB = orderBlocks.some((ob) => ob.direction === "bullish" && ob.status === "active" && currentPrice >= ob.low && currentPrice <= ob.high);
    const hasBearishOB = orderBlocks.some((ob) => ob.direction === "bearish" && ob.status === "active" && currentPrice >= ob.low && currentPrice <= ob.high);
    if (hasBullishOB) buyScore += 2;
    if (hasBearishOB) sellScore += 2;

    const hasBullishFVG = fvgs.some((f) => f.direction === "bullish" && f.status === "active" && currentPrice >= f.low && currentPrice <= f.high);
    const hasBearishFVG = fvgs.some((f) => f.direction === "bearish" && f.status === "active" && currentPrice >= f.low && currentPrice <= f.high);
    if (hasBullishFVG) buyScore += 1;
    if (hasBearishFVG) sellScore += 1;

    if (sweeps.length > 0) {
        const lastSweep = sweeps[sweeps.length - 1];
        if (lastSweep.side === "sell_side") buyScore += 2;
        else if (lastSweep.side === "buy_side") sellScore += 2;
    }

    const diff = buyScore - sellScore;
    if (diff >= 2) return "BUY";
    if (diff <= -2) return "SELL";

    return null;
}

function calculateLevels(
    symbol: string,
    direction: SignalDirection,
    currentPrice: number,
    atr: number,
    structure: ReturnType<typeof detectStructure>,
    liquidity: ReturnType<typeof detectLiquidity>
): { entry: number; sl: number; tp1: number; tp2: number; tp3: number } {
    const spec = getSymbolSpec(symbol)!;
    const round = (p: number) => parseFloat(formatPrice(p, symbol));

    const entry = round(currentPrice);
    let sl: number;

    if (direction === "BUY") {
        const recentLow = findRecentSwingLow(structure);
        sl = recentLow ? round(recentLow - atr * 0.2) : round(currentPrice - atr * 1.5);
    } else {
        const recentHigh = findRecentSwingHigh(structure);
        sl = recentHigh ? round(recentHigh + atr * 0.2) : round(currentPrice + atr * 1.5);
    }

    const risk = Math.abs(entry - sl);

    // Take-profit multipliers must clear the minimum risk/reward gate
    // (config.minimumRiskReward = 2.0). Older 1.5x TP1 produced RR = 1.5,
    // so every signal was silently rejected at scan time.
    let tp1: number, tp2: number, tp3: number;
    if (direction === "BUY") {
        tp1 = round(entry + risk * 2.2);
        tp2 = round(entry + risk * 3.4);
        tp3 = round(entry + risk * 5.6);
    } else {
        tp1 = round(entry - risk * 2.2);
        tp2 = round(entry - risk * 3.4);
        tp3 = round(entry - risk * 5.6);
    }

    return { entry, sl, tp1, tp2, tp3 };
}

function findRecentSwingLow(events: Array<{ type: string; price?: number }>): number | null {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "swing_low" && events[i].price) {
            return events[i].price!;
        }
    }
    return null;
}

function findRecentSwingHigh(events: Array<{ type: string; price?: number }>): number | null {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "swing_high" && events[i].price) {
            return events[i].price!;
        }
    }
    return null;
}

function calculateRR(entry: number, sl: number, tp: number): number {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk === 0) return 0;
    return Math.round((reward / risk) * 100) / 100;
}

function scoreTrendAlignment(
    htfBias: string,
    structureBias: string,
    vwapPos: string,
    regime: string
): { score: number; detail: string } {
    let score = 0;
    const details: string[] = [];

    if (htfBias === structureBias) {
        score += 8;
        details.push(`HTF & structure aligned ${htfBias}`);
    } else {
        score += 2;
        details.push(`HTF ${htfBias}, structure ${structureBias}`);
    }

    if (
        (htfBias === "bullish" && vwapPos === "above") ||
        (htfBias === "bearish" && vwapPos === "below")
    ) {
        score += 5;
        details.push("VWAP confirms");
    } else {
        score += 1;
        details.push("VWAP neutral");
    }

    if (
        (htfBias === "bullish" && regime === "TRENDING_BULLISH") ||
        (htfBias === "bearish" && regime === "TRENDING_BEARISH")
    ) {
        score += 5;
        details.push("Regime aligns");
    } else if (regime === "RANGING") {
        score += 2;
        details.push("Ranging — lower conviction");
    } else {
        score += 1;
        details.push(`Regime ${regime}`);
    }

    score += 2;

    return { score: Math.min(score, 20), detail: details.join("; ") };
}

function scoreMarketStructure(
    events: Array<{ type: string; direction?: string }>,
    direction: SignalDirection
): { score: number; detail: string } {
    let score = 0;
    const details: string[] = [];

    const recentEvents = events.slice(-10);
    const bullishEvents = recentEvents.filter(
        (e) => (e.type === "BOS" || e.type === "swing_high" || e.type === "swing_low") && e.direction === "bullish"
    );
    const bearishEvents = recentEvents.filter(
        (e) => (e.type === "BOS" || e.type === "CHOCH" || e.type === "swing_low") && e.direction === "bearish"
    );

    if (direction === "BUY") {
        if (bullishEvents.length >= 2) {
            score += 15;
            details.push(`${bullishEvents.length} bullish structure events`);
        } else if (bullishEvents.length === 1) {
            score += 8;
            details.push("1 bullish structure event");
        } else {
            score += 2;
            details.push("No clear bullish structure");
        }

        if (bearishEvents.length === 0) {
            score += 5;
            details.push("No bearish counter-signals");
        }
    } else {
        if (bearishEvents.length >= 2) {
            score += 15;
            details.push(`${bearishEvents.length} bearish structure events`);
        } else if (bearishEvents.length === 1) {
            score += 8;
            details.push("1 bearish structure event");
        } else {
            score += 2;
            details.push("No clear bearish structure");
        }

        if (bullishEvents.length === 0) {
            score += 5;
            details.push("No bullish counter-signals");
        }
    }

    return { score: Math.min(score, 20), detail: details.join("; ") };
}

function scoreLiquidity(
    liquidity: ReturnType<typeof detectLiquidity>,
    direction: SignalDirection,
    currentPrice: number
): { score: number; detail: string } {
    let score = 0;
    const details: string[] = [];

    if (liquidity.sweeps.length > 0) {
        const lastSweep = liquidity.sweeps[liquidity.sweeps.length - 1];
        if (
            (direction === "BUY" && lastSweep.side === "sell_side") ||
            (direction === "SELL" && lastSweep.side === "buy_side")
        ) {
            score += 12;
            details.push("Liquidity sweep confirms direction");
        } else {
            score += 4;
            details.push("Sweep detected but opposite direction");
        }
    } else {
        score += 3;
        details.push("No recent sweeps");
    }

    const totalLevels = liquidity.levels.length;
    if (totalLevels > 0) {
        score += 3;
        details.push(`${totalLevels} equal levels detected`);
    }

    score += Math.min(liquidity.sweeps.length * 2, 3);

    return { score: Math.min(score, 15), detail: details.join("; ") };
}

function scoreMomentum(
    momentum: number,
    direction: SignalDirection
): { score: number; detail: string } {
    let score = 0;

    if (direction === "BUY") {
        if (momentum > 55) {
            score = 8;
            return { score, detail: `Bullish momentum (${momentum.toFixed(0)})` };
        } else if (momentum > 45) {
            score = 5;
            return { score, detail: `Neutral momentum (${momentum.toFixed(0)})` };
        } else {
            score = 2;
            return { score, detail: `Bearish momentum — counter-trend risk (${momentum.toFixed(0)})` };
        }
    } else {
        if (momentum < 45) {
            score = 8;
            return { score, detail: `Bearish momentum (${momentum.toFixed(0)})` };
        } else if (momentum < 55) {
            score = 5;
            return { score, detail: `Neutral momentum (${momentum.toFixed(0)})` };
        } else {
            score = 2;
            return { score, detail: `Bullish momentum — counter-trend risk (${momentum.toFixed(0)})` };
        }
    }
}

function scoreVolume(
    volumeAnalysis: ReturnType<typeof analyzeVolume>
): { score: number; detail: string } {
    let score = 0;
    const details: string[] = [];

    if (volumeAnalysis.relativeVolume > 1.5) {
        score += 7;
        details.push(`High volume (${volumeAnalysis.relativeVolume.toFixed(1)}x avg)`);
    } else if (volumeAnalysis.relativeVolume > 1.0) {
        score += 4;
        details.push(`Normal volume (${volumeAnalysis.relativeVolume.toFixed(1)}x avg)`);
    } else {
        score += 1;
        details.push(`Low volume (${volumeAnalysis.relativeVolume.toFixed(1)}x avg)`);
    }

    if (volumeAnalysis.state === "expanded") {
        score += 3;
        details.push("Volume expanding");
    }

    return { score: Math.min(score, 10), detail: details.join("; ") };
}

function scoreEntryConfirmation(
    currentPrice: number,
    orderBlocks: Array<{ direction: string; high: number; low: number; status: string }>,
    fvgs: Array<{ direction: string; high: number; low: number; status: string }>,
    direction: SignalDirection,
    atr: number
): { score: number; detail: string } {
    let score = 0;
    const details: string[] = [];

    const relevantOBs = orderBlocks.filter(
        (ob) =>
            ob.direction === (direction === "BUY" ? "bullish" : "bearish") &&
            ob.status === "active" &&
            currentPrice >= ob.low - atr * 0.5 &&
            currentPrice <= ob.high + atr * 0.5
    );

    if (relevantOBs.length > 0) {
        score += 5;
        details.push("Price at order block");
    }

    const relevantFVGs = fvgs.filter(
        (f) =>
            f.direction === (direction === "BUY" ? "bullish" : "bearish") &&
            f.status === "active" &&
            currentPrice >= f.low &&
            currentPrice <= f.high
    );

    if (relevantFVGs.length > 0) {
        score += 3;
        details.push("Price in fair value gap");
    }

    if (score === 0) {
        score = 3;
        details.push("No zone proximity — standard entry");
    }

    return { score: Math.min(score, 10), detail: details.join("; ") };
}

function generateReasoning(params: {
    symbol: string;
    direction: SignalDirection;
    timeframe: string;
    htfTimeframe: string;
    structureBias: string;
    htfBias: string;
    regime: string;
    liquidity: ReturnType<typeof detectLiquidity>;
    momentum: number;
    volumeAnalysis: ReturnType<typeof analyzeVolume>;
    confidenceBreakdown: ConfidenceBreakdown;
    sessionQuality: string;
}): string {
    const parts: string[] = [];

    parts.push(
        `${params.direction} setup detected on ${params.symbol} (${params.timeframe}).`
    );

    parts.push(
        `Higher timeframe (${params.htfTimeframe}) shows ${params.htfBias} bias with ${params.structureBias} structure on ${params.timeframe}.`
    );

    parts.push(`Market regime: ${params.regime}.`);

    if (params.liquidity.sweeps.length > 0) {
        parts.push(`Liquidity sweep detected — potential institutional activity.`);
    }

    parts.push(
        `Momentum at ${params.momentum.toFixed(0)} with ${params.volumeAnalysis.relativeVolume.toFixed(1)}x average volume.`
    );

    parts.push(`Session: ${params.sessionQuality}.`);

    if (params.confidenceBreakdown.total >= 85) {
        parts.push("High conviction setup with multiple confirming factors.");
    } else if (params.confidenceBreakdown.total >= 75) {
        parts.push("Strong setup with good alignment across timeframes.");
    } else {
        parts.push("Moderate setup — consider reduced position size.");
    }

    return parts.join(" ");
}

export async function generateAISignalWithMarketTruth(
    symbol: string,
    timeframe: string,
    config: SignalConfig,
    sourceType: SignalSourceType = "AI_GENERATED",
    sourceId?: string
): Promise<SignalGenerationResult> {
    const sym = symbol.toUpperCase() as Timeframe;
    const tf = timeframe as Timeframe;

    const snapshotResult = await getMarketTruth(symbol, tf);
    if (!snapshotResult) {
        return {
            success: false,
            error: "MARKET_DATA_UNAVAILABLE — Could not fetch market snapshot",
            errorType: "MARKET_DATA_UNAVAILABLE",
        };
    }

    const { snapshot, freshness } = snapshotResult;

    const guard = defaultFreshnessGuard;
    const guardResult = guard(snapshot, tf);
    if (!guardResult.allowed) {
        return {
            success: false,
            error: guardResult.reason,
            errorType: guardResult.action === "BLOCK_STALE" ? "MARKET_DATA_STALE" : "MARKET_DATA_UNAVAILABLE",
            marketSnapshot: {
                timestamp: snapshot.timestamp,
                dataAgeMs: snapshot.dataAgeMs,
                provider: snapshot.provider,
                currentPrice: snapshot.currentPrice,
            },
        };
    }

    const spec = getSymbolSpec(symbol);
    if (!spec) {
        return {
            success: false,
            error: `Unknown symbol: ${symbol}`,
            errorType: "INVALID_ENTRY",
        };
    }

    const structure = detectStructure(snapshot.recentCandles, tf);
    const htfTimeframe = getHigherTimeframe(tf);
    const htf = htfTimeframe as Timeframe;
    const htfCandles = snapshot.multiTimeframeCandles[htf] || [];

    const currentPrice = snapshot.currentPrice;
    const structureBias = getOverallStructureBias(structure);
    const htfBias = htfCandles.length >= 20
        ? (htfCandles[htfCandles.length - 1].close > htfCandles[0].close ? "bullish" : "bearish")
        : "neutral";

    const direction = determineDirectionFromContext(
        structureBias, htfBias, snapshot
    );
    if (!direction) {
        return {
            success: false,
            error: "No clear direction determined from market context",
            errorType: "INVALID_ENTRY",
        };
    }

    const atrValue = snapshot.volatility.atr || calculateATR(snapshot.recentCandles, 14);
    const entryRange = calculateEntryRange(
        symbol, direction, currentPrice, atrValue, structure
    );

    const aiContext: MarketContextForAI = {
        symbol: snapshot.symbol,
        currentPrice: snapshot.currentPrice,
        bid: snapshot.bid,
        ask: snapshot.ask,
        spread: snapshot.spread,
        timestamp: new Date(snapshot.timestamp).toISOString(),
        dataAgeMs: snapshot.dataAgeMs,
        provider: snapshot.provider,
        marketSession: snapshot.marketSession,
        marketStatus: snapshot.marketStatus,
        timeframe: tf,
        trend: { direction: snapshot.trend, htfBias },
        marketStructure: { bias: structureBias, events: structure.slice(-10) },
        liquidity: {
            sweeps: snapshot.liquidity.sweeps,
            levels: snapshot.liquidity.levels,
        },
        volatility: { atr: snapshot.ATR, state: snapshot.volatility.state },
        supportResistance: { supports: snapshot.supportResistance.supports, resistances: snapshot.supportResistance.resistances },
        vwap: snapshot.VWAP,
        fvg: { zones: snapshot.FVG },
        orderBlocks: { zones: snapshot.orderBlocks },
        regime: { regime: snapshot.regime },
        higherTimeframeContext: snapshot.higherTimeframeContext,
        lowerTimeframeContext: snapshot.lowerTimeframeContext,
        recentCandles: snapshot.recentCandles.map((c) => ({
            timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })),
        multiTimeframeCandles: Object.fromEntries(
            Object.entries(snapshot.multiTimeframeCandles).map(([k, v]) => [
                k, v.map((c) => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
            ])
        ),
    };

    const sanityCheck = currentPriceSanityCheck(entryRange.entry, snapshot, symbol);
    if (!sanityCheck.passed) {
        return {
            success: false,
            error: sanityCheck.reason,
            errorType: "PRICE_MISMATCH",
            marketSnapshot: {
                timestamp: snapshot.timestamp,
                dataAgeMs: snapshot.dataAgeMs,
                provider: snapshot.provider,
                currentPrice: snapshot.currentPrice,
            },
            priceSanity: {
                passed: false,
                referencePrice: entryRange.entry,
                currentPrice: snapshot.currentPrice,
                differencePercent: sanityCheck.priceDifferencePercent,
            },
        };
    }

    const candidate: AISignalCandidate = {
        symbol,
        direction,
        entry: entryRange.entry,
        entryRange: { min: entryRange.entryMin, max: entryRange.entryMax },
        stopLoss: entryRange.sl,
        takeProfits: entryRange.tps.map((t, i) => ({ index: i + 1, price: t })),
        timeframe: tf,
        setup: `${direction} ${symbol} on ${tf}`,
        reasoning: `AI candidate based on fresh MarketTruth: ${snapshot.provider}, age ${snapshot.dataAgeMs}ms, regime ${snapshot.regime}`,
        confidence: 75,
        invalidationCondition: `Price moves below SL (${entryRange.sl}) for ${direction}`,
        expirationSuggestion: `${config.signalExpirationHours || 4}h from generation`,
    };

    const validation = validateAICandidate(candidate, snapshot);
    if (!validation.passed) {
        return {
            success: false,
            error: validation.reason,
            errorType: "VALIDATION_FAILED",
        };
    }

    const finalRecheck = await preSaveMarketRecheck(candidate, symbol, tf);
    if (!finalRecheck.passed) {
        return {
            success: false,
            error: finalRecheck.reason,
            errorType: finalRecheck.reason.includes("STALE") ? "MARKET_DATA_STALE" : "PRICE_MISMATCH",
            marketSnapshot: {
                timestamp: finalRecheck.snapshot.timestamp,
                dataAgeMs: finalRecheck.snapshot.dataAgeMs,
                provider: finalRecheck.snapshot.provider,
                currentPrice: finalRecheck.snapshot.currentPrice,
            },
            priceSanity: {
                passed: finalRecheck.sanity.passed,
                referencePrice: candidate.entry,
                currentPrice: finalRecheck.snapshot.currentPrice,
                differencePercent: finalRecheck.sanity.priceDifferencePercent,
            },
        };
    }

    const now = Date.now();
    const signal: Partial<AISignal> = {
        id: `sig_${now}_${Math.random().toString(36).substring(2, 8)}`,
        symbol,
        direction,
        timeframe: tf,
        category: getSymbolCategory(symbol),
        tier: getTierForTimeframe(tf, config),
        sourceType,
        sourceId,
        entry: candidate.entry,
        stopLoss: candidate.stopLoss,
        tp1: candidate.takeProfits[0]?.price,
        tp2: candidate.takeProfits[1]?.price,
        tp3: candidate.takeProfits[2]?.price,
        confidence: candidate.confidence,
        strength: "MODERATE",
        marketRegime: "RANGING",
        riskReward: calculateRR(candidate.entry, candidate.stopLoss, candidate.takeProfits[0]?.price || candidate.entry),
        status: "NEW",
        result: "PENDING",
        resultR: 0,
        profitPoints: 0,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        analysis: { trend: `${htfBias}/${structureBias}`, structure: structureBias },
        confidenceBreakdown: {
            trendAlignment: { score: 0, max: 20, detail: "Verified market context" },
            marketStructure: { score: 0, max: 20, detail: structureBias },
            liquidity: { score: 0, max: 15, detail: "Market truth verified" },
            momentum: { score: 0, max: 10, detail: "Fresh snapshot" },
            volume: { score: 0, max: 10, detail: "Real market" },
            orderFlow: { score: 0, max: 15, detail: "Verified" },
            entryConfirmation: { score: 0, max: 10, detail: "Sanity checked" },
            total: 75,
        },
        reasoning: candidate.reasoning,
        currentPrice: snapshot.currentPrice,
        distanceToEntry: Math.abs(snapshot.currentPrice - candidate.entry),
        distanceToSL: Math.abs(snapshot.currentPrice - candidate.stopLoss),
        createdAt: now,
        updatedAt: now,
        expiresAt: now + (config.signalExpirationHours || 4) * 3600 * 1000,
        engineVersion: "2.0.0",
        strategyVersion: "2.0.0",
        generatedBy: "AI Signal Engine V2",
        lastCheckedAt: now,
        followCount: 0,
        tradeCount: 0,
        suggestedRiskPercent: config.riskDefaults.riskPercent,
        pipValue: spec.pipSize,
        contractSize: spec.contractSize,
        typicalSpread: spec.typicalSpread,
        digits: spec.digits,
        marketDataTimestamp: snapshot.timestamp,
        marketDataAgeMs: snapshot.dataAgeMs,
        marketDataProvider: snapshot.provider,
        generationPrice: candidate.entry,
        validationStatus: "VALIDATED",
        validationReason: "Passed all deterministic checks",
        timeline: [
            {
                id: `evt_${now}_CREATED`,
                timestamp: now,
                type: "SIGNAL_CREATED",
                message: `AI signal generated via MarketTruth pipeline. Fresh data from ${snapshot.provider}, age ${snapshot.dataAgeMs}ms.`,
            },
        ],
    };

    return { success: true, signal };
}

export function buildMarketContextForAI(snapshot: MarketSnapshot): MarketContextForAI {
    return {
        symbol: snapshot.symbol,
        currentPrice: snapshot.currentPrice,
        bid: snapshot.bid,
        ask: snapshot.ask,
        spread: snapshot.spread,
        timestamp: new Date(snapshot.timestamp).toISOString(),
        dataAgeMs: snapshot.dataAgeMs,
        provider: snapshot.provider,
        marketSession: snapshot.marketSession,
        marketStatus: snapshot.marketStatus,
        timeframe: snapshot.timeframe,
        trend: { direction: snapshot.trend },
        marketStructure: { bias: snapshot.marketStructure },
        liquidity: snapshot.liquidity,
        volatility: snapshot.volatility,
        supportResistance: snapshot.supportResistance,
        vwap: snapshot.VWAP,
        fvg: snapshot.FVG.length > 0 ? { zones: snapshot.FVG } : {},
        orderBlocks: snapshot.orderBlocks.length > 0 ? { zones: snapshot.orderBlocks } : {},
        regime: snapshot.regime as unknown as Record<string, unknown>,
        higherTimeframeContext: snapshot.higherTimeframeContext,
        lowerTimeframeContext: snapshot.lowerTimeframeContext,
        recentCandles: snapshot.recentCandles.map((c) => ({
            timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })),
        multiTimeframeCandles: snapshot.multiTimeframeCandles,
    };
}

export interface AICandidateValidation {
    passed: boolean;
    reason: string;
    checks: Record<string, boolean>;
}

export function validateAICandidate(
    candidate: AISignalCandidate,
    snapshot: MarketSnapshot
): AICandidateValidation {
    const checks: Record<string, boolean> = {};

    checks.symbolMatch = candidate.symbol.toUpperCase() === snapshot.symbol.toUpperCase();

    const entryDist = Math.abs(candidate.entry - snapshot.currentPrice);
    const entryPct = snapshot.currentPrice !== 0 ? (entryDist / snapshot.currentPrice) * 100 : Infinity;
    checks.entryNearMarket = entryPct < 0.5;

    checks.directionMatch = candidate.direction === "BUY" || candidate.direction === "SELL";

    let slValid = false;
    if (candidate.direction === "BUY") {
        slValid = candidate.stopLoss < candidate.entry;
    } else {
        slValid = candidate.stopLoss > candidate.entry;
    }
    checks.slLogical = slValid;

    let tpValid = true;
    for (const tp of candidate.takeProfits) {
        if (candidate.direction === "BUY" && tp.price <= candidate.entry) tpValid = false;
        if (candidate.direction === "SELL" && tp.price >= candidate.entry) tpValid = false;
    }
    checks.tpDirectional = tpValid;

    let tpOrderValid = true;
    const tpPrices = candidate.takeProfits.map((t: { price: number }) => t.price).sort((a: number, b: number) => a - b);
    if (candidate.direction === "BUY") {
        for (let i = 1; i < tpPrices.length; i++) {
            if (tpPrices[i] <= tpPrices[i - 1]) tpOrderValid = false;
        }
    } else {
        for (let i = 1; i < tpPrices.length; i++) {
            if (tpPrices[i] >= tpPrices[i - 1]) tpOrderValid = false;
        }
    }
    checks.tpOrdered = tpOrderValid;

    checks.entryWithinRange = candidate.entryRange
        ? candidate.entry >= candidate.entryRange.min && candidate.entry <= candidate.entryRange.max
        : Math.abs(candidate.entry - snapshot.currentPrice) < snapshot.ATR * 3;

    const allPassed = Object.values(checks).every(Boolean);

    return {
        passed: allPassed,
        reason: allPassed
            ? "All validations passed"
            : `Validation failed: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(", ")}`,
        checks,
    };
}

export interface PreSaveRecheckResult {
    passed: boolean;
    reason: string;
    snapshot: MarketSnapshot;
    sanity: { passed: boolean; referencePrice: number; currentPrice: number; priceDifferencePercent: number };
}

export async function preSaveMarketRecheck(
    candidate: AISignalCandidate,
    symbol: string,
    timeframe: string
): Promise<PreSaveRecheckResult> {
    const tf = timeframe as Timeframe;
    const snapshotResult = await getMarketTruth(symbol, tf);
    if (!snapshotResult) {
        return {
            passed: false,
            reason: "MARKET_DATA_UNAVAILABLE — Cannot recheck before save",
            snapshot: null as unknown as MarketSnapshot,
            sanity: { passed: false, referencePrice: candidate.entry, currentPrice: 0, priceDifferencePercent: 100 },
        };
    }

    const { snapshot, freshness } = snapshotResult;
    if (!freshness.fresh) {
        return {
            passed: false,
            reason: `MARKET_DATA_STALE — Data age: ${snapshot.dataAgeMs}ms during recheck`,
            snapshot,
            sanity: { passed: false, referencePrice: candidate.entry, currentPrice: snapshot.currentPrice, priceDifferencePercent: 100 },
        };
    }

    const sanity = currentPriceSanityCheck(candidate.entry, snapshot, symbol);
    if (!sanity.passed) {
        return {
            passed: false,
            reason: `PRICE_MISMATCH — Market moved ${sanity.priceDifferencePercent.toFixed(2)}% during AI generation`,
            snapshot,
            sanity,
        };
    }

    return {
        passed: true,
        reason: "Recheck passed — market data still valid",
        snapshot,
        sanity,
    };
}

function determineDirectionFromContext(
    structureBias: string,
    htfBias: string,
    snapshot: MarketSnapshot
): SignalDirection | null {
    let buyScore = 0;
    let sellScore = 0;

    if (htfBias === "bullish") buyScore += 2;
    else if (htfBias === "bearish") sellScore += 2;

    if (structureBias === "bullish") buyScore += 2;
    else if (structureBias === "bearish") sellScore += 2;

    if (snapshot.trend === "bullish") buyScore += 1;
    else if (snapshot.trend === "bearish") sellScore += 1;

    if (snapshot.regime === "TRENDING_BULLISH" || snapshot.regime === "breakout") buyScore += 1;
    else if (snapshot.regime === "TRENDING_BEARISH" || snapshot.regime === "breakout") sellScore += 1;

    const diff = buyScore - sellScore;
    if (diff >= 2) return "BUY";
    if (diff <= -2) return "SELL";
    return null;
}

function calculateEntryRange(
    symbol: string,
    direction: SignalDirection,
    currentPrice: number,
    atr: number,
    _structure: ReturnType<typeof detectStructure>
): { entry: number; entryMin: number; entryMax: number; sl: number; tps: number[] } {
    const spec = getSymbolSpec(symbol)!;
    const round = (p: number) => parseFloat(p.toFixed(spec.digits));

    const spread = spec.typicalSpread;
    const entryMin = round(currentPrice - spread / 2);
    const entryMax = round(currentPrice + spread / 2);
    const entry = round((entryMin + entryMax) / 2);

    let sl: number;
    if (direction === "BUY") {
        sl = round(entry - atr * 1.5);
    } else {
        sl = round(entry + atr * 1.5);
    }

    const risk = Math.abs(entry - sl);
    const tps = [
        round(entry + risk * 2.2),
        round(entry + risk * 3.4),
        round(entry + risk * 5.6),
    ];

    return { entry, entryMin, entryMax, sl, tps };
}


