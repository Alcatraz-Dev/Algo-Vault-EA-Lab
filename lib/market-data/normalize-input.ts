/**
 * normalize-input.ts
 *
 * Shared helpers for normalizing extension API inputs.
 *
 * TradingView sends symbols prefixed with a broker exchange (e.g. "OANDA:XAUUSD",
 * "BINANCE:BTCUSDT") and timeframes as numeric strings (e.g. "60" = H1, "240" = H4).
 * All API routes must strip these before hitting the SUPPORTED_SET check.
 */

import type { Timeframe } from "@/lib/market-data/types";

/**
 * Strip a TradingView broker prefix from a symbol.
 *
 * "OANDA:XAUUSD"  → "XAUUSD"
 * "BINANCE:BTCUSDT" → "BTCUSDT"
 * "XAUUSD"        → "XAUUSD"  (no-op when already clean)
 */
export function normalizeSymbol(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().toUpperCase();
  const colonIdx = trimmed.indexOf(":");
  return colonIdx !== -1 ? trimmed.slice(colonIdx + 1) : trimmed;
}

/** TradingView numeric → canonical Timeframe map */
const TV_TIMEFRAME_MAP: Record<string, Timeframe> = {
  "1": "M1",
  "3": "M3",
  "5": "M5",
  "15": "M15",
  "30": "M30",
  "60": "H1",
  "120": "H1",  // some TVs send 120 for H1/H2 — best-effort map
  "240": "H4",
  "D": "D1",
  "1D": "D1",
  "W": "W1",
  "1W": "W1",
};

const VALID_TIMEFRAMES = new Set<string>(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]);

/**
 * Normalise a raw timeframe string.
 *
 * Accepts canonical strings ("H1") and TradingView numeric codes ("60").
 * Falls back to the provided `fallback` (default "H1") for unknown values.
 */
export function normalizeTimeframe(raw: unknown, fallback: Timeframe = "H1"): Timeframe {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const upper = raw.trim().toUpperCase();
  if (VALID_TIMEFRAMES.has(upper)) return upper as Timeframe;
  if (TV_TIMEFRAME_MAP[upper]) return TV_TIMEFRAME_MAP[upper];
  return fallback;
}
