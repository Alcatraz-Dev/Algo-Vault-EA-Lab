// Sieve scrape API — HTTP client.
//
// Follows the repo's outbound-HTTP convention (see lib/ai/providers/*.ts and
// lib/integrations/erpnext/client.ts): plain `fetch`, AbortController timeout,
// cache:"no-store", and no second HTTP library.
//
// Critical rule (from the contract): POST /api/scrapes spends credits and has
// no idempotency key, so it is SINGLE ATTEMPT — a timeout or network error is
// never auto-retried. GET requests and 429/5xx responses are safe to retry.

import { loadSieveConfig, isSieveConfigured, SIEVE_DEFAULT_BASE_URL } from "./config";
import type { SieveConfig } from "./config";
import { SieveError, SieveNotConfiguredError, mapHttpError } from "./errors";
import type {
  SieveAcceptedRun,
  SieveCredits,
  SieveDeviceCode,
  SieveDeviceTokenResult,
  SieveFile,
  SieveFollowUpInput,
  SieveRun,
  SieveStartRunInput,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_GET_RETRIES = 4;
const DEFAULT_RETRY_BASE_MS = 500;

export interface SieveRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  config?: SieveConfig;
}

/** Retry policy for a single logical request. */
export interface SieveRetryPolicy {
  retries: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SieveCallOptions extends SieveRequestOptions {
  retry?: SieveRetryPolicy;
}

// ── utilities ────────────────────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR")
  );
}

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Parse a Retry-After header (delta-seconds form) into seconds. */
export function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }
  return undefined;
}

function requireConfig(config?: SieveConfig): SieveConfig {
  const resolved = config ?? loadSieveConfig();
  if (!isSieveConfigured(resolved)) throw new SieveNotConfiguredError();
  return resolved;
}

