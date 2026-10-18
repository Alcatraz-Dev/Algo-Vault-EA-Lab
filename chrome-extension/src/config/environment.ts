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
