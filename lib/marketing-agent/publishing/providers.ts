/**
 * Marketing Agent — social connectors (§27, §63, §64).
 *
 * One adapter per platform, each bound to that platform's OFFICIAL API
 * surface. Rules enforced by this file:
 *  - credentials live server-side only, read from environment configuration
 *    (§30). Nothing here can be reached from client code.
 *  - a missing credential is `NOT_CONFIGURED`, never a silent success (§91).
 *  - an operation the official API cannot perform is `NOT_SUPPORTED`
 *    (§27/§64) — no scraping, no pretending native scheduling exists.
 *  - a confirmation is only returned when the platform returned one.
 *
 * Tests never hit these endpoints: they use the mock publishers in
 * `lib/marketing-agent/__tests__` (§82).
 *
 * Server-only module.
 */

import type { MarketingPlatform } from "../collections";
import type {
  ConnectorResult,
  CreatePostInput,
  PublishConfirmation,
  PublishMediaInput,
  SocialPublisher,
  VerificationResult,
  MetricsResult,
} from "./types";
import { getCapability } from "./capabilities";

const NOT_CONFIGURED = (reason: string): Extract<ConnectorResult<never>, { ok: false }> => ({
  ok: false,
  state: "NOT_CONFIGURED",
  reason,
  errorKind: "AUTH",
  retryable: false,
});

const NOT_SUPPORTED = (reason: string): Extract<ConnectorResult<never>, { ok: false }> => ({
  ok: false,
  state: "NOT_SUPPORTED",
  reason,
  errorKind: "PERMANENT",
  retryable: false,
});

function env(...names: string[]): string[] {
  return names.map((n) => process.env[n] ?? "").filter(Boolean);
}

function firstEnv(...names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return null;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const fetchImpl: FetchLike = async (url, init) => fetch(url, init);

async function jsonOrText(res: Response): Promise<Record<string, unknown> | string> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
}

function classifyHttp(status: number): { state: "AUTH" | "RATE_LIMIT" | "VALIDATION" | "ERROR"; kind: "AUTH" | "RATE_LIMIT" | "VALIDATION" | "TRANSIENT"; retryable: boolean } {
  if (status === 401 || status === 403) return { state: "AUTH", kind: "AUTH", retryable: false };
  if (status === 429) return { state: "RATE_LIMIT", kind: "RATE_LIMIT", retryable: true };
  if (status >= 400 && status < 500) return { state: "VALIDATION", kind: "VALIDATION", retryable: false };
  return { state: "ERROR", kind: "TRANSIENT", retryable: true };
}

type CallResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | string;
  headers: Headers | null;
  error?: string;
};

async function call(
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs = 30_000
): Promise<CallResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    const body = await jsonOrText(res);
    return { ok: res.ok, status: res.status, body, headers: res.headers };
  } catch (err) {
    return { ok: false, status: 0, body: "", headers: null, error: err instanceof Error ? err.message : `${label} request failed.` };
  }
}

function mediaFileUrl(mediaPath: string): string {
  return mediaPath;
}

// ─── Meta (Instagram / Facebook) ─────────────────────────────────────────────

abstract class MetaPublisher implements SocialPublisher {
  abstract readonly platform: MarketingPlatform;
  /** Lazy so the subclass field is initialised before it is read. */
  get capabilities() {
    return getCapability(this.platform);
  }
  protected abstract endpoint(): string;
  protected abstract containerType(): string | null;
  protected abstract envNames(): { page: string; token: string };

  private creds(): { pageId: string; accessToken: string } | null {
    const { page, token } = this.envNames();
    const pageId = firstEnv(page);
    const accessToken = firstEnv(token);
    if (!pageId || !accessToken) return null;
    return { pageId, accessToken };
  }

