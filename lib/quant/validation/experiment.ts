/**
 * Reproducible experiment records.
 *
 * Every quantitative validation result the platform reports should be
 * re-derivable: the parameters, the seed, the assumptions and a fingerprint of
 * the exact input data. This module builds that record and gives it a stable
 * identity, so two runs over the same data with the same parameters produce
 * the same `experimentId`.
 */

import { roundTo, stableHash } from "../canonical";

export const QUANT_VALIDATION_VERSION = "1.0.0";

/** Assumptions every result in this layer carries. Stated, never hidden. */
export const QUANT_ASSUMPTIONS: readonly string[] = [
    "Returns are per-observation; no annualisation or compounding assumption is applied.",
    "Statistical evidence is not a guarantee of future performance.",
    "Sharpe ratios are computed on the supplied sample and inherit its regime mix.",
    "Purged CV removes overlapping labels; it cannot repair a biased or survivorship-selected dataset.",
    "PBO describes the selection process across the supplied configurations, not the market.",
    "A single passing metric never validates a strategy.",
];

export interface ExperimentParameters {
    method: "DSR" | "PBO_CSCV" | "PURGED_KFOLD" | "CPCV" | "MONTE_CARLO" | "KELLY" | "COMPOSITE";
    [key: string]: unknown;
}

export interface ExperimentRecord {
    experimentId: string;
    createdAt: number;
    method: ExperimentParameters["method"];
    parameters: Record<string, unknown>;
    assumptions: string[];
    seed: number | null;
    dataFingerprint: string;
    engineVersion: string;
    reproducible: true;
}

export interface CreateExperimentInput {
    method: ExperimentParameters["method"];
    parameters: Record<string, unknown>;
    /** Fingerprint of the exact observations used (stableHash of returns/candles). */
    dataFingerprint: string;
    seed?: number | null;
    createdAt?: number;
    assumptions?: readonly string[];
}

export function createExperimentRecord(input: CreateExperimentInput): ExperimentRecord {
    const createdAt = input.createdAt ?? Date.now();
    const seed = input.seed ?? null;
    const assumptions = [...(input.assumptions ?? QUANT_ASSUMPTIONS)];
    const identity = {
        method: input.method,
        parameters: input.parameters,
        seed,
        dataFingerprint: input.dataFingerprint,
        engineVersion: QUANT_VALIDATION_VERSION,
    };
    return {
        experimentId: `${input.method.toLowerCase()}-${stableHash(identity)}`,
        createdAt,
        method: input.method,
        parameters: input.parameters,
        assumptions,
        seed,
        dataFingerprint: input.dataFingerprint,
        engineVersion: QUANT_VALIDATION_VERSION,
        reproducible: true,
    };
}

/**
 * Composite verdict rules. Deliberately conservative: DSR/PBO never *certify*
 * a strategy, they only refuse to reject it. `inconclusive` is a first-class
 * outcome and the default whenever evidence is missing.
 */
export interface CompositeEvidence {
    dsr?: number | null;
    pbo?: number | null;
    /** Number of out-of-sample observations behind the DSR. */
    observations?: number | null;
    /** True when an out-of-sample period with trades exists. */
    hasOosTrades?: boolean;
}

export type CompositeVerdict = "NO_EVIDENCE" | "OVERFIT_RISK" | "INCONCLUSIVE" | "SUPPORTED";

export interface CompositeResult {
    verdict: CompositeVerdict;
    reasons: string[];
    /** Explicitly never "validated" or "profitable". */
    label: "statistically supported" | "inconclusive" | "overfitting risk" | "no evidence";
}

export function composeVerdict(evidence: CompositeEvidence): CompositeResult {
    const reasons: string[] = [];
    const { dsr, pbo } = evidence;

    if (!evidence.hasOosTrades) {
        reasons.push("No out-of-sample trades were produced — there is nothing to validate.");
    }
    if (dsr === null || dsr === undefined) {
        reasons.push("Deflated Sharpe Ratio is unavailable (missing trials or degenerate returns).");
    }
    if (pbo === null || pbo === undefined) {
        reasons.push("Probability of Backtest Overfitting is unavailable (single configuration or insufficient data).");
    }

    if (!evidence.hasOosTrades || (dsr === null || dsr === undefined) && (pbo === null || pbo === undefined)) {
        return { verdict: "NO_EVIDENCE", reasons, label: "no evidence" };
    }

    if ((pbo !== null && pbo !== undefined && pbo > 0.5) || (dsr !== null && dsr !== undefined && dsr < 0.5)) {
        if (pbo !== null && pbo !== undefined && pbo > 0.5) {
            reasons.push(`PBO ${roundTo(pbo, 3)} indicates selection worse than chance out of sample.`);
        }
        if (dsr !== null && dsr !== undefined && dsr < 0.5) {
            reasons.push(`DSR ${roundTo(dsr, 3)} is consistent with a selection artefact.`);
        }
        return { verdict: "OVERFIT_RISK", reasons, label: "overfitting risk" };
    }

    if (dsr !== null && dsr !== undefined && dsr >= 0.95 && (pbo === null || pbo === undefined || pbo <= 0.2)) {
        reasons.push(`DSR ${roundTo(dsr, 3)} survives the multiple-testing adjustment${pbo !== null && pbo !== undefined ? ` and PBO ${roundTo(pbo, 3)} is low` : ""}.`);
        return { verdict: "SUPPORTED", reasons, label: "statistically supported" };
    }

    reasons.push("Evidence does not clear the conservative support threshold.");
    return { verdict: "INCONCLUSIVE", reasons, label: "inconclusive" };
}
