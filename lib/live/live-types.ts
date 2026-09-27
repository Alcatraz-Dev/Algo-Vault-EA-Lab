export type LiveActivityType =
  | "market_analysis"
  | "smart_money"
  | "scalping"
  | "signal"
  | "ai_analysis"
  | "bot_activity"
  | "trading_studio"
  | "marketplace"
  | "plugin_activity";

export interface LiveActivity {
  id: string;
  country: string;
  countryCode: string; // ISO code for privacy-safe aggregation
  latitude: number;
  longitude: number;
  market?: string;
  activityType: LiveActivityType;
  direction?: "bullish" | "bearish" | "neutral";
  intensity?: number; // 0-1
  timestamp: number;
}

export interface LiveStats {
  activeUsers: number;
  activeMarkets: number;
  aiAnalyses: number;
  liveSignals: number;
}

export interface CountryActivity {
  country: string;
  countryCode: string;
  percentage: number;
  sessions?: number;
  aiAnalyses?: number;
  markets?: number;
  topMarket?: string;
}

export interface MarketShare {
  market: string;
  share: number;
}

/** Aggregated per-country cluster used by the LiveWorldMap + hover cards. */
export interface CountryCluster {
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  activeUsers: number;
  analyses: number;
  signals: number;
  topMarket: string;
  /** ISO-3166 alpha-2 code -> emoji flag, resolved lazily. */
  flag?: string;
}

/** Minimal MT5 account snapshot used by the account live page. */
export interface LiveAccountSnapshot {
  id: string;
  productId: string;
  productName?: string;
  mt5Account: string;
  broker?: string;
  server?: string;
  currency?: string;
  balance?: number;
  equity?: number;
  floatingProfit?: number;
  peakEquity?: number;
  drawdown?: number;
  status?: string;
  lastHeartbeatAt?: number;
  userId?: string;
  licenseId?: string;
}

export const MARKET_UNIVERSE = [
  "XAUUSD",
  "BTCUSD",
  "EURUSD",
  "NAS100",
  "GBPUSD",
  "US500",
] as const;

export type MarketUniverse = (typeof MARKET_UNIVERSE)[number];

export function flagFromCountryCode(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => 127397 + c.charCodeAt(0))
  );
}
