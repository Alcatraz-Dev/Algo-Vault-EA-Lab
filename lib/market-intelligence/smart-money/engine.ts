/**
 * Smart Money Engine — adapter over the ONE Market Intelligence Core.
 *
 * Since Phase 3 this class no longer owns any detection math. `run()` calls
 * `detectSmartMoney()` from `lib/market-core/smart-money` (the same
 * deterministic, confirmation-aware detectors the chart, the backtester,
 * replay, alerts and the AI context consume) and maps the canonical
 * `SmartMoneyObject`s onto the legacy Market Intelligence shapes so every
 * existing consumer keeps working unchanged.
 *
 * Guarantees:
 *  - deterministic (same candles + config → same output, no LLM involvement),
 *  - confirmation-aware: every mapped event carries
 *    `metadata.confirmationAt` / `metadata.status` (anti-look-ahead gate),
 *  - point-in-time safe: callers pass ONLY the candles available at
 *    evaluation time; detectors never read past the end of the array.
 *
 * Documented rules live in docs/market-intelligence-core.md.
 */

import { MarketCandle } from "../../market-data/types";
import {
  detectSmartMoney,
  primarySession,
  sessionLevels,
  SMART_MONEY_VERSION,
  type SmartMoneyDetection,
} from "../../market-core";
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
// DOCUMENTED DEFINITIONS (delegated to lib/market-core/smart-money)
// =====================================================================

/**
 * Swing Detection — fractal rule with `lookback` bars each side.
 * Confirmation: a swing at index i is confirmed only when candle
 * i+lookback has CLOSED (exposed as `confirmationAt` on every mapped
 * object). Unconfirmed swings are emitted with status `developing` and can
 * never pass an `asOf` gate. Default lookback = 3.
 */
export interface SwingConfig {
  lookback?: number; // default 3
  mode: Mode;
}

/**
 * Liquidity — confirmed swing/equal-high clusters within a relative
 * tolerance (default 0.001 = 0.1%). Sides: buy-side rests ABOVE highs,
 * sell-side rests BELOW lows. Sweep = wick through the level with a close
 * back inside, evaluated only after the pool's confirmation.
 *
 * FVG — three-candle definition:
 *   Bullish: c3.low  > c1.high  → zone [c1.high, c3.low]
 *   Bearish: c3.high < c1.low   → zone [c3.high, c1.low]
 * Lifecycle: active → mitigated (≥50% filled) → invalidated (close beyond
 * the gap origin).
 *
 * Order Block — deterministic: last opposite candle before a displacement
 * close beyond that candle's extreme (within `obLookahead` candles).
 * Lifecycle: active → mitigated (trade back into the zone) → invalidated
 * (close beyond the block extreme).
 *
 * All of the above are implemented once in lib/market-core/smart-money;
 * see docs/market-intelligence-core.md for the full rule text.
 */

// =====================================================================
// ENGINE (adapter)
// =====================================================================

type EventMeta = Record<string, unknown>;

function metaOf(obj: { confirmationAt: number; status: string; detectedAt: number }): EventMeta {
  return {
    confirmationAt: obj.confirmationAt,
    confirmationTime: obj.confirmationAt,
    status: obj.status,
    calculated: true,
    smartMoneyVersion: SMART_MONEY_VERSION,
  };
}

