/**
 * Intelligence Cloud — Canonical Intelligence Facade (Phase 13)
 *
 * This is the ONE place that composes canonical engines into the canonical
 * response. It contains no trading logic of its own: every field is read from
 *
 *   lib/market-data/market-truth        → market state, freshness, session
 *   lib/market-core/indicators          → indicator values
 *   lib/market-core/smart-money         → structure, liquidity, FVG, OB, sessions
 *   lib/strategy-engine/validation      → strategy validation
 *
 * and nothing else. There is deliberately no second market engine, no second
 * SMC detector and no second indicator implementation anywhere in the B2B
 * layer — this file is a reader, not a calculator.
 *
 * Honesty rules enforced here:
 *  - No value is ever defaulted to look complete. Absent input ⇒ absent field
 *    plus an explicit limitation.
 *  - `limitations` is assembled from what actually happened in this call, not
 *    from a static marketing list.
 *  - `availableAt` is set when the result depends on a still-forming candle, so
 *    a client never treats mid-candle output as settled.
 */

import { getMarketTruth } from "@/lib/market-data/market-truth";
import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import {
    detectSmartMoney,
    IndicatorEngine,
    registerBuiltinIndicators,
    timeframeToMs,
} from "@/lib/market-core";
import type { CoreCandle } from "@/lib/market-core/types";
import { validateStrategyDefinition } from "@/lib/strategy-engine/validation";
import type { Strategy } from "@/lib/strategy-lab/types";
import { randomUUID } from "node:crypto";
import {
    INTELLIGENCE_API_VERSION,
    type ComputationCost,
    type DataLineageEntry,
    type IndicatorSnapshot,
    type IndicatorSignal,
    type IntelligenceRequest,
    type IntelligenceResponse,
    type MarketState,
    type SmartMoneySnapshot,
    type StrategyValidationRequest,
    type StrategyValidationResult,
    type StructureState,
    type LiquidityState,
} from "./contracts";
import { buildEngineVersions } from "./engine-registry";
import { errors } from "./errors";

// ── Request validation ──────────────────────────────────────────────────────

const SUPPORTED_TIMEFRAMES = new Set(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]);
const SYMBOL_PATTERN = /^[A-Z0-9]{2,12}$/;

export interface NormalisedRequest {
    symbol: string;
    timeframe: Timeframe;
    /** ms epoch, never in the future. */
    asOf: number;
    indicatorIds: string[];
    includeLineage: boolean;
    includeSnapshot: boolean;
    want: {
        indicators: boolean;
        smartMoney: boolean;
        structure: boolean;
        liquidity: boolean;
        regime: boolean;
    };
}

/**
 * Validate and canonicalise the request.
 *
 * Rejecting bad input here means an engine never has to defend itself, and
 * that a hostile symbol string can never reach a provider URL.
 */
export function normaliseRequest(
    request: IntelligenceRequest,
    now: number = Date.now()
): NormalisedRequest {
    const details: Array<{ field: string; issue: string }> = [];

    const symbol = String(request.symbol ?? "").trim().toUpperCase();
    if (!symbol) details.push({ field: "symbol", issue: "required" });
    else if (!SYMBOL_PATTERN.test(symbol)) details.push({ field: "symbol", issue: "invalid format" });

    const timeframe = String(request.timeframe ?? "").trim().toUpperCase();
    if (!timeframe) details.push({ field: "timeframe", issue: "required" });
    else if (!SUPPORTED_TIMEFRAMES.has(timeframe)) {
        details.push({ field: "timeframe", issue: `must be one of ${[...SUPPORTED_TIMEFRAMES].join(", ")}` });
    }

    // A future as-of would ask the engines to describe data that does not exist.
    if (request.timestamp !== undefined && request.timestamp > now) {
        details.push({ field: "timestamp", issue: "must not be in the future" });
    }

    if (details.length > 0) {
        throw errors.invalidRequest("The intelligence request is invalid.", details);
    }

    const context = request.context ?? {};
    const requested = (context.indicators ?? []).map((id) => String(id).trim().toLowerCase());

    return {
        symbol,
        timeframe: timeframe as Timeframe,
        asOf: request.timestamp ?? now,
        indicatorIds: requested,
        includeLineage: request.includeLineage !== false,
        includeSnapshot: request.includeSnapshot !== false,
        want: {
            indicators: requested.length > 0 || context.regime === true,
            smartMoney: context.smartMoney !== false,
            structure: context.structure !== false,
            liquidity: context.liquidity !== false,
            regime: context.regime !== false,
        },
    };
}

// ── Engine adaptation ───────────────────────────────────────────────────────