/** Base URL that works before an API key exists (device login). */
function baseUrlOf(config?: SieveConfig): string {
  const configured = config?.baseUrl ?? process.env.SIEVE_BASE_URL ?? SIEVE_DEFAULT_BASE_URL;
  return configured.replace(/\/+$/, "");
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Low-level fetch with an abort-based timeout. Timeouts and network failures
 * surface as SieveError with `safeToRetry:false` — the caller decides whether
 * retrying is allowed for its verb.
 */
async function rawFetch(
  url: string,
  init: RequestInit,
  options: SieveRequestOptions = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (isAbortError(err)) {
      throw new SieveError("TIMEOUT", `Sieve request timed out after ${timeoutMs}ms.`);
    }
    throw new SieveError("NETWORK_ERROR", `Sieve request failed: ${errorMessageOf(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `attempt`, retrying only when the thrown error is `safeToRetry`. */
async function withRetry<T>(
  attempt: () => Promise<T>,
  policy: SieveRetryPolicy | undefined,
): Promise<T> {
  const maxRetries = policy?.retries ?? 0;
  const baseDelayMs = policy?.baseDelayMs ?? DEFAULT_RETRY_BASE_MS;
  const sleep = policy?.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i += 1) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      const safe = err instanceof SieveError && err.safeToRetry;
      if (!safe || i === maxRetries) throw err;
      const delay = err.retryAfterSeconds !== undefined
        ? err.retryAfterSeconds * 1000
        : baseDelayMs * 2 ** i;
      await sleep(delay);
    }
  }
  throw lastError;
}

interface RequestInput {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  multipart?: FormData;
  absUrl?: string;
  auth?: boolean;
  options?: SieveCallOptions;
  config?: SieveConfig;
}

async function request<T>(input: RequestInput): Promise<T> {
  const config = input.config ?? requireConfig(input.options?.config);
  const url = input.absUrl ?? `${config.baseUrl}${input.path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.auth !== false) headers.Authorization = `Bearer ${config.apiKey}`;

  let payload: BodyInit | undefined;
  if (input.multipart) {
    payload = input.multipart;
  } else if (input.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(input.body);
  }

  const attempt = async (): Promise<T> => {
    const res = await rawFetch(url, { method: input.method, headers, body: payload }, input.options);
    if (!res.ok) {
      const body = await readBody(res);
      throw mapHttpError(res.status, body, parseRetryAfter(res.headers.get("retry-after")));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };

  return withRetry(attempt, input.options?.retry);
}

// ── request building ─────────────────────────────────────────────────────────

/** JSON body for POST /api/scrapes (document goes via multipart instead). */
export function buildStartBody(input: SieveStartRunInput): Record<string, unknown> {
  const body: Record<string, unknown> = { instruction: input.instruction };
  if (input.target_urls?.length) body.target_urls = input.target_urls;
  if (input.fields?.length) body.fields = input.fields;
  if (input.schema) body.schema = input.schema;
  if (input.output_schema) body.output_schema = input.output_schema;
  if (input.table_shape) body.table_shape = input.table_shape;
  if (input.compliance_mode) body.compliance_mode = input.compliance_mode;
  return body;
}

export function buildStartFormData(input: SieveStartRunInput): FormData {
  const form = new FormData();
  const body = buildStartBody(input);
  for (const [key, value] of Object.entries(body)) {
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  if (input.document) {
    form.append(
      "file",
      new Blob([new Uint8Array(input.document.content)], { type: input.document.contentType ?? "application/octet-stream" }),
      input.document.filename,
    );
  }
  return form;
}

/** Absolute download URL for a delivered file (its `url` is relative). */
export function fileUrl(file: SieveFile, config?: SieveConfig): string {
  if (/^https?:\/\//i.test(file.url)) return file.url;
  const base = baseUrlOf(config);
  return `${base}${file.url.startsWith("/") ? "" : "/"}${file.url}`;
}

// ── scrapes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/scrapes — SINGLE ATTEMPT. Never auto-retried: a timeout or network
 * error is indistinguishable from a call that created a run and spent credits.
 * On a 429/5xx the thrown SieveError has `safeToRetry:true` and the caller may
 * retry deliberately (see `createScrapeWithSafeRetry`).
 */
export async function createScrape(
  input: SieveStartRunInput,
  options: SieveCallOptions = {},
): Promise<SieveAcceptedRun> {
  const config = requireConfig(options.config);
  if (input.document) {
    return request<SieveAcceptedRun>({
      method: "POST",
      path: "/api/scrapes",
      multipart: buildStartFormData(input),
      config,
      options,
    });
  }
  return request<SieveAcceptedRun>({
    method: "POST",
    path: "/api/scrapes",
    body: buildStartBody(input),
    config,
    options,
  });
}

/**
 * Deliberate retry of POST /api/scrapes ONLY for responses where no run was
 * created (429/5xx). Network/timeout errors are still never retried.
 */
export async function createScrapeWithSafeRetry(
  input: SieveStartRunInput,
  options: SieveCallOptions = {},
): Promise<SieveAcceptedRun> {
  return request<SieveAcceptedRun>({
    method: "POST",
    path: "/api/scrapes",
    body: input.document ? undefined : buildStartBody(input),
    multipart: input.document ? buildStartFormData(input) : undefined,
    config: requireConfig(options.config),
    options: { ...options, retry: options.retry ?? { retries: 2 } },
  });
}

/** GET /api/scrapes/<session_id> — retries 5xx/network with backoff. */
export async function getScrape(
  sessionId: string,
  options: SieveCallOptions = {},
): Promise<SieveRun> {
  return request<SieveRun>({
    method: "GET",
    path: `/api/scrapes/${encodeURIComponent(sessionId)}`,
    options: { ...options, retry: options.retry ?? { retries: DEFAULT_GET_RETRIES } },
  });
}

/** POST /api/scrapes/<session_id>/messages — single attempt; 409 → TURN_IN_FLIGHT. */
export async function sendMessage(
  sessionId: string,
  input: SieveFollowUpInput,
  options: SieveCallOptions = {},
): Promise<SieveRun> {
  return request<SieveRun>({
    method: "POST",
    path: `/api/scrapes/${encodeURIComponent(sessionId)}/messages`,
    body: buildStartBody(input),
    options,
  });
}

/** GET /api/me/credits. */
export async function getCredits(options: SieveCallOptions = {}): Promise<SieveCredits> {
  return request<SieveCredits>({ method: "GET", path: "/api/me/credits", options });
}

/** Download a delivered file (relative url + Bearer). */
export async function downloadFile(
  file: SieveFile,
  options: SieveCallOptions = {},
): Promise<{ name: string; contentType: string; bytes: ArrayBuffer }> {
  const config = requireConfig(options.config);
  const res = await rawFetch(
    fileUrl(file, config),
    { method: "GET", headers: { Authorization: `Bearer ${config.apiKey}` } },
    options,
  );
  if (!res.ok) {
    const body = await readBody(res);
    throw mapHttpError(res.status, body, parseRetryAfter(res.headers.get("retry-after")));
  }
  return {
    name: file.name,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    bytes: await res.arrayBuffer(),
  };
}

// ── device login (unauthenticated; key does not exist yet) ───────────────────

/** POST /api/auth/device/code. */
export async function requestDeviceCode(
  clientName: string,
  options: SieveRequestOptions & { baseUrl?: string } = {},
): Promise<SieveDeviceCode> {
  const base = (options.baseUrl ?? baseUrlOf(options.config)).replace(/\/+$/, "");
  const res = await rawFetch(
    `${base}/api/auth/device/code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_name: clientName }),
    },
    options,
  );
  if (!res.ok) throw mapHttpError(res.status, await readBody(res));
  return (await res.json()) as SieveDeviceCode;
}

/** POST /api/auth/device/token — one poll. */
export async function pollDeviceToken(
  deviceCode: string,
  options: SieveRequestOptions & { baseUrl?: string } = {},
): Promise<SieveDeviceTokenResult> {
  const base = (options.baseUrl ?? baseUrlOf(options.config)).replace(/\/+$/, "");
  const res = await rawFetch(
    `${base}/api/auth/device/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    },
    options,
  );

  if (res.status === 200) {
    const body = (await res.json()) as { api_key?: string; token_type?: string; key_name?: string };
    if (!body.api_key) {
      throw new SieveError("UNKNOWN_ERROR", "Sieve device token response contained no api_key.");
    }
    return {
      status: "approved",
      apiKey: body.api_key,
      tokenType: body.token_type ?? "Bearer",
      keyName: body.key_name ?? "",
    };
  }

  if (res.status === 400) {
    const body = (await readBody(res)) as { error?: string } | string | undefined;
    const code = typeof body === "string" ? body : body?.error ?? "";
    if (code === "authorization_pending") return { status: "pending" };
    if (code === "slow_down") return { status: "slow_down" };
    if (code === "access_denied") return { status: "denied" };
    if (code === "expired_token") return { status: "expired" };
    throw mapHttpError(res.status, body);
  }

  throw mapHttpError(res.status, await readBody(res));
}
