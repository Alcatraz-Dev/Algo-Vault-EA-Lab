import type { BotStrategy, StrategySource } from "@/lib/bot-studio/types";
import type { Strategy } from "@/lib/strategy-lab/types";
import { XAUUSD_SCALPING_DEFAULTS } from "./config";
import type { XauUsdScalpingConfig } from "./config";

export type { XauUsdScalpingConfig } from "./config";

/**
 * Pre-built XAUUSD M1 scalping strategy — a canonical `BotStrategy` that can
 * be saved as a Bot Studio strategy and deployed like any other bot.
 *
 * This is the "gold scalper" ready-made bot: M1 timeframe, dual TP (TP1/TP2)
 * with partial close after TP1, hard SL, spread filter, and configurable magic
 * number so multiple instances can coexist on one account.
 */
export function createXauUsdScalpingStrategy(
    ownerId: string,
    opts: { name?: string; description?: string } & Partial<XauUsdScalpingConfig> = {},
): { strategy: BotStrategy; config: XauUsdScalpingConfig } {
    const config: XauUsdScalpingConfig = {
        ...XAUUSD_SCALPING_DEFAULTS,
        ...opts,
    };
    const name = opts.name ?? `XAUUSD M1 Scalper ${config.direction === "long" ? "Long" : "Short"}`;
    const description =
        opts.description ??
        `M1 scalping bot for XAUUSD with dual take-profit (TP1 ${config.tp1Pips}p / TP2 ${config.tp2Pips}p), SL ${config.slPips}p, spread filter ≤${config.maxSpreadPoints}pts, magic ${config.magicNumber}.`;

    const strategy: BotStrategy = {
        id: "",
        name,
        description,
        authorId: ownerId,
        state: "draft",
        validationErrors: [],
        validationWarnings: [],
        source: {
            kind: "imported" as const,
            originalFormat: "xauusd-scalping-v1",
        } as StrategySource,
        definition: {
            id: "",
            name,
            symbol: "XAUUSD",
            timeframe: "M1",
            direction: config.direction as "long" | "short",
            entryRules: [
                {
                    id: "scalp-entry",
                    type: "xauusd_scalping",
                    timeframe: "M1",
                    source: "xauusd-scalping",
                    enabled: config.enabled,
                    config: {
                        tp1Pips: config.tp1Pips,
                        tp2Pips: config.tp2Pips,
                        slPips: config.slPips,
                        riskPercent: config.riskPercent,
                        maxSpreadPoints: config.maxSpreadPoints,
                        warmUpCandles: config.warmUpCandles,
                        magicNumber: config.magicNumber,
                    },
                },
            ],
            exitRules: [
                {
                    id: "scalp-sl",
                    type: "stop_loss",
                    timeframe: "M1",
                    source: "hard_sl",
                    enabled: true,
                    config: {
                        slPips: config.slPips,
                    },
                },
                {
                    id: "scalp-tp1",
                    type: "take_profit",
                    timeframe: "M1",
                    source: "tp1",
                    enabled: true,
                    config: {
                        tpPips: config.tp1Pips,
                        partialClosePct: 50,
                    },
                },
                {
                    id: "scalp-tp2",
                    type: "take_profit",
                    timeframe: "M1",
                    source: "tp2",
                    enabled: true,
                    config: {
                        tpPips: config.tp2Pips,
                        partialClosePct: 100,
                    },
                },
            ],
            risk: {
                riskPercent: config.riskPercent,
                maxPositions: config.maxPositions,
                stopLoss: {
                    type: "pip",
                    value: config.slPips,
                },
                takeProfit: {
                    type: "dual_tp",
                    levels: [
                        { pips: config.tp1Pips, partialPct: 50 },
                        { pips: config.tp2Pips, partialPct: 100 },
                    ],
                },
                maxSpreadPoints: config.maxSpreadPoints,
            },
            execution: {
                defaultLot: 0.01,
                slippagePips: 5,
                magicNumber: config.magicNumber,
            },
        } as unknown as Strategy,
        fingerprint: "xauusd-scalping-v1",
        magicNumber: config.magicNumber,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };

    return { strategy, config };
}

