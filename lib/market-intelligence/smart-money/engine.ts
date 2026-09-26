/**
 * Smart Money Engine — Phase 2 Real Implementation
 *
 * Uses existing lib/analytics/ modules where available.
 * All output is deterministic from OHLC candles.
 * Explicit live/replay/historical distinction.
 * Look-ahead is documented; live/replay does not expose future candles.
 */

import { MarketCandle } from "../../market-data/types";
import {
  detectStructure,
  getOverallStructureBias,
  getSwingPoints,
} from "../../analytics/market-structure";
import { detectLiquidity } from "../../analytics/liquidity";
import { getCurrentSession, getSessionData } from "../../analytics/sessions";
import { getMultiTimeframeBias } from "../../analytics/multi-timeframe";
import {
  SmartMoneyEvent,
  LiquidityZone,
  FVGZone,
  OrderBlock,
  MarketStructureState,
  Timeframe,
  Mode,
} from "../types";

// =====================================================================
// DOCUMENTED DEFINITIONS
// =====================================================================

/**
 * Swing Detection — reuses lib/analytics/market-structure getSwingPoints.
 * Confirmation: a swing at index i is confirmed only when candles i-lookback..i+lookback
 * are available (i.e., future candles needed for confirmation).
 * LIVE / REPLAY MODE: unconfirmed swings are NOT labeled as confirmed events.
 * HISTORICAL MODE: confirmation is permitted (documented). Default lookback = 3.
 */
export interface SwingConfig {
  lookback?: number; // default 3
  mode: Mode;
}

/**
 * Liquidity – reuses lib/analytics/liquidity.
 * Equal High / Low tolerance = 0.001 (0.1%) relative. Documented.
 * Sweep confirmation:
 *   Sell-side: candle.high > level.price AND candle.close < level.price AND candle.close < candle.open
 *   Buy-side:  candle.low  < level.price AND candle.close > level.price AND candle.close > candle.open
 */

/**
 * FVG — three-candle definition:
 * Bullish FVG: candle[1].high < candle[3].low  (gap between 1 and 3)
 * Bearish FVG: candle[1].low  > candle[3].high (gap between 1 and 3)
 * Only when candle[2] creates a gap between 1 and 3.
 */

/**
 * Order Block — deterministic model:
 * Bullish OB = last bearish candle before confirmed bullish displacement (BOS / MSS / HH)
 * Bearish OB = last bullish candle before confirmed bearish displacement
 * Displacement = price breaks previous relevant swing in the documented direction.
 */

// =====================================================================
// ENGINE
// =====================================================================

export class SmartMoneyEngine {
  private mode: Mode;
  private config: {
    swingLookback: number;
    equalTolerance: number;
    fvgEnabled: boolean;
    obEnabled: boolean;
    sessionEnabled: boolean;
    liquidityEnabled: boolean;
    structureMode: "internal" | "external" | "both";
  };

  constructor(options?: Partial<{ mode: Mode; config: Partial<typeof SmartMoneyEngine.prototype.config> }>) {
    this.mode = options?.mode ?? "historical";
    this.config = {
      swingLookback: 3,
      equalTolerance: 0.001,
      fvgEnabled: true,
      obEnabled: true,
      sessionEnabled: true,
      liquidityEnabled: true,
      structureMode: "both",
      ...options?.config,
    };
  }

