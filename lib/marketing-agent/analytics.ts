/**
 * Marketing Agent — Analytics Agent + Learning Agent (§36, §37, §38).
 *
 * Collects ONLY metrics a platform actually returned (never zero-filled or
 * invented), and turns them into non-causal observations with an explicit
 * sample size, period, platform and confidence. Correlation is never presented
 * as certainty.
 *
 * Pure module: collection is performed by the connectors; this file stores and
 * interprets. `store` is injected so it is testable without Firebase.
 */

import type { MarketingPlatform } from "./collections";
import type { LearningObservation, PerformanceSnapshot, PublishingJob } from "./types";

export type AnalyticsStore = {
  savePerformance(snapshot: PerformanceSnapshot): Promise<string>;
  listPerformance(creativeId: string): Promise<PerformanceSnapshot[]>;
  saveLearning(observation: LearningObservation): Promise<string>;
  listLearning(creativeId: string): Promise<LearningObservation[]>;
};

const MIN_SAMPLE_SIZE = 30;
const HIGH_CONFIDENCE_SAMPLE = 500;

/** Metrics the agent knows how to interpret (§36). */
export const INTERPRETABLE_METRICS = [
  "views",
  "watch_time",
  "completion",
  "impressions",
  "clicks",
  "ctr",
  "engagement",
  "shares",
  "saves",
  "comments",
  "conversions",
] as const;

/**
 * Persist one snapshot. Metrics not present in `metrics` are simply absent —
 * a platform that does not report `ctr` never gets `ctr: 0` (§36).
 */
export async function recordPerformance(
  store: AnalyticsStore,
  input: Omit<PerformanceSnapshot, "id" | "collectedAt">
): Promise<string> {
  const snapshot: PerformanceSnapshot = { ...input, collectedAt: Date.now() };
  return store.savePerformance(snapshot);
}

