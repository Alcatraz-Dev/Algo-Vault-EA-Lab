/**
 * AlgoVault — broker volume constraints for bot configuration.
 *
 * The MT5 gateway snapshot does not currently report per-symbol volume
 * constraints. This module never invents them: when min/step are absent the
 * spec is reported UNAVAILABLE and the UI must disable lot calculations.
 *
 * Final order volume is still computed and validated server-side by the
 * canonical risk engine at execution time — this is only the preview/limits
 * surface the configuration UI is allowed to show.
 */

export interface BrokerSizingSpec {
    /** True only when the account record actually reports usable constraints. */
    available: boolean;
    /** Why the spec is unavailable; empty when available. */
    reason: string;
    minVolume: number | null;
    maxVolume: number | null;
    volumeStep: number | null;
    contractSize: number | null;
    tickValue: number | null;
    /** Account currency, when reported. Never defaulted to USD. */
    currency: string | null;
}

function positive(value: unknown): number | null {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Project a persisted account record onto its volume constraints.
 *
 * A usable spec requires a positive minimum volume AND a positive step; a
 * maximum is optional but must not be below the minimum.
 */
export function resolveBrokerSizingSpec(
    accountRecord: Record<string, unknown> | null | undefined,
): BrokerSizingSpec {
    const record = accountRecord ?? {};
    const minVolume = positive(record.minLot) ?? positive(record.volumeMin);
    const maxVolume = positive(record.maxLot) ?? positive(record.volumeMax);
    const volumeStep = positive(record.lotStep) ?? positive(record.volumeStep);
    const currency =
        typeof record.currency === "string" && record.currency.trim() ? record.currency.trim() : null;

    if (minVolume === null) {
        return {
            available: false,
            reason:
                "The MT5 gateway has not reported this symbol's minimum volume, so lot presets and monetary risk estimates are unavailable.",
            minVolume: null,
            maxVolume,
            volumeStep,
            contractSize: positive(record.contractSize),
            tickValue: positive(record.tickValue),
            currency,
        };
    }

    if (volumeStep === null) {
        return {
            available: false,
            reason:
                "The MT5 gateway has not reported this symbol's volume step, so a valid lot size cannot be guaranteed.",
            minVolume,
            maxVolume,
            volumeStep: null,
            contractSize: positive(record.contractSize),
            tickValue: positive(record.tickValue),
            currency,
        };
    }

    if (maxVolume !== null && maxVolume < minVolume) {
        return {
            available: false,
            reason: "Reported maximum volume is below the minimum — the broker constraints are inconsistent.",
            minVolume,
            maxVolume,
            volumeStep,
            contractSize: positive(record.contractSize),
            tickValue: positive(record.tickValue),
            currency,
        };
    }

    return {
        available: true,
        reason: "",
        minVolume,
        maxVolume,
        volumeStep,
        contractSize: positive(record.contractSize),
        tickValue: positive(record.tickValue),
        currency,
    };
}

export interface VolumeCheck {
    valid: boolean;
    reason?: string;
}

/** Validate a requested lot against the reported constraints (server-side). */
export function isValidVolume(volume: number, spec: BrokerSizingSpec): VolumeCheck {
    if (!spec.available || spec.minVolume === null || spec.volumeStep === null) {
        return { valid: false, reason: "Broker volume constraints are unavailable." };
    }
    if (!Number.isFinite(volume) || volume <= 0) {
        return { valid: false, reason: "Volume must be greater than zero." };
    }
    if (volume < spec.minVolume) {
        return { valid: false, reason: `Volume is below the broker minimum of ${spec.minVolume}.` };
    }
    if (spec.maxVolume !== null && volume > spec.maxVolume) {
        return { valid: false, reason: `Volume exceeds the broker maximum of ${spec.maxVolume}.` };
    }
    const steps = volume / spec.volumeStep;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
        return { valid: false, reason: `Volume must be a multiple of ${spec.volumeStep}.` };
    }
    return { valid: true };
}
