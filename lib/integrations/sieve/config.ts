// Sieve scrape API — server-only configuration.
//
// Mirrors the ERPNext integration convention (lib/integrations/erpnext/config.ts):
// a plain env reader with no side effects. `SIEVE_API_KEY` is server-only and
// must never be exposed to client code, logs or git. When the key is absent the
// integration is disabled and every entry point fails closed with
// NOT_CONFIGURED — the rest of the app behaves exactly as before.

export const SIEVE_DEFAULT_BASE_URL = "https://scrape.usesieve.com";

/** Polling defaults from the contract: start at 5s, back off to ~30s. */
export const SIEVE_DEFAULT_POLL_INITIAL_MS = 5_000;
export const SIEVE_DEFAULT_POLL_MAX_MS = 30_000;

export interface SieveConfig {
  /** Raw API key (dc_sk_...). Empty when unset. */
  apiKey: string;
  /** API base URL, no trailing slash. */
  baseUrl: string;
  /** True only when an API key is present. */
  enabled: boolean;
  pollInitialMs: number;
  pollMaxMs: number;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(raw ?? "", 10);
  if (isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function loadSieveConfig(): SieveConfig {
  const apiKey = (process.env.SIEVE_API_KEY ?? "").trim();
  return {
    apiKey,
    baseUrl: (process.env.SIEVE_BASE_URL ?? SIEVE_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    enabled: apiKey.length > 0,
    pollInitialMs: clampInt(
      process.env.SIEVE_POLL_INITIAL_MS,
      SIEVE_DEFAULT_POLL_INITIAL_MS,
      1_000,
      600_000,
    ),
    pollMaxMs: clampInt(process.env.SIEVE_POLL_MAX_MS, SIEVE_DEFAULT_POLL_MAX_MS, 1_000, 600_000),
  };
}

export function isSieveConfigured(config: SieveConfig = loadSieveConfig()): boolean {
  return config.enabled && config.baseUrl.length > 0;
}
