export type Timeframe = "M1" | "M3" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";

export type MarketCandle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
};

export type MarketQuote = {
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    change?: number;
    changePercent?: number;
};

export type MarketSession = "asian" | "london" | "new_york" | "overlap" | "closed";

export type MarketStructurePoint = {
    index: number;
    price: number;
    timestamp: number;
    type: "swing_high" | "swing_low";
};

export type MarketStructureEvent = {
    id: string;
    type: "BOS" | "CHOCH" | "swing_high" | "swing_low";
    direction: "bullish" | "bearish";
    price: number;
    timestamp: number;
    timeframe: Timeframe;
    brokenLevel?: number;
};

export type LiquidityLevel = {
    id: string;
    type:
        | "equal_highs"
        | "equal_lows"
        | "prev_day_high"
        | "prev_day_low"
        | "prev_week_high"
        | "prev_week_low"
        | "swing_high"
        | "swing_low"
        | "session_high"
        | "session_low";
    price: number;
    strength: number;
    timeframe: Timeframe;
    timestamp: number;
};

export type LiquiditySweep = {
    id: string;
    type: "sweep";
    side: "buy_side" | "sell_side";
    level: number;
    sweepPrice: number;
    confirmed: boolean;
    timestamp: number;
};

export type VolumeData = {
    volume: number;
    averageVolume: number;
    relativeVolume: number;
    state: "expanded" | "normal" | "contracted";
    isTickVolume: boolean;
};

export type VWAPData = {
    vwap: number;
    upperBand1: number;
    lowerBand1: number;
    upperBand2: number;
    lowerBand2: number;
    distance: number;
    distancePercent: number;
    period: "session" | "daily" | "weekly" | "anchored";
};

export type VolatilityData = {
    atr: number;
    atrPercent: number;
    state: "low" | "normal" | "high" | "extreme";
    rangeExpansion: number;
    lookbackPeriods: number;
};

export type MarketRegime =
    | "trending_bullish"
    | "trending_bearish"
    | "ranging"
    | "breakout"
    | "high_volatility"
    | "low_volatility"
    | "transitional";

export type RegimeData = {
    regime: MarketRegime;
    confidence: number;
    factors: string[];
};

export type ZoneType = "order_block" | "fvg" | "liquidity" | "vwap" | "prev_high_low";
export type ZoneStatus = "active" | "mitigated" | "invalidated";
export type ZoneDirection = "bullish" | "bearish" | "neutral";

export type Zone = {
    id: string;
    type: ZoneType;
    direction: ZoneDirection;
    high: number;
    low: number;
    timeframe: Timeframe;
    strength: number;
    status: ZoneStatus;
    createdAt: number;
    mitigatedAt?: number;
    source?: string;
};

export type ZoneScore = {
    zoneId: string;
    strength: number;
    reasons: string[];
};

export type MarketScoreComponent = {
    name: string;
    value: number;
    max: number;
    direction: "bullish" | "bearish" | "neutral";
};

export type MarketScore = {
    total: number;
    bias: "bullish" | "bearish" | "neutral";
    confidence: "high" | "medium" | "low";
    components: MarketScoreComponent[];
    timestamp: number;
};

export type MultiTimeframeBias = {
    timeframe: Timeframe;
    bias: "bullish" | "bearish" | "neutral";
    structure: string;
};

export type MarketIntelligence = {
    symbol: string;
    timeframe: Timeframe;
    candles: MarketCandle[];
    quote?: MarketQuote;
    structure: MarketStructureEvent[];
    liquidity: LiquidityLevel[];
    liquiditySweeps: LiquiditySweep[];
    volume: VolumeData;
    vwap: VWAPData;
    session: {
        current: MarketSession;
        name: string;
        startTime: number;
        endTime: number;
        high: number;
        low: number;
        range: number;
    };
    volatility: VolatilityData;
    regime: RegimeData;
    zones: Zone[];
    score: MarketScore;
    multiTimeframe: MultiTimeframeBias[];
    timestamp: number;
};

export type AnalyticsParams = {
    symbol: string;
    timeframe: Timeframe;
    from?: number;
    to?: number;
};

export const TIMEFRAME_INTERVALS: Record<Timeframe, string> = {
    M1: "1m",
    M3: "3m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
    H4: "4h",
    D1: "1d",
};

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
    M1: "1 Minute",
    M3: "3 Minutes",
    M5: "5 Minutes",
    M15: "15 Minutes",
    M30: "30 Minutes",
    H1: "1 Hour",
    H4: "4 Hour",
    D1: "Daily",
};

export const SUPPORTED_SYMBOLS = [
    // Forex
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "AUDUSD",
    "NZDUSD",
    "USDCAD",
    "EURGBP",
    "EURJPY",
    "GBPJPY",
    "AUDJPY",
    "EURCHF",
    // Metals
    "XAUUSD",
    "XAGUSD",
    // Indices
    "US30",
    "NAS100",
    "SPX500",
    "SPY",
    "QQQ",
    "DXY",
    // Crypto
    "BTCUSD",
    "ETHUSD",
    "SOLUSD",
    "XRPUSD",
    "ADAUSD",
    "DOGEUSD",
    "BNBUSD",
    "LTCUSD",
    "DOTUSD",
    // US Equities
    "AAPL",
    "TSLA",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "GOOGL",
    "AMD",
    "NFLX",
    "COIN",
] as const;

export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];
