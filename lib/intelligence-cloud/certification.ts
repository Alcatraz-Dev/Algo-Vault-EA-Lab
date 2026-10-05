/**
 * Intelligence Cloud — Strategy Certification (Phase 9)
 *
 * Transparent, criterion-based certification with lifecycle management.
 * Must NOT imply guaranteed performance.
 */

export type CertificationLevel =
  | "UNVERIFIED"
  | "TESTED"
  | "OOS_VERIFIED"
  | "ROBUST"
  | "CERTIFIED";

export interface CertificationCriteria {
  validStrategy: boolean;
  successfulBacktest: boolean;
  sufficientSample: boolean;
  oosPassed?: boolean;
  noSevereOosDegradation?: boolean;
  walkForwardPassed?: boolean;
  monteCarloPassed?: boolean;
  parameterSensitivityPassed?: boolean;
  executionSensitivityPassed?: boolean;
  minimumSampleSize?: number; // e.g., 100 trades
  documentedLimitations?: boolean;
  reproducibleReport?: boolean;
}

export interface CertificationRecord {
  strategyId: string;
  strategyVersion: string;
  certifiedAt: number;
  testedDataPeriod: string;
  engineVersions: string; // snapshot reference
  status: CertificationLevel | "REVIEW_REQUIRED" | "EXPIRED" | "SUSPENDED" | "REVOKED";
  criteria: CertificationCriteria;
  expiresAt: number;
  reviewedAt?: number;
  reviewReason?: string;
  reportId?: string; // reproducible snapshot
}

export function evaluateCertification(
  criteria: CertificationCriteria,
  previous?: CertificationRecord
): CertificationLevel {
  if (!criteria.validStrategy || !criteria.successfulBacktest) return "UNVERIFIED";
  if (!criteria.sufficientSample) return "TESTED";
  if (!criteria.oosPassed || criteria.noSevereOosDegradation === false) return "TESTED";
  if (!criteria.walkForwardPassed || !criteria.monteCarloPassed) return "OOS_VERIFIED";
  if (!criteria.parameterSensitivityPassed || !criteria.executionSensitivityPassed) return "ROBUST";
  return "CERTIFIED";
}

export function shouldExpire(record: CertificationRecord): boolean {
  return Date.now() > record.expiresAt;
}

export function certificationStatusText(level: CertificationLevel | string): string {
  const map: Record<string, string> = {
    UNVERIFIED: "Unverified — no independent testing performed.",
    TESTED: "Tested — valid backtest, sufficient sample.",
    OOS_VERIFIED: "OOS Verified — out-of-sample passed without severe degradation.",
    ROBUST: "Robust — WFA, Monte Carlo, parameter/execution sensitivity included.",
    CERTIFIED: "Certified — all required tests passed; limitations documented.",
    REVIEW_REQUIRED: "Review Required — performance degradation detected.",
    EXPIRED: "Expired — certification review overdue.",
    SUSPENDED: "Suspended — temporary hold pending review.",
    REVOKED: "Revoked — certification withdrawn.",
  };
  return map[level] ?? "Unknown";
}
