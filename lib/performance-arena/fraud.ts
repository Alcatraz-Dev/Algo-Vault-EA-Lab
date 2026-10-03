// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — fraud / abuse foundations.
//
// Privacy-conscious by design: detectors consume only technical metadata that
// the arena already produces (attempts, trades, timestamps, reward ids).
// Flags are stored in a SEPARATE namespace from performance data and never
// alter challenge accounting — they route to human review.
//
// No invasive surveillance: no device fingerprinting, no cross-site tracking,
// no message/content inspection.
// ─────────────────────────────────────────────────────────────────────────────

import { rtdbSlug } from "./rewards";
import type { ChallengeAttempt, ChallengeTrade, FraudFlag, FraudFlagType } from "./types";

export interface FraudDetectionContext {
    userId: string;
    attempt: ChallengeAttempt | null;
    now: number;
    /** Attempts created by this user recently (for duplicate/reset checks). */
    recentAttempts: Array<Pick<ChallengeAttempt, "id" | "definitionId" | "status" | "createdAt">>;
    /** Reward ids granted for the same source (duplication check). */
    rewardIdsForSource?: string[];
    /** Count of arena API mutations in the current minute window. */
    apiCallsThisMinute?: number;
    nextFlagId: () => string;
}

export function flagIdFor(params: { userId: string; type: FraudFlagType; attemptId: string | null; dedupeKey: string }): string {
    return rtdbSlug(`ff_${params.type}_${params.attemptId ?? "na"}_${params.dedupeKey}_${params.userId}`);
}

function flag(
    ctx: FraudDetectionContext,
    params: { type: FraudFlagType; severity: FraudFlag["severity"]; detail: string; metadata: FraudFlag["metadata"]; dedupeKey: string; attemptId?: string | null }
): FraudFlag {
    return {
        flagId: flagIdFor({ userId: ctx.userId, type: params.type, attemptId: params.attemptId ?? ctx.attempt?.id ?? null, dedupeKey: params.dedupeKey }),
        userId: ctx.userId,
        attemptId: params.attemptId ?? ctx.attempt?.id ?? null,
        type: params.type,
        severity: params.severity,
        detail: params.detail,
        metadata: params.metadata,
        status: "OPEN",
        createdAt: ctx.now,
        resolvedAt: null,
    };
}

/**
 * Duplicate-challenge detection: the same user restarting the same
 * definition many times in a short window is a reset-abuse signal.
 */
export function detectDuplicateChallengeAbuse(ctx: FraudDetectionContext): FraudFlag[] {
    const definitionId = ctx.attempt?.definitionId;
    if (!definitionId) return [];
    const windowMs = 24 * 60 * 60 * 1000;
    const recent = ctx.recentAttempts.filter(
        (a) => a.definitionId === definitionId && ctx.now - a.createdAt < windowMs
    );
    if (recent.length >= 3) {
        return [
            flag(ctx, {
                type: "CHALLENGE_RESET_ABUSE",
                severity: recent.length >= 5 ? "high" : "medium",
                detail: `${recent.length} attempts on the same challenge definition within 24h.`,
                metadata: { definitionId, count: recent.length },
                dedupeKey: "daily-restarts",
            }),
        ];
    }
    if (recent.length >= 2) {
        return [
            flag(ctx, {
                type: "DUPLICATE_ACTIVE_CHALLENGE",
                severity: "low",
                detail: `${recent.length} recent attempts on the same definition.`,
                metadata: { definitionId, count: recent.length },
                dedupeKey: "duplicate-active",
            }),
        ];
    }
    return [];
}

/**
 * Reward-duplication guard: identical reward ids for one source must exist at
 * most once (idempotent ledger makes this near-impossible — the flag is the
 * tripwire if storage is ever corrupted or written out-of-band).
 */
