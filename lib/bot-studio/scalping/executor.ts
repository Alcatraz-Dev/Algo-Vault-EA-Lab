import type { BotDeployment, BotSignal, BotExecution } from "@/lib/bot-studio/types";
import type { XauUsdScalpingConfig } from "./config";
import { pipsToPrice, deriveLevels } from "./config";

export type XauUsdScalpingOrderPayload = {
    ticket: string;
    symbol: "XAUUSD";
    type: "BUY" | "SELL";
    volume: number;
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    magic: number;
    config: XauUsdScalpingConfig;
};

/**
 * Build the order payload for a scalping entry.
 *
 * The unified trading service accepts ONE order per call. We implement the
 * dual-TP pattern as:
 *  1. Open the position with TP1 attached.
 *  2. After TP1 fills, the runtime re-enters the remainder (or moves SL to
 *     breakeven + trail) and attaches TP2.
 *
 * For the MVP we model this as a single "entry + TP1" order; TP2 is attached
 * by the runtime after partial close. The executor returns the full level set
 * so the runtime can reason about TP2 without issuing a second provider call.
 */
export function buildScalpingEntry(
    direction: "long" | "short",
    tick: { bid: number; ask: number; spreadPoints: number },
    config: XauUsdScalpingConfig,
    defaultLot?: number,
): XauUsdScalpingOrderPayload | null {
    if (!config.enabled) return null;
    if (tick.spreadPoints > config.maxSpreadPoints) return null;

    const entry = direction === "long" ? tick.ask : tick.bid;
    const { tp1, tp2, sl } = deriveLevels(
        entry,
        config.tp1Pips,
        config.tp2Pips,
        config.slPips,
        direction,
    );

    const volume = defaultLot ?? 0.01;

    return {
        ticket: `SCALP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        symbol: "XAUUSD",
        type: direction === "long" ? "BUY" : "SELL",
        volume,
        entry,
        sl,
        tp1,
        tp2,
        magic: config.magicNumber,
        config,
    };
}

/**
 * Convert an order payload into a BotSignal (what the runtime records before
 * the unified service attempts the execution).
 */
export function signalFromOrder(payload: XauUsdScalpingOrderPayload): BotSignal {
    return {
        id: payload.ticket,
        botId: "",
        strategyId: "",
        symbol: payload.symbol,
        direction: payload.type === "BUY" ? "BUY" : "SELL",
        barTimestamp: Date.now(),
        generatedAt: Date.now(),
        outcome: "pending",
        proposedEntry: payload.entry,
        proposedSl: payload.sl,
        proposedTp: payload.tp1,
        proposedRiskPct: payload.config.riskPercent,
    };
}

/**
 * Convert a BotExecution (filled by the unified service) into a runtime-visible
 * trade record with the dual-TP levels attached.
 */
export function executionFromFill(
    signal: BotSignal,
    exec: BotExecution,
): {
    signal: BotSignal;
    execution: BotExecution;
    tp1: number;
    tp2: number;
    sl: number;
    remainingVolume: number;
} {
    const tp1 = signal.proposedTp ?? 0;
    const tp2 = 0; // TP2 is not part of the canonical BotSignal — set by the runtime after TP1 fill.
    const sl = signal.proposedSl ?? 0;
    const originalVolume = signal.proposedEntry ? signal.proposedEntry : 0;
    const filledVolume = exec.fillVolume ?? 0;
    const remainingVolume = Math.max(0, originalVolume - filledVolume);

    return {
        signal,
        execution: exec,
        tp1,
        tp2,
        sl,
        remainingVolume,
    };
}
