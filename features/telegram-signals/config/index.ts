/**
 * AlgoVault Pro Signal Intelligence - Configuration & Feature Flags
 */

export const ENABLE_PRO_SIGNALS =
    process.env.NEXT_PUBLIC_ENABLE_PRO_SIGNALS === "true" ||
    process.env.NODE_ENV !== "production";

/**
 * Extensible Symbol Aliases Map
 * Maps raw text aliases to standard internal symbol names.
 */
export const DEFAULT_SYMBOL_ALIASES: Record<string, string> = {
    // Precious Metals
    GOLD: "XAUUSD",
    XAU: "XAUUSD",
    XAUUSD: "XAUUSD",
    "XAU/USD": "XAUUSD",
    SILVER: "XAGUSD",
    XAG: "XAGUSD",
    XAGUSD: "XAGUSD",
    "XAG/USD": "XAGUSD",

    // Forex Majors & Minors
    EURUSD: "EURUSD",
    "EUR/USD": "EURUSD",
    GBPUSD: "GBPUSD",
    "GBP/USD": "GBPUSD",
    USDJPY: "USDJPY",
    "USD/JPY": "USDJPY",
    AUDUSD: "AUDUSD",
    "AUD/USD": "AUDUSD",
    USDCAD: "USDCAD",
    "USD/CAD": "USDCAD",
    USDCHF: "USDCHF",
    "USD/CHF": "USDCHF",
    NZDUSD: "NZDUSD",
    "NZD/USD": "NZDUSD",

    // Indices
    US30: "US30",
    DJ30: "US30",
    DOW: "US30",
    DOWJONES: "US30",
    NAS100: "NAS100",
    NASDAQ: "NAS100",
    US100: "NAS100",
    SPX500: "SP500",
    US500: "SP500",
    SP500: "SP500",
    GER30: "GER40",
    GER40: "GER40",
    DAX: "GER40",
    DAX40: "GER40",
    UK100: "UK100",
    FTSE: "UK100",

    // Crypto
    BTC: "BTCUSD",
    BTCUSD: "BTCUSD",
    "BTC/USD": "BTCUSD",
    BITCOIN: "BTCUSD",
    ETH: "ETHUSD",
    ETHUSD: "ETHUSD",
    "ETH/USD": "ETHUSD",
    ETHEREUM: "ETHUSD",
};

/**
 * Expiration Defaults (in minutes) per Signal Style
 */
export const DEFAULT_EXPIRATION_MINUTES: Record<string, number> = {
    SCALPING: 30, // 30 minutes for scalping
    INTRADAY: 240, // 4 hours for intraday
    SWING: 1440, // 24 hours for swing
    UNKNOWN: 60, // 1 hour fallback
};

/**
 * Default Risk Configuration
 */
export const DEFAULT_RISK_CONFIG = {
    enabled: false, // Auto-execution disabled by default for safety
    riskPercent: 1.0,
    maxDailyLossPercent: 5.0,
    maxOpenPositions: 3,
    maxSymbolExposureLots: 2.0,
    maxSignalsPerSourceDaily: 20,
    cooldownSeconds: 30,
    allowMarketEntries: true,
    requireStopLoss: true,
};

/**
 * Minimum Sample Size for Analytics Confidence
 */
export const MIN_ANALYTICS_SAMPLE_SIZE = 15;
