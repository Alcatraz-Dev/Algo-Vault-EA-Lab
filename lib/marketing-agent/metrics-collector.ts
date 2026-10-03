/**
 * Marketing Agent — metrics collection (§36).
 *
 * Pulls metrics for posts this system published, using each connector's
 * official analytics surface. Platforms that cannot return metrics are
 * reported as uncovered — no zero-filled substitutes (§36, §64).
 *
 * Server-only module.
 */

import type { MarketingPlatform } from "./collections";
import type { PerformanceSnapshot } from "./types";
import { listPublishingJobs, listPerformance, savePerformance, audit } from "./storage";
import { listSocialPublishers, registerSocialPublishers } from "./publishing/providers";

export type CollectResult = {
  collected: number;
  skipped: number;
  uncovered: MarketingPlatform[];
  snapshots: PerformanceSnapshot[];
};

/**
 * Collect metrics for every PUBLISHED job that has not been collected in the
 * last 6 hours. Idempotent: an unchanged snapshot is not re-written.
 */
export async function collectPublishedMetrics(now = Date.now(), options?: { creativeId?: string }): Promise<CollectResult> {
  registerSocialPublishers();
  const jobs = await listPublishingJobs({ ...(options?.creativeId ? { creativeId: options.creativeId } : {}) });
  const published = jobs.filter((j) => j.state === "PUBLISHED" && j.externalId);
  const publishers = listSocialPublishers();

  const uncovered = new Set<MarketingPlatform>();
  const snapshots: PerformanceSnapshot[] = [];
  let collected = 0;
  let skipped = 0;

  for (const job of published) {
    if (!job.id || !job.externalId) continue;
    const externalId: string = job.externalId;
    const publisher = publishers.find((p) => p.platform === job.platform);
    if (!publisher) {
      uncovered.add(job.platform);
      skipped += 1;
      continue;
    }
    if (!publisher.capabilities.canRetrieveMetrics) {
      uncovered.add(job.platform);
      skipped += 1;
      continue;
    }

    const periodStart = Math.max(job.publishedAt ?? now - 7 * 24 * 60 * 60 * 1000, now - 30 * 24 * 60 * 60 * 1000);
    const periodEnd = now;

    // Skip when a snapshot for this external id already covers the period.
    const existing = await listPerformance(job.creativeId, 40);
    const recent = existing.find(
      (s) => s.externalId === externalId && s.periodEnd >= now - 6 * 60 * 60 * 1000
    );
    if (recent) {
      skipped += 1;
      continue;
    }

    const result = await publisher.getMetrics(job.accountId ?? "", externalId, periodStart, periodEnd);
    if (!result.ok) {
      if (result.state === "NOT_CONFIGURED" || result.state === "NOT_SUPPORTED") uncovered.add(job.platform);
      skipped += 1;
      continue;
    }

    const snapshot: PerformanceSnapshot = {
      creativeId: job.creativeId,
      versionId: job.versionId,
      platform: job.platform,
      externalId,
      periodStart,
      periodEnd,
      metrics: result.value.metrics,
      source: publisher.capabilities.apiSurface,
      sampleSize: Object.values(result.value.metrics).reduce((max, v) => Math.max(max, v), 0),
      collectedAt: now,
      createdBy: "agent:metrics",
    };
    await savePerformance(snapshot);
    snapshots.push(snapshot);
    collected += 1;
  }

  if (collected > 0 || uncovered.size > 0) {
    await audit({
      actor: "agent:metrics",
      action: "marketing_metrics_collected",
      targetType: "marketingPerformance",
      targetId: options?.creativeId ?? "",
      detail: { collected, skipped, uncovered: Array.from(uncovered) },
    });
  }

  return { collected, skipped, uncovered: Array.from(uncovered), snapshots };
}
