/**
 * Twelve Data configuration.
 * The API key is read from environment variables server-side only.
 * NEVER expose TWELVE_DATA_API_KEY to the browser.
 */

export const TWELVE_DATA_CONFIG = {
  restBaseUrl: "https://api.twelvedata.com",
  wsUrl: "wss://ws.twelvedata.com",
  timeoutMs: 8000,
  maxRetries: 2,
} as const;

export function getTwelveDataApiKey(): string | undefined {
  return process.env.TWELVE_DATA_API_KEY;
}

export function hasTwelveDataApiKey(): boolean {
  return Boolean(process.env.TWELVE_DATA_API_KEY);
}