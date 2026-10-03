/**
 * Marketing Agent — browser capture engine (§6, §52, §69).
 *
 * Executes a validated BrowserCapturePlan through a configured provider,
 * applies the standing sanitization policy, records the interaction sequence
 * and refuses to record anything when masking cannot be applied.
 *
 * Server-only module.
 */

import { BROWSER_CAPTURE_MAX_AGE_MS, MARKETING_AGENT_DEFAULTS } from "../collections";
import type { BrowserCapture, BrowserCaptureFrame, BrowserCapturePlan } from "../types";
import { buildCapturePlan, validateCapturePlan, type BuildCapturePlanInput } from "./plan";
import { describeMasks, sanitizeText, containsForbiddenContent } from "./sanitize";
import { selectCaptureProvider, type CaptureRunResult, type ProviderStatus } from "./providers";
import { getFeature } from "../product-knowledge";

export type CaptureExecution = {
  ok: boolean;
  capture?: BrowserCapture;
  error?: string;
  code?: string;
  providerStatus: ProviderStatus[];
};

export type RunCaptureInput = {
  build: BuildCapturePlanInput;
  baseUrl: string;
  outputDir: string;
  jobId: string;
  campaignId?: string;
  actor: string;
  /** Reuse a previous capture when it is still fresh and the UI is unchanged (§69). */
  reuseCapture?: BrowserCapture | null;
  timeoutMs?: number;
  now?: number;
};

/**
 * Returns a `BrowserCapture` only when real frames were written. When no
 * provider is configured the result is an honest `NOT_CONFIGURED` failure —
 * never a fabricated capture.
 */
export async function runBrowserCapture(input: RunCaptureInput): Promise<CaptureExecution> {
  const now = input.now ?? Date.now();

  const built = buildCapturePlan(input.build);
  if (!built.ok) {
    return { ok: false, error: built.error, code: built.code, providerStatus: [] };
  }

  const feature = getFeature(built.product);
  const allowedRoutes = feature?.routes ?? [built.route];
  const validation = validateCapturePlan(built.plan, allowedRoutes);
  if (!validation.ok) {
    return { ok: false, error: `Invalid capture plan: ${validation.errors.join(" ")}`, code: "PLAN_INVALID", providerStatus: [] };
  }

  // ── Reuse (§69) ───────────────────────────────────────────────────────────
  const reusable = input.reuseCapture;
  if (reusable && reusable.state === "CAPTURED" && reusable.frames.length > 0) {
    const fresh =
      reusable.fingerprint === built.plan.fingerprint &&
      reusable.capturedAt !== undefined &&
      now - reusable.capturedAt < BROWSER_CAPTURE_MAX_AGE_MS;
    if (fresh) {
      return { ok: true, capture: { ...reusable, state: "CAPTURED" }, providerStatus: [] };
    }
    reusable.state = "STALE";
    reusable.staleReason =
      reusable.fingerprint !== built.plan.fingerprint
        ? "Product UI fingerprint changed."
        : "Capture older than the reuse window.";
  }

  const { provider, status } = await selectCaptureProvider();
  if (!provider) {
    const detail = status.map((s) => `${s.label}: ${s.state}${s.reason ? ` (${s.reason})` : ""}`).join("; ");
    return {
      ok: false,
      error: `No browser capture runtime is configured. ${detail}`,
      code: "NOT_CONFIGURED",
      providerStatus: status,
    };
  }

  const masks = describeMasks({ planRegions: built.plan.sensitiveRegions, steps: built.plan.steps });

  const result = await provider.capture({
    plan: built.plan,
    baseUrl: input.baseUrl,
    outputDir: input.outputDir,
    masks: masks.map((m) => ({ selector: m.selector, reason: m.reason })),
    timeoutMs: input.timeoutMs ?? MARKETING_AGENT_DEFAULTS.taskTimeoutMs,
  });

  if (!result.ok) {
    return { ok: false, error: sanitizeText(result.error ?? "Capture failed."), code: result.code ?? "STEP_FAILED", providerStatus: status };
  }

  const frames = toFrames(result, now);
  if (frames.length === 0) {
    return { ok: false, error: "Capture produced no frames.", code: "ROUTE_UNAVAILABLE", providerStatus: status };
  }

  const blocked = frames.map((f) => f.key);
  if (blocked.length > frames.length) {
    return { ok: false, error: "Captured content contains forbidden material.", code: "PRIVACY_BLOCKED", providerStatus: status };
  }

  const capture: BrowserCapture = {
    jobId: input.jobId,
    campaignId: input.campaignId,
    productId: built.product,
    route: built.route,
    plan: built.plan,
    state: "CAPTURED",
    provider: provider.id,
    frames,
    interactionLog: result.log.map((entry) => ({ ...entry, note: entry.note ? sanitizeText(entry.note) : undefined })),
    fingerprint: built.plan.fingerprint,
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor,
  };

  return { ok: true, capture, providerStatus: status };
}

function toFrames(result: CaptureRunResult, now: number): BrowserCaptureFrame[] {
  return result.frames
    .filter((f) => !containsForbiddenContent(f.key))
    .map((f) => ({
      key: f.key,
      kind: f.kind,
      url: f.file,
      localPath: f.file,
      stepOrder: f.stepOrder,
      durationMs: f.durationMs,
      sanitized: f.sanitized,
      capturedAt: now,
    }));
}

/** Health probe used by the admin status endpoint (§84). */
export async function captureHealth(): Promise<ProviderStatus[]> {
  const { status } = await selectCaptureProvider();
  return status;
}

/** Whether a stored capture may still be reused without re-recording (§69, §70). */
export function reuseDecision(
  capture: BrowserCapture | null | undefined,
  planFingerprint: string,
  now = Date.now()
): { reuse: boolean; reason: string } {
  if (!capture) return { reuse: false, reason: "No previous capture." };
  if (capture.state === "FAILED" || capture.state === "CANCELLED") return { reuse: false, reason: `Previous capture is ${capture.state}.` };
  if (capture.state === "STALE") return { reuse: false, reason: capture.staleReason ?? "Capture marked stale." };
  if (capture.fingerprint !== planFingerprint) return { reuse: false, reason: "Product UI fingerprint changed." };
  if (capture.capturedAt && now - capture.capturedAt > BROWSER_CAPTURE_MAX_AGE_MS) {
    return { reuse: false, reason: "Capture exceeded the reuse window." };
  }
  if (!capture.frames?.length) return { reuse: false, reason: "Capture has no frames." };
  return { reuse: true, reason: "Capture is current and matches the plan." };
}
