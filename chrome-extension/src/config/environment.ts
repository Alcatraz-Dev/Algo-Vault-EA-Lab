export const PRODUCTION_ALGOVAULT_URL = "https://algo-vault-ea-lab.vercel.app";

export function getAlgoVaultUrl(): string {
  const envUrl = typeof import.meta !== "undefined" && (import.meta.env as Record<string, string>)?.VITE_ALGOVAULT_URL;
  if (envUrl) return envUrl;
  // Production default — the deployed AlgoVault web app (verified: serves
  // /api/health with {"ok":true}). The dev workflow overrides this with
  // VITE_ALGOVAULT_URL=http://localhost:3000 in chrome-extension/.env, and
  // release builds pin the production URL via chrome-extension/.env.production.
  // NOTE: https://algovault.dev does NOT resolve (NXDOMAIN) — never use it.
  return PRODUCTION_ALGOVAULT_URL;
}

/**
 * True only for LOCAL DEVELOPMENT builds (vite dev server / non-prod build).
 * Never derived from the API URL: a localhost URL must not flip user-facing
 * surfaces into "developer mode".
 */
export function isDevelopment(): boolean {
  return typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
}

/**
 * Normalize a candidate server URL (e.g. from persisted settings) into a
 * usable https?://origin, or fall back to the build's own default.
 *
 * Stored settings can hold an empty string (options saved before the async
 * settings load), a protocol-less host, or a dead domain — all of which
 * make `fetch()` reject with an opaque TypeError that used to surface as
 * the generic "Cannot reach AlgoVault server". Resolving centrally keeps
 * every API caller on a valid URL and lets error reporting distinguish a
 * misconfigured address from a real network failure.
 */
export function resolveAlgovaultUrl(raw: unknown): string {
  const fallback = getAlgoVaultUrl();
  if (typeof raw !== "string") return fallback;
  let candidate = raw.trim().replace(/\/+$/, "");
  if (!candidate) return fallback;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
    if (!parsed.hostname || /\s/.test(parsed.hostname)) return fallback;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return fallback;
  }
}
