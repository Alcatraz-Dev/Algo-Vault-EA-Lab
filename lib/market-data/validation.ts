import { Timeframe, SUPPORTED_SYMBOLS, SupportedSymbol, TIMEFRAME_INTERVALS } from "./types";

export function validateSymbol(symbol: string): SupportedSymbol | null {
    const upper = symbol.toUpperCase();
    if ((SUPPORTED_SYMBOLS as readonly string[]).includes(upper)) {
        return upper as SupportedSymbol;
    }
    return null;
}

export function validateTimeframe(tf: string): Timeframe | null {
    const upper = tf.toUpperCase() as Timeframe;
    if (upper in TIMEFRAME_INTERVALS) {
        return upper;
    }
    return null;
}

export function parseAnalyticsParams(searchParams: URLSearchParams): {
    symbol: SupportedSymbol | null;
    timeframe: Timeframe | null;
    from: number | undefined;
    to: number | undefined;
    error?: string;
} {
    const symbol = validateSymbol(searchParams.get("symbol") || "XAUUSD");
    const timeframe = validateTimeframe(searchParams.get("timeframe") || "H1");

    if (!symbol) {
        return { symbol: null, timeframe: null, from: undefined, to: undefined, error: `Invalid symbol. Supported: ${SUPPORTED_SYMBOLS.join(", ")}` };
    }
    if (!timeframe) {
        return { symbol: null, timeframe: null, from: undefined, to: undefined, error: `Invalid timeframe. Supported: ${Object.keys(TIMEFRAME_INTERVALS).join(", ")}` };
    }

    const from = searchParams.get("from") ? Number(searchParams.get("from")) : undefined;
    const to = searchParams.get("to") ? Number(searchParams.get("to")) : undefined;

    return { symbol, timeframe, from, to };
}
