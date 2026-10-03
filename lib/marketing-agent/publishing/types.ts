/**
 * Marketing Agent — unified social publishing contract (§27, §63, §65).
 *
 * Layered ON TOP of the existing growth channel adapters
 * (`lib/growth/channels`), which remain the text/status publisher and the
 * credential owner. This module adds the video-specific operations the growth
 * adapter does not model, and reports `NOT_SUPPORTED` wherever a platform's
 * official API cannot do something (§27, §64).
 */

import type { MarketingPlatform } from "../collections";

/** §65 — the UI adapts to what each platform can actually do. */
export type PublishingCapability = {
  platform: MarketingPlatform;
  canPublishVideo: boolean;
  canScheduleNatively: boolean;
  canUploadThumbnail: boolean;
  canAddDescription: boolean;
  canAddHashtags: boolean;
  canAddFirstComment: boolean;
  canRetrieveMetrics: boolean;
  maxVideoDurationSec: number;
  maxCaptionChars: number;
  supportedAspectRatios: string[];
  /** Official API surface used. Documentation link is not a promise of access. */
  apiSurface: string;
  /** Why a capability is false — surfaced in the UI instead of failing silently. */
  notes: string[];
};

export type PublishMediaInput = {
  /** Server-side path or URL the connector may read. */
  mediaPath: string;
  mimeType: string;
  durationSec: number;
  width?: number;
  height?: number;
  thumbnailPath?: string;
};

export type CreatePostInput = {
  accountId: string;
  media: PublishMediaInput;
  title: string;
  caption: string;
  description?: string;
  hashtags?: string[];
  firstComment?: string;
  destinationUrl: string;
  /** Server-generated; identical retries must reuse it (§29). */
  idempotencyKey: string;
  scheduledAt?: number;
};

export type ConnectorResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /** `NOT_CONFIGURED` / `NOT_SUPPORTED` are first-class outcomes (§27). */
      state: "NOT_CONFIGURED" | "NOT_SUPPORTED" | "ERROR" | "AUTH" | "RATE_LIMIT" | "VALIDATION";
      reason: string;
      errorKind: "TRANSIENT" | "PERMANENT" | "AUTH" | "RATE_LIMIT" | "VALIDATION";
      retryable: boolean;
    };

export type PublishConfirmation = {
  externalId: string;
  externalUrl?: string;
  publishedAt: number;
  raw?: Record<string, unknown>;
};

export type VerificationResult =
  | { ok: true; externalId: string; externalUrl?: string; checkedAt: number }
  | { ok: false; reason: string; checkedAt: number };

export type MetricsResult = {
  metrics: Record<string, number>;
  /** Metrics the platform did NOT return are absent, never zero-filled. */
  missing: string[];
  periodStart: number;
  periodEnd: number;
};

export type SocialPublisher = {
  readonly platform: MarketingPlatform;
  readonly capabilities: PublishingCapability;

  /** Credential/connection health — never returns the token itself (§30). */
  health(accountId?: string): Promise<ConnectorResult<{ state: string; permissions: string[]; tokenExpiresAt?: number; detail?: string }>>;
  validatePermissions(accountId: string, required: string[]): Promise<ConnectorResult<{ granted: string[]; missing: string[] }>>;

  /** Upload media and return a platform-side media handle. */
  uploadMedia(accountId: string, media: PublishMediaInput, idempotencyKey: string): Promise<ConnectorResult<{ mediaId: string }>>;

  /** Create the post. Returns a confirmation ONLY on platform confirmation. */
  createPost(input: CreatePostInput): Promise<ConnectorResult<PublishConfirmation>>;

  /** Native scheduling when supported; otherwise NOT_SUPPORTED (§63). */
  schedulePost(input: CreatePostInput): Promise<ConnectorResult<{ scheduledId: string; scheduledAt: number }>>;

  /** Re-read the post to confirm it exists (§31). */
  getPost(accountId: string, externalId: string): Promise<ConnectorResult<{ exists: boolean; url?: string; publishedAt?: number }>>;

  getMetrics(accountId: string, externalId: string, periodStart: number, periodEnd: number): Promise<ConnectorResult<MetricsResult>>;

  refreshCredentials(accountId: string): Promise<ConnectorResult<{ tokenExpiresAt?: number }>>;
};
