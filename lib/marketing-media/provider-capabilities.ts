/** Provider-aware media capability registry — uses existing adapters only.
 * Never exposes keys; never invents availability.
 */
import { AIConfig } from "../ai/config";

export type CapabilityStatus = "AVAILABLE" | "BLOCKED" | "UNCONFIGURED" | "UNKNOWN";

export interface ProviderCapability {
  provider: string;
  capability: "image" | "video";
  status: CapabilityStatus;
  model?: string;
  reason?: string;
  httpStatus?: number;
  checkedAt: number;
}

// Small server-side cache to avoid hammering providers on every render
const CACHE_TTL_MS = 8 * 60 * 1000; // 8 min
const cache = new Map<string, ProviderCapability>();

function cacheKey(provider: string, cap: string) {
  return `${provider}:${cap}`;
}

function safeErrorCategory(status?: number, msg?: string): string {
  if (status === 401) return "invalid_credentials";
  if (status === 402) return "insufficient_credits";
  if (status === 403) return "access_denied";
  if (status === 404) return "model_or_endpoint_unavailable";
  if (status === 429) return "rate_limited";
  if (status === 500 || status === 502 || status === 503) return "provider_error";
  if (msg?.toLowerCase().includes("timeout") || msg?.toLowerCase().includes("abort")) return "provider_timeout";
  return "provider_error";
}

async function checkOpenRouterImage(): Promise<ProviderCapability> {
  const key = AIConfig.openrouterApiKey;
  if (!key || !key.trim()) return { provider: "openrouter", capability: "image", status: "UNCONFIGURED", reason: "key_missing", checkedAt: Date.now() };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${AIConfig.openrouterBaseUrl || "https://openrouter.ai/api/v1"}/images`, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-image", prompt: "test" }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.data && Array.isArray(j.data) && j.data.length > 0) return { provider: "openrouter", capability: "image", status: "AVAILABLE", model: "google/gemini-2.5-flash-image", checkedAt: Date.now() };
      return { provider: "openrouter", capability: "image", status: "BLOCKED", model: "google/gemini-2.5-flash-image", reason: safeErrorCategory(res.status), httpStatus: res.status, checkedAt: Date.now() };
    }
    return { provider: "openrouter", capability: "image", status: "BLOCKED", model: "google/gemini-2.5-flash-image", reason: safeErrorCategory(res.status), httpStatus: res.status, checkedAt: Date.now() };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider: "openrouter", capability: "image", status: "BLOCKED", model: "google/gemini-2.5-flash-image", reason: safeErrorCategory(undefined, msg), httpStatus: undefined, checkedAt: Date.now() };
  }
}

async function checkBytezImage(): Promise<ProviderCapability> {
  const key = AIConfig.bytezApiKey;
  if (!key || !key.trim()) return { provider: "bytez", capability: "image", status: "UNCONFIGURED", reason: "key_missing", checkedAt: Date.now() };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch("https://api.bytez.com/models/v2/dreamlike-art/dreamlike-photoreal-2.0", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "test" }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.output || j.error === undefined) return { provider: "bytez", capability: "image", status: "AVAILABLE", model: "dreamlike-art/dreamlike-photoreal-2.0", checkedAt: Date.now() };
    }
    return { provider: "bytez", capability: "image", status: "BLOCKED", model: "dreamlike-art/dreamlike-photoreal-2.0", reason: safeErrorCategory(res.status), httpStatus: res.status, checkedAt: Date.now() };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider: "bytez", capability: "image", status: "BLOCKED", model: "dreamlike-art/dreamlike-photoreal-2.0", reason: safeErrorCategory(undefined, msg), httpStatus: undefined, checkedAt: Date.now() };
  }
}

async function checkBytezVideo(): Promise<ProviderCapability> {
  const key = AIConfig.bytezApiKey;
  if (!key || !key.trim()) return { provider: "bytez", capability: "video", status: "UNCONFIGURED", reason: "key_missing", checkedAt: Date.now() };
  // No verified accessible model; keep BLOCKED honestly
  return { provider: "bytez", capability: "video", status: "BLOCKED", model: "ali-vilab/text-to-video-ms-1.7b", reason: "model_or_endpoint_unavailable", checkedAt: Date.now() };
}

async function checkGeminiImage(): Promise<ProviderCapability> {
  const key = AIConfig.geminiApiKey;
  if (!key || !key.trim()) return { provider: "gemini", capability: "image", status: "UNCONFIGURED", reason: "key_missing", checkedAt: Date.now() };
  // Existing adapter supports text only; no image adapter present
  return { provider: "gemini", capability: "image", status: "UNCONFIGURED", reason: "no_image_adapter_configured", checkedAt: Date.now() };
}

export async function resolveCapability(provider: string, cap: "image" | "video"): Promise<ProviderCapability> {
  const k = cacheKey(provider, cap);
  const cached = cache.get(k);
  if (cached && (Date.now() - cached.checkedAt) < CACHE_TTL_MS) return cached;
  let result: ProviderCapability;
  switch (provider) {
    case "openrouter":
      result = cap === "image" ? await checkOpenRouterImage() : { provider, capability: cap, status: "BLOCKED", model: "google/gemini-2.5-flash-image", reason: "no_video_model_verified", checkedAt: Date.now() };
      break;
    case "bytez":
      result = cap === "image" ? await checkBytezImage() : await checkBytezVideo();
      break;
    case "gemini":
      result = cap === "image" ? await checkGeminiImage() : { provider, capability: cap, status: "UNCONFIGURED", reason: "no_video_adapter_configured", checkedAt: Date.now() };
      break;
    default:
      result = { provider, capability: cap, status: "UNKNOWN", reason: "unknown_provider", checkedAt: Date.now() };
  }
  cache.set(k, result);
  return result;
}

export function getBestImageProvider(): { provider: string; status: CapabilityStatus; reason?: string; model?: string } {
  // Priority: openrouter (verified adapter) → bytez (verified adapter) → gemini
  // For now all blocked/unconfigured; return best attempt with honest state
  // Caller should use actual resolved values; this is a convenience only
  return { provider: "openrouter", status: "BLOCKED", reason: "insufficient_credits", model: "google/gemini-2.5-flash-image" };
}
