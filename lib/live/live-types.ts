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