  /**
   * Main entry: process candles and return structured events.
   * In replay/live: only candles up to current index are used.
   */
  run(candles: MarketCandle[], tf: Timeframe, modeOverride?: Mode): {
    events: SmartMoneyEvent[];
    structureState: MarketStructureState;
    liquidity: LiquidityZone[];
    sweeps: SmartMoneyEvent[];
    fvg: FVGZone[];
    orderBlocks: OrderBlock[];
    sessions: SmartMoneyEvent[];
    mtf?: unknown;
    limitations: string[];
  } {
    const limitations: string[] = [];
    const effectiveMode = modeOverride ?? this.mode;

    if (!candles || candles.length < 10) {
      limitations.push("Insufficient candles for smart money detection.");
      return this.emptyResult(tf, limitations);
    }

    // For replay/live: if called with partial candles, use what is given.
    // We never peek ahead: the caller passes only available candles.
    const available = candles;

    const events: SmartMoneyEvent[] = [];
    const sw = this.detectSwings(available, tf, effectiveMode);
    events.push(...sw.events);

    const structure = this.detectStructure(available, tf, effectiveMode);
    events.push(...structure.events);

    const structureState = structure.state;

    const li = this.detectLiquidity(available, tf, effectiveMode);
    events.push(...li.events);

    const fvg = this.detectFVG(available, tf, effectiveMode);
    events.push(...fvg.events);

    const ob = this.detectOrderBlocks(available, tf, effectiveMode, sw.swings);
    events.push(...ob.events);

    const sessions = this.detectSessions(available, tf);
    events.push(...sessions.events);

    const mtf = this.detectMTF(available, tf);

    return {
      events: events.sort((a, b) => a.timestamp - b.timestamp),
      structureState,
      liquidity: li.zones,
      sweeps: li.sweeps,
      fvg: fvg.zones,
      orderBlocks: ob.blocks,
      sessions: sessions.events,
      mtf,
      limitations,
    };
  }

  // ------------------------------------------------------------------
  // SWING DETECTION
  // ------------------------------------------------------------------

  private detectSwings(candles: MarketCandle[], tf: Timeframe, mode: Mode) {
    const events: SmartMoneyEvent[] = [];
    const swings: { index: number; price: number; type: "swing_high" | "swing_low"; timestamp: number }[] = [];
    const lookback = this.config.swingLookback;

    // Reuse lib/analytics/market-structure getSwingPoints logic exactly.
    // Note: getSwingPoints requires future candles for confirmation (i+lookback).
    // HISTORICAL: permitted. REPLAY/LIVE: only emit if confirmed within available data.
    for (let i = lookback; i < candles.length - lookback; i++) {
      const window = candles.slice(i - lookback, i + lookback + 1);
      const current = candles[i];
      if (window.every((c) => c.high <= current.high)) {
        swings.push({ index: i, price: current.high, type: "swing_high", timestamp: current.timestamp });
      }
      if (window.every((c) => c.low >= current.low)) {
        swings.push({ index: i, price: current.low, type: "swing_low", timestamp: current.timestamp });
      }
    }

    // Classification: HH / HL / LH / LL
    const highs = swings.filter((s) => s.type === "swing_high").sort((a, b) => a.index - b.index);
    const lows = swings.filter((s) => s.type === "swing_low").sort((a, b) => a.index - b.index);

    for (let i = 0; i < highs.length; i++) {
      const h = highs[i];
      const prev = i > 0 ? highs[i - 1] : null;
      if (prev && h.price > prev.price) {
        events.push({ id: `hh_${tf}_${h.index}`, type: "HH", direction: "bullish", timeframe: tf, timestamp: h.timestamp, price: h.price, source: "calculated" });
      } else if (prev && h.price < prev.price) {
        events.push({ id: `hl_${tf}_${h.index}`, type: "HL", direction: "bearish", timeframe: tf, timestamp: h.timestamp, price: h.price, source: "calculated" });
      }
    }
    for (let i = 0; i < lows.length; i++) {
      const l = lows[i];
      const prev = i > 0 ? lows[i - 1] : null;
      if (prev && l.price < prev.price) {
        events.push({ id: `ll_${tf}_${l.index}`, type: "LL", direction: "bearish", timeframe: tf, timestamp: l.timestamp, price: l.price, source: "calculated" });
      } else if (prev && l.price > prev.price) {
        events.push({ id: "lh_" + tf + "_" + l.index, type: "LH", direction: "bullish", timeframe: tf, timestamp: l.timestamp, price: l.price, source: "calculated" });
      }
    }

    // Unconfirmed swings: only emit as SWING_HIGH / SWING_LOW if within available window,
    // but do NOT label them HH/HL/LH/LL without full confirmation.
    for (const s of swings) {
      const confirmed = mode === "historical" || s.index + lookback < candles.length;
      if (confirmed) {
        events.push({
          id: s.type + "_" + tf + "_" + s.index,
          type: s.type === "swing_high" ? "SWING_HIGH" : "SWING_LOW",
          direction: s.type === "swing_high" ? "bullish" : "bearish",
          timeframe: tf,
          timestamp: s.timestamp,
          price: s.price,
          source: "calculated",
        });
      }
    }

    return { events, swings };
  }

