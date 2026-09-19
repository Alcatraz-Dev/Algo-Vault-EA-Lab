import { SymbolSpec, SignalCategory, MarketSessionName } from "./types";

export const SYMBOL_SPECS: Record<string, SymbolSpec> = {
    XAUUSD: {
        symbol: "XAUUSD",
        category: "gold",
        pipSize: 0.01,
        pipDigits: 2,
        contractSize: 100,
        typicalSpread: 0.20,
        digits: 2,
        minLot: 0.01,
        maxLot: 100,
        tickValue: 1,
        preferredSessions: ["london", "new_york", "overlap"],
        volatilityMultiplier: 1.5,
    },
    EURUSD: {
        symbol: "EURUSD",
        category: "forex",
        pipSize: 0.0001,
        pipDigits: 4,
        contractSize: 100000,
        typicalSpread: 0.00012,
        digits: 5,
        minLot: 0.01,
        maxLot: 100,
        tickValue: 10,
        preferredSessions: ["london", "new_york", "overlap"],
        volatilityMultiplier: 1.0,
    },
    GBPUSD: {
        symbol: "GBPUSD",
        category: "forex",
        pipSize: 0.0001,
        pipDigits: 4,
        contractSize: 100000,
        typicalSpread: 0.00015,
        digits: 5,
        minLot: 0.01,
        maxLot: 100,
        tickValue: 10,
        preferredSessions: ["london", "new_york", "overlap"],
        volatilityMultiplier: 1.1,
    },
    USDJPY: {
        symbol: "USDJPY",
        category: "forex",
        pipSize: 0.01,
        pipDigits: 2,
        contractSize: 100000,
        typicalSpread: 0.012,
        digits: 3,
        minLot: 0.01,
        maxLot: 100,
        tickValue: 6.67,
        preferredSessions: ["asian", "london", "new_york"],
        volatilityMultiplier: 0.9,
    },
    USDCHF: {
        symbol: "USDCHF",
        category: "forex",
        pipSize: 0.0001,
        pipDigits: 4,
        contractSize: 100000,
        typicalSpread: 0.00015,
        digits: 5,
        minLot: 0.01,
        maxLot: 100,
        tickValue: 10,
        preferredSessions: ["london", "new_york", "overlap"],
        volatilityMultiplier: 0.9,
    },
    AUDUSD: {
        symbol: "AUDUSD",
        category: "forex",
        pipSize: 0.0001,
        pipDigits: 4,
        contractSize: 100000,
        typicalSpread: 0.00014,
        digits: 5,
        minLot: 0.01,
        maxLot: 100,
        tickValue: 10,
        preferredSessions: ["asian", "london", "new_york"],
        volatilityMultiplier: 0.85,
    },
    NZDUSD: {
        symbol: "NZDUSD",
        category: "forex",
        pipSize: 0.0001,
        pipDigits: 4,
        contractSize: 100000,
        typicalSpread: 0.00018,
        digits: 5,
        minLot: 0.01,
        maxLot: 100,
        tickValue: 10,
        preferredSessions: ["asian", "london", "new_york"],
        volatilityMultiplier: 0.8,
    },
    US30: {
        symbol: "US30",
        category: "indices",
        pipSize: 0.01,
        pipDigits: 2,
        contractSize: 1,
        typicalSpread: 1.5,
        digits: 2,
        minLot: 0.01,
        maxLot: 10,
        tickValue: 1,
        preferredSessions: ["new_york", "overlap"],
        volatilityMultiplier: 1.3,
    },
    NAS100: {
        symbol: "NAS100",
        category: "indices",
        pipSize: 0.01,
        pipDigits: 2,
        contractSize: 1,
        typicalSpread: 1.0,
        digits: 2,
        minLot: 0.01,
        maxLot: 10,
        tickValue: 1,
        preferredSessions: ["new_york", "overlap"],
        volatilityMultiplier: 1.4,
    },
    SPX500: {
        symbol: "SPX500",
        category: "indices",
        pipSize: 0.01,
        pipDigits: 2,
        contractSize: 1,
        typicalSpread: 0.5,
        digits: 2,
        minLot: 0.01,
        maxLot: 10,
        tickValue: 1,
        preferredSessions: ["new_york", "overlap"],
        volatilityMultiplier: 1.2,
    },
    BTCUSD: {
        symbol: "BTCUSD",
        category: "crypto",
        pipSize: 0.01,
        pipDigits: 2,
        contractSize: 1,
        typicalSpread: 20.0,
        digits: 2,
        minLot: 0.001,
        maxLot: 1,
        tickValue: 1,
        preferredSessions: ["asian", "london", "new_york", "overlap"],
        volatilityMultiplier: 2.0,
    },
    ETHUSD: {
        symbol: "ETHUSD",
        category: "crypto",
        pipSize: 0.01,
        pipDigits: 2,
        contractSize: 1,
        typicalSpread: 2.0,
        digits: 2,
        minLot: 0.01,
        maxLot: 10,
        tickValue: 1,
        preferredSessions: ["asian", "london", "new_york", "overlap"],
        volatilityMultiplier: 2.2,
    },
};

export function getSymbolSpec(symbol: string): SymbolSpec | null {
    return SYMBOL_SPECS[symbol.toUpperCase()] || null;
}

export function getSymbolCategory(symbol: string): SignalCategory {
    const spec = getSymbolSpec(symbol);
    return spec?.category || "forex";
}

export function getSymbolsByCategory(category: SignalCategory): string[] {
    return Object.values(SYMBOL_SPECS)
        .filter((s) => s.category === category)
        .map((s) => s.symbol);
}

export function getAllSymbols(): string[] {
    return Object.keys(SYMBOL_SPECS);
}

export function formatPrice(price: number, symbol: string): string {
    const spec = getSymbolSpec(symbol);
    const digits = spec?.digits || 5;
    return price.toFixed(digits);
}

export function calculatePipValue(
    symbol: string,
    lotSize: number
): number {
    const spec = getSymbolSpec(symbol);
    if (!spec) return 0;
    return spec.tickValue * lotSize * (1 / spec.pipSize) * spec.pipSize;
}

export function calculateContractPnL(
    symbol: string,
    direction: "BUY" | "SELL",
    entry: number,
    exit: number,
    lotSize: number
): number {
    const spec = getSymbolSpec(symbol);
    if (!spec) return 0;
    const diff = direction === "BUY" ? exit - entry : entry - exit;
    return diff * spec.contractSize * lotSize;
}