export function detectRewardDuplication(ctx: FraudDetectionContext, rewardIds: string[]): FraudFlag[] {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of rewardIds) {
        if (seen.has(id)) dupes.push(id);
        seen.add(id);
    }
    if (dupes.length > 0) {
        return [
            flag(ctx, {
                type: "REWARD_DUPLICATION",
                severity: "high",
                detail: `Duplicate reward ids detected for one source: ${dupes.join(", ")}.`,
                metadata: { duplicates: dupes.length },
                dedupeKey: "dup-rewards",
            }),
        ];
    }
    return [];
}

/**
 * Impossible-execution detection: fills recorded far away from the quote the
 * server resolved are impossible under the deterministic cost model. The
 * service rejects the fill AND records this flag.
 */
export function detectImpossibleExecution(params: {
    ctx: FraudDetectionContext;
    quotePriceMicros: number;
    fillPriceMicros: number;
    symbol: string;
    tolerancePct?: number;
}): FraudFlag[] {
    const { ctx, quotePriceMicros, fillPriceMicros, symbol, tolerancePct = 1 } = params;
    if (quotePriceMicros <= 0) return [];
    const deviationPct = (Math.abs(fillPriceMicros - quotePriceMicros) / quotePriceMicros) * 100;
    if (deviationPct <= tolerancePct) return [];
    return [
        flag(ctx, {
            type: "IMPOSSIBLE_EXECUTION",
            severity: "high",
            detail: `Fill deviated ${deviationPct.toFixed(2)}% from the resolved quote for ${symbol} (tolerance ${tolerancePct}%).`,
            metadata: { symbol, deviationPct: Math.round(deviationPct * 100) / 100 },
            dedupeKey: "impossible-exec",
            attemptId: ctx.attempt?.id ?? null,
        }),
    ];
}

/** Excessive API activity: sustained high mutation rate from one user. */
export function detectExcessiveApiActivity(ctx: FraudDetectionContext): FraudFlag[] {
    const calls = ctx.apiCallsThisMinute ?? 0;
    if (calls >= 120) {
        return [
            flag(ctx, {
                type: "EXCESSIVE_API_ACTIVITY",
                severity: calls >= 300 ? "high" : "medium",
                detail: `${calls} arena mutations within one minute.`,
                metadata: { callsPerMinute: calls },
                dedupeKey: "api-rate",
            }),
        ];
    }
    return [];
}

/**
 * Suspicious trading pattern: perfectly uniform round-trip timing with
 * identical sizes at the millisecond cadence is not human behaviour.
 * Only technical timing metadata is examined.
 */
export function detectSuspiciousTradingPattern(params: {
    ctx: FraudDetectionContext;
    trades: ChallengeTrade[];
}): FraudFlag[] {
    const { ctx, trades } = params;
    const closed = trades.filter((t) => t.closedAt !== null && t.entryAt > 0);
    if (closed.length < 10) return [];

    const durations = closed.map((t) => (t.closedAt ?? 0) - t.entryAt);
    const sizes = closed.map((t) => t.sizeCentiLots);
    const uniqueDurations = new Set(durations).size;
    const uniqueSizes = new Set(sizes).size;

    if (uniqueDurations <= 2 && uniqueSizes <= 2) {
        return [
            flag(ctx, {
                type: "SUSPICIOUS_TRADING_PATTERN",
                severity: "medium",
                detail: `${closed.length} trades with near-identical duration and size — pattern flagged for review only.`,
                metadata: { trades: closed.length, uniqueDurations, uniqueSizes },
                dedupeKey: "uniform-trades",
            }),
        ];
    }
    return [];
}

/** Run every detector and de-duplicate by flagId (idempotent writes). */
export function runFraudDetections(params: {
    ctx: FraudDetectionContext;
    trades?: ChallengeTrade[];
}): FraudFlag[] {
    const { ctx, trades = [] } = params;
    const flags: FraudFlag[] = [
        ...detectDuplicateChallengeAbuse(ctx),
        ...detectRewardDuplication(ctx, ctx.rewardIdsForSource ?? []),
        ...detectExcessiveApiActivity(ctx),
        ...detectSuspiciousTradingPattern({ ctx, trades }),
    ];
    const byId = new Map(flags.map((f) => [f.flagId, f]));
    return Array.from(byId.values());
}
