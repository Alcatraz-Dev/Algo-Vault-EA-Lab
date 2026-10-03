/**
 * Marketing Agent — cron entry point (§26, §36).
 *
 * Hooked into the EXISTING growth cron surface (`/api/growth/cron/[job]`) so
 * no second scheduler is created. Each tick is idempotent: `claimJobKey`
 * deduplicates by job key, and publishing is guarded by idempotency keys.
 *
 * Server-only module.
 */

import { tickSchedules } from "./agent";
import { listPublishingJobs, rtdbPublishingStore, listSocialAccounts, audit } from "./storage";
import { executePublishingJob } from "./publishing/engine";
import { listSocialPublishers, registerSocialPublishers } from "./publishing/providers";
import { loadSettingsFromRtdb } from "./settings";

export type MarketingAgentCronResult = {
  summary: string;
  counts?: Record<string, number>;
  [key: string]: unknown;
};

/**
 * One tick:
 *  1. advance due schedules (publish + verify inline),
 *  2. retry jobs waiting on backoff,
 *  3. collect metrics for recently published posts,
 *  4. refresh social account health.
 */
export async function runMarketingAgentCron(payload: Record<string, unknown> = {}, now = Date.now()): Promise<MarketingAgentCronResult> {
  const settings = await loadSettingsFromRtdb();
  if (!settings.enabled || settings.flags.marketingAgentEnabled === false) {
    return { summary: "Marketing Agent disabled — tick skipped.", counts: { skipped: 1 } };
  }

  // 1) Due schedules.
  const tick = await tickSchedules(now);

  // 2) Retry anything sitting in RETRYING with a elapsed backoff window.
  const store = rtdbPublishingStore();
  const retryable = await listPublishingJobs({ state: "RETRYING" });
  let retried = 0;
  let published = 0;
  let verificationRequired = 0;

  for (const job of retryable) {
    if (!job.id) continue;
    if (job.nextAttemptAt && job.nextAttemptAt > now) continue;
    const result = await executePublishingJob(store, job.id, {
      approvalGranted: true,
      accountConnected: true,
      publishingEnabled: settings.flags.marketingAgentPublishingEnabled === true,
      qaPassed: true,
      now,
    });
    retried += 1;
    if (result.state === "PUBLISHED") published += 1;
    if (result.state === "PUBLISH_VERIFICATION_REQUIRED") verificationRequired += 1;
  }

  // 3) Collect metrics for published posts (§36).
  const { collectPublishedMetrics } = await import("./metrics-collector");
  const metrics = await collectPublishedMetrics(now);

  // 4) Social account health (§32).
  registerSocialPublishers();
  const accounts = await listSocialAccounts();
  const publishers = listSocialPublishers();
  let healthy = 0;
  for (const account of accounts) {
    const publisher = publishers.find((p) => p.platform === account.platform);
    if (!publisher) continue;
    const health = await publisher.health(account.accountId);
    if (health.ok) healthy += 1;
  }

  await audit({
    actor: "vercel-cron",
    action: "marketing_agent_tick",
    targetType: "marketingAgentJob",
    targetId: "",
    detail: {
      due: tick.due.length,
      completedSchedules: tick.completed,
      retried,
      published,
      verificationRequired,
      metricsCollected: metrics.collected,
      healthyAccounts: healthy,
      accounts: accounts.length,
    },
  });

  return {
    summary:
      `Marketing Agent tick: ${tick.due.length} schedule(s) due, ${published} published, ` +
      `${retried} retried, ${metrics.collected} metric snapshot(s), ${verificationRequired} awaiting verification.`,
    counts: {
      due: tick.due.length,
      published,
      retried,
      metrics: metrics.collected,
      errors: tick.errors,
      verificationRequired,
    },
  };
}