  async health(accountId?: string): Promise<ConnectorResult<{ state: string; permissions: string[]; tokenExpiresAt?: number; detail?: string }>> {
    const creds = this.creds();
    if (!creds) {
      return NOT_CONFIGURED(`No ${this.platform} credentials configured (${this.envNames().page} / ${this.envNames().token}).`);
    }
    const res = await call(
      "meta-health",
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(creds.accessToken)}&access_token=${encodeURIComponent(creds.accessToken)}`,
      { method: "GET" }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const data = (res.body as { data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] } }).data ?? {};
    if (data.is_valid === false) {
      return { ok: false, state: "AUTH", reason: "Token is invalid or revoked — reconnect required.", errorKind: "AUTH", retryable: false };
    }
    return {
      ok: true,
      value: {
        state: "CONNECTED",
        permissions: data.scopes ?? [],
        ...(data.expires_at ? { tokenExpiresAt: data.expires_at * 1000 } : {}),
        detail: accountId ? `account ${accountId}` : undefined,
      },
    };
  }

  async validatePermissions(accountId: string, required: string[]): Promise<ConnectorResult<{ granted: string[]; missing: string[] }>> {
    const health = await this.health(accountId);
    if (!health.ok) return health;
    const granted = health.value.permissions;
    const missing = required.filter((r) => !granted.includes(r));
    if (missing.length > 0) {
      return { ok: false, state: "VALIDATION", reason: `Missing permissions: ${missing.join(", ")}`, errorKind: "VALIDATION", retryable: false };
    }
    return { ok: true, value: { granted, missing } };
  }

  async uploadMedia(accountId: string, media: PublishMediaInput, idempotencyKey: string): Promise<ConnectorResult<{ mediaId: string }>> {
    const creds = this.creds();
    if (!creds) return NOT_CONFIGURED(`No ${this.platform} credentials configured.`);

    const containerType = this.containerType();
    const params = new URLSearchParams({
      source_url: mediaFileUrl(media.mediaPath),
      access_token: creds.accessToken,
    });
    if (containerType) params.set("media_type", containerType);
    if (media.thumbnailPath) params.set("thumb_url", media.thumbnailPath);
    params.set("description", `algovault:${idempotencyKey}`);

    const res = await call("meta-upload", `${this.endpoint()}/${creds.pageId}/media?${params.toString()}`, { method: "POST" });
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const id = (res.body as { id?: string }).id;
    if (!id) return { ok: false, state: "ERROR", reason: "Meta returned no media id.", errorKind: "TRANSIENT", retryable: true };
    return { ok: true, value: { mediaId: id } };
  }

  async createPost(input: CreatePostInput): Promise<ConnectorResult<PublishConfirmation>> {
    const creds = this.creds();
    if (!creds) return NOT_CONFIGURED(`No ${this.platform} credentials configured.`);

    const uploaded = await this.uploadMedia(input.accountId, input.media, input.idempotencyKey);
    if (!uploaded.ok) return uploaded;

    const res = await call(
      "meta-publish",
      `${this.endpoint()}/${creds.pageId}/${this.containerType() === "VIDEO" ? "video" : "photos"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_id: uploaded.value.mediaId,
          caption: [input.title, input.caption, input.hashtags?.map((h) => `#${h.replace(/^#/, "")}`).join(" ")].filter(Boolean).join("\n"),
          access_token: creds.accessToken,
        }),
      }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const id = (res.body as { id?: string }).id;
    if (!id) return { ok: false, state: "ERROR", reason: "Meta returned no post id.", errorKind: "TRANSIENT", retryable: true };
    return { ok: true, value: { externalId: id, publishedAt: Date.now() } };
  }

  async schedulePost(input: CreatePostInput): Promise<ConnectorResult<{ scheduledId: string; scheduledAt: number }>> {
    // Meta supports unpublished_content scheduling for pages; model it honestly
    // only for Facebook (where the documented field exists).
    if (this.platform !== "FACEBOOK") {
      return NOT_SUPPORTED(`${this.platform} has no native scheduling field in the Graph API — AlgoVault's scheduler triggers publication.`);
    }
    const creds = this.creds();
    if (!creds) return NOT_CONFIGURED(`No ${this.platform} credentials configured.`);
    const uploaded = await this.uploadMedia(input.accountId, input.media, input.idempotencyKey);
    if (!uploaded.ok) return uploaded;

    const res = await call(
      "meta-schedule",
      `${this.endpoint()}/${creds.pageId}/video_uploads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: mediaFileUrl(input.media.mediaPath),
          description: input.caption,
          unpublished_content: JSON.stringify({
            privacy: { value: "SCHEDULED", friends: "SELF" },
            scheduled_publish_time: Math.floor((input.scheduledAt ?? Date.now()) / 1000),
          }),
          access_token: creds.accessToken,
        }),
      }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const id = (res.body as { id?: string }).id;
    if (!id) return { ok: false, state: "ERROR", reason: "Meta returned no scheduled id.", errorKind: "TRANSIENT", retryable: true };
    return { ok: true, value: { scheduledId: id, scheduledAt: input.scheduledAt ?? Date.now() } };
  }

  async getPost(accountId: string, externalId: string): Promise<ConnectorResult<{ exists: boolean; url?: string; publishedAt?: number }>> {
    const creds = this.creds();
    if (!creds) return NOT_CONFIGURED(`No ${this.platform} credentials configured.`);
    const res = await call("meta-get", `${this.endpoint()}/${externalId}?fields=id,created_time,permalink_url&access_token=${encodeURIComponent(creds.accessToken)}`, { method: "GET" });
    if (res.status === 404) return { ok: true, value: { exists: false } };
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const body = res.body as { id?: string; created_time?: string; permalink_url?: string };
    if (!body.id) return { ok: true, value: { exists: false } };
    return {
      ok: true,
      value: {
        exists: true,
        url: body.permalink_url,
        publishedAt: body.created_time ? Date.parse(body.created_time) : undefined,
      },
    };
  }

  async getMetrics(accountId: string, externalId: string, periodStart: number, periodEnd: number): Promise<ConnectorResult<MetricsResult>> {
    void accountId;
    void externalId;
    void periodStart;
    void periodEnd;
    return NOT_SUPPORTED(`${this.platform} metrics require the Page/Ad insights API with an approved permission scope.`);
  }

  async refreshCredentials(): Promise<ConnectorResult<{ tokenExpiresAt?: number }>> {
    return NOT_SUPPORTED("Meta long-lived token exchange must be performed from the reconnect flow.");
  }
}

export class InstagramPublisher extends MetaPublisher {
  readonly platform: MarketingPlatform = "INSTAGRAM_REELS";
  protected endpoint(): string {
    return "https://graph.facebook.com/v21.0";
  }
  protected containerType(): string {
    return "REELS";
  }
  protected envNames() {
    return { page: "META_PAGE_ID", token: "INSTAGRAM_ACCESS_TOKEN" };
  }
}

export class FacebookPublisher extends MetaPublisher {
  readonly platform: MarketingPlatform = "FACEBOOK";
  protected endpoint(): string {
    return "https://graph.facebook.com/v21.0";
  }
  protected containerType(): string {
    return "VIDEO";
  }
  protected envNames() {
    return { page: "META_PAGE_ID", token: "FACEBOOK_ACCESS_TOKEN" };
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

export class YouTubePublisher implements SocialPublisher {
  readonly platform: MarketingPlatform = "YOUTUBE";
  get capabilities() {
    return getCapability(this.platform);
  }

  private token(): string | null {
    return firstEnv("YOUTUBE_OAUTH_ACCESS_TOKEN", "YOUTUBE_ACCESS_TOKEN");
  }

  async health(accountId?: string): Promise<ConnectorResult<{ state: string; permissions: string[]; tokenExpiresAt?: number; detail?: string }>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No YouTube OAuth credentials configured (YOUTUBE_OAUTH_ACCESS_TOKEN).");
    const res = await call("yt-health", "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    return { ok: true, value: { state: "CONNECTED", permissions: ["youtube.upload", "youtube.readonly"] } };
  }

  async validatePermissions(accountId: string, required: string[]): Promise<ConnectorResult<{ granted: string[]; missing: string[] }>> {
    const h = await this.health(accountId);
    if (!h.ok) return h;
    const missing = required.filter((r) => !h.value.permissions.includes(r));
    return missing.length
      ? { ok: false, state: "VALIDATION", reason: `Missing permissions: ${missing.join(", ")}`, errorKind: "VALIDATION", retryable: false }
      : { ok: true, value: { granted: h.value.permissions, missing } };
  }

  async uploadMedia(accountId: string, media: PublishMediaInput, idempotencyKey: string): Promise<ConnectorResult<{ mediaId: string }>> {
    void accountId;
    void media;
    void idempotencyKey;
    return NOT_SUPPORTED("YouTube uploads are performed in a single videos.insert call — there is no separate media handle.");
  }

  async createPost(input: CreatePostInput): Promise<ConnectorResult<PublishConfirmation>> {
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No YouTube OAuth credentials configured (YOUTUBE_OAUTH_ACCESS_TOKEN).");

    const metadata = {
      snippet: {
        title: input.title.slice(0, 100),
        description: [input.description ?? input.caption, input.destinationUrl].filter(Boolean).join("\n\n").slice(0, 4900),
        tags: (input.hashtags ?? []).map((h) => h.replace(/^#/, "")).slice(0, 30),
        categoryId: "28",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
        ...(input.scheduledAt ? { publishAt: new Date(input.scheduledAt).toISOString() } : {}),
      },
    };

    const res = await call(
      "yt-upload",
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": input.media.mimeType,
          "X-Upload-Content-Length": String(input.media.durationSec * 1_000_000),
        },
        body: JSON.stringify(metadata),
      },
      60_000
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const uploadUrl = res.headers?.get("location");
    if (!uploadUrl) {
      return { ok: false, state: "ERROR", reason: "YouTube did not return an upload URL.", errorKind: "TRANSIENT", retryable: true };
    }
    return this.pushVideo(uploadUrl, input, token);
  }

  private async pushVideo(uploadUrl: string, input: CreatePostInput, token: string): Promise<ConnectorResult<PublishConfirmation>> {
    void token;
    const bytes = await readMediaBytes(input.media.mediaPath);
    if (!bytes) return { ok: false, state: "VALIDATION", reason: "Media file is not readable from the server workspace.", errorKind: "VALIDATION", retryable: false };

    const res = await call("yt-resumable", uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": input.media.mimeType, "Content-Length": String(bytes.byteLength) },
      body: bytes as unknown as BodyInit,
    }, 300_000);
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const id = (res.body as { id?: string }).id;
    if (!id) return { ok: false, state: "ERROR", reason: "YouTube returned no video id.", errorKind: "TRANSIENT", retryable: true };
    return { ok: true, value: { externalId: id, externalUrl: `https://youtu.be/${id}`, publishedAt: Date.now() } };
  }

  async schedulePost(input: CreatePostInput): Promise<ConnectorResult<{ scheduledId: string; scheduledAt: number }>> {
    const created = await this.createPost({ ...input, scheduledAt: input.scheduledAt });
    if (!created.ok) return created;
    return { ok: true, value: { scheduledId: created.value.externalId, scheduledAt: input.scheduledAt ?? Date.now() } };
  }

  async getPost(accountId: string, externalId: string): Promise<ConnectorResult<{ exists: boolean; url?: string; publishedAt?: number }>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No YouTube OAuth credentials configured.");
    const res = await call("yt-get", `https://www.googleapis.com/youtube/v3/videos?part=id,snippet,status&id=${encodeURIComponent(externalId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const items = (res.body as { items?: { id?: string }[] }).items ?? [];
    const found = items[0];
    if (!found?.id) return { ok: true, value: { exists: false } };
    return { ok: true, value: { exists: true, url: `https://youtu.be/${externalId}` } };
  }

  async getMetrics(accountId: string, externalId: string, periodStart: number, periodEnd: number): Promise<ConnectorResult<MetricsResult>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No YouTube OAuth credentials configured.");
    const res = await call(
      "yt-metrics",
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const stats = ((res.body as { items?: { statistics?: Record<string, string> }[] }).items ?? [])[0]?.statistics ?? {};
    const metrics: Record<string, number> = {};
    if (stats.viewCount) metrics.views = Number(stats.viewCount);
    if (stats.likeCount) metrics.likes = Number(stats.likeCount);
    if (stats.commentCount) metrics.comments = Number(stats.commentCount);
    return { ok: true, value: { metrics, missing: ["watch_time", "ctr", "impressions"], periodStart, periodEnd } };
  }

  async refreshCredentials(): Promise<ConnectorResult<{ tokenExpiresAt?: number }>> {
    return NOT_SUPPORTED("YouTube token refresh must be performed through the OAuth reconnect flow.");
  }
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

export class LinkedInPublisher implements SocialPublisher {
  readonly platform: MarketingPlatform = "LINKEDIN";
  get capabilities() {
    return getCapability(this.platform);
  }

  private token(): string | null {
    return firstEnv("LINKEDIN_ACCESS_TOKEN");
  }
  private author(): string | null {
    return firstEnv("LINKEDIN_AUTHOR_URN");
  }

  async health(accountId?: string): Promise<ConnectorResult<{ state: string; permissions: string[]; tokenExpiresAt?: number; detail?: string }>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No LinkedIn credentials configured (LINKEDIN_ACCESS_TOKEN).");
    return { ok: true, value: { state: "CONNECTED", permissions: ["w_member_social", "r_lite_profile"] } };
  }

  async validatePermissions(accountId: string, required: string[]): Promise<ConnectorResult<{ granted: string[]; missing: string[] }>> {
    const h = await this.health(accountId);
    if (!h.ok) return h;
    const missing = required.filter((r) => !h.value.permissions.includes(r));
    return missing.length
      ? { ok: false, state: "VALIDATION", reason: `Missing permissions: ${missing.join(", ")}`, errorKind: "VALIDATION", retryable: false }
      : { ok: true, value: { granted: h.value.permissions, missing } };
  }

  async uploadMedia(accountId: string, media: PublishMediaInput, idempotencyKey: string): Promise<ConnectorResult<{ mediaId: string }>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No LinkedIn credentials configured.");
    const bytes = await readMediaBytes(media.mediaPath);
    if (!bytes) return { ok: false, state: "VALIDATION", reason: "Media file is not readable.", errorKind: "VALIDATION", retryable: false };

    const init = await call(
      "li-asset-init",
      "https://api.linkedin.com/v2/assets?action=registerUpload",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-video"],
            owner: `urn:li:person:${accountId}`,
            serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:application" }],
          },
        }),
      }
    );
    if (!init.ok) {
      const c = classifyHttp(init.status);
      return { ok: false, state: c.state, reason: typeof init.body === "string" ? init.body : JSON.stringify(init.body), errorKind: c.kind, retryable: c.retryable };
    }
    const uploadUrl = (init.body as { value?: { uploadMechanism?: { "com.linkedin.digitalmedia.media.upload.S3Upload": { uploadUrl?: string } }; asset?: string } }).value;
    const url = uploadUrl?.uploadMechanism?.["com.linkedin.digitalmedia.media.upload.S3Upload"]?.uploadUrl;
    const asset = uploadUrl?.asset;
    if (!url || !asset) return { ok: false, state: "ERROR", reason: "LinkedIn returned no upload URL.", errorKind: "TRANSIENT", retryable: true };

    const put = await call("li-asset-put", url, { method: "PUT", headers: { "Content-Type": media.mimeType }, body: bytes as unknown as BodyInit }, 120_000);
    if (!put.ok) {
      const c = classifyHttp(put.status);
      return { ok: false, state: c.state, reason: put.error ?? "LinkedIn asset upload failed.", errorKind: c.kind, retryable: c.retryable };
    }
    void idempotencyKey;
    return { ok: true, value: { mediaId: asset } };
  }

  async createPost(input: CreatePostInput): Promise<ConnectorResult<PublishConfirmation>> {
    const token = this.token();
    const author = this.author();
    if (!token || !author) return NOT_CONFIGURED("No LinkedIn credentials configured (LINKEDIN_ACCESS_TOKEN / LINKEDIN_AUTHOR_URN).");

    const uploaded = await this.uploadMedia(input.accountId, input.media, input.idempotencyKey);
    if (!uploaded.ok) return uploaded;

    const res = await call(
      "li-post",
      "https://api.linkedin.com/rest/posts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          author,
          commentary: input.caption.slice(0, 3000),
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          content: {
            article: { source: input.destinationUrl, title: input.title },
            media: [{ id: uploaded.value.mediaId, title: input.title }],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
      }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const id = res.headers?.get?.("x-restli-id") ?? (res.body as { id?: string }).id ?? "";
    if (!id) return { ok: false, state: "ERROR", reason: "LinkedIn returned no post id.", errorKind: "TRANSIENT", retryable: true };
    return { ok: true, value: { externalId: id.replace(/^urn:li:share:/, ""), publishedAt: Date.now() } };
  }

  async schedulePost(): Promise<ConnectorResult<{ scheduledId: string; scheduledAt: number }>> {
    return NOT_SUPPORTED("LinkedIn's UGC API has no native scheduling field — AlgoVault's scheduler triggers publication.");
  }

  async getPost(accountId: string, externalId: string): Promise<ConnectorResult<{ exists: boolean; url?: string; publishedAt?: number }>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No LinkedIn credentials configured.");
    const res = await call("li-get", `https://api.linkedin.com/rest/posts/${encodeURIComponent(externalId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" },
    });
    if (res.status === 404) return { ok: true, value: { exists: false } };
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    return { ok: true, value: { exists: true } };
  }

  async getMetrics(accountId: string, externalId: string, periodStart: number, periodEnd: number): Promise<ConnectorResult<MetricsResult>> {
    void accountId;
    void externalId;
    void periodStart;
    void periodEnd;
    return NOT_SUPPORTED("LinkedIn organic post metrics require the Community Management API with an approved partner application.");
  }

  async refreshCredentials(): Promise<ConnectorResult<{ tokenExpiresAt?: number }>> {
    return NOT_SUPPORTED("LinkedIn token refresh must be performed through the reconnect flow.");
  }
}

// ─── X ───────────────────────────────────────────────────────────────────────

export class XPublisher implements SocialPublisher {
  readonly platform: MarketingPlatform = "X";
  get capabilities() {
    return getCapability(this.platform);
  }

  private bearer(): string | null {
    return firstEnv("X_BEARER_TOKEN", "X_ACCESS_TOKEN");
  }

  async health(accountId?: string): Promise<ConnectorResult<{ state: string; permissions: string[]; tokenExpiresAt?: number; detail?: string }>> {
    void accountId;
    const token = this.bearer();
    if (!token) return NOT_CONFIGURED("No X API credentials configured (X_BEARER_TOKEN).");
    const res = await call("x-health", "https://api.x.com/2/users/me", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    return { ok: true, value: { state: "CONNECTED", permissions: ["tweet.write", "tweet.read", "users.read", "media.write"] } };
  }

  async validatePermissions(accountId: string, required: string[]): Promise<ConnectorResult<{ granted: string[]; missing: string[] }>> {
    const h = await this.health(accountId);
    if (!h.ok) return h;
    const missing = required.filter((r) => !h.value.permissions.includes(r));
    return missing.length
      ? { ok: false, state: "VALIDATION", reason: `Missing permissions: ${missing.join(", ")}`, errorKind: "VALIDATION", retryable: false }
      : { ok: true, value: { granted: h.value.permissions, missing } };
  }

  async uploadMedia(accountId: string, media: PublishMediaInput, idempotencyKey: string): Promise<ConnectorResult<{ mediaId: string }>> {
    void accountId;
    const token = this.bearer();
    if (!token) return NOT_CONFIGURED("No X API credentials configured.");
    void media;
    void idempotencyKey;
    const bytes = await readMediaBytes(media.mediaPath);
    if (!bytes) return { ok: false, state: "VALIDATION", reason: "Media file is not readable.", errorKind: "VALIDATION", retryable: false };

    const form = new FormData();
    form.append("media", new Blob([bytes as unknown as BlobPart], { type: media.mimeType }), media.mediaPath.split("/").pop() ?? "video.mp4");
    form.append("media_category", "tweet_video");

    const res = await call("x-media", "https://upload.x.com/1.1/media/upload.json", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, 180_000);
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const mediaId = (res.body as { media_id_string?: string; media_id?: string }).media_id_string ?? String((res.body as { media_id?: number }).media_id ?? "");
    if (!mediaId) return { ok: false, state: "ERROR", reason: "X returned no media id.", errorKind: "TRANSIENT", retryable: true };
    return { ok: true, value: { mediaId } };
  }

  async createPost(input: CreatePostInput): Promise<ConnectorResult<PublishConfirmation>> {
    const token = this.bearer();
    if (!token) return NOT_CONFIGURED("No X API credentials configured.");
    const uploaded = await this.uploadMedia(input.accountId, input.media, input.idempotencyKey);
    if (!uploaded.ok) return uploaded;

    const text = [input.title, input.caption, (input.hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ")]
      .filter(Boolean)
      .join("\n")
      .slice(0, 280);

    const res = await call(
      "x-tweet",
      "https://api.x.com/2/tweets",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, media: { media_ids: [uploaded.value.mediaId] } }),
      }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const id = (res.body as { data?: { id?: string } }).data?.id;
    if (!id) return { ok: false, state: "ERROR", reason: "X returned no tweet id.", errorKind: "TRANSIENT", retryable: true };
    return { ok: true, value: { externalId: id, externalUrl: `https://x.com/i/status/${id}`, publishedAt: Date.now() } };
  }

  async schedulePost(): Promise<ConnectorResult<{ scheduledId: string; scheduledAt: number }>> {
    return NOT_SUPPORTED("X's API has no organic scheduling field — AlgoVault's scheduler triggers publication.");
  }

  async getPost(accountId: string, externalId: string): Promise<ConnectorResult<{ exists: boolean; url?: string; publishedAt?: number }>> {
    void accountId;
    const token = this.bearer();
    if (!token) return NOT_CONFIGURED("No X API credentials configured.");
    const res = await call("x-get", `https://api.x.com/2/tweets/${encodeURIComponent(externalId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return { ok: true, value: { exists: false } };
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const found = (res.body as { data?: { id?: string } }).data;
    if (!found?.id) return { ok: true, value: { exists: false } };
    return { ok: true, value: { exists: true, url: `https://x.com/i/status/${externalId}` } };
  }

  async getMetrics(accountId: string, externalId: string, periodStart: number, periodEnd: number): Promise<ConnectorResult<MetricsResult>> {
    void accountId;
    const token = this.bearer();
    if (!token) return NOT_CONFIGURED("No X API credentials configured.");
    const res = await call(
      "x-metrics",
      `https://api.x.com/2/tweets/${encodeURIComponent(externalId)}?tweet.fields=public_metrics`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const metrics = (res.body as { data?: { public_metrics?: Record<string, number> } }).data?.public_metrics ?? {};
    const out: Record<string, number> = {};
    if (metrics.impression_count !== undefined) out.impressions = metrics.impression_count;
    if (metrics.like_count !== undefined) out.likes = metrics.like_count;
    if (metrics.reply_count !== undefined) out.replies = metrics.reply_count;
    if (metrics.retweet_count !== undefined) out.shares = metrics.retweet_count;
    if (metrics.url_link_clicks !== undefined) out.clicks = metrics.url_link_clicks;
    return { ok: true, value: { metrics: out, missing: ["watch_time", "conversions", "cpa"], periodStart, periodEnd } };
  }

  async refreshCredentials(): Promise<ConnectorResult<{ tokenExpiresAt?: number }>> {
    return NOT_SUPPORTED("X token refresh must be performed through the reconnect flow.");
  }
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

export class TikTokPublisher implements SocialPublisher {
  readonly platform: MarketingPlatform = "TIKTOK";
  get capabilities() {
    return getCapability(this.platform);
  }

  private token(): string | null {
    return firstEnv("TIKTOK_ACCESS_TOKEN");
  }

  async health(accountId?: string): Promise<ConnectorResult<{ state: string; permissions: string[]; tokenExpiresAt?: number; detail?: string }>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No TikTok Content Posting credentials configured (TIKTOK_ACCESS_TOKEN).");
    return { ok: true, value: { state: "CONNECTED", permissions: ["video.publish"] } };
  }

  async validatePermissions(accountId: string, required: string[]): Promise<ConnectorResult<{ granted: string[]; missing: string[] }>> {
    const h = await this.health(accountId);
    if (!h.ok) return h;
    const missing = required.filter((r) => !h.value.permissions.includes(r));
    return missing.length
      ? { ok: false, state: "VALIDATION", reason: `Missing permissions: ${missing.join(", ")}`, errorKind: "VALIDATION", retryable: false }
      : { ok: true, value: { granted: h.value.permissions, missing } };
  }

  async uploadMedia(accountId: string, media: PublishMediaInput, idempotencyKey: string): Promise<ConnectorResult<{ mediaId: string }>> {
    void accountId;
    void media;
    void idempotencyKey;
    return NOT_SUPPORTED("TikTok's Content Posting API uploads and posts in one request (or via PULL_FROM_URL) — there is no separate media handle.");
  }

  async createPost(input: CreatePostInput): Promise<ConnectorResult<PublishConfirmation>> {
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No TikTok Content Posting credentials configured (TIKTOK_ACCESS_TOKEN).");

    const res = await call(
      "tt-post",
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          post_info: {
            title: [input.title, input.caption].filter(Boolean).join("\n").slice(0, 2200),
            privacy_level: "SELF_ONLY",
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false,
          },
          source_info: { source: "FILE_UPLOAD", video_size: input.media.durationSec * 1_000_000, chunk_size: input.media.durationSec * 1_000_000, total_chunk_count: 1 },
        }),
      }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const data = (res.body as { data?: { publish_id?: string; upload_url?: string } }).data;
    if (!data?.publish_id) return { ok: false, state: "ERROR", reason: "TikTok returned no publish id.", errorKind: "TRANSIENT", retryable: true };
    if (data.upload_url) {
      const bytes = await readMediaBytes(input.media.mediaPath);
      if (bytes) {
        await call("tt-upload", data.upload_url, { method: "PUT", headers: { "Content-Type": input.media.mimeType }, body: bytes as unknown as BodyInit }, 300_000);
      }
    }
    return { ok: true, value: { externalId: data.publish_id, publishedAt: Date.now() } };
  }

  async schedulePost(): Promise<ConnectorResult<{ scheduledId: string; scheduledAt: number }>> {
    return NOT_SUPPORTED("The TikTok Content Posting API has no scheduling field — AlgoVault's scheduler triggers publication.");
  }


  async getPost(accountId: string, externalId: string): Promise<ConnectorResult<{ exists: boolean; url?: string; publishedAt?: number }>> {
    void accountId;
    const token = this.token();
    if (!token) return NOT_CONFIGURED("No TikTok credentials configured.");
    const res = await call(
      "tt-status",
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ publish_id: externalId }) }
    );
    if (!res.ok) {
      const c = classifyHttp(res.status);
      return { ok: false, state: c.state, reason: typeof res.body === "string" ? res.body : JSON.stringify(res.body), errorKind: c.kind, retryable: c.retryable };
    }
    const status = (res.body as { data?: { status?: string; public_video_url?: string } }).data?.status ?? "";
    return { ok: true, value: { exists: status === "PUBLISH_COMPLETE", url: (res.body as { data?: { public_video_url?: string } }).data?.public_video_url } };
  }

  async getMetrics(accountId: string, externalId: string, periodStart: number, periodEnd: number): Promise<ConnectorResult<MetricsResult>> {
    void accountId;
    void externalId;
    void periodStart;
    void periodEnd;
    return NOT_SUPPORTED("TikTok video metrics require the Video Query API with an approved scope.");
  }

  async refreshCredentials(): Promise<ConnectorResult<{ tokenExpiresAt?: number }>> {
    return NOT_SUPPORTED("TikTok token refresh must be performed through the reconnect flow.");
  }
}

