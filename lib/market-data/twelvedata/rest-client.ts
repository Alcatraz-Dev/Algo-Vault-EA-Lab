/**
 * Twelve Data REST client.
 *
 * Low-level HTTP client for Twelve Data API endpoints.
 * Handles authentication, timeouts, retries, and error parsing.
 * The API key is NEVER exposed to the browser.
 */

import { TWELVE_DATA_CONFIG, getTwelveDataApiKey } from "./config";
import { Timeframe } from "../types";

export interface TwelveDataError {
  code: number;
  message: string;
  status: "error";
}

export interface TimeSeriesMeta {
  symbol: string;
  interval: string;
  currency: string;
  exchange_timezone: string;
  exchange: string;
  mic_code: string;
  type: string;
}

export interface TimeSeriesBar {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

export interface TimeSeriesResponse {
  meta?: TimeSeriesMeta;
  values?: TimeSeriesBar[];
  status?: string;
}

export interface QuoteResponse {
  symbol?: string;
  name?: string;
  exchange?: string;
  mic_code?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  last_quote_at?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  average_volume?: string;
  is_market_open?: boolean;
  fifty_two_week?: {
    low?: string;
    high?: string;
  };
  status?: string;
}

export interface PriceResponse {
  price?: string;
  status?: string;
}

export interface MarketStateResponse {
  market?: string;
  state?: "open" | "closed" | "pre_market" | "post_market" | "extended";
  status?: string;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface SymbolSearchResponse {
  data?: SymbolSearchResult[];
}

function isTwelveDataError(data: unknown): data is TwelveDataError {
  return (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    (data as { status?: string }).status === "error"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function twelveDataFetch<T>(
  endpoint: string,
  params: Record<string, string>,
  options?: { retries?: number; timeoutMs?: number }
): Promise<T | null> {
  const apiKey = getTwelveDataApiKey();
  if (!apiKey) {
    console.warn("[twelvedata] Missing TWELVE_DATA_API_KEY");
    return null;
  }

  const url = new URL(`${TWELVE_DATA_CONFIG.restBaseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("format", "JSON");

  const retries = options?.retries ?? TWELVE_DATA_CONFIG.maxRetries;
  const timeoutMs = options?.timeoutMs ?? TWELVE_DATA_CONFIG.timeoutMs;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });
      clearTimeout(timer);

      if (response.status === 429) {
        lastError = new Error("Twelve Data rate limit (429)");
        if (attempt < retries) {
          const retryAfter = Number(response.headers.get("Retry-After")) || 1;
          await delay(Math.min(retryAfter * 1000, 5000));
          continue;
        }
        return null;
      }

      if (response.status === 401) {
        console.error("[twelvedata] Invalid API key (401)");
        return null;
      }

      if (response.status === 403) {
        console.error("[twelvedata] Forbidden (403) - plan upgrade required");
        return null;
      }

      if (!response.ok) {
        lastError = new Error(`Twelve Data HTTP ${response.status}`);
        if (attempt < retries) await delay(150 * (attempt + 1));
        continue;
      }

      const data = (await response.json()) as T;

      if (isTwelveDataError(data)) {
        console.warn("[twelvedata] API error", { code: data.code, message: data.message });
        return null;
      }

      return data;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) await delay(150 * (attempt + 1));
    }
  }

  console.warn("[twelvedata] Request failed after retries", {
    endpoint,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return null;
}

/**
 * Map AlgoVault Timeframe to Twelve Data interval string.
 * Supported: 1min, 5min, 15min, 30min, 45min, 1h, 2h, 4h, 8h, 1day, 1week, 1month
 */
export function timeframeToTwelveDataInterval(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    M1: "1min",
    M3: "3min",
    M5: "5min",
    M15: "15min",
    M30: "30min",
    H1: "1h",
    H4: "4h",
    D1: "1day",
  };
  return map[tf];
}

export async function fetchTimeSeries(
  tdSymbol: string,
  interval: string,
  outputsize: number,
  options?: { startDate?: string; endDate?: string }
): Promise<TimeSeriesResponse | null> {
  const params: Record<string, string> = {
    symbol: tdSymbol,
    interval,
    outputsize: String(Math.min(outputsize, 5000)),
    order: "desc",
  };
  if (options?.startDate) params.start_date = options.startDate;
  if (options?.endDate) params.end_date = options.endDate;

  return twelveDataFetch<TimeSeriesResponse>("/time_series", params);
}

export async function fetchQuote(tdSymbol: string): Promise<QuoteResponse | null> {
  return twelveDataFetch<QuoteResponse>("/quote", { symbol: tdSymbol });
}

export async function fetchPrice(tdSymbol: string): Promise<PriceResponse | null> {
  return twelveDataFetch<PriceResponse>("/price", { symbol: tdSymbol });
}

export async function fetchMarketState(
  tdSymbol: string
): Promise<MarketStateResponse | null> {
  return twelveDataFetch<MarketStateResponse>("/market_state", { symbol: tdSymbol });
}

export async function symbolSearch(
  query: string
): Promise<SymbolSearchResult[]> {
  const data = await twelveDataFetch<SymbolSearchResponse>("/symbol_search", {
    symbol: query,
  });
  return data?.data ?? [];
}