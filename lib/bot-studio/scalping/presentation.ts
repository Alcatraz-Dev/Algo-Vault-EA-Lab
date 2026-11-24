/**
 * Pure presentation helpers for the bot UI (client-safe).
 *
 * These decide labels and availability only — they never compute trading
 * values. Keeping them pure lets the terminal render the same honest states
 * the server persists, and lets the rules be tested without a browser.
 */

import {
    describePositionMode,
    supportsIndependentOpposingPositions,
    type TradingPositionMode,
} from "@/lib/trading/position-mode";
import type { BrokerSizingSpec } from "./broker-sizing";
import type { ScalpingDirectionMode } from "./profiles";

export type LaneDisplayStatus =
    | "POSITION_OPEN"
    | "SIGNAL_READY"
    | "WAITING"
    | "BLOCKED"
    | "NOT_EVALUATED";

export type LaneSide = "long" | "short";

/** Whether the configured direction lets this lane trade at all. */
export function directionAllows(direction: ScalpingDirectionMode | null | undefined, side: LaneSide): boolean {
    switch (direction) {
        case "long_only":
            return side === "long";
        case "short_only":
            return side === "short";
        case "both":
            return true;
        default:
            // Unknown configuration is not permission to claim the lane is on.
            return false;
    }
}

export function laneStatusLabel(status: LaneDisplayStatus): string {
    switch (status) {
        case "POSITION_OPEN":
            return "Position open";
        case "SIGNAL_READY":
            return "Signal ready";
        case "BLOCKED":
            return "Blocked";
        case "NOT_EVALUATED":
            return "Disabled";
        default:
            return "Waiting for signal";
    }
}

/**
 * Account-mode summary for the UI. `restriction` is the sentence that must be
 * shown next to the lane toggles on that account.
 */
export function positionModeSummary(mode: TradingPositionMode): {
    label: string;
    canHedge: boolean;
    restriction: string;
} {
    const canHedge = supportsIndependentOpposingPositions(mode);
    return {
        label:
            mode === "HEDGING"
                ? "Hedging account"
                : mode === "NETTING"
                  ? "Netting account"
                  : mode === "EXCHANGE"
                    ? "Exchange account"
                    : "Position mode unknown",
        canHedge,
        restriction: describePositionMode(mode),
    };
}

/** Volume shown with the precision implied by the broker step (never padded beyond it). */
export function formatVolume(volume: number | null | undefined, step: number | null | undefined): string {
    if (volume === null || volume === undefined || !Number.isFinite(volume)) return "unavailable";
    const decimals =
        step && Number.isFinite(step) && step > 0
            ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
            : 2;
    return volume.toFixed(decimals);
}

export interface VolumeInputCheck {
    ok: boolean;
    value?: number;
    reason?: string;
}

/**
 * UI-level check for a typed lot. The server remains authoritative; this only
 * prevents an obviously invalid value from being presented as usable.
 */
export function checkVolumeInput(raw: string, spec: BrokerSizingSpec): VolumeInputCheck {
    if (!spec.available) {
        return { ok: false, reason: spec.reason };
    }
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, reason: "Enter a lot size." };
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return { ok: false, reason: "Lot size must be a number." };
    if (value <= 0) return { ok: false, reason: "Lot size must be greater than zero." };
    if (spec.minVolume !== null && value < spec.minVolume) {
        return { ok: false, reason: `Minimum is ${spec.minVolume} lots.` };
    }
    if (spec.maxVolume !== null && value > spec.maxVolume) {
        return { ok: false, reason: `Maximum is ${spec.maxVolume} lots.` };
    }
    if (spec.volumeStep !== null) {
        const steps = value / spec.volumeStep;
        if (Math.abs(steps - Math.round(steps)) > 1e-6) {
            return { ok: false, reason: `Volume must be a multiple of ${spec.volumeStep}.` };
        }
    }
    return { ok: true, value };
}
