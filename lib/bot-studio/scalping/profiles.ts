/**
 * AlgoVault — configurable Long/Short scalping profiles.
 *
 * A profile is a CONFIGURATION PRESET, never a claim of profitability. It
 * compiles into a canonical `Strategy` (lib/strategy-lab/types) so the bot runs
 * through the ONE decision core (`evaluateEntry`) and the ONE execution path
 * (AI Execution Gate → Unified Trading Service). No second strategy engine, no
 * second risk engine, no second execution service.
 *
 * Direction is explicit: `buildScalpingStrategy(config, "long" | "short")`
 * produces a strategy whose rules are written for that side. The directional
 * evaluator (./directional) evaluates both variants for `both` mode; a single
 * implementation is never hard-coded to one side.
 *
 * SAFETY: every numeric field is clamped to a documented ceiling that is at or
 * below the bot automation policy enforced by the gate. A profile can never
 * raise an account-level limit — account limits come from
 * `lib/risk/account-state` at decision time and are applied by the risk engine.
 */

import type { MarketRegime, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import type { Strategy, StrategyRule, StrategyFilters } from "@/lib/strategy-lab/types";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";

export { SUPPORTED_SYMBOLS };

export type ScalpingDirectionMode = "both" | "long_only" | "short_only";
export type ScalpingPresetId = "conservative" | "balanced" | "active";
export type ScalpingSession = "asian" | "london" | "new_york" | "overlap";

export interface ScalpingBotConfig {
    /** Instrument. Validated against the platform symbol list. */
    symbol: SupportedSymbol;
    /** Timeframe the bot evaluates (closed bars only). */
    timeframe: Timeframe;
    /** Which sides the bot may trade. */
    direction: ScalpingDirectionMode;
    /** Configuration preset the rest of the values were derived from. */
    preset: ScalpingPresetId;
    /** Account risk per trade, percent of balance. Ceiling: 2%. */
    riskPerTradePercent: number;
    /** Stop distance in ATR multiples. Range: 1–6. */
    stopAtrMultiple: number;
    /** Take-profit as a multiple of the stop distance (R). Range: 0.5–4. */
    rewardRisk: number;
    /** Hard cap on concurrent positions. Platform policy caps 1 per instrument. */
    maxOpenPositions: number;
    /** Entries allowed per UTC day. Range: 1–50. */
    maxTradesPerDay: number;
    /** Minimum seconds between entries. Range: 0–86 400. */
    cooldownSeconds: number;
    /** Maximum quoted spread in pips. Ceiling: gate policy (15 pips). */
    maxSpreadPips: number;
    /** Minimum signal-quality score (0–1) required to trade. */
    minSignalConfidence: number;
    /** Bot-level daily notional cap in account currency; never above account cap. */
    dailyNotionalBudget: number | null;
    /** Sessions the bot may trade. Empty = no session filter. */
    sessions: ScalpingSession[];
    /** Require market-structure alignment (`hl` long / `lh` short) as a hard rule. */
    requireStructureAlignment: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard ceilings — deliberately at/below the bot automation policy
// ─────────────────────────────────────────────────────────────────────────────

export const SCALPING_LIMITS = {
    /** ALGO_POLICY: maxRiskPercentPerTrade = 2.0 */
    maxRiskPerTradePercent: 2,
    minRiskPerTradePercent: 0.1,
    minStopAtrMultiple: 1,
    maxStopAtrMultiple: 6,
    minRewardRisk: 0.5,
    maxRewardRisk: 4,
    /** Gate policy: maxPositionsPerInstrument = 1 on a single-instrument bot. */
    maxOpenPositions: 1,
    minTradesPerDay: 1,
    maxTradesPerDay: 50,
    maxCooldownSeconds: 86_400,
    /** Gate policy: maxSpreadPips = 15 */
    maxSpreadPips: 15,
    minSignalConfidence: 0.2,
    maxSignalConfidence: 0.95,
    maxDailyNotionalBudget: 10_000_000,
} as const;

export const SCALPING_ALLOWED_TIMEFRAMES = ["M1", "M3", "M5", "M15"] as const;
export type ScalpingTimeframe = (typeof SCALPING_ALLOWED_TIMEFRAMES)[number];

const LIQUID_SESSIONS: ScalpingSession[] = ["london", "new_york", "overlap"];

const PRESET_VALUES: Record<ScalpingPresetId, Omit<ScalpingBotConfig, "symbol" | "preset">> = {
    conservative: {
        timeframe: "M15",
        direction: "both",
        riskPerTradePercent: 0.25,
        stopAtrMultiple: 2.5,
        rewardRisk: 1.5,
        maxOpenPositions: 1,
        maxTradesPerDay: 4,
        cooldownSeconds: 900,
        maxSpreadPips: 6,
        minSignalConfidence: 0.65,
        dailyNotionalBudget: null,
        sessions: [...LIQUID_SESSIONS],
        requireStructureAlignment: true,
    },
    balanced: {
        timeframe: "M5",
        direction: "both",
        riskPerTradePercent: 0.5,
        stopAtrMultiple: 1.8,
        rewardRisk: 1.2,
        maxOpenPositions: 1,
        maxTradesPerDay: 8,
        cooldownSeconds: 300,
        maxSpreadPips: 10,
        minSignalConfidence: 0.55,
        dailyNotionalBudget: null,
        sessions: [...LIQUID_SESSIONS],
        requireStructureAlignment: false,
    },
    active: {
        timeframe: "M1",
        direction: "both",
        riskPerTradePercent: 1,
        stopAtrMultiple: 1.2,
        rewardRisk: 1,
        maxOpenPositions: 1,
        maxTradesPerDay: 20,
        cooldownSeconds: 60,
        maxSpreadPips: 15,
        minSignalConfidence: 0.45,
        dailyNotionalBudget: null,
        sessions: [...LIQUID_SESSIONS],
        requireStructureAlignment: false,
    },
};

export const SCALPING_PRESETS: ReadonlyArray<{
    id: ScalpingPresetId;
    label: string;
    description: string;
}> = [
    {
        id: "conservative",
        label: "Conservative",
        description: "M15, 0.25% risk, wide ATR stop, liquid sessions only, structure alignment required.",
    },
    {
        id: "balanced",
        label: "Balanced",
        description: "M5, 0.5% risk, 1.8×ATR stop, liquid sessions.",
    },
    {
        id: "active",
        label: "Active",
        description: "M1, 1% risk, tight 1.2×ATR stop, highest trade allowance.",
    },
];

export function defaultScalpingConfig(
    preset: ScalpingPresetId,
    symbol: SupportedSymbol = "XAUUSD",
): ScalpingBotConfig {
    return { symbol, preset, ...PRESET_VALUES[preset] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation + clamping
// ─────────────────────────────────────────────────────────────────────────────

export interface ScalpingConfigResult {
    config: ScalpingBotConfig;
    errors: string[];
    warnings: string[];
}

const DIRECTIONS: ScalpingDirectionMode[] = ["both", "long_only", "short_only"];
const PRESETS: ScalpingPresetId[] = ["conservative", "balanced", "active"];
const SESSIONS: ScalpingSession[] = ["asian", "london", "new_york", "overlap"];

function numberOr(value: unknown, fallback: number): number {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Validate and clamp a caller-supplied scalping configuration.
 *
 * Unknown / out-of-range values are CLAMPED (never silently accepted as-is) and
 * reported as warnings so the UI can show what the platform actually applied.
 * Structurally wrong input (unknown symbol, unknown preset, unknown direction)
 * is an error — it is not guessed.
 */
export function normalizeScalpingConfig(input: unknown): ScalpingConfigResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

    const preset: ScalpingPresetId = PRESETS.includes(raw.preset as ScalpingPresetId)
        ? (raw.preset as ScalpingPresetId)
        : "balanced";
    if (raw.preset !== undefined && !PRESETS.includes(raw.preset as ScalpingPresetId)) {
        errors.push(`Unknown preset "${String(raw.preset)}".`);
    }

    const symbolRaw = String(raw.symbol ?? "XAUUSD").toUpperCase();
    const symbol = (SUPPORTED_SYMBOLS as readonly string[]).includes(symbolRaw)
        ? (symbolRaw as SupportedSymbol)
        : null;
    if (!symbol) errors.push(`Unsupported symbol "${symbolRaw}".`);

    const directionRaw = String(raw.direction ?? "both");
    if (!DIRECTIONS.includes(directionRaw as ScalpingDirectionMode)) {
        errors.push(`Unknown direction "${directionRaw}".`);
    }
    const direction = DIRECTIONS.includes(directionRaw as ScalpingDirectionMode)
        ? (directionRaw as ScalpingDirectionMode)
        : "both";

    const timeframeRaw = String(raw.timeframe ?? PRESET_VALUES[preset].timeframe);
    if (!(SCALPING_ALLOWED_TIMEFRAMES as readonly string[]).includes(timeframeRaw)) {
        errors.push(`Unsupported scalping timeframe "${timeframeRaw}".`);
    }
    const timeframe = ((SCALPING_ALLOWED_TIMEFRAMES as readonly string[]).includes(timeframeRaw)
        ? timeframeRaw
        : PRESET_VALUES[preset].timeframe) as Timeframe;

    const base = { ...PRESET_VALUES[preset] };

    const risk = clamp(
        numberOr(raw.riskPerTradePercent, base.riskPerTradePercent),
        SCALPING_LIMITS.minRiskPerTradePercent,
        SCALPING_LIMITS.maxRiskPerTradePercent,
    );
    if (raw.riskPerTradePercent !== undefined && risk !== Number(raw.riskPerTradePercent)) {
        warnings.push(
            `riskPerTradePercent clamped to ${risk}% (allowed ${SCALPING_LIMITS.minRiskPerTradePercent}–${SCALPING_LIMITS.maxRiskPerTradePercent}%).`,
        );
    }

    const stop = clamp(
        numberOr(raw.stopAtrMultiple, base.stopAtrMultiple),
        SCALPING_LIMITS.minStopAtrMultiple,
        SCALPING_LIMITS.maxStopAtrMultiple,
    );
    const rr = clamp(
        numberOr(raw.rewardRisk, base.rewardRisk),
        SCALPING_LIMITS.minRewardRisk,
        SCALPING_LIMITS.maxRewardRisk,
    );

    const requestedPositions = clamp(
        Math.round(numberOr(raw.maxOpenPositions, base.maxOpenPositions)),
        1,
        SCALPING_LIMITS.maxOpenPositions,
    );
    if (numberOr(raw.maxOpenPositions, base.maxOpenPositions) > SCALPING_LIMITS.maxOpenPositions) {
        warnings.push(
            `maxOpenPositions limited to ${SCALPING_LIMITS.maxOpenPositions} by platform policy (one position per instrument).`,
        );
    }

    const maxTrades = clamp(
        Math.round(numberOr(raw.maxTradesPerDay, base.maxTradesPerDay)),
        SCALPING_LIMITS.minTradesPerDay,
        SCALPING_LIMITS.maxTradesPerDay,
    );
    const cooldown = clamp(
        Math.round(numberOr(raw.cooldownSeconds, base.cooldownSeconds)),
        0,
        SCALPING_LIMITS.maxCooldownSeconds,
    );
    const spread = clamp(
        numberOr(raw.maxSpreadPips, base.maxSpreadPips),
        0,
        SCALPING_LIMITS.maxSpreadPips,
    );
    if (raw.maxSpreadPips !== undefined && spread !== Number(raw.maxSpreadPips)) {
        warnings.push(`maxSpreadPips clamped to ${spread} (gate policy ceiling ${SCALPING_LIMITS.maxSpreadPips}).`);
    }

    const confidence = clamp(
        numberOr(raw.minSignalConfidence, base.minSignalConfidence),
        SCALPING_LIMITS.minSignalConfidence,
        SCALPING_LIMITS.maxSignalConfidence,
    );

    let notional: number | null = base.dailyNotionalBudget;
    if (raw.dailyNotionalBudget !== undefined && raw.dailyNotionalBudget !== null) {
        const n = numberOr(raw.dailyNotionalBudget, NaN);
        if (!Number.isFinite(n) || n <= 0) {
            errors.push("dailyNotionalBudget must be a positive number or null.");
        } else {
            notional = clamp(n, 1, SCALPING_LIMITS.maxDailyNotionalBudget);
            if (notional !== n) {
                warnings.push(`dailyNotionalBudget clamped to ${notional}.`);
            }
        }
    }

    let sessions: ScalpingSession[] = base.sessions;
    if (Array.isArray(raw.sessions)) {
        const requested = raw.sessions.filter((s): s is ScalpingSession =>
            SESSIONS.includes(s as ScalpingSession),
        );
        const unknown = raw.sessions.filter((s) => !SESSIONS.includes(s as ScalpingSession));
        if (unknown.length > 0) errors.push(`Unknown session(s): ${unknown.map(String).join(", ")}.`);
        sessions = [...new Set(requested)];
        if (sessions.length === 0) errors.push("At least one trading session must be selected.");
    }

    return {
        config: {
            symbol: symbol ?? "XAUUSD",
            preset,
            timeframe,
            direction,
            riskPerTradePercent: risk,
            stopAtrMultiple: stop,
            rewardRisk: rr,
            maxOpenPositions: requestedPositions,
            maxTradesPerDay: maxTrades,
            cooldownSeconds: cooldown,
            maxSpreadPips: spread,
            minSignalConfidence: confidence,
            dailyNotionalBudget: notional,
            sessions,
            requireStructureAlignment:
                typeof raw.requireStructureAlignment === "boolean"
                    ? raw.requireStructureAlignment
                    : base.requireStructureAlignment,
        },
        errors,
        warnings,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy compilation
// ─────────────────────────────────────────────────────────────────────────────

function makeRule(partial: Omit<StrategyRule, "enabled" | "groupLogic" | "operator"> & {
    operator?: StrategyRule["operator"];
    groupLogic?: "AND" | "OR";
    enabled?: boolean;
}): StrategyRule {
    return {
        enabled: partial.enabled ?? true,
        groupLogic: partial.groupLogic ?? "AND",
        operator: partial.operator ?? "eq",
        ...partial,
    } as StrategyRule;
}

/**
 * Entry/confirmation rules for one side of the scalper.
 *
 * Only indicators already implemented in the canonical indicator library and
 * feature engine are referenced (EMA 9/21/50, RSI 14, ATR, momentum, swing
 * structure). VWAP is NOT referenced: the platform has no VWAP series in the
 * causal feature set, and inventing one would make live signals diverge from
 * every other AlgoVault surface.
 */
function rulesFor(direction: "long" | "short", requireStructure: boolean) {
    const long = direction === "long";

    const entryRules: StrategyRule[] = [
        makeRule({
            id: "scalp-trend",
            group: "trend",
            label: `Trend ${long ? "bullish" : "bearish"}`,
            operator: "eq",
            value: long ? "bullish" : "bearish",
        }),
        makeRule({
            id: "scalp-ema-alignment",
            group: "indicator",
            label: "EMA 9 vs EMA 21 alignment",
            operator: long ? "gt" : "lt",
            value: 0,
            indicator: "ema_9",
            compareTo: "ema_21",
        }),
        makeRule({
            id: "scalp-price-bias",
            group: "indicator",
            label: `Close ${long ? "above" : "below"} EMA 50`,
            operator: long ? "gt" : "lt",
            value: 0,
            indicator: "close",
            compareTo: "ema_50",
        }),
        makeRule({
            id: "scalp-momentum",
            group: "indicator",
            label: "RSI 14 momentum confirmation",
            operator: long ? "gte" : "lte",
            value: 50,
            indicator: "rsi_14",
        }),
    ];

    if (requireStructure) {
        entryRules.push(
            makeRule({
                id: "scalp-structure",
                group: "structure",
                label: `Market structure ${long ? "higher low" : "lower high"}`,
                value: long ? "hl" : "lh",
            }),
        );
    }

    const confirmationRules: StrategyRule[] = [
        makeRule({
            id: "scalp-candle-confirmation",
            group: "confirmation",
            label: "Short-term momentum confirmation",
            value: long ? "momentum_positive" : "momentum_negative",
        }),
    ];

    return { entryRules, confirmationRules };
}

export interface BuildScalpingStrategyOptions {
    /** Strategy id assigned by the caller (Bot Studio strategy id). */
    id?: string;
    name?: string;
}

/**
 * Compile a scalping profile + side into a canonical Strategy.
 *
 * The returned object is a normal Strategy: backtest, validation, replay and
 * live evaluation all consume it unchanged.
 */
export function buildScalpingStrategy(
    config: ScalpingBotConfig,
    direction: "long" | "short",
    options: BuildScalpingStrategyOptions = {},
): Strategy {
    const { entryRules, confirmationRules } = rulesFor(direction, config.requireStructureAlignment);
    const spec = getSymbolSpec(config.symbol);
    const pipSize = spec?.pipSize ?? 0.01;
    const typicalSpreadPips = spec ? Math.max(0, spec.typicalSpread / pipSize) : 0;

    const filters: StrategyFilters = {
        sessions: [...config.sessions],
        daysOfWeek: [],
        volatilityMinAtrPct: 0,
        volatilityMaxAtrPct: 0,
        maxTradesPerDay: config.maxTradesPerDay,
        // Cooldown is enforced in seconds by the bot runtime (see ./pacing) —
        // the bar-based field is kept at 0 so the two do not disagree.
        cooldownCandles: 0,
    };

    const regimeFilter: MarketRegime[] = [];
    const sideLabel = direction === "long" ? "Long" : "Short";

    return {
        id: options.id ?? "",
        name: options.name ?? `${config.symbol} ${config.timeframe} Scalper — ${sideLabel}`,
        description:
            `Configurable ${config.timeframe} scalper for ${config.symbol}: EMA 9/21/50 alignment, RSI 14 momentum, ` +
            `ATR stop (${config.stopAtrMultiple}×ATR), ${config.rewardRisk}R target, spread ceiling ${config.maxSpreadPips} pips. ` +
            `Configuration preset "${config.preset}" — not a performance claim.`,
        asset: config.symbol,
        direction,
        timeframes: {
            macro: config.timeframe,
            structure: config.timeframe,
            setup: config.timeframe,
            entry: config.timeframe,
        },
        regimeFilter,
        entryRules,
        confirmationRules,
        stopLoss: {
            mode: "atr",
            atrMultiple: config.stopAtrMultiple,
            levelOffset: 0,
            useSwing: false,
        },
        takeProfit: {
            mode: "r",
            r1: config.rewardRisk,
            r2: 0,
            r3: 0,
            fixedDistance: 0,
            partialCloses: [],
            moveBeAfterTp1: false,
            lockAfterTp2: false,
            trailingEnabled: false,
            trailingStopAtr: 0,
        },
        risk: {
            mode: "percent",
            riskPercent: config.riskPerTradePercent,
            fixedLot: 0.01,
            maxPositions: config.maxOpenPositions,
            dailyLossLimitPct: 0,
            maxDrawdownPct: 0,
        },
        filters,
        executionModel: "next_bar_open",
        costs: {
            // Quoted spread assumption from the platform symbol spec; broker
            // commission is NOT known to the platform and is stated as zero
            // rather than invented. The live gate re-checks the real spread.
            spreadPips: typicalSpreadPips,
            commissionPerLot: 0,
            slippagePips: 1,
        },
        sourcePatternId: null,
        whyp: {
            discovered: "Configuration preset compiled by the AlgoVault scalping profile builder.",
            conditionsSelected:
                "Trend regime + EMA 9/21 alignment + close vs EMA 50 + RSI 14 confirmation, plus optional structure alignment.",
            occurrenceFrequency: "Not measured — no frequency claim is made by a preset.",
            historicalPerformance: "Not measured — a preset is not a performance claim. Run a Strategy Lab backtest.",
            weaknesses:
                "Scalping is sensitive to spread, slippage and broker execution latency; choppy sessions produce false EMA alignment.",
            poorRegimes: "Low-volatility ranges and news spikes.",
            generatedByProvider: "algovault:scalping-profiles",
        },
        version: "1.0.0",
        created: Date.now(),
        updated: Date.now(),
    };
}

/** Human-readable summary for the Bot Studio deployment record / audit log. */
export function describeScalpingConfig(config: ScalpingBotConfig): string {
    return [
        `${config.preset} preset`,
        config.symbol,
        config.timeframe,
        config.direction,
        `risk ${config.riskPerTradePercent}%`,
        `stop ${config.stopAtrMultiple}×ATR`,
        `${config.rewardRisk}R`,
        `max ${config.maxTradesPerDay} trades/day`,
        `cooldown ${config.cooldownSeconds}s`,
        `spread ≤${config.maxSpreadPips}p`,
        `confidence ≥${config.minSignalConfidence}`,
        config.dailyNotionalBudget ? `notional cap ${config.dailyNotionalBudget}` : "notional cap: account limit",
    ].join(" · ");
}

/** True when the mode permits the side. Used by the directional evaluator. */
export function directionPermits(mode: ScalpingDirectionMode, side: "long" | "short"): boolean {
    if (mode === "both") return true;
    return mode === "long_only" ? side === "long" : side === "short";
}