export type Comparison = {
  metric: string;
  a: { label: string; value: number };
  b: { label: string; value: number };
  deltaPct: number;
  direction: "HIGHER" | "LOWER" | "FLAT";
  sampleSize: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

/** Compare two snapshots on shared metrics only. */
export function compareSnapshots(
  a: PerformanceSnapshot,
  b: PerformanceSnapshot
): Comparison[] {
  const out: Comparison[] = [];
  const shared = Object.keys(a.metrics).filter((k) => typeof b.metrics[k] === "number");
  const sample = Math.min(a.sampleSize || 1, b.sampleSize || 1);

  for (const metric of shared) {
    const va = a.metrics[metric];
    const vb = b.metrics[metric];
    if (va === vb) {
      out.push({ metric, a: { label: a.platform, value: va }, b: { label: b.platform, value: vb }, deltaPct: 0, direction: "FLAT", sampleSize: sample, confidence: confidenceFor(sample) });
      continue;
    }
    const base = Math.abs(va) > 0 ? Math.abs(va) : Math.abs(vb) || 1;
    const deltaPct = Math.round(((vb - va) / base) * 1000) / 10;
    out.push({
      metric,
      a: { label: a.platform, value: va },
      b: { label: b.platform, value: vb },
      deltaPct,
      direction: deltaPct > 2 ? "HIGHER" : deltaPct < -2 ? "LOWER" : "FLAT",
      sampleSize: sample,
      confidence: confidenceFor(sample),
    });
  }
  return out;
}

function confidenceFor(sampleSize: number): LearningObservation["confidence"] {
  if (sampleSize >= HIGH_CONFIDENCE_SAMPLE) return "HIGH";
  if (sampleSize >= MIN_SAMPLE_SIZE) return "MEDIUM";
  return "LOW";
}

/**
 * Turn comparisons into stored observations (§37). Language is deliberately
 * observational: "higher observed completion", never "because".
 */
export async function generateObservations(
  store: AnalyticsStore,
  input: {
    creativeId: string;
    platform: MarketingPlatform;
    baseline: PerformanceSnapshot;
    candidate: PerformanceSnapshot;
    createdBy: string;
  }
): Promise<LearningObservation[]> {
  const comparisons = compareSnapshots(input.baseline, input.candidate);
  const observations: LearningObservation[] = [];

  for (const c of comparisons) {
    if (c.direction === "FLAT") continue;
    if (c.sampleSize < MIN_SAMPLE_SIZE) continue;

    const observation: LearningObservation = {
      creativeId: input.creativeId,
      observation:
        c.direction === "HIGHER"
          ? `Variant "${c.b.label}" showed higher observed ${c.metric} than "${c.a.label}" (${c.b.value} vs ${c.a.value}, ${c.deltaPct}%).`
          : `Variant "${c.b.label}" showed lower observed ${c.metric} than "${c.a.label}" (${c.b.value} vs ${c.a.value}, ${c.deltaPct}%).`,
      metric: c.metric,
      direction: c.direction,
      sampleSize: c.sampleSize,
      periodStart: Math.min(input.baseline.periodStart, input.candidate.periodStart),
      periodEnd: Math.max(input.baseline.periodEnd, input.candidate.periodEnd),
      platform: input.platform,
      confidence: c.confidence,
      applied: false,
      createdAt: Date.now(),
      createdBy: input.createdBy,
    };
    observations.push(observation);
    await store.saveLearning(observation);
  }
  return observations;
}

export type FatigueAssessment = {
  detected: boolean;
  reason: string;
  sampleSize: number;
  metric?: string;
  value?: number;
  threshold?: number;
  suggestedAction: string;
  /** Never auto-applied — the agent proposes only (§38). */
  requiresHuman: true;
};

/**
 * Creative-fatigue detection (§38). Only fires with sufficient data; the
 * proposal is always surfaced to a human unless autonomous mode is enabled AND
 * admin rules allow it.
 */
export function detectFatigue(input: {
  impressions: number;
  ctr?: number;
  completionRate?: number;
  daysRunning: number;
}): FatigueAssessment {
  const base: FatigueAssessment = {
    detected: false,
    reason: "",
    sampleSize: input.impressions,
    suggestedAction: "No action proposed.",
    requiresHuman: true,
  };

  if (input.impressions < 500 || input.daysRunning < 7) {
    return { ...base, reason: `Insufficient data (${input.impressions} impressions over ${input.daysRunning} days).` };
  }
  if (input.ctr !== undefined && input.ctr < 0.008) {
    return {
      ...base,
      detected: true,
      reason: `Observed CTR of ${(input.ctr * 100).toFixed(2)}% is below the 0.8% fatigue threshold over ${input.impressions} impressions.`,
      metric: "ctr",
      value: input.ctr,
      threshold: 0.008,
      suggestedAction: "Create fresh opening variants while keeping the core product demonstration.",
    };
  }
  if (input.completionRate !== undefined && input.completionRate < 0.25) {
    return {
      ...base,
      detected: true,
      reason: `Observed completion of ${(input.completionRate * 100).toFixed(1)}% is below the 25% threshold.`,
      metric: "completion",
      value: input.completionRate,
      threshold: 0.25,
      suggestedAction: "Tighten the hook and shorten the opening beat.",
    };
  }
  return { ...base, reason: `Metrics within normal range over ${input.impressions} impressions.` };
}

/** Aggregate metrics across the published jobs of a creative. */
export function aggregateMetrics(snapshots: PerformanceSnapshot[]): { totals: Record<string, number>; sampleSize: number; periods: { start: number; end: number } } {
  const totals: Record<string, number> = {};
  let sampleSize = 0;
  let start = Number.POSITIVE_INFINITY;
  let end = 0;

  for (const s of snapshots) {
    sampleSize += s.sampleSize || 0;
    start = Math.min(start, s.periodStart);
    end = Math.max(end, s.periodEnd);
    for (const [k, v] of Object.entries(s.metrics)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return { totals, sampleSize, periods: { start: Number.isFinite(start) ? start : 0, end } };
}

/** Which platforms in a batch actually returned data (§36 honesty check). */
export function coverageOf(jobs: PublishingJob[], snapshots: PerformanceSnapshot[]): { published: number; withMetrics: number; missing: MarketingPlatform[] } {
  const published = jobs.filter((j) => j.state === "PUBLISHED");
  const covered = new Set(snapshots.map((s) => `${s.platform}:${s.externalId ?? ""}`));
  const missing = Array.from(
    new Set(
      published
        .filter((j) => !covered.has(`${j.platform}:${j.externalId ?? ""}`))
        .map((j) => j.platform)
    )
  ) as MarketingPlatform[];
  return { published: published.length, withMetrics: published.length - missing.length, missing };
}