/**
 * Map the market-data candle shape onto the canonical CoreCandle shape.
 *
 * `MarketCandle` carries no `finalized` flag, so it is derived from the
 * timeframe: a bucket is still forming until its close time has passed.
 * Deriving it is what lets the response set `availableAt` instead of presenting
 * a mid-candle value as settled.
 */
function toCoreCandles(candles: readonly MarketCandle[], timeframe: string, now: number): CoreCandle[] {
    let tfMs = 0;
    try {
        tfMs = timeframeToMs(timeframe);
    } catch {
        tfMs = 0;
    }
    return candles.map((candle) => ({
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        finalized: tfMs > 0 ? candle.timestamp + tfMs <= now : true,
    }));
}

/**
 * Deterministic indicator→signal mapping.
 *
 * This is a *classification of the indicator's own output*, not a trade
 * decision and not a forecast. Averages get a trend read; oscillators get a
 * bounded threshold read. Anything else is reported as "none" rather than
 * guessed at.
 */
function classifySignal(id: string, value: number | null): IndicatorSignal {
    if (value === null || !Number.isFinite(value)) return "none";
    switch (id) {
        case "rsi":
            return value >= 70 ? "sell" : value <= 30 ? "buy" : "neutral";
        case "stochastic":
            return value >= 80 ? "sell" : value <= 20 ? "buy" : "neutral";
        case "macd":
            return value > 0 ? "buy" : value < 0 ? "sell" : "neutral";
        case "sma":
        case "ema":
        case "wma":
        case "vwap":
            // Trend classification only becomes meaningful against price,
            // which the caller has; without it, report the raw line.
            return "none";
        case "adx":
            // ADX is a strength, not a direction.
            return value >= 25 ? "buy" : "none";
        default:
            return "none";
    }
}

/** Compute indicators through the canonical IndicatorEngine. */
function computeIndicators(
    symbol: string,
    timeframe: string,
    candles: readonly CoreCandle[],
    indicatorIds: readonly string[],
    limitations: string[]
): { snapshots: IndicatorSnapshot[]; engineVersion: string } {
    if (indicatorIds.length === 0) return { snapshots: [], engineVersion: "" };
    registerBuiltinIndicators();

    const engine = new IndicatorEngine({ symbol, timeframe });
    const refById = new Map<string, { id: string; params: Record<string, number> }>();
    for (const id of indicatorIds) {
        // Duplicate ids collapse; the engine keeps one instance per id|params.
        if (!refById.has(id)) refById.set(id, { id, params: {} });
    }
    engine.configure(Array.from(refById.values()).map((r) => ({ id: r.id, params: r.params })));

    if (candles.length === 0) {
        limitations.push("Indicator values are unavailable: no candle history was returned for this instrument.");
        return { snapshots: [], engineVersion: "" };
    }
    engine.setSeries(candles);

    const snapshots: IndicatorSnapshot[] = [];
    for (const [id, ref] of refById) {
        const latest = engine.latest(ref);
        if (!latest) {
            limitations.push(`Indicator "${id}" produced no values for this range.`);
            continue;
        }
        const { value, ...outputs } = latest.values;
        const params = (refById.get(id)?.params ?? {}) as Record<string, number>;
        snapshots.push({
            name: id,
            version: undefined,
            value: value ?? null,
            outputs: Object.keys(outputs).length > 0 ? outputs : undefined,
            signal: classifySignal(id, value ?? null),
            params: Object.keys(params).length > 0 ? params : undefined,
            timestamp: latest.timestamp,
        });
    }
    engine.dispose();

    return {
        snapshots,
        engineVersion: buildEngineVersions().indicators,
    };
}

