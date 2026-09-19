/**
 * Symbol utilities for the browser intelligence layer.
 *
 * Turns a raw TradingView identifier ("OANDA:XAUUSD", "BINANCE:BTCUSDT",
 * "NASDAQ:AAPL", "FX_IDC:EURUSD", "TVC:US30") into an AlgoVault-market-data
 * symbol that is validated against SUPPORTED_SYMBOLS. The normalizer is the
 * single authority used by the content script, chart-intelligence service and
 * market service so every feature sees the exact same market symbol.
 */
import type { Market } from "../types/chart-context";
import { SUPPORTED_SYMBOLS } from "../../../lib/market-data/types";

/** Parsed TradingView-style symbol reference. */
export interface ParsedSymbol {
  /** Exchange/feed prefix, e.g. "OANDA". Null when no prefix present. */
  exchange: string | null;
  /** Full raw identifier as seen in the browser, e.g. "OANDA:XAUUSD". */
  raw: string;
  /** Ticker part (uppercased, spaces removed), e.g. "XAUUSD". */
  ticker: string;
  /** The exact raw ticker before casing cleanup (used for crypto settlements). */
  rawTicker: string;
}

/**
 * Aliases from exchange-specific tickers to the canonical AlgoVault market
 * symbol. Keys are the raw ticker (uppercased). Falls back to the plain
 * ticker when no alias exists.
 */
const EXCHANGE_ALIASES: Record<string, string | undefined> = {
  // ── Crypto (exchange feeds add the quote asset suffix) ──────────────
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
  SOLUSDT: "SOLUSD",
  XRPUSDT: "XRPUSD",
  ADAUSDT: "ADAUSD",
  DOGEUSDT: "DOGEUSD",
  BNBUSDT: "BNBUSD",
  LTCUSDT: "LTCUSD",
  DOTUSDT: "DOTUSD",
  BTCUSDTPERP: "BTCUSD",
  ETHUSDTPERP: "ETHUSD",
  // ── Index feeds ──────────────────────────────────────────────────────
  US30: "US30",
  DJI: "US30",
  NAS100: "NAS100",
  NDX: "NAS100",
  SPX500: "SPX500",
  SPX: "SPX500",
  DXY: "DXY",
  // ── Equities (exchange prefixes carry no alias, ticker passes through) ──
};

/** Exchanges whose tickers map straight onto the canonical symbol. */
const PASSTHROUGH_EXCHANGES = new Set([
  "NASDAQ",
  "NYSE",
  "AMEX",
  "BATS",
  "ARCA",
  "OANDA",
  "FX_IDC",
  "FOREXCOM",
  "FXCM",
  "TVC",
  "INDEX",
  "SP",
]);

const FOREX_TICKERS = new Set([
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD",
  "USDCAD", "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "EURCHF",
]);

const CRYPTO_TICKERS = new Set([
  "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD",
  "DOGEUSD", "BNBUSD", "LTCUSD", "DOTUSD",
]);

const INDEX_TICKERS = new Set(["US30", "NAS100", "SPX500", "SPY", "QQQ", "DXY"]);

const EQUITY_TICKERS = new Set([
  "AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "COIN",
]);

/** Parse an `EXCHANGE:TICKER` (or bare ticker) TradingView symbol reference. */
export function parseSymbol(input: string | null | undefined): ParsedSymbol | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0) {
    const exchange = trimmed.slice(0, colonIndex).trim().toUpperCase() || null;
    const rawTicker = trimmed.slice(colonIndex + 1).trim();
    return {
      exchange,
      raw: trimmed,
      ticker: rawTicker.toUpperCase().replace(/\s+/g, ""),
      rawTicker,
    };
  }

  return {
    exchange: null,
    raw: trimmed,
    ticker: trimmed.toUpperCase().replace(/\s+/g, ""),
    rawTicker: trimmed,
  };
}

/** Classify a canonical market symbol into a Market bucket. */
export function classifyMarket(ticker: string): Market {
  const t = ticker.toUpperCase();
  if (FOREX_TICKERS.has(t)) return "forex";
  if (CRYPTO_TICKERS.has(t)) return "crypto";
  if (t === "XAUUSD" || t === "XAGUSD") return "metal";
  if (INDEX_TICKERS.has(t)) return "index";
  if (EQUITY_TICKERS.has(t)) return "stock";
  // Generic heuristics for unlisted symbols.
  if (t.startsWith("X") && t.endsWith("USD")) return "metal";
  if (t.endsWith("USD") && t.length <= 7) return "forex";
  return "unknown";
}

/** Whether a ticker is known to the AlgoVault market-data layer. */
export function isSupportedSymbol(ticker: string): boolean {
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(ticker.toUpperCase());
}

export interface ResolvedSymbol {
  /** Canonical AlgoVault market symbol (e.g. "XAUUSD", "BTCUSD", "AAPL"). */
  symbol: string;
  market: Market;
  exchange: string | null;
  ticker: string;
  raw: string;
}

export interface UnsupportedSymbol {
  reason: string;
  ticker: string;
  raw: string | null;
}

/**
 * Resolve any TradingView symbol reference to a supported AlgoVault market
 * symbol. Returns `{ symbol, market, ... }` on success or
 * `{ reason, ... }` when the symbol cannot be served by market data.
 */
export function resolveMarketSymbol(
  input: string | null | undefined,
): ResolvedSymbol | UnsupportedSymbol {
  const parsed = parseSymbol(input);
  if (!parsed) {
    return { reason: "empty", ticker: "", raw: null };
  }

  const alias = EXCHANGE_ALIASES[parsed.ticker];
  const candidate = alias ?? parsed.ticker;

  if (parsed.exchange && !PASSTHROUGH_EXCHANGES.has(parsed.exchange) && !alias) {
    // Unknown exchange: we can only proceed when the ticker maps cleanly.
    if (!isSupportedSymbol(candidate)) {
      return {
        reason: `unsupported exchange:${parsed.exchange}`,
        ticker: candidate,
        raw: parsed.raw,
      };
    }
  }

  if (isSupportedSymbol(candidate)) {
    return {
      symbol: candidate,
      market: classifyMarket(candidate),
      exchange: parsed.exchange,
      ticker: candidate,
      raw: parsed.raw,
    };
  }

  return {
    reason: `unsupported symbol:${candidate}`,
    ticker: candidate,
    raw: parsed.raw,
  };
}

/** Human-friendly chart label, e.g. "OANDA:XAUUSD · XAUUSD" → "XAUUSD". */
export function symbolDisplay(raw: string | null | undefined, maxLength = 8): string {
  const parsed = parseSymbol(raw);
  if (!parsed) return "—";
  // Keep the richest readable form: exchange prefix + ticker, clipped.
  const label = parsed.exchange ? `${parsed.exchange}:${parsed.ticker}` : parsed.ticker;
  return label.length <= maxLength ? label : label.slice(0, maxLength);
}

/** Normalize a timeframe string seen in the browser to a market-data Timeframe. */
export function normalizeTradingViewTimeframe(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!upper) return null;
  switch (upper) {
    case "1":
    case "1M":
    case "60S":
      return "M1";
    case "3":
    case "3M":
      return "M3";
    case "5":
    case "5M":
      return "M5";
    case "15":
    case "15M":
      return "M15";
    case "30":
    case "30M":
      return "M30";
    case "60":
    case "1H":
      return "H1";
    case "240":
    case "4H":
      return "H4";
    case "D":
    case "1D":
    case "1DAY":
    case "1440":
      return "D1";
    default:
      return null;
  }
}