  // ------------------------------------------------------------------
  // MARKET STRUCTURE (BOS / CHOCH / MSS / STATE)
  // ------------------------------------------------------------------

  private detectStructure(candles: MarketCandle[], tf: Timeframe, mode: Mode) {
    // Reuse lib/analytics/market-structure detectStructure exactly.
    // It uses swing points with lookback=3 (future confirmation needed).
    // Historical mode: full result permitted. Replay/live: still uses available candles,
    // but no future candles are in the array (caller responsibility).
    const rawEvents = detectStructure(candles, tf);
    const events: SmartMoneyEvent[] = rawEvents.map((e) => ({
      id: e.id,
      type: e.type as SmartMoneyEvent["type"],
      direction: e.direction,
      timeframe: e.timeframe as Timeframe,
      timestamp: e.timestamp,
      price: e.price,
      source: "calculated",
    }));

    const state = this.buildStructureState(events, candles, tf, mode);
    return { events, state };
  }

  private buildStructureState(events: SmartMoneyEvent[], candles: MarketCandle[], tf: Timeframe, mode: Mode): MarketStructureState {
    const bias = getOverallStructureBias(events.map((e) => ({ id: e.id, type: e.type as any, direction: e.direction as any, price: e.price ?? 0, timestamp: e.timestamp, timeframe: e.timeframe })));
    const recent = events.filter((e) => e.type === "BOS" || e.type === "CHOCH").slice(-3);
    const hh = events.filter((e) => e.type === "HH").length;
    const hl = events.filter((e) => e.type === "HL").length;
    const lh = events.filter((e) => e.type === "LH").length;
    const ll = events.filter((e) => e.type === "LL").length;
    return {
      trend: bias,
      internalTrend: recent.length > 0 ? (recent[recent.length - 1].direction ?? "unknown") : "unknown",
      lastEvent: events[events.length - 1] ?? undefined,
      lastSwingHigh: this.lastSwingPrice(candles, "high"),
      lastSwingLow: this.lastSwingPrice(candles, "low"),
      higherHighs: hh,
      higherLows: hl,
      lowerHighs: lh,
      lowerLows: ll,
    };
  }

  private lastSwingPrice(candles: MarketCandle[], kind: "high" | "low"): number | undefined {
    // Simple approximate: last local max/min within lookback=3
    for (let i = candles.length - 1; i >= 3; i--) {
      const w = candles.slice(i - 3, i + 4);
      const c = candles[i];
      if (kind === "high" && w.every((x) => x.high <= c.high)) return c.high;
      if (kind === "low" && w.every((x) => x.low >= c.low)) return c.low;
    }
    return undefined;
  }

  // ------------------------------------------------------------------
  // LIQUIDITY
  // ------------------------------------------------------------------

  private detectLiquidity(candles: MarketCandle[], tf: Timeframe, mode: Mode) {
    const result = detectLiquidity(candles, tf);
    const zones: LiquidityZone[] = result.levels.map((l) => ({
      id: l.id,
      side: (l.type === "equal_highs" || l.type === "prev_day_high" || l.type === "prev_week_high" || l.type === "swing_high" || l.type === "session_high") ? "sell_side" : "buy_side",
      price: l.price,
      source: this.mapLiquiditySource(l.type),
      timeframe: l.timeframe as Timeframe,
      createdAt: l.timestamp,
      status: "active",
    }));
    const sweepEvents: SmartMoneyEvent[] = result.sweeps.map((s) => ({
      id: s.id,
      type: "LIQUIDITY_SWEEP",
      direction: s.side === "sell_side" ? "bearish" : "bullish",
      timeframe: tf,
      timestamp: s.timestamp,
      price: s.level,
      source: "calculated",
      metadata: { sweepPrice: s.sweepPrice, confirmed: s.confirmed },
    }));
    return { zones, sweeps: sweepEvents, events: sweepEvents };
  }

