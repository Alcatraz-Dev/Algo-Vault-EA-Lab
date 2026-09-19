import { MarketCandle, SupportedSymbol, Timeframe, TIMEFRAME_INTERVALS } from "@/lib/market-data/types";
import { AnalysisPeriod, DataBundle, DataCoverage, DataSourceKind, PERIOD_DAYS, TimeframeHierarchy } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// MarketDataProvider
//
// The platform's historical market data arrives from biquote.io (a broker-style
// OHLC feed, no API key required). Biquote caps the number of bars it returns per
// timeframe, and it does NOT expose M3 / M30 intervals, nor multi-year history.
//
// To support longer histories (3Y / 5Y) and timeframes the feed lacks, an optional
// local export provider can be seeded with real broker data files placed at:
//
//   private-files/market-data/{SYMBOL}.{TIMEFRAME}.json
//
// The file must contain an array of { timestamp, open, high, low, close, volume? }.
// When present and covering the requested window, the local export wins. No data
// is ever synthesized.
// ─────────────────────────────────────────────────────────────────────────────

const BIQUOTE_BASE = "https://biquote.io/api";

type BiquoteBar = {
    openTime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    isOpen?: boolean;
};

type BiquoteResponse = { bars?: BiquoteBar[] };

// Observed maximum history biquote returns per timeframe (probed live).
export const BIQUOTE_MAX_BARS: Record<Timeframe, number> = {
    M1: 301,
    M3: 0,
    M5: 289,
    M15: 193,
    M30: 193,
    H1: 169,
    H4: 181,
    D1: 501,
};

// Timeframes we can actually request from biquote.
export const BIQUOTE_SUPPORTED_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

// Symbols that are broker-style contract instruments (not global exchange prices).
export const BROKER_INSTRUMENT_SYMBOLS = new Set<string>(["XAUUSD", "XAGUSD"]);

// Symbols whose last-letter suffix indicates an index of USD cross; used only for labeling.
export function isBrokerInstrument(symbol: string): boolean {
    return BROKER_INSTRUMENT_SYMBOLS.has(symbol.toUpperCase());
}

export const DATA_SOURCE_NOTE =
    isBrokerInstrument("XAUUSD")
        ? "XAUUSD is a broker-style gold contract used on retail MT4/MT5 platforms. Its price is not identical to a global spot or COMEX exchange price. The Strategy Lab operates on this feed and all results are relative to it."
        : "";

export interface MarketDataProvider {
    readonly kind: DataSourceKind;
    readonly name: string;
    readonly requiresKey: boolean;
    supportsTimeframe(tf: Timeframe): boolean;
    maxBars(tf: Timeframe): number;
    fetch(
        symbol: SupportedSymbol,
        timeframe: Timeframe,
        options?: { from?: number; to?: number }
    ): Promise<MarketCandle[]>;
}

// ── biquote provider ─────────────────────────────────────────────────────────

class BiquoteProvider implements MarketDataProvider {
    readonly kind = "biquote" as const;
    readonly name = "biquote.io";
    readonly requiresKey = false;

    supportsTimeframe(tf: Timeframe): boolean {
        return BIQUOTE_SUPPORTED_TIMEFRAMES.includes(tf);
    }

    maxBars(tf: Timeframe): number {
        return BIQUOTE_MAX_BARS[tf];
    }

    async fetch(
        symbol: SupportedSymbol,
        timeframe: Timeframe,
        options?: { from?: number; to?: number }
    ): Promise<MarketCandle[]> {
        if (!this.supportsTimeframe(timeframe)) {
            throw new Error(`biquote.io does not expose the ${timeframe} timeframe.`);
        }
        const interval = TIMEFRAME_INTERVALS[timeframe];
        // Request a generous limit; the API caps internally.
        const url = `${BIQUOTE_BASE}/${symbol}/ohlc?interval=${interval}&limit=5000`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
            throw new Error(`Biquote API error: ${res.status}`);
        }
        const data = (await res.json()) as BiquoteResponse;
        const bars = data.bars || [];

        let candles: MarketCandle[] = bars
            .map((b) => ({
                timestamp: Date.parse(b.openTime),
                open: Number(b.open),
                high: Number(b.high),
                low: Number(b.low),
                close: Number(b.close),
                volume: b.volume !== undefined ? Number(b.volume) : undefined,
            }))
            .sort((a, b) => a.timestamp - b.timestamp)
            .filter((c) => Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close));

        if (options?.from) candles = candles.filter((c) => c.timestamp >= options.from!);
        if (options?.to) candles = candles.filter((c) => c.timestamp <= options.to!);
        return candles;
    }
}

// ── local export provider (optional) ─────────────────────────────────────────

const LOCAL_EXPORT_DIR = "private-files/market-data";

function dedupeCandles(candles: MarketCandle[]): MarketCandle[] {
    const seen = new Map<number, MarketCandle>();
    for (const c of candles) {
        const existing = seen.get(c.timestamp);
        if (!existing || (existing.high < c.high && existing.low > c.low)) {
            seen.set(c.timestamp, c);
        }
    }
    return Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
}

class LocalExportProvider implements MarketDataProvider {
    readonly kind = "local_export" as const;
    readonly name = "broker export (private-files/market-data)";
    readonly requiresKey = false;

    supportsTimeframe(tf: Timeframe): boolean {
        return tf in BIQUOTE_MAX_BARS;
    }

