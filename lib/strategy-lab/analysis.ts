import { MarketCandle, Timeframe, SupportedSymbol, MarketSession, MarketStructurePoint } from "@/lib/market-data/types";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP } from "@/lib/analytics/vwap";
import { detectOrderBlocks, detectFairValueGaps } from "@/lib/analytics/zones";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import {
    AnalysisPeriod,
    AnalysisResult,
    DataCoverage,
    DayOfWeekStat,
    HourOfDayStat,
    MarketAnalysisSet,
    PriceActionAnalysis,
    PriceActionKind,
    SessionStats,
    SupportResistanceAnalysis,
    SupportResistanceLevel,
    TimeframeHierarchy,
    TrendAnalysis,
} from "./types";
import { computeFeatures, CandleFeatures } from "./features";
import { loadDataBundle } from "./market-data";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SESSION_NAMES: Record<string, string> = {
    asian: "Asian",
    london: "London",
    new_york: "New York",
    overlap: "London/NY Overlap",
};

function classifyPriceAction(fe: CandleFeatures, avgRangePct: number): PriceActionKind {
    const body = Math.abs(fe.close - fe.open);
    const range = fe.high - fe.low;
    const prevDir = fe.close > fe.open ? "up" : "down";
    if (fe.breakoutHigh || fe.breakoutLow) return "breakout";
    if (fe.rangeExpansion > 30 && body / (range || 1) > 0.6) return "impulse";
    if (range > 0 && range / Math.max(fe.close, 1) < avgRangePct * 0.5) return "consolidation";
    if (fe.hour === 0 && prevDir === "up") return "reversal";
    if (fe.fvgBarsAgo !== null && fe.fvgBarsAgo <= 2 && fe.close > fe.open) return "retest";
    if (fe.momentumPct > 3 || fe.momentumPct < -3) return "impulse";
    if (fe.lastSweep && fe.lastSweepBarsAgo !== null && fe.lastSweepBarsAgo <= 3) return "retest";
    return "consolidation";
}

function analyzeSessions(candles: MarketCandle[]): {
    sessions: SessionStats[];
    hourOfDay: HourOfDayStat[];
    dayOfWeek: DayOfWeekStat[];
    bestSession: SessionStats | null;
    bestDay: DayOfWeekStat | null;
} {
    const sessionKeys: SessionStats["session"][] = ["asian", "london", "new_york", "overlap"];
    const bySession = new Map<SessionStats["session"], { range: number[]; bars: number; up: number; down: number; move: number[] }>();

    for (const key of sessionKeys) {
        bySession.set(key, { range: [], bars: 0, up: 0, down: 0, move: [] });
    }

    const byHour = new Map<number, { range: number[]; up: number; down: number; bars: number }>();
    const byDay = new Map<number, { range: number[]; up: number; down: number; bars: number }>();

    for (let i = 1; i < candles.length; i++) {
        const c = candles[i];
        const d = new Date(c.timestamp);
        const hour = d.getUTCHours();
        const weekday = d.getUTCDay();
        const dir = c.close > c.open ? "up" : c.close < c.open ? "down" : "flat";
        const key = sessionOfHour(hour);
        const range = c.high - c.low;
        const move = (c.close - c.open) / (c.open || 1) * 100;

        const s = bySession.get(key as SessionStats["session"]);
        if (s) {
            s.bars++;
            s.range.push(range);
            if (dir === "up") s.up++;
            else if (dir === "down") s.down++;
            s.move.push(move);
        }

        const h = byHour.get(hour) || { range: [], up: 0, down: 0, bars: 0 };
        h.bars++;
        h.range.push(range);
        if (dir === "up") h.up++;
        else if (dir === "down") h.down++;
        byHour.set(hour, h);

        const day = byDay.get(weekday) || { range: [], up: 0, down: 0, bars: 0 };
        day.bars++;
        day.range.push(range);
        if (dir === "up") day.up++;
        else if (dir === "down") day.down++;
        byDay.set(weekday, day);
    }

    const sessions: SessionStats[] = [];
    for (const key of sessionKeys) {
        const s = bySession.get(key)!;
        const avgRange = s.range.length > 0 ? s.range.reduce((a, b) => a + b, 0) / s.range.length : 0;
        const avgMove = s.move.length > 0 ? s.move.reduce((a, b) => a + b, 0) / s.move.length : 0;
        const bullRun = s.up > s.down ? "up" : s.down > s.up ? "down" : "flat";
        sessions.push({
            session: key,
            sessionName: SESSION_NAMES[key],
            bars: s.bars,
            averageRange: Number(avgRange.toFixed(5)),
            bullRun,
            averageMovePercent: Number(avgMove.toFixed(4)),
            winBias: s.up > s.down ? "bullish" : s.down > s.up ? "bearish" : "neutral",
        });
    }

    const hourOfDay: HourOfDayStat[] = [];
    for (let h = 0; h < 24; h++) {
        const e = byHour.get(h);
        if (!e || e.bars === 0) continue;
        const avgRange = e.range.reduce((a, b) => a + b, 0) / e.range.length;
        hourOfDay.push({
            hour: h,
            bars: e.bars,
            averageRange: Number(avgRange.toFixed(5)),
            direction: e.up > e.down ? "up" : e.down > e.up ? "down" : "flat",
        });
    }

    const dayOfWeek: DayOfWeekStat[] = [];
    for (let wd = 0; wd < 7; wd++) {
        const e = byDay.get(wd);
        if (!e || e.bars === 0) continue;
        const avgRange = e.range.reduce((a, b) => a + b, 0) / e.range.length;
        dayOfWeek.push({
            day: DAY_NAMES[wd],
            bars: e.bars,
            averageRange: Number(avgRange.toFixed(5)),
            direction: e.up > e.down ? "up" : e.down > e.up ? "down" : "flat",
        });
    }

    const bestSession = [...sessions].sort((a, b) => b.averageRange - a.averageRange)[0] || null;
    const bestDay = [...dayOfWeek].sort((a, b) => b.averageRange - a.averageRange)[0] || null;

    return { sessions, hourOfDay, dayOfWeek, bestSession, bestDay };
}

