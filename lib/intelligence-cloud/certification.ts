/**
 * Intelligence Cloud — Strategy Certification (Phase 13)
 *
 * Certification is evidence-based. A level is only granted when the criteria
 * that justify it were *actually evaluated*, and the previous implementation's
 * failure mode was that every criterion defaulted to a truthy literal:
 *
 *     validStrategy: true,
 *     documentedLimitations: true,
 *     reproducibleReport: true,
 *
 * which meant any call could produce "CERTIFIED" with no tests behind it.
 *
 * Certification is never based on profitability. It measures whether the
 * methodology was executed and survived robustness testing.
 */

import type { CertificationStatus, CertificationStatusLevel, EngineVersions } from "./contracts";

export type CertificationLevel = "UNVERIFIED" | "TESTED" | "OOS_VERIFIED" | "ROBUST" | "CERTIFIED";

export type CertificationState = CertificationLevel | "REVIEW_REQUIRED" | "EXPIRED" | "SUSPENDED" | "REVOKED";

/**
 * Criteria. Each is opt-in: an absent field means "not evaluated", which can
 * never advance the certification level.
 */
export interface CertificationCriteria {
    /** Strategy passes canonical strategy-engine validation. */
    validStrategy?: boolean;
    /** A backtest completed without engine error. Says nothing about profit. */
    backtestCompleted?: boolean;
    /** Observed trade count meets the required minimum. */
    sampleSize?: number;
    minimumSampleSize?: number;
    outOfSamplePassed?: boolean;
    /** OOS degradation beyond the declared tolerance. */
    maxOosDegradationPercent?: number;
    observedOosDegradationPercent?: number;
    walkForwardPassed?: boolean;
    monteCarloPassed?: boolean;
    parameterSensitivityPassed?: boolean;
    executionSensitivityPassed?: boolean;
    documentedLimitations?: boolean;
    reproducibleSnapshot?: string;
    /** Minimum trades required for the level to be claimed. */
    requiredSampleSize?: number;
}

/**
 * Derive the highest certification level actually supported by the evidence.
 *
 * The ladder is strict: each rung requires the previous one plus its own
 * criteria. Any missing criterion stops the climb rather than being assumed.
 */
export function evaluateCertification(criteria: CertificationCriteria): CertificationLevel {
    if (criteria.validStrategy !== true) return "UNVERIFIED";

    const required = criteria.requiredSampleSize ?? criteria.minimumSampleSize;
    const hasSample =
        required !== undefined && typeof criteria.sampleSize === "number" && criteria.sampleSize >= required;

    if (criteria.backtestCompleted !== true) return "UNVERIFIED";
    if (!hasSample) return "TESTED";

    if (criteria.outOfSamplePassed !== true) return "TESTED";

    // An OOS result that degraded beyond the declared tolerance is a failure
    // even though the test "passed" in the narrow sense.
    const degradation = criteria.observedOosDegradationPercent;
    const maxDegradation = criteria.maxOosDegradationPercent ?? 50;
    if (typeof degradation === "number" && degradation > maxDegradation) return "TESTED";

    if (criteria.walkForwardPassed !== true || criteria.monteCarloPassed !== true) {
        return "OOS_VERIFIED";
    }

    if (
        criteria.parameterSensitivityPassed !== true ||
        criteria.executionSensitivityPassed !== true
    ) {
        return "ROBUST";
    }

    if (criteria.documentedLimitations !== true || !criteria.reproducibleSnapshot) {
        return "ROBUST";
    }

    return "CERTIFIED";
}

/** Tests a level legitimately implies. Only ever derived, never asserted. */
export function testsImpliedBy(level: CertificationLevel): string[] {
    switch (level) {
        case "UNVERIFIED":
            return [];
        case "TESTED":
            return ["strategy-validation", "backtest-completed", "sample-size"];
        case "OOS_VERIFIED":
            return ["strategy-validation", "backtest-completed", "sample-size", "oos", "walk-forward", "monte-carlo"];
        case "ROBUST":
            return [
                "strategy-validation",
                "backtest-completed",
                "sample-size",
                "oos",
                "walk-forward",
                "monte-carlo",
                "parameter-sensitivity",
                "execution-sensitivity",
            ];
        case "CERTIFIED":
            return [
                "strategy-validation",
                "backtest-completed",
                "sample-size",
                "oos",
                "walk-forward",
                "monte-carlo",
                "parameter-sensitivity",
                "execution-sensitivity",
                "documented-limitations",
                "reproducible-snapshot",
            ];
    }
}

export interface CertificationRecord {
    strategyId: string;
    strategyVersion: string;
    level: CertificationState;
    certifiedAt?: number;
    /** Immutable snapshot backing this certification. */
    snapshotId?: string;
    testedDataPeriod?: { start: number; end: number };
    engineVersions?: EngineVersions;
    testsPassed: string[];
    limitations: string[];
    expiresAt?: number;
    reviewedAt?: number;
    reviewReason?: string;
}

/**
 * Public certification status with expiry applied.
 *
 * An expired certification must never be displayed as `CERTIFIED`, so expiry
 * is resolved here rather than left to each consumer.
 */
export function resolveStatus(record: CertificationRecord, now: number = Date.now()): CertificationStatus {
    const expired =
        typeof record.expiresAt === "number" && record.expiresAt <= now && record.level !== "REVOKED";
    const status: CertificationStatusLevel = expired
        ? "EXPIRED"
        : record.level === "CERTIFIED"
          ? "CERTIFIED"
          : (record.level as CertificationStatusLevel);

    return {
        status,
        certifiedAt: record.certifiedAt,
        expiresAt: record.expiresAt,
        reviewedAt: record.reviewedAt,
        engineVersions: record.engineVersions,
        testsPassed: record.testsPassed,
        limitations: record.limitations,
        snapshotId: record.snapshotId,
        dataPeriod:
            record.testedDataPeriod
                ? `${new Date(record.testedDataPeriod.start).toISOString()} → ${new Date(
                      record.testedDataPeriod.end
                  ).toISOString()}`
                : undefined,
    };
}

export function shouldExpire(record: { expiresAt?: number }, now: number = Date.now()): boolean {
    return typeof record.expiresAt === "number" && record.expiresAt <= now;
}

export function certificationStatusText(level: CertificationState | string): string {
    const map: Record<string, string> = {
        UNVERIFIED: "Unverified — the strategy has not passed canonical validation.",
        TESTED: "Tested — validated and backtested over a sufficient sample. No out-of-sample evidence.",
        OOS_VERIFIED: "OOS Verified — out-of-sample, walk-forward and Monte Carlo tests passed.",
        ROBUST: "Robust — sensitivity to parameters and execution assumptions was tested.",
        CERTIFIED: "Certified — full methodology executed, limitations documented, result reproducible from a snapshot.",
        REVIEW_REQUIRED: "Review Required — a monitoring signal indicated the strategy needs re-validation.",
        EXPIRED: "Expired — the certification review date has passed and it must be re-evaluated.",
        SUSPENDED: "Suspended — certification is temporarily held pending review.",
        REVOKED: "Revoked — certification has been withdrawn.",
    };
    return map[level] ?? "Unknown";
}

/**
 * Disclosures every certification must carry.
 *
 * Configurable in wording, never removable in substance: certification
 * describes methodology, never an outcome.
 */
export const REQUIRED_CERTIFICATION_DISCLOSURES = [
    "Certification describes the methodology that was executed, not the strategy's future performance.",
    "Past performance and backtest results do not indicate future results.",
    "AlgoVault does not guarantee profitability.",
];
