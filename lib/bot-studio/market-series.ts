/**
 * Bot Studio — market series resolution for live evaluation.
 *
 * The bot engine's PRIMARY series is `strategy.timeframes.setup` (identical to
 * the Strategy Lab backtest loop). Rules that name their own `timeframe` are
 * resolved by timestamp at-or-before the signal bar, so those series must be
 * supplied too or the rule silently falls back to primary features and the
 * live decision diverges from the backtest.
 *
 * Server-side only: candles are always fetched from the platform market-data
 * layer. A request body can never supply them — strategy signals (and the
 * prices they propose to the gate) must not be client-authored.
 */

import { fetchCandles } from "@/lib/market-data/normalizer";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { Strategy } from "@/lib/strategy-lab/types";

/** Distinct non-primary timeframes referenced by enabled strategy rules. */
export function strategyRuleTimeframes(strategy: Strategy): Timeframe[] {
    const referenced = [
        ...(strategy.entryRules ?? []).filter((r) => r.enabled).map((r) => r.timeframe),
        ...(strategy.confirmationRules ?? []).filter((r) => r.enabled).map((r) => r.timeframe),
    ].filter((tf): tf is Timeframe => Boolean(tf));

    return [...new Set(referenced)].filter((tf) => tf !== strategy.timeframes.setup);
}

export interface BotStrategySeries {
    /** Primary timeframe = `strategy.timeframes.setup`. */
    timeframe: Timeframe;
    /** Primary candles (the canonical evaluation series). */
    candles: MarketCandle[];
    /** Primary + rule-resolution series, keyed by timeframe. */
    series: Partial<Record<Timeframe, MarketCandle[]>>;
}

/**
 * Load every timeframe this strategy needs, in ONE parallel round trip.
 * Timeframes with no data are omitted — never synthesized.
 */
export async function loadBotStrategySeries(
    strategy: Strategy,
    symbol: SupportedSymbol,
): Promise<BotStrategySeries> {
    const timeframe = strategy.timeframes.setup;
    const auxiliary = strategyRuleTimeframes(strategy);

    const [primaryPage, ...auxPages] = await Promise.all([
        fetchCandles(symbol, timeframe, { to: Date.now() }),
        ...auxiliary.map((tf) =>
            fetchCandles(symbol, tf, { to: Date.now() }).catch(() => [] as MarketCandle[]),
        ),
    ]);

    const series: Partial<Record<Timeframe, MarketCandle[]>> = { [timeframe]: primaryPage };
    auxiliary.forEach((tf, index) => {
        const page = auxPages[index];
        if (page?.length) series[tf] = page;
    });

    return { timeframe, candles: primaryPage, series };
}