function sessionOfHour(hour: number): MarketSession {
    if (hour >= 12 && hour < 16) return "overlap";
    if (hour >= 7 && hour < 16) return "london";
    if (hour >= 12 && hour < 21) return "new_york";
    if (hour >= 0 && hour < 8) return "asian";
    return "closed";
}

function analyzeSupportResistance(candles: MarketCandle[], timePriceScale: number): SupportResistanceAnalysis {
    const levels: SupportResistanceLevel[] = [];
    const n = candles.length;
    const buckets = new Map<number, { price: number; touches: number; latest: number }>();

    for (let i = Math.max(1, n - 400); i < n; i++) {
        const c = candles[i];
        const round = Math.round(c.high / timePriceScale) * timePriceScale;
        const key = Math.round(round / timePriceScale);
        const bucket = buckets.get(key) || { price: round, touches: 0, latest: 0 };
        bucket.touches++;
        bucket.latest = c.timestamp;
        buckets.set(key, bucket);
    }

    for (const b of buckets.values()) {
        if (b.touches < 3) continue;
        const last = candles[candles.length - 1].close;
        const kind: SupportResistanceLevel["kind"] =
            b.price > last
                ? b.touches >= 4 ? "resistance" : "reaction_zone"
                : b.touches >= 4 ? "support" : "reaction_zone";
        levels.push({
            price: Number(b.price.toFixed(5)),
            touches: b.touches,
            kind,
            strength: Math.min(100, 30 + b.touches * 15),
            latest: b.latest,
        });
    }

    const last = candles.length > 0 ? candles[candles.length - 1].close : 0;
    const above = levels.filter((l) => l.price > last).sort((a, b) => a.price - b.price);
    const below = levels.filter((l) => l.price < last).sort((a, b) => b.price - a.price);

    return {
        levels: levels.sort((a, b) => b.strength - a.strength).slice(0, 12),
        nearestResistance: above.length > 0 ? above[0] : null,
        nearestSupport: below.length > 0 ? below[0] : null,
    };
}