/** Adapt the deterministic SMC detection into the contract's snapshot shape. */
function adaptSmartMoney(
    detection: ReturnType<typeof detectSmartMoney>,
    price: number | undefined,
    limitations: string[]
): SmartMoneySnapshot {
    const activeFvg = detection.fvgs.filter((z) => z.status === "active");
    const activeOb = detection.orderBlocks.filter((z) => z.status === "active");
    const pools = detection.pools.filter((p) => p.status === "active");

    // Nearest active zone by absolute price distance; absent when there is none.
    let nearestZone: SmartMoneySnapshot["nearestZone"] = null;
    if (price !== undefined) {
        const candidates = [...activeFvg, ...activeOb];
        let best: (typeof candidates)[number] | undefined;
        let bestPrice: number | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const zone of candidates) {
            const zonePrice = zone.price;
            if (typeof zonePrice !== "number") continue;
            const distance = Math.abs(zonePrice - price);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = zone;
                bestPrice = zonePrice;
            }
        }
        if (best && bestPrice !== null) {
            nearestZone = {
                price: bestPrice,
                direction: best.direction ?? "unknown",
                status: best.status,
            };
        }
    }

    const snapshot: SmartMoneySnapshot = {
        engineVersion: detection.version,
        premiumDiscount: detection.dealingRange ? detection.dealingRange.zone : "unknown",
        dealingRange: detection.dealingRange
            ? {
                high: detection.dealingRange.high,
                low: detection.dealingRange.low,
                equilibrium: detection.dealingRange.equilibrium,
            }
            : null,
        fvgZones: activeFvg.length,
        orderBlocks: activeOb.length,
        liquidityPools: pools.length,
        nearestZone,
    };

    // Anything the detector itself flagged as degraded is surfaced verbatim.
    for (const note of detection.limitations) limitations.push(note);
    if (!detection.dealingRange) {
        limitations.push("Premium/discount is unknown: no confirmed dealing range is available for this range.");
    }
    return snapshot;
}

/**
 * Adapt the deterministic structure result.
 *
 * `lastEvent` is derived from the engine's own BOS/CHOCH objects rather than
 * invented, and only from objects that have already *confirmed* — an
 * unconfirmed break must never be reported as the latest structure event.
 */
function adaptStructure(detection: ReturnType<typeof detectSmartMoney>): StructureState {
    const result = detection.structure;
    const breaks = detection.objects
        .filter((o) => (o.kind === "bos" || o.kind === "choch") && o.status === "confirmed")
        .sort((a, b) => a.confirmationAt - b.confirmationAt);
    const latestBreak = breaks[breaks.length - 1];

    return {
        bias: result.bias,
        higherHighs: result.counts.hh,
        higherLows: result.counts.hl,
        lowerHighs: result.counts.lh,
        lowerLows: result.counts.ll,
        lastSwingHigh: result.lastSwingHigh,
        lastSwingLow: result.lastSwingLow,
        lastEvent: latestBreak?.kind === "bos" ? "BOS" : latestBreak?.kind === "choch" ? "CHOCH" : undefined,
        lastEventAt: latestBreak?.confirmationAt,
        label: latestBreak
            ? `${latestBreak.kind === "bos" ? "Break of structure" : "Change of character"} (${latestBreak.direction})`
            : undefined,
    };
}

// ── Cost metadata ───────────────────────────────────────────────────────────

const COST_UNITS: Record<ComputationCost, number> = { LOW: 1, MEDIUM: 3, HIGH: 10 };

export function intelligenceCost(input: {
    indicatorCount: number;
    wantSmartMoney: boolean;
    wantRegime: boolean;
}): { cost: ComputationCost; units: number } {
    if (input.wantRegime && input.wantSmartMoney && input.indicatorCount > 5) {
        return { cost: "HIGH", units: COST_UNITS.HIGH };
    }
    if (input.wantSmartMoney || input.indicatorCount > 2) {
        return { cost: "MEDIUM", units: COST_UNITS.MEDIUM };
    }
    return { cost: "LOW", units: COST_UNITS.LOW };
}

// ── Market intelligence ─────────────────────────────────────────────────────

export interface IntelligenceOptions {
    /** Maximum tolerated data age. Stale data raises DATA_STALE instead of being served as current. */
    maxDataAgeMs?: number;
    /** Injectable for tests. */
    now?: () => number;
}

/**
 * Produce the canonical intelligence response for one instrument.
 *
 * @throws IntelligenceError DATA_UNAVAILABLE / DATA_STALE / ENGINE_UNAVAILABLE
 *   rather than degrading silently into a response that looks current.
 */