const EVENT_TYPE: Record<string, SmartMoneyEvent["type"]> = {
  swing_high: "SWING_HIGH",
  swing_low: "SWING_LOW",
  hh: "HH",
  hl: "HL",
  lh: "LH",
  ll: "LL",
  bos: "BOS",
  choch: "CHOCH",
  liquidity_sweep: "LIQUIDITY_SWEEP",
  fvg: "FVG",
  order_block: "ORDER_BLOCK",
};

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
   * In replay/live: only candles up to the current snapshot are used — the
   * caller passes what is available and the core never peeks ahead.
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
    void effectiveMode;

    if (!candles || candles.length < 10) {
      limitations.push("Insufficient candles for smart money detection.");
      return this.emptyResult(tf, limitations);
    }

    const symbol = (candles as Array<MarketCandle & { symbol?: string }>).find((c) => c.symbol)?.symbol ?? "UNKNOWN";

    const detection: SmartMoneyDetection = detectSmartMoney(candles, {
      symbol,
      timeframe: tf,
      lookback: this.config.swingLookback,
      equalTolerance: this.config.equalTolerance,
      structure: true,
      liquidity: this.config.liquidityEnabled,
      zones: this.config.fvgEnabled,
      orderBlocks: this.config.obEnabled,
      sessions: this.config.sessionEnabled,
    });
    limitations.push(...detection.limitations);

    const events: SmartMoneyEvent[] = [];
    for (const obj of detection.objects) {
      const type = EVENT_TYPE[obj.kind];
      if (!type) continue;
      const meta: EventMeta = {
        ...metaOf(obj),
        sourceCandles: obj.sourceCandles,
        ...(obj.metadata ?? {}),
      };
      events.push({
        id: obj.id,
        type,
        direction: obj.direction,
        timeframe: tf,
        timestamp: obj.detectedAt,
        price: obj.price,
        priceHigh: obj.priceHigh,
        priceLow: obj.priceLow,
        startTimestamp: typeof obj.metadata?.zoneStart === "number" ? obj.metadata.zoneStart : obj.detectedAt,
        status: mapStatus(obj.status),
        source: "calculated",
        metadata: meta,
      });
    }

    const sessions = this.buildSessionEvents(candles, tf);

    return {
      events: [...events, ...sessions].sort((a, b) => a.timestamp - b.timestamp),
      structureState: this.buildStructureState(detection),
      liquidity: this.mapLiquidity(detection),
      sweeps: events.filter((e) => e.type === "LIQUIDITY_SWEEP"),
      fvg: this.mapFvg(detection, candles),
      orderBlocks: this.mapOrderBlocks(detection),
      sessions,
      mtf: {
        note: "MTF requires candlesByTimeframe input. Use getMultiTimeframeBias with Record<Timeframe, MarketCandle[]>",
        available: false,
        currentTimeframe: tf,
      },
      limitations,
    };
  }

  // ------------------------------------------------------------------
  // MAPPINGS (canonical object → legacy shape)
  // ------------------------------------------------------------------

  private buildStructureState(detection: SmartMoneyDetection): MarketStructureState {
    const st = detection.structure;
    const breaks = st.objects.filter((o) => o.kind === "bos" || o.kind === "choch");
    const lastBreak = breaks[breaks.length - 1];
    const lastEvent = detection.objects[detection.objects.length - 1];

    return {
      trend: st.bias,
      internalTrend: lastBreak ? lastBreak.direction : "unknown",
      lastEvent: lastEvent
        ? {
            id: lastEvent.id,
            type: EVENT_TYPE[lastEvent.kind] ?? "BOS",
            direction: lastEvent.direction,
            timeframe: detection.timeframe as Timeframe,
            timestamp: lastEvent.detectedAt,
            price: lastEvent.price,
            source: "calculated",
            metadata: { ...metaOf(lastEvent), ...(lastEvent.metadata ?? {}) },
          }
        : undefined,
      lastSwingHigh: st.lastSwingHigh,
      lastSwingLow: st.lastSwingLow,
      higherHighs: st.counts.hh,
      higherLows: st.counts.hl,
      lowerHighs: st.counts.lh,
      lowerLows: st.counts.ll,
    };
  }

  private mapLiquidity(detection: SmartMoneyDetection): LiquidityZone[] {
    return detection.pools.map((pool) => {
      const side = pool.metadata?.side === "sell_side" ? "sell_side" : "buy_side";
      const source = pool.metadata?.source;
      const highSide = side === "buy_side";
      let mapped: LiquidityZone["source"];
      if (source === "equal") mapped = highSide ? "equal_high" : "equal_low";
      else if (source === "session") mapped = highSide ? "session_high" : "session_low";
      else if (source === "prev_day") mapped = highSide ? "previous_high" : "previous_low";
      else mapped = highSide ? "swing_high" : "swing_low";

      return {
        id: pool.id,
        side,
        price: pool.price ?? 0,
        source: mapped,
        timeframe: detection.timeframe as Timeframe,
        createdAt: pool.detectedAt,
        status: pool.status === "invalidated" ? "swept" : pool.status === "mitigated" ? "invalidated" : "active",
      };
    });
  }

  private mapFvg(detection: SmartMoneyDetection, candles: MarketCandle[]): FVGZone[] {
    const lastTs = candles[candles.length - 1]?.timestamp ?? 0;
    return detection.fvgs.map((z) => {
      const fill = typeof z.metadata?.fillPercent === "number" ? z.metadata.fillPercent : 0;
      const status: FVGZone["status"] =
        z.status === "invalidated" ? "filled" : z.status === "mitigated" ? "partially_filled" : "active";
      return {
        id: z.id,
        direction: zoneDirection(z.direction),
        timeframe: detection.timeframe as Timeframe,
        top: z.priceHigh ?? 0,
        bottom: z.priceLow ?? 0,
        createdAt: typeof z.metadata?.zoneStart === "number" ? z.metadata.zoneStart : z.detectedAt,
        age: Math.max(0, lastTs - (typeof z.metadata?.zoneStart === "number" ? z.metadata.zoneStart : z.detectedAt)),
        fillPercent: Math.round(fill * 100),
        status,
        consequentEncroachment: typeof z.metadata?.midpoint === "number" ? z.metadata.midpoint : undefined,
      };
    });
  }

  private mapOrderBlocks(detection: SmartMoneyDetection): OrderBlock[] {
    return detection.orderBlocks.map((ob) => ({
      id: ob.id,
      direction: zoneDirection(ob.direction),
      timeframe: detection.timeframe as Timeframe,
      top: ob.priceHigh ?? 0,
      bottom: ob.priceLow ?? 0,
      createdAt: typeof ob.metadata?.zoneStart === "number" ? ob.metadata.zoneStart : ob.detectedAt,
      status:
        ob.status === "invalidated"
          ? "invalidated"
          : ob.status === "mitigated"
            ? "mitigated"
            : "active",
      sourceEventId: typeof ob.metadata?.displacementTime === "number" ? String(ob.metadata.displacementTime) : undefined,
    }));
  }

  private buildSessionEvents(candles: MarketCandle[], tf: Timeframe): SmartMoneyEvent[] {
    const last = candles[candles.length - 1];
    if (!last) return [];
    const name = primarySession(last.timestamp);
    if (name === "closed") return [];
    const levels = sessionLevels(candles);
    const match = levels.find((l) => l.session.label === name || (name === "overlap" && l.session.key === "new_york"));
    return [
      {
        id: `session_${tf}_${name.toLowerCase().replace(/\s+/g, "_")}`,
        type: "SESSION_LEVEL",
        direction: "neutral",
        timeframe: tf,
        timestamp: last.timestamp,
        price: match?.high ?? last.high,
        source: "calculated",
        metadata: {
          sessionName: name,
          high: match?.high,
          low: match?.low,
          range: match ? match.high - match.low : undefined,
          confirmationAt: last.timestamp,
          status: "active",
        },
      },
    ];
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

/** Zones are directionally binary by construction (never neutral). */
function zoneDirection(direction: string): "bullish" | "bearish" {
  return direction === "bearish" ? "bearish" : "bullish";
}

function mapStatus(status: string): SmartMoneyEvent["status"] {
  switch (status) {
    case "developing":
    case "confirmed":
    case "active":
      return "active";
    case "mitigated":
      return "mitigated";
    case "invalidated":
      return "invalidated";
    default:
      return "active";
  }
}

/** Re-exported so consumers can gate visibility without importing the core. */
export { visibleAsOf, SMART_MONEY_VERSION } from "../../market-core";
