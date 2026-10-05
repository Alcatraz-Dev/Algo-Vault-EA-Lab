/**
 * Product Analytics — safe A/B testing engine.
 *
 * Design constraints that are non-negotiable (§48):
 *  - Experiments may ONLY touch surfaces on the allowlist below.
 *  - An experiment may never touch checkout, auth, trading execution, risk
 *    controls, or legal disclaimers. `validateExperimentSafety` rejects those
 *    at creation time, not at render time.
 *  - Assignment is DETERMINISTIC (hash of userId + experimentId) so a user
 *    keeps their variant across sessions and devices without a lookup.
 *  - A winner is never declared below the minimum sample size, and lift alone
 *    is never enough — we require a two-proportion z-test.
 *
 * Pure module: no I/O.
 */

import { hash } from "./events";

export const EXPERIMENT_STATES = ["DRAFT", "RUNNING", "PAUSED", "COMPLETED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATES)[number];

export type ExperimentVariant = {
    id: string;
    label: string;
    /** e.g. { ctaLabel: "Start Research" }. Only keys the surface understands. */
    settings?: Record<string, unknown>;
};

export type Experiment = {
    id: string;
    name: string;
    hypothesis: string;
    variants: ExperimentVariant[];
    /** The event that counts as a success for this experiment. */
    metric: string;
    /** Surfaces this experiment may modify. Must be a subset of SAFE_SURFACES. */
    surfaces: string[];
    startAt: number;
    endAt?: number;
    status: ExperimentStatus;
    createdAt: number;
    updatedAt: number;
};

// ─── Safety ─────────────────────────────────────────────────────────────────

/**
 * Surfaces an experiment is allowed to modify. Everything here is cosmetic or
 * explanatory. Notably absent: checkout, auth, trading, risk, pricing totals,
 * and anything carrying a risk disclosure.
 */
export const SAFE_SURFACES = [
    "onboarding",
    "pricing-presentation",
    "feature-explanation",
    "upgrade-placement",
    "empty-state",
    "digest",
    "landing-copy",
] as const;

export type SafeSurface = (typeof SAFE_SURFACES)[number];

/**
 * Surfaces that must never be experimented on, regardless of who asks. Kept as
 * an explicit list (rather than only the allowlist) so the rejection message
 * can name the offending surface and so adding a new surface to the product
 * fails closed.
 */
export const PROTECTED_SURFACES = [
    "checkout",
    "billing",
    "auth",
    "login",
    "register",
    "password-reset",
    "trading",
    "order-execution",
    "risk-control",
    "position-sizing",
    "risk-disclosure",
    "terms",
    "privacy",
    "data-export",
] as const;

export type SafetyIssue = {
    surface: string;
    severity: "BLOCK" | "WARN";
    reason: string;
};

export type SafetyReport = {
    safe: boolean;
    issues: SafetyIssue[];
};

/**
 * Validate an experiment before it can be created or started.
 * Fails closed: unknown surfaces are a BLOCK, not a WARN.
 */
export function validateExperimentSafety(input: {
    surfaces: string[];
    variants: ExperimentVariant[];
    metric?: string;
}): SafetyReport {
    const issues: SafetyIssue[] = [];
    const safeSet = new Set<string>(SAFE_SURFACES);

    for (const surface of input.surfaces) {
        if ((PROTECTED_SURFACES as readonly string[]).includes(surface)) {
            issues.push({
                surface,
                severity: "BLOCK",
                reason: `"${surface}" is a protected surface. Experiments may never alter billing, auth, trading execution, risk controls, or legal disclosures.`,
            });
            continue;
        }
        if (!safeSet.has(surface)) {
            issues.push({
                surface,
                severity: "BLOCK",
                reason: `"${surface}" is not on the experiment allowlist. Add it to SAFE_SURFACES only after a review confirms it is cosmetic.`,
            });
        }
    }

    // A single-variant experiment cannot teach us anything.
    if (input.variants.length < 2) {
        issues.push({
            surface: "(experiment)",
            severity: "BLOCK",
            reason: "An experiment needs at least two variants to produce a comparison.",
        });
    }
    const ids = new Set(input.variants.map((v) => v.id));
    if (ids.size !== input.variants.length) {
        issues.push({ surface: "(experiment)", severity: "BLOCK", reason: "Variant ids must be unique." });
    }

    return { safe: issues.every((i) => i.severity !== "BLOCK"), issues };
}

// ─── Assignment ─────────────────────────────────────────────────────────────

/**
 * Deterministically assign a user to a variant. The same (userId, experimentId)
 * always yields the same variant, so a user never flips between variants —
 * which would corrupt the results and annoy the user.
 */
export function assignVariant(experimentId: string, userId: string, variantCount: number): string {
    if (variantCount <= 1) return "v0";
    const bucket = parseInt(hash(`${experimentId}:${userId}`).slice(0, 8), 36) % variantCount;
    return `v${bucket}`;
}

export type Assignment = {
    experimentId: string;
    variantId: string;
    assignedAt: number;
};

/** True when the experiment is currently running and accepting assignments. */
export function isExperimentActive(experiment: Experiment, now = Date.now()): boolean {
    if (experiment.status !== "RUNNING") return false;
    if (experiment.startAt > now) return false;
    if (experiment.endAt !== undefined && experiment.endAt <= now) return false;
    return true;
}

// ─── Analysis ───────────────────────────────────────────────────────────────

/** Minimum conversions per variant before a result may be called significant. */
export const MIN_SAMPLE_PER_VARIANT = 100;
/** Minimum absolute relative lift (percent) before we call it a winner. */
export const MIN_LIFT_PCT = 5;
/** p-value below which we call the difference significant. */
export const SIGNIFICANCE_LEVEL = 0.05;

export type VariantResult = {
    variantId: string;
    label: string;
    users: number;
    conversions: number;
    conversionPct: number;
};

export type ExperimentOutcome = {
    status: "INSUFFICIENT_DATA" | "NO_SIGNIFICANT_DIFFERENCE" | "WINNER";
    control: VariantResult;
    challenger: VariantResult;
    /** Relative lift of challenger over control, percent. */
    liftPct: number | null;
    /** Two-sided p-value from a two-proportion z-test. */
    pValue: number | null;
    /** Human-readable explanation including the caveat. */
    explanation: string;
};

function zTestPValue(p1: number, n1: number, p2: number, n2: number): number | null {
    if (n1 <= 0 || n2 <= 0) return null;
    const pooled = (p1 * n1 + p2 * n2) / (n1 + n2);
    if (pooled <= 0 || pooled >= 1) return null;
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
    if (se <= 0) return null;
    const z = (p2 - p1) / se;
    return twoTailedP(Math.abs(z));
}

/**
 * Two-sided p-value for a standard normal statistic.
 *
 * Uses the Abramowitz & Stegun 7.1.26 approximation to the normal CDF:
 *   Φ(z) ≈ 1 − φ(z)·(b₁t + b₂t² + b₃t³ + b₄t⁴ + b₅t⁵),  t = 1/(1 + p·z)
 * and returns 2·(1 − Φ(|z|)), which is the two-sided p-value.
 *
 * Accurate to ~7.5e-8, far tighter than any experiment decision we make.
 */
export function twoTailedP(z: number): number {
    const absZ = Math.abs(z);
    const t = 1 / (1 + 0.2316419 * absZ);
    const d = 0.3989422804014327 * Math.exp((-absZ * absZ) / 2);
    const tail =
        d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    // `tail` is the upper-tail probability Φ(−|z|); the two-sided value is
    // twice that.
    return Math.min(1, Math.max(0, 2 * tail));
}

/**
 * Analyse a two-variant experiment. Always reports honestly: when the sample
 * is too small the result is INSUFFICIENT_DATA, never a "winner" off a handful
 * of users.
 */
export function analyzeExperiment(input: {
    experiment: Experiment;
    control: { variantId: string; label: string; users: number; conversions: number };
    challenger: { variantId: string; label: string; users: number; conversions: number };
    minSample?: number;
    minLiftPct?: number;
}): ExperimentOutcome {
    const minSample = input.minSample ?? MIN_SAMPLE_PER_VARIANT;
    const minLift = input.minLiftPct ?? MIN_LIFT_PCT;
    const { control, challenger } = input;

    const controlPct = control.users > 0 ? (control.conversions / control.users) * 100 : 0;
    const challengerPct = challenger.users > 0 ? (challenger.conversions / challenger.users) * 100 : 0;
    const controlResult: VariantResult = {
        variantId: control.variantId,
        label: control.label,
        users: control.users,
        conversions: control.conversions,
        conversionPct: controlPct,
    };
    const challengerResult: VariantResult = {
        variantId: challenger.variantId,
        label: challenger.label,
        users: challenger.users,
        conversions: challenger.conversions,
        conversionPct: challengerPct,
    };

    if (control.users < minSample || challenger.users < minSample) {
        return {
            status: "INSUFFICIENT_DATA",
            control: controlResult,
            challenger: challengerResult,
            liftPct: controlPct > 0 ? ((challengerPct - controlPct) / controlPct) * 100 : null,
            pValue: null,
            explanation: `Needs at least ${minSample} users per variant. Currently ${control.users} vs ${challenger.users}. No winner can be declared.`,
        };
    }

    const pValue = zTestPTest(controlPct, control.users, challengerPct, challenger.users);
    const liftPct = controlPct > 0 ? ((challengerPct - controlPct) / controlPct) * 100 : null;

    if (pValue !== null && pValue < SIGNIFICANCE_LEVEL && liftPct !== null && Math.abs(liftPct) >= minLift) {
        // A "winner" is only ever the variant that CONVERTED BETTER. A
        // challenger that significantly underperforms is reported as a
        // regression with the control retained — shipping the worse variant
        // is never the conclusion.
        if (liftPct > 0) {
            return {
                status: "WINNER",
                control: controlResult,
                challenger: challengerResult,
                liftPct,
                pValue,
                explanation: `Variant "${challenger.label}" outperformed the control by ${liftPct.toFixed(1)}% (p=${pValue.toFixed(4)}, n=${challenger.users}). Ship the challenger.`,
            };
        }
        return {
            status: "NO_SIGNIFICANT_DIFFERENCE",
            control: controlResult,
            challenger: challengerResult,
            liftPct,
            pValue,
            explanation: `Variant "${challenger.label}" performed significantly WORSE than the control by ${Math.abs(liftPct).toFixed(1)}% (p=${pValue.toFixed(4)}). Keep the control and roll the challenger back.`,
        };
    }

    return {
        status: "NO_SIGNIFICANT_DIFFERENCE",
        control: controlResult,
        challenger: challengerResult,
        liftPct,
        pValue,
        explanation:
            pValue === null
                ? "Not enough data to establish significance."
                : `Difference is not statistically significant (p=${pValue.toFixed(4)}, threshold ${SIGNIFICANCE_LEVEL}). Treating the variants as equivalent.`,
    };
}

/** Two-proportion z-test, taking conversion rates as percentages. */
function zTestPTest(p1: number, n1: number, p2: number, n2: number): number | null {
    return zTestPValue(p1 / 100, n1, p2 / 100, n2);
}

export type NewExperiment = {
    name: string;
    hypothesis: string;
    variants: { label: string; settings?: Record<string, unknown> }[];
    metric: string;
    surfaces: string[];
    now?: number;
};

export type CreateExperimentResult = { ok: true; experiment: Experiment } | { ok: false; report: SafetyReport };

/**
 * Create a draft experiment. Refuses to create an unsafe experiment at all —
 * an admin cannot save a checkout experiment and activate it later.
 */
export function createExperiment(input: NewExperiment): CreateExperimentResult {
    const now = input.now ?? Date.now();
    const variants: ExperimentVariant[] = input.variants.map((v, i) => ({
        id: `v${i}`,
        label: v.label,
        settings: v.settings,
    }));

    const report = validateExperimentSafety({ surfaces: input.surfaces, variants, metric: input.metric });
    if (!report.safe) return { ok: false, report };

    return {
        ok: true,
        experiment: {
            id: `exp_${now.toString(36)}_${hash(input.name).slice(0, 6)}`,
            name: input.name,
            hypothesis: input.hypothesis,
            variants,
            metric: input.metric,
            surfaces: input.surfaces,
            startAt: now,
            status: "DRAFT",
            createdAt: now,
            updatedAt: now,
        },
    };
}
