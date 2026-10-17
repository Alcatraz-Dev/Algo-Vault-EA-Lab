/**
 * Marketing Agent — execution-time publish guards.
 *
 * Every path that can publish (scheduled ticks, cron retries, agent publish
 * step, workflow executor, manual admin retry) must derive the publish
 * context from the live state of the job here. Callers must never assert
 * `approvalGranted` / `accountConnected` / `qaPassed` themselves.
 *
 * Fail closed: any missing, invalid, or unreadable input yields `false`, and
 * the engine's `queuePreconditions` then blocks the publish.
 *
 * Dependencies are injected so tests run without Firebase or the network.
 */

import type { MarketingPlatform } from "../collections";
import type { PublishingJob } from "../types";
import type { PublishContext } from "./engine";
import type { SocialPublisher } from "./types";

export type PublishContextDeps = {
  /** Live value of the marketingAgentPublishingEnabled kill switch. */
  loadPublishingEnabled(): Promise<boolean>;
  /** Parent agent job, which holds the campaign approval decision. */
  getAgentJob(id: string): Promise<{ approval?: { decision?: string } | null } | null>;
  /** Creative version, which holds the QA result recorded by run_qa. */
  getVersion(id: string): Promise<{ qa?: { passed?: boolean } | null } | null>;
  /** Platform connector, used for the real account-health check. */
  getPublisher(platform: MarketingPlatform): SocialPublisher | undefined;
};

const CLOSED: PublishContext = {
  approvalGranted: false,
  accountConnected: false,
  publishingEnabled: false,
  qaPassed: false,
};

async function safely<T>(check: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await check();
  } catch {
    return fallback;
  }
}

/**
 * Resolves the publish context for one publishing job from live state.
 * Every flag is `true` only when the verifying source positively confirms it.
 */
export async function resolvePublishContext(
  job: PublishingJob,
  deps: PublishContextDeps,
  now?: number
): Promise<PublishContext> {
  const [publishingEnabled, approvalGranted, qaPassed, accountConnected] = await Promise.all([
    safely(async () => (await deps.loadPublishingEnabled()) === true, false),
    safely(async () => {
      if (!job.jobId) return false;
      const agentJob = await deps.getAgentJob(job.jobId);
      return agentJob?.approval?.decision === "APPROVED";
    }, false),
    safely(async () => {
      if (!job.versionId) return false;
      const version = await deps.getVersion(job.versionId);
      return version?.qa?.passed === true;
    }, false),
    safely(async () => {
      // The connector submits to job.accountId, so a job without one cannot publish.
      if (!job.accountId) return false;
      const publisher = deps.getPublisher(job.platform);
      if (!publisher) return false;
      const health = await publisher.health(job.accountId);
      return health.ok === true;
    }, false),
  ]);

  if (!publishingEnabled && !approvalGranted && !qaPassed && !accountConnected) {
    return { ...CLOSED, now };
  }
  return { publishingEnabled, approvalGranted, qaPassed, accountConnected, now };
}

/** Production wiring: real RTDB, settings, and connector registry. */
export async function productionPublishContextDeps(): Promise<PublishContextDeps> {
  const [storage, settings, providers] = await Promise.all([
    import("../storage"),
    import("../settings"),
    import("./providers"),
  ]);
  providers.registerSocialPublishers();
  return {
    loadPublishingEnabled: async () => (await settings.loadSettingsFromRtdb()).flags.marketingAgentPublishingEnabled === true,
    getAgentJob: (id) => storage.getAgentJob(id),
    getVersion: (id) => storage.getVersion(id),
    getPublisher: (platform) => providers.getSocialPublisher(platform),
  };
}