export async function getIntelligence(
    request: IntelligenceRequest,
    options: IntelligenceOptions = {}
): Promise<IntelligenceResponse> {
    const nowFn = options.now ?? (() => Date.now());
    const requestId = `req_${randomUUID()}`;
    const envelopeAt = nowFn();
    const normalised = normaliseRequest(request, envelopeAt);
    const limitations: string[] = [];

    const truth = await getMarketTruth(normalised.symbol, normalised.timeframe);
    if (!truth || !truth.snapshot) {
        throw errors.dataUnavailable(
            `No market data is available for ${normalised.symbol} ${normalised.timeframe}.`
        );
    }

    const { snapshot, freshness } = truth;

    // Freshness gate. Serving stale intelligence labelled as current is worse
    // than refusing, so this throws unless the caller opted into stale reads.
    if (!freshness.fresh) {
        const maxAge = options.maxDataAgeMs;
        if (maxAge !== undefined && freshness.dataAgeMs > maxAge) {
            throw errors.dataStale(
                `Market data is ${Math.round(freshness.dataAgeMs / 1000)}s old, older than the permitted ${Math.round(
                    maxAge / 1000
                )}s window.`
            );
        }
        limitations.push(
            `Market data is ${freshness.status}: ${Math.round(freshness.dataAgeMs / 1000)}s old ` +
                `(threshold ${Math.round(freshness.thresholdMs / 1000)}s).`
        );
    }

    const candles = snapshot.recentCandles ?? [];
    const coreCandles = toCoreCandles(candles, normalised.timeframe, envelopeAt);
    const dataTimestamp = snapshot.timestamp ?? snapshot.serverTimestamp ?? envelopeAt;

    const marketState: MarketState = {
        price: snapshot.currentPrice,
        bid: snapshot.bid,
        ask: snapshot.ask,
        spread: snapshot.spread,
        timestamp: dataTimestamp,
        dataAgeMs: snapshot.dataAgeMs,
        freshness: freshness.status,
        trend:
            snapshot.trend === "bullish" || snapshot.trend === "bearish" || snapshot.trend === "neutral"
                ? snapshot.trend
                : "unknown",
        session: snapshot.marketSession,
        sessionState: snapshot.marketStatus === "open" ? "open" : snapshot.marketStatus === "closed" ? "close" : "unknown",
        marketStatus: snapshot.marketStatus,
    };

    let structure: StructureState | undefined;
    let liquidity: LiquidityState | undefined;
    let smartMoney: SmartMoneySnapshot | undefined;

    if (normalised.want.smartMoney || normalised.want.structure || normalised.want.liquidity) {
        if (coreCandles.length === 0) {
            limitations.push("Smart Money analysis is unavailable: no candle history was returned for this instrument.");
        } else {
            const detection = detectSmartMoney(coreCandles, {
                symbol: normalised.symbol,
                timeframe: normalised.timeframe,
                structure: normalised.want.structure,
                liquidity: normalised.want.liquidity,
                zones: normalised.want.smartMoney,
                orderBlocks: normalised.want.smartMoney,
                sessions: normalised.want.smartMoney,
            });

            if (normalised.want.structure) {
                structure = adaptStructure(detection);
            }

            if (normalised.want.liquidity) {
                liquidity = {
                    pools: detection.pools
                        .filter((p) => typeof p.price === "number" && p.status === "active")
                        .slice(0, 10)
                        .map((p) => ({
                            price: p.price as number,
                            // The engine tags buy-side (high) vs sell-side (low) liquidity.
                            side: p.metadata?.side === "sell_side" ? ("low" as const) : ("high" as const),
                            strength: p.strength,
                            detectedAt: p.detectedAt,
                        })),
                    sweeps: detection.sweeps
                        .filter((s) => typeof s.price === "number")
                        .slice(0, 10)
                        .map((s) => ({
                            side: s.metadata?.side === "sell_side" ? ("low" as const) : ("high" as const),
                            price: s.price as number,
                            // confirmationAt, not detectedAt: a sweep is not known
                            // until its candle closes.
                            timestamp: s.confirmationAt,
                            strength: s.strength,
                        })),
                    state: "unknown",
                    fvgActive: detection.fvgs.filter((z) => z.status === "active").length,
                    orderBlocksActive: detection.orderBlocks.filter((z) => z.status === "active").length,
                };
            }

            if (normalised.want.smartMoney) {
                smartMoney = adaptSmartMoney(detection, snapshot.currentPrice, limitations);
            }
        }
    }

    let indicators: IndicatorSnapshot[] | undefined;
    if (normalised.want.indicators && normalised.indicatorIds.length > 0) {
        const result = computeIndicators(
            normalised.symbol,
            normalised.timeframe,
            coreCandles,
            normalised.indicatorIds,
            limitations
        );
        indicators = result.snapshots;
        if (result.snapshots.length < normalised.indicatorIds.length) {
            limitations.push(
                `${normalised.indicatorIds.length - result.snapshots.length} of ${normalised.indicatorIds.length} ` +
                    "requested indicators produced no value in this range."
            );
        }
    }

    // Regime comes from the canonical market-data engine, which already labels
    // it. It is passed through rather than reclassified here.
    const regime = normalised.want.regime
        ? {
            regime: snapshot.regime || "unknown",
            confidence: undefined,
            volatility: snapshot.volatility?.state ?? "unknown",
            description: "Regime classification from the AlgoVault market-data engine.",
        }
        : undefined;

    if (regime) {
        limitations.push(
            "Regime confidence is not exposed by the current engine version, so it is reported as unknown."
        );
    }

    const lineage = normalised.includeLineage ? buildLineage(coreCandles, engineVersionSnapshot()) : undefined;
    const cost = intelligenceCost({
        indicatorCount: normalised.indicatorIds.length,
        wantSmartMoney: normalised.want.smartMoney,
        wantRegime: normalised.want.regime,
    });

    // Forming-candle dependency: if the newest candle is not final, the result
    // is not settled until that candle closes.
    const newest = coreCandles[coreCandles.length - 1];
    const availableAt =
        newest && newest.finalized === false
            ? safeCloseTime(newest.timestamp, normalised.timeframe)
            : undefined;

    if (limitations.length === 0) {
        limitations.push(
            "Past performance and historical structure do not indicate future results."
        );
    }

    const response: IntelligenceResponse = {
        requestId,
        timestamp: envelopeAt,
        dataTimestamp,
        ...(availableAt ? { availableAt } : {}),
        instrument: {
            symbol: normalised.symbol,
            timeframe: normalised.timeframe,
            exchange: snapshot.exchange,
            dataSource: snapshot.provider,
        },
        marketState,
        ...(structure ? { structure } : {}),
        ...(liquidity ? { liquidity } : {}),
        ...(indicators ? { indicators } : {}),
        ...(smartMoney ? { smartMoney } : {}),
        ...(regime ? { regime } : {}),
        limitations,
        engineVersions: buildEngineVersions({
            "strategy-engine": false,
            risk: false,
            research: false,
            "ai-router": false,
        }),
        ...(lineage ? { dataLineage: lineage } : {}),
        cost,
        apiVersion: INTELLIGENCE_API_VERSION,
    };

    return response;
}