export function analyzeTimeframe(
    symbol: SupportedSymbol,
    period: AnalysisPeriod,
    timeframe: Timeframe,
    candles: MarketCandle[],
    coverage: DataCoverage
): AnalysisResult | null {
    if (candles.length < 20) return null;

    const structure = detectStructure(candles, timeframe);
    const liquidity = detectLiquidity(candles, timeframe);
    const volatility = analyzeVolatility(candles);
    const regime = detectRegime(candles, timeframe);
    // Volume feed is a tick-volume only (see advanced.volumeProfile); the raw data
    // is still validated here so a future rich-volume provider slots in cleanly.
    analyzeVolume(candles);
    const vwap = calculateVWAP(candles, "daily");
    const orderBlocks = detectOrderBlocks(candles, timeframe);
    const fvgs = detectFairValueGaps(candles, timeframe);
    const score = calculateMarketScore(candles, timeframe);
    const features = computeFeatures(candles);

    const last = features[features.length - 1];
    const trend: TrendAnalysis = {
        state: last.trend === "bullish" ? "bullish" : last.trend === "bearish" ? "bearish" : regime.regime.includes("trending") ? "transition" : "ranging",
        bias: last.trend,
        structureBias: getOverallStructureBias(structure),
        ema20: last.ema20,
        ema50: last.ema50,
        priceVsEma20: last.close >= last.ema20 ? "above" : "below",
        higherHighs: features.some((f, i) => i > features.length - 30 && f.higherHigh),
        higherLows: features.some((f, i) => i > features.length - 30 && f.higherLow),
        lowerHighs: features.some((f, i) => i > features.length - 30 && f.lowerHigh),
        lowerLows: features.some((f, i) => i > features.length - 30 && f.lowerLow),
        regime: regime.regime.toUpperCase() as TrendAnalysis["regime"],
        regimeConfidence: regime.confidence,
    };

    const sessions = analyzeSessions(candles);
    const avgRangePct = volatility.atrPercent;

    const paCounts: PriceActionAnalysis = { impulses: 0, consolidations: 0, breakouts: 0, reversals: 0, retests: 0, sequence: [] };
    const recentFeatures = features.slice(Math.max(0, features.length - 200));
    for (const fe of recentFeatures) {
        const kind = classifyPriceAction(fe, avgRangePct);
        paCounts.sequence.push(kind);
        switch (kind) {
            case "impulse": paCounts.impulses++; break;
            case "consolidation": paCounts.consolidations++; break;
            case "breakout": paCounts.breakouts++; break;
            case "reversal": paCounts.reversals++; break;
            case "retest": paCounts.retests++; break;
        }
    }

    const scale = timeframe === "D1" ? 8 : timeframe === "H4" ? 4 : timeframe === "H1" ? 1 : 0.5;
    const sr = analyzeSupportResistance(candles, scale);

    const buySideSweeps = liquidity.sweeps.filter((s) => s.side === "buy_side");
    const sellSideSweeps = liquidity.sweeps.filter((s) => s.side === "sell_side");

    const swingHighs = structure
            .filter((e) => e.type === "swing_high")
            .map((e, idx): MarketStructurePoint => ({ index: idx, price: e.price, timestamp: e.timestamp, type: "swing_high" }));
        const swingLows = structure
            .filter((e) => e.type === "swing_low")
            .map((e, idx): MarketStructurePoint => ({ index: idx, price: e.price, timestamp: e.timestamp, type: "swing_low" }));

        return {
            symbol,
            period,
            timeframe,
            barsUsed: candles.length,
            coverage,
            trend,
            structure: {
                swingHighs,
                swingLows,
            events: structure,
            bosCount: structure.filter((e) => e.type === "BOS").length,
            chochCount: structure.filter((e) => e.type === "CHOCH").length,
            recentEvent: structure[structure.length - 1] || null,
            overall: getOverallStructureBias(structure),
        },
        liquidity: {
            levels: liquidity.levels,
            sweeps: liquidity.sweeps,
            recentSweep: liquidity.sweeps[liquidity.sweeps.length - 1] || null,
            equalHighsAbove: liquidity.levels.filter((l) => l.type === "equal_highs").map((l) => l.price),
            equalLowsBelow: liquidity.levels.filter((l) => l.type === "equal_lows").map((l) => l.price),
            buySideCount: buySideSweeps.length,
            sellSideCount: sellSideSweeps.length,
        },
        volatility,
        priceAction: paCounts,
        sessions: sessions as AnalysisResult["sessions"],
        supportResistance: sr,
        advanced: {
            orderBlocks,
            fairValueGaps: fvgs,
            vwap,
            volumeProfile: {
                available: false,
                notes: "Tick-volume only feed — a true session volume profile is not available.",
            },
            orderFlowAvailable: false,
            orderFlowNote: "Order-flow / delta data is not provided by the current data source.",
        },
        score,
        candleSeries: candles,
    };
}

export async function analyzeMarket(
    symbol: SupportedSymbol,
    period: AnalysisPeriod,
    hierarchy: TimeframeHierarchy
): Promise<MarketAnalysisSet> {
    const bundle = await loadDataBundle(symbol, period, hierarchy);
    const timeframes = Array.from(new Set([hierarchy.macro, hierarchy.structure, hierarchy.setup, hierarchy.entry]));

    const byTimeframe: Partial<Record<Timeframe, AnalysisResult>> = {};
    for (const tf of timeframes) {
        const candles = bundle.candles[tf];
        const coverage = bundle.coverage.find((c) => c.timeframe === tf);
        if (!candles || candles.length < 20 || !coverage) continue;
        const result = analyzeTimeframe(symbol, period, tf, candles, coverage);
        if (result) byTimeframe[tf] = result;
    }

    const relationships: string[] = [];
    const macro = byTimeframe[hierarchy.macro];
    const structureRes = byTimeframe[hierarchy.structure];
    const setup = byTimeframe[hierarchy.setup];
    const entry = byTimeframe[hierarchy.entry];

    if (macro && setup) {
        relationships.push(
            `${hierarchy.macro} bias is ${macro.trend.bias} while ${hierarchy.setup} shows ${setup.trend.bias} action — trade only when the macro pull aligns with the ${hierarchy.setup} signal.`
        );
    }
    if (structureRes) {
        relationships.push(
            `${hierarchy.structure} structure is ${structureRes.structure.overall} with ${structureRes.structure.bosCount} BOS and ${structureRes.structure.chochCount} CHOCH confirmations.`
        );
    }
    if (entry && setup) {
        relationships.push(
            `${hierarchy.entry} confirms entries only after the ${hierarchy.setup} setup has completed its formation.`
        );
    }
    if (macro && macro.volatility) {
        relationships.push(
            `Volatility on ${hierarchy.macro} is ${macro.volatility.state} (ATR ${macro.volatility.atrPercent}%). Position size accordingly.`
        );
    }

    return {
        symbol,
        period,
        generatedAt: Date.now(),
        hierarchy,
        dataBundle: bundle,
        byTimeframe,
        relationships,
    };
}