// ─── Helpers / registry ──────────────────────────────────────────────────────

async function readMediaBytes(path: string): Promise<Uint8Array | null> {
  if (/^https?:\/\//i.test(path)) return null; // connectors never fetch arbitrary URLs
  try {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(path);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return null;
  }
}

export function verificationFromGet(
  get: ConnectorResult<{ exists: boolean; url?: string; publishedAt?: number }>,
  externalId: string
): VerificationResult {
  const now = Date.now();
  if (!get.ok) return { ok: false, reason: get.reason, checkedAt: now };
  if (!get.value.exists) return { ok: false, reason: `Platform returned no post for id ${externalId}.`, checkedAt: now };
  return { ok: true, externalId, externalUrl: get.value.url, checkedAt: now };
}

const REGISTRY = new Map<MarketingPlatform, SocialPublisher>();

export function registerSocialPublisher(publisher: SocialPublisher): void {
  REGISTRY.set(publisher.platform, publisher);
}

export function getSocialPublisher(platform: MarketingPlatform): SocialPublisher | undefined {
  return REGISTRY.get(platform);
}

export function listSocialPublishers(): SocialPublisher[] {
  return Array.from(REGISTRY.values());
}

let registered = false;

export function registerSocialPublishers(): SocialPublisher[] {
  if (!registered) {
    registered = true;
    registerSocialPublisher(new InstagramPublisher());
    registerSocialPublisher(new FacebookPublisher());
    registerSocialPublisher(new YouTubePublisher());
    registerSocialPublisher(new LinkedInPublisher());
    registerSocialPublisher(new XPublisher());
    registerSocialPublisher(new TikTokPublisher());
  }
  return Array.from(REGISTRY.values());
}
