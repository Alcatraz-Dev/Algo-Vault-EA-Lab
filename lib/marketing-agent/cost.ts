/**
 * Marketing Agent — cost control (§46).
 *
 * Estimates the production workload BEFORE any expensive generation runs, and
 * enforces daily/batch/concurrency limits. The unit is a "production unit":
 * one rendered, QA'd platform version of one creative in one language.
 *
 * Pure module: no I/O (usage counters are read from RTDB by the caller).
 */

import { MARKETING_AGENT_DEFAULTS } from "./collections";
import type { MarketingAgentSettings } from "./types";

export type ProductionEstimate = {
  /** videos × variants × languages × platforms — the number in §46. */
  units: number;
  videos: number;
  variants: number;
  languages: number;
  platforms: number;
  /** Rough render seconds across all units (used to pick worker timeouts). */
  estimatedRenderSec: number;
  /** True when the request exceeds a hard cap. */
  blocked: boolean;
  blockedReason?: string;
  warnings: string[];
};

export function estimateProduction(input: {
  videos?: number;
  variants?: number;
  languages?: number;
  platforms?: number;
  durationSec: number;
  settings?: MarketingAgentSettings;
}): ProductionEstimate {
  const settings = input.settings;
  const videos = clamp(input.videos ?? 1, 1, 12);
  const variants = clamp(input.variants ?? 1, 1, settings?.maxVariants ?? MARKETING_AGENT_DEFAULTS.maxVariants);
  const languages = clamp(input.languages ?? 1, 1, 3);
  const platforms = clamp(input.platforms ?? 1, 1, 9);

  const units = videos * variants * languages * platforms;
  const duration = clamp(input.durationSec, 5, 600);
  const estimatedRenderSec = Math.round(units * Math.max(duration, 15) * 1.8);

  const maxUnits = settings?.maxProductionUnits ?? MARKETING_AGENT_DEFAULTS.maxProductionUnits;
  const warnings: string[] = [];
  let blocked = false;
  let blockedReason: string | undefined;

  if (units > maxUnits) {
    blocked = true;
    blockedReason = `Requested ${units} production units exceeds the limit of ${maxUnits}. Reduce languages, variants or platforms.`;
  } else if (units > maxUnits * 0.7) {
    warnings.push(`${units} of ${maxUnits} allowed production units will be used.`);
  }
  if (estimatedRenderSec > 60 * 60) {
    warnings.push("Estimated render time exceeds one hour — the run will be split across worker ticks.");
  }

  return { units, videos, variants, languages, platforms, estimatedRenderSec, blocked, blockedReason, warnings };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export type BudgetCheck = {
  allowed: boolean;
  reason?: string;
  usedToday: number;
  limit: number;
  remaining: number;
};

/** Daily job + unit budget check. Consumed counts are supplied by storage. */
export function checkDailyBudget(input: {
  jobsUsedToday: number;
  unitsUsedToday: number;
  settings: MarketingAgentSettings;
  requestedUnits: number;
  runningJobs: number;
}): BudgetCheck {
  const limit = input.settings.maxDailyJobs ?? MARKETING_AGENT_DEFAULTS.maxDailyJobs;
  const unitLimit = input.settings.costLimitUnitsPerDay;
  const remaining = Math.max(0, limit - input.jobsUsedToday);

  if (input.runningJobs >= MARKETING_AGENT_DEFAULTS.maxConcurrentJobs) {
    return {
      allowed: false,
      reason: `Concurrency limit reached (${MARKETING_AGENT_DEFAULTS.maxConcurrentJobs} jobs running).`,
      usedToday: input.jobsUsedToday,
      limit,
      remaining,
    };
  }
  if (input.jobsUsedToday >= limit) {
    return {
      allowed: false,
      reason: `Daily job limit reached (${limit}).`,
      usedToday: input.jobsUsedToday,
      limit,
      remaining: 0,
    };
  }
  if (input.unitsUsedToday + input.requestedUnits > unitLimit) {
    return {
      allowed: false,
      reason: `Daily production budget would be exceeded (used ${input.unitsUsedToday} of ${unitLimit}, requested ${input.requestedUnits}).`,
      usedToday: input.jobsUsedToday,
      limit,
      remaining,
    };
  }
  return { allowed: true, usedToday: input.jobsUsedToday, limit, remaining };
}

/**
 * Exponential backoff with jitter, bounded by §56.
 * Permanent/auth errors must not reach this function — the caller classifies
 * first and stops.
 */
export function backoffDelayMs(attempt: number, baseMs = MARKETING_AGENT_DEFAULTS.retryBaseMs): number {
  const exp = Math.min(attempt, 8);
  const raw = baseMs * Math.pow(2, exp - 1);
  const jitter = Math.floor(Math.random() * baseMs);
  return Math.min(raw + jitter, 60_000);
}

export function shouldRetry(input: {
  attempt: number;
  maxAttempts: number;
  errorKind: "TRANSIENT" | "PERMANENT" | "AUTH" | "RATE_LIMIT" | "VALIDATION";
}): { retry: boolean; reason: string; delayMs: number } {
  const { attempt, maxAttempts, errorKind } = input;
  if (errorKind === "PERMANENT") return { retry: false, reason: "Permanent error — not retried.", delayMs: 0 };
  if (errorKind === "VALIDATION") return { retry: false, reason: "Validation error — not retried.", delayMs: 0 };
  if (errorKind === "AUTH") {
    // Connectors classify AUTH only after their own credential refresh failed
    // (§30) — blind retries cannot fix an invalid token, so fail closed and
    // require an explicit reconnect instead of burning the retry budget.
    return { retry: false, reason: "Authentication failed — reconnect required.", delayMs: 0 };
  }
  if (attempt >= maxAttempts) return { retry: false, reason: "Retry budget exhausted.", delayMs: 0 };
  return { retry: true, reason: `${errorKind} error — retrying.`, delayMs: backoffDelayMs(attempt) };
}
