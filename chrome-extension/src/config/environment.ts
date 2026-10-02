export function getAlgoVaultUrl(): string {
  const envUrl = typeof import.meta !== "undefined" && (import.meta.env as Record<string, string>)?.VITE_ALGOVAULT_URL;
  if (envUrl) return envUrl;
  // Production default — the extension talks to the deployed AlgoVault web
  // app unless a build explicitly overrides it (dev workflow sets
  // VITE_ALGOVAULT_URL=http://localhost:3000 in chrome-extension/.env).
  return "https://algovault.dev";
}

/**
 * True only for LOCAL DEVELOPMENT builds (vite dev server / non-prod build).
 * Never derived from the API URL: a localhost URL must not flip user-facing
 * surfaces into "developer mode".
 */
export function isDevelopment(): boolean {
  return typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
}