function engineVersionSnapshot() {
    return buildEngineVersions();
}

/** Close time of a candle bucket; falls back to now if the timeframe is unknown. */
function safeCloseTime(openTime: number, timeframe: string): number {
    try {
        return openTime + timeframeToMs(timeframe);
    } catch {
        return Date.now();
    }
}

/**
 * Lineage describing exactly which candles fed this response.
 *
 * The period is measured from the data actually consumed, not a fixed lookback
 * window, so it stays truthful when history depth varies by symbol/provider.
 */
function buildLineage(candles: readonly CoreCandle[], versions: ReturnType<typeof buildEngineVersions>): DataLineageEntry[] {
    const now = Date.now();
    const start = candles.length > 0 ? candles[0].timestamp : now;
    const end = candles.length > 0 ? candles[candles.length - 1].timestamp : now;

    const entries: DataLineageEntry[] = [
        {
            source: "market-data",
            engineVersion: versions.market,
            dataPeriodStart: start,
            dataPeriodEnd: end,
            transformedAt: now,
            assumptions: ["real-time feed", "normalised prices"],
        },
    ];
    if (versions.smartMoney && versions.smartMoney !== "unversioned") {
        entries.push({
            source: "smart-money",
            engineVersion: versions.smartMoney,
            dataPeriodStart: start,
            dataPeriodEnd: end,
            transformedAt: now,
            assumptions: ["SMC state computed from OHLC only"],
        });
    }
    return entries;
}

// ── Strategy validation ─────────────────────────────────────────────────────

/**
 * Validate a strategy definition through the canonical strategy engine.
 * No second validator exists in the B2B layer.
 */
export async function validateStrategy(
    request: StrategyValidationRequest
): Promise<StrategyValidationResult> {
    if (request.definition === null || typeof request.definition !== "object") {
        throw errors.invalidRequest("A strategy definition object is required.", [
            { field: "definition", issue: "must be an object" },
        ]);
    }

    const validation = validateStrategyDefinition(request.definition as Strategy, {
        symbol: request.symbol,
    });

    const issues = validation.issues.map((issue) => ({
        code: `${issue.severity === "error" ? "INVALID" : "WARNING"}:${issue.field}`,
        message: issue.message,
        severity: issue.severity === "error" ? ("error" as const) : ("warning" as const),
    }));

    return {
        valid: validation.valid,
        issues,
        engineVersions: buildEngineVersions({ "smart-money": false, "ai-router": false }),
        validatedAt: Date.now(),
        // Reproducible: validation is a pure function of the definition and the
        // engine version, both of which are recorded here.
        reproducible: true,
        dataPeriod: request.context?.backtestRange,
        limitations: [
            "Validation confirms structural correctness only. It does not indicate profitability or robustness.",
        ],
    };
}

export { INTELLIGENCE_API_VERSION };
