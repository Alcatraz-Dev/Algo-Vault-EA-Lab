/**
 * Provider-neutral volume and partial-close semantics.
 *
 * Partial close is a VOLUME operation, never a P/L operation. Closing 30% of
 * a 1.00-lot position means closing ~0.30 lots and realizing the P/L that
 * volume actually earned. It never means "take 30% of the floating profit and
 * book the rest as a loss".
 *
 * All rounding funnels through the canonical risk engine helpers so provider
 * lot-step / min-lot rules stay in exactly one place.
 */

import { normalizeVolume, type BrokerLimits } from "@/lib/risk/risk-engine";
import type { TradingSymbolSpec } from "./domain";

export interface PartialClosePlan {
    /** Lots actually to be closed at the provider. */
    closeVolume: number;
    /** Lots that remain open afterwards (0 when the close is total). */
    remainingVolume: number;
    /** Rounded, in [0, 1]. */
    appliedPercentage: number;
    /** True when rounding forced the operation to close the whole position. */
    closesFully: boolean;
    reason: string | null;
}

export class VolumeError extends Error {
    constructor(
        readonly code: "INVALID_VOLUME" | "INVALID_SYMBOL",
        message: string
    ) {
        super(message);
        this.name = "VolumeError";
    }
}

/** Rounds a requested lot to the provider's step and clamps to its bounds. */
export function roundVolume(volume: number, limits: BrokerLimits = {}): number {
    return normalizeVolume(volume, limits);
}

function stepOf(spec: TradingSymbolSpec | null): number {
    const step = spec?.volumeStep;
    return typeof step === "number" && Number.isFinite(step) && step > 0 ? step : 0.01;
}

function minOf(spec: TradingSymbolSpec | null): number {
    const min = spec?.minVolume;
    return typeof min === "number" && Number.isFinite(min) && min > 0 ? min : 0.01;
}

/**
 * Computes the close volume for a percentage partial close.
 *
 * Rounding down is deliberate: rounding a close UP could exceed the open
 * volume (MT5 rejects that), so the plan clamps to the position and, when the
 * remainder is smaller than the provider minimum, closes the position fully
 * instead of leaving an unclosable stub.
 */
export function planPartialClose(input: {
    openVolume: number;
    percentage: number;
    spec?: TradingSymbolSpec | null;
    limits?: BrokerLimits;
}): PartialClosePlan {
    const { openVolume, percentage } = input;
    const spec = input.spec ?? null;
    const limits: BrokerLimits = { ...(input.limits ?? {}) };

    if (!Number.isFinite(openVolume) || openVolume <= 0) {
        throw new VolumeError("INVALID_VOLUME", "Open position volume is unavailable.");
    }
    if (!Number.isFinite(percentage) || percentage <= 0) {
        throw new VolumeError("INVALID_VOLUME", "Partial close percentage must be greater than 0.");
    }
    if (percentage > 100) {
        throw new VolumeError("INVALID_VOLUME", "Partial close percentage cannot exceed 100.");
    }

    const step = stepOf(spec);
    const min = minOf(spec);
    const bounds: BrokerLimits = {
        ...limits,
        minLot: min,
        ...(limits.lotStep ? {} : { lotStep: step }),
    };

    // Percentage >= 100 is a full close regardless of rounding.
    if (percentage >= 100) {
        const closeVolume = roundVolume(openVolume, bounds);
        return {
            closeVolume: Math.min(closeVolume, openVolume),
            remainingVolume: 0,
            appliedPercentage: 100,
            closesFully: true,
            reason: null,
        };
    }

    const raw = openVolume * (percentage / 100);
    // Step down, never up: closing more than is open is not a partial close.
    let closeVolume = Math.floor(raw / step + 1e-9) * step;
    closeVolume = Math.round(closeVolume * 1_000_000) / 1_000_000;

    if (closeVolume >= openVolume) {
        closeVolume = roundVolume(openVolume, bounds);
        return {
            closeVolume: Math.min(closeVolume, openVolume),
            remainingVolume: 0,
            appliedPercentage: 100,
            closesFully: true,
            reason: null,
        };
    }

    const remaining = Math.round((openVolume - closeVolume) * 1_000_000) / 1_000_000;

    // Too small to close, or too small to leave behind: settle for a full close.
    if (closeVolume < min || remaining < min) {
        const closeVolumeFull = roundVolume(openVolume, bounds);
        return {
            closeVolume: Math.min(closeVolumeFull, openVolume),
            remainingVolume: 0,
            appliedPercentage: 100,
            closesFully: true,
            reason: "Remaining volume would be below the provider minimum volume.",
        };
    }

    return {
        closeVolume,
        remainingVolume: remaining,
        appliedPercentage: Math.round((closeVolume / openVolume) * 100 * 100) / 100,
        closesFully: false,
        reason: null,
    };
}

/**
 * Splits a position's floating P/L by volume.
 *
 * Used only for *reporting* the expected realized portion of a partial close
 * (order ticket label, UI preview). The provider remains the source of truth
 * for what was actually realized — this never books a trade.
 */
export function proportionalProfit(openProfit: number, openVolume: number, closeVolume: number): number {
    if (!Number.isFinite(openProfit) || !Number.isFinite(openVolume) || openVolume <= 0) return 0;
    return (openProfit * closeVolume) / openVolume;
}