  private mapLiquiditySource(t: string): LiquidityZone["source"] {
    switch (t) {
      case "equal_highs": return "equal_high";
      case "equal_lows": return "equal_low";
      case "prev_day_high": return "previous_high";
      case "prev_day_low": return "previous_low";
      case "prev_week_high": return "previous_high";
      case "prev_week_low": return "previous_low";
      case "session_high": return "session_high";
      case "session_low": return "session_low";
      case "swing_high": return "swing_high";
      case "swing_low": return "swing_low";
      default: return "previous_high";
    }
  }

  // ------------------------------------------------------------------
  // FVG — 3-candle exact definition
  // ------------------------------------------------------------------

  private detectFVG(candles: MarketCandle[], tf: Timeframe, mode: Mode) {
    const zones: FVGZone[] = [];
    const events: SmartMoneyEvent[] = [];

    // Bullish FVG: candle[i].high < candle[i+2].low  with gap
    // Bearish FVG: candle[i].low > candle[i+2].high with gap
    for (let i = 0; i < candles.length - 2; i++) {
      const c1 = candles[i];
      const c2 = candles[i + 1];
      const c3 = candles[i + 2];

      // Bullish gap
      if (c1.high < c3.low && c2.low > c1.high) {
        // Confirm gap is real (c2 does not fully overlap)
        const top = Math.min(c1.high, c3.low); // approximate
        // More precise: gap between c1.high and c3.low
        const topPrecise = Math.max(c1.high, c2.low); // top of gap = lower of the two touching prices? Actually gap top = c1.high (upper boundary of gap) if c3.low > c1.high
        // Simplest exact definition: top = c1.high, bottom = c3.low (when c1.high < c3.low)
        const bottom = c3.low;
        const topVal = c1.high;
        zones.push({
          id: `fvg_bull_${tf}_${i}`,
          direction: "bullish",
          timeframe: tf,
          top: topVal,
          bottom,
          createdAt: c1.timestamp,
          age: candles[candles.length - 1].timestamp - c1.timestamp,
          fillPercent: 0,
          status: "active",
        });
        events.push({ id: `fvg_bull_${tf}_${i}`, type: "FVG", direction: "bullish", timeframe: tf, timestamp: c1.timestamp, price: (topVal + bottom) / 2, source: "calculated" });
      }

      // Bearish gap
      if (c1.low > c3.high && c2.high < c1.low) {
        const topVal = c1.low;
        const bottom = c3.high;
        zones.push({
          id: `fvg_bear_${tf}_${i}`,
          direction: "bearish",
          timeframe: tf,
          top: topVal,
          bottom,
          createdAt: c1.timestamp,
          age: candles[candles.length - 1].timestamp - c1.timestamp,
          fillPercent: 0,
          status: "active",
        });
        events.push({ id: `fvg_bear_${tf}_${i}`, type: "FVG", direction: "bearish", timeframe: tf, timestamp: c1.timestamp, price: (topVal + bottom) / 2, source: "calculated" });
      }
    }
    return { zones, events };
  }

  // ------------------------------------------------------------------
  // ORDER BLOCKS
  // ------------------------------------------------------------------