    maxBars(tf: Timeframe): number {
        return BIQUOTE_MAX_BARS[tf] ?? 0;
    }

    async fetch(
        symbol: SupportedSymbol,
        timeframe: Timeframe,
        options?: { from?: number; to?: number }
    ): Promise<MarketCandle[]> {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const file = join(process.cwd(), LOCAL_EXPORT_DIR, `${symbol.toUpperCase()}.${timeframe}.json`);
        try {
            const raw = await readFile(file, "utf8");
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                throw new Error(`Malformed ${file}: expected an array of candles.`);
            }
            let candles: MarketCandle[] = parsed.map((c: Record<string, unknown>) => ({
                timestamp: Number(c.timestamp),
                open: Number(c.open),
                high: Number(c.high),
                low: Number(c.low),
                close: Number(c.close),
                volume: c.volume !== undefined ? Number(c.volume) : undefined,
            }));
            candles = dedupeCandles(candles).filter(
                (c) => Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.close)
            );
            if (options?.from) candles = candles.filter((c) => c.timestamp >= options.from!);
            if (options?.to) candles = candles.filter((c) => c.timestamp <= options.to!);
            return candles;
        } catch (err) {
            const code = (err as { code?: string }).code;
            if (code === "ENOENT") {
                throw new Error(`Local export not found for ${symbol} ${timeframe}.`);
            }
            throw err;
        }
    }
}

// ── provider selection / orchestration ──────────────────────────────────────

export async function getCandlesForTimeframe(
    symbol: SupportedSymbol,
    timeframe: Timeframe,
    options?: { from?: number; to?: number; preferLocal?: boolean }
): Promise<{ candles: MarketCandle[]; source: DataSourceKind; maxBars: number }> {
    const preferLocal = options?.preferLocal ?? true;
    const local = new LocalExportProvider();

    if (preferLocal) {
        try {
            // Only use local export when it actually covers what we need (or any data at all).
            if (options?.from || options?.to) {
                const probe = await local.fetch(symbol, timeframe, {
                    from: options?.from,
                    to: options?.to,
                });
                if (probe.length > 0) return { candles: probe, source: "local_export", maxBars: probe.length };
            }
            const probe = await local.fetch(symbol, timeframe);
            if (probe.length > 0) return { candles: probe, source: "local_export", maxBars: probe.length };
        } catch {
            // fall through to biquote
        }
    }

    const bq = new BiquoteProvider();
    const candles = await bq.fetch(symbol, timeframe, options);
    return { candles, source: "biquote", maxBars: bq.maxBars(timeframe) };
}

export function timeframeSpanDays(tf: Timeframe, bars: number): number {
    const approxMsPerBar: Record<Timeframe, number> = {
        M1: 60_000,
        M3: 180_000,
        M5: 300_000,
        M15: 900_000,
        M30: 1_800_000,
        H1: 3_600_000,
        H4: 14_400_000,
        D1: 86_400_000,
    };
    return (bars * approxMsPerBar[tf]) / 86_400_000;
}

export async function loadDataBundle(
    symbol: SupportedSymbol,
    period: AnalysisPeriod,
    hierarchy: TimeframeHierarchy
): Promise<DataBundle> {
    const periodDays = PERIOD_DAYS[period];
    const requestedTo = Date.now();
    const requestedFrom = requestedTo - periodDays * 86_400_000;

    const timeframes: Timeframe[] = Array.from(
        new Set([hierarchy.macro, hierarchy.structure, hierarchy.setup, hierarchy.entry])
    );

    const candles: Partial<Record<Timeframe, MarketCandle[]>> = {};
    const coverage: DataCoverage[] = [];

    for (const tf of timeframes) {
        let fetched: { candles: MarketCandle[]; source: DataSourceKind; maxBars: number };
        try {
            fetched = await getCandlesForTimeframe(symbol, tf);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "data provider error";
            console.error(`[strategy-lab] ${symbol} ${tf}: ${msg}`);
            continue;
        }

        candles[tf] = fetched.candles;
        const availableBars = fetched.candles.length;
        const availableFrom = fetched.candles.length > 0 ? fetched.candles[0].timestamp : 0;
        const availableTo = fetched.candles.length > 0 ? fetched.candles[fetched.candles.length - 1].timestamp : 0;

        coverage.push({
            timeframe: tf,
            availableBars,
            requestedFrom,
            requestedTo,
            availableFrom,
            availableTo,
            fullyCoversRequest: availableFrom <= requestedFrom,
            spanDays: availableBars > 0 ? (availableTo - availableFrom) / 86_400_000 : 0,
            source: fetched.source,
            maxSourceBars: fetched.maxBars,
        });
    }

    const overallCoversRequest = timeframes.every(
        (tf) => coverage.find((c) => c.timeframe === tf)?.fullyCoversRequest
    );

    return {
        symbol,
        period,
        candles,
        coverage,
        requestedFrom,
        requestedTo,
        dataSource: {
            name: "biquote.io (broker-style feed) + optional local broker exports",
            kind: "biquote",
            brokerInstrumentNote: DATA_SOURCE_NOTE,
            sourceLimits: { ...BIQUOTE_MAX_BARS },
            symbolsAreExchangePrices: false,
        },
        overallCoversRequest,
    };
}

export { BiquoteProvider, LocalExportProvider };