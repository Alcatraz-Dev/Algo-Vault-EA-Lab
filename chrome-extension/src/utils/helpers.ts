import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  return price.toFixed(4);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export interface SymbolInfo {
  provider: string | null;
  rawSymbol: string;
  normalizedSymbol: string;
}

const SYMBOL_PREFIXES: Record<string, string> = {
  "OANDA:": "OANDA",
  "FX:": "FX",
  "XAU:": "XAU",
  "XAG:": "XAG",
  "BINANCE:": "BINANCE",
  "BYBIT:": "BYBIT",
  "COINBASE:": "COINBASE",
  "NASDAQ:": "NASDAQ",
  "NYSE:": "NYSE",
  "AMEX:": "AMEX",
  "INDEX:": "INDEX",
  "CRYPTO:": "CRYPTO",
  "TVC:": "TVC",
  "CME:": "CME",
  "ICE:": "ICE",
  "LSE:": "LSE",
  "TSE:": "TSE",
};

export function normalizeSymbolInput(raw: string): SymbolInfo {
  const trimmed = raw.trim();
  for (const [prefix, provider] of Object.entries(SYMBOL_PREFIXES)) {
    if (trimmed.startsWith(prefix)) {
      return {
        provider,
        rawSymbol: trimmed,
        normalizedSymbol: trimmed.slice(prefix.length).toUpperCase().trim(),
      };
    }
  }
  return {
    provider: null,
    rawSymbol: trimmed,
    normalizedSymbol: trimmed.toUpperCase().trim(),
  };
}

export function normalizeSymbol(symbol: string): string {
  return normalizeSymbolInput(symbol).normalizedSymbol;
}

export function symbolDisplayName(symbol: string | null | undefined): string {
  if (!symbol) return "—";
  const normalized = normalizeSymbol(symbol);
  if (normalized.length <= 6) return normalized;
  return normalized.slice(0, 6);
}

const TIMEFRAME_MAP: Record<string, string> = {
  "1": "M1",
  "3": "M3",
  "5": "M5",
  "15": "M15",
  "30": "M30",
  "60": "H1",
  "120": "H4",
  "240": "H4",
  "1D": "D1",
};

export function normalizeTimeframe(tf: string): string | null {
  const upper = tf.trim().toUpperCase().replace(" ", "");
  if (TIMEFRAME_MAP[upper]) return TIMEFRAME_MAP[upper];
  const minuteMatch = upper.match(/^(\d+)M$/);
  if (minuteMatch) return `M${minuteMatch[1]}`;
  const hourMatch = upper.match(/^(\d+)H$/);
  if (hourMatch) {
    const h = parseInt(hourMatch[1], 10);
    if (h === 1) return "H1";
    if (h === 4) return "H4";
    if (h === 24) return "D1";
    if (h >= 1 && h <= 12) return `H${h}`;
  }
  if (upper === "1DAY" || upper === "1D") return "D1";
  if (upper === "1W") return "W1";
  return null;
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