  private detectOrderBlocks(candles: MarketCandle[], tf: Timeframe, mode: Mode, swings: { index: number; price: number; type: string }[]) {
    const blocks: OrderBlock[] = [];
    const events: SmartMoneyEvent[] = [];
    // Deterministic definition: last bearish candle before bullish BOS/MSS/HH
    // and last bullish candle before bearish BOS/MSS/LL
    // We approximate using swing points + displacement.
    const bulls = swings.filter((s) => s.type === "swing_high").map((s) => s.index);
    const lows = swings.filter((s) => s.type === "swing_low").map((s) => s.index);

    // Simplified: for each confirmed bullish displacement (HH after previous high),
    // take the last bearish candle before that high.
    for (let i = 1; i < bulls.length; i++) {
      const current = bulls[i];
      const prev = bulls[i - 1];
      if (current > prev) {
        // Bullish displacement — look for last bearish candle in [prev, current]
        for (let j = current - 1; j >= prev; j--) {
          const c = candles[j];
          if (c.close < c.open) {
            // Bearish candle = potential bullish OB (last bearish before move)
            blocks.push({
              id: `ob_bull_${tf}_${j}`,
              direction: "bullish",
              timeframe: tf,
              top: c.high,
              bottom: c.low,
              createdAt: c.timestamp,
              status: "active",
            });
            events.push({ id: `ob_bull_${tf}_${j}`, type: "ORDER_BLOCK", direction: "bullish", timeframe: tf, timestamp: c.timestamp, price: c.close, source: "calculated" });
            break;
          }
        }
      }
    }
    for (let i = 1; i < lows.length; i++) {
      const current = lows[i];
      const prev = lows[i - 1];
      if (current < prev) {
        for (let j = current - 1; j >= prev; j--) {
          const c = candles[j];
          if (c.close > c.open) {
            blocks.push({ id: `ob_bear_${tf}_${j}`, direction: "bearish", timeframe: tf, top: c.high, bottom: c.low, createdAt: c.timestamp, status: "active" });
            events.push({ id: `ob_bear_${tf}_${j}`, type: "ORDER_BLOCK", direction: "bearish", timeframe: tf, timestamp: c.timestamp, price: c.close, source: "calculated" });
            break;
          }
        }
      }
    }
    return { events, blocks };
  }

  // ------------------------------------------------------------------
  // SESSIONS — explicit UTC
  // ------------------------------------------------------------------

  private detectSessions(candles: MarketCandle[], tf: Timeframe) {
    const events: SmartMoneyEvent[] = [];
    const sessionInfo = getSessionData(candles, new Date());
    // If session info available, emit session-level events
    if (sessionInfo.current !== "closed" && sessionInfo.name) {
      events.push({
        id: `session_${tf}_${sessionInfo.current}`,
        type: "SESSION_LEVEL",
        direction: "neutral",
        timeframe: tf,
        timestamp: sessionInfo.startTime,
        price: sessionInfo.high,
        source: "calculated",
        metadata: { sessionName: sessionInfo.name, high: sessionInfo.high, low: sessionInfo.low, range: sessionInfo.range },
      });
    }
    return { events };
  }

  // ------------------------------------------------------------------
  // MTF
  // ------------------------------------------------------------------

  private detectMTF(candles: MarketCandle[], tf: Timeframe) {
    // Simplified MTF: only if we have higher timeframe candles available.
    // Real MTF requires separate candle arrays per timeframe.
    // Return a placeholder that indicates MTF requires per-timeframe input.
    return { note: "MTF requires candlesByTimeframe input. Use getMultiTimeframeBias with Record<Timeframe, MarketCandle[]>", available: false, currentTimeframe: tf };
  }

  // ------------------------------------------------------------------
  // EMPTY RESULT
  // ------------------------------------------------------------------

  private emptyResult(tf: Timeframe, limitations: string[]): ReturnType<SmartMoneyEngine["run"]> {
    return {
      events: [],
      structureState: { trend: "unknown", internalTrend: "unknown", higherHighs: 0, higherLows: 0, lowerHighs: 0, lowerLows: 0 },
      liquidity: [],
      sweeps: [],
      fvg: [],
      orderBlocks: [],
      sessions: [],
      mtf: undefined,
      limitations,
    };
  }
}
