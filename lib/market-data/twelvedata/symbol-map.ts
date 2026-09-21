/**
 * Twelve Data symbol normalization.
 *
 * Maps AlgoVault internal SupportedSymbol values to Twelve Data provider
 * symbols (which use the "BASE/QUOTE" format for forex/metals/crypto).
 *
 * If a symbol is not supported by Twelve Data, the mapper returns null
 * instead of silently producing fake data.
 */

import { SupportedSymbol } from "../types";

/**
 * Twelve Data uses "BASE/QUOTE" notation for forex, metals, and crypto.
 * Indices and stocks use their standard ticker symbols.
 */
export const TWELVE_DATA_SYMBOL_MAP: Record<SupportedSymbol, string> = {
  // Forex
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCHF: "USD/CHF",
  AUDUSD: "AUD/USD",
  NZDUSD: "NZD/USD",
  USDCAD: "USD/CAD",
  EURGBP: "EUR/GBP",
  EURJPY: "EUR/JPY",
  GBPJPY: "GBP/JPY",
  AUDJPY: "AUD/JPY",
  EURCHF: "EUR/CHF",
  AUDCNH: "AUD/CNH",
  USDCNH: "USD/CNH",
  // Metals
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
  // Indices
  US30: "DJI",
  NAS100: "NDX",
  SPX500: "SPX",
  SPY: "SPY",
  QQQ: "QQQ",
  DXY: "DXY",
  // Crypto
  BTCUSD: "BTC/USD",
  ETHUSD: "ETH/USD",
  SOLUSD: "SOL/USD",
  XRPUSD: "XRP/USD",
  ADAUSD: "ADA/USD",
  DOGEUSD: "DOGE/USD",
  BNBUSD: "BNB/USD",
  LTCUSD: "LTC/USD",
  DOTUSD: "DOT/USD",
  // US Equities
  AAPL: "AAPL",
  TSLA: "TSLA",
  MSFT: "MSFT",
  NVDA: "NVDA",
  AMZN: "AMZN",
  META: "META",
  GOOGL: "GOOGL",
  AMD: "AMD",
  NFLX: "NFLX",
  COIN: "COIN",
};

/**
 * Reverse map: Twelve Data symbol -> AlgoVault SupportedSymbol.
 */
export function toSupportedSymbol(tdSymbol: string): SupportedSymbol | null {
  const upper = tdSymbol.toUpperCase();
  for (const [sym, td] of Object.entries(TWELVE_DATA_SYMBOL_MAP) as [SupportedSymbol, string][]) {
    if (td.toUpperCase() === upper) return sym;
  }
  return null;
}

/**
 * Get the Twelve Data provider symbol for an AlgoVault symbol.
 * Returns null if the symbol is not mapped.
 */
export function toTwelveDataSymbol(symbol: SupportedSymbol): string | null {
  return TWELVE_DATA_SYMBOL_MAP[symbol] ?? null;
}

/**
 * Normalize a user-facing symbol string (e.g. "EURUSD", "EUR/USD", "eur-usd")
 * into an AlgoVault SupportedSymbol.
 */
export function normalizeSymbolInput(input: string): SupportedSymbol | null {
  if (!input) return null;
  const cleaned = input.trim().toUpperCase().replace(/[\s\-]/g, "");
  const withSlash = cleaned.replace(/^([A-Z]{3,4})([A-Z]{3,4})$/, "$1/$2");
  const withoutSlash = withSlash.replace("/", "");

  // Direct match
  const direct = (cleaned as SupportedSymbol) ||
    (withoutSlash as SupportedSymbol) ||
    (withSlash as SupportedSymbol);
  if (direct && (TWELVE_DATA_SYMBOL_MAP as Record<string, string>)[direct]) {
    return direct;
  }

  // Try matching by Twelve Data symbol
  for (const [sym, td] of Object.entries(TWELVE_DATA_SYMBOL_MAP) as [SupportedSymbol, string][]) {
    if (td.toUpperCase() === withSlash || td.replace("/", "") === withoutSlash) {
      return sym;
    }
  }

  return null;
}