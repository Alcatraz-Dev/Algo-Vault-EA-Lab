/**
 * Options normalization internals — pure functions, no network.
 *
 * Symbology parsing (OCC + Deribit) and payload → `OptionQuote` conversion
 * for the two wired sources. Isolated from options-provider.ts (fetching) so
 * tests exercise the exact normalization the live provider uses without any
 * HTTP. Everything funnels through the fail-closed `validateOptionQuote`.
 */

import type { OptionQuote } from "./types";
import { validateOptionQuote } from "./validation";

// ── symbology ────────────────────────────────────────────────────────────────

/**
 * OCC option symbol → parts. "SPX261218P06900000" →
 * root SPX, yy=26, mm=12, dd=18, type P, strike 6900 (8 digits, 3 implied decimals).
 */
export function parseOccSymbol(symbol: string): { root: string; expiryYymmdd: string; type: "call" | "put"; strike: number } | null {
    const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(symbol);
    if (!m) return null;
    return {
        root: m[1],
        expiryYymmdd: m[2],
        type: m[3] === "C" ? "call" : "put",
        strike: Number(m[4]) / 1000,
    };
}

/** US index/equity options settle at the 16:00 ET close; 21:00 UTC is the
 * standard winter encoding and is precise enough for expiry-bucketing. */
export function occExpiryMs(yymmdd: string): number | null {
    const m = /^(\d{2})(\d{2})(\d{2})$/.exec(yymmdd);
    if (!m) return null;
    const year = 2000 + Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    return Date.UTC(year, month, day, 21, 0, 0, 0);
}

/** Parse a Deribit instrument name: "BTC-28NOV26-74000-C". */
export function parseDeribitInstrument(name: string): { expiryDdMmmYy: string; strike: number; type: "call" | "put" } | null {
    const m = /^([A-Z]+)-(\d{1,2}[A-Z]{3}\d{2})-(\d+)-([CP])$/.exec(name);
    if (!m) return null;
    return { expiryDdMmmYy: m[2], strike: Number(m[3]), type: m[4] === "C" ? "call" : "put" };
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "28NOV26" → ms epoch of that UTC day's 08:00 UTC settlement. */
export function deribitExpiryMs(dmy: string): number | null {
    const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(dmy);
    if (!m) return null;
    const day = Number(m[1]);
    const month = MONTHS[m[2]];
    const year = 2000 + Number(m[3]);
    if (!Number.isFinite(day) || month === undefined || !Number.isFinite(year)) return null;
    return Date.UTC(year, month, day, 8, 0, 0, 0);
}

/** Deribit quotes IV in percent (36.78) — the validator wants a fraction (0.3678). */
export function deribitIvToFraction(pct: number): number {
    return pct / 100;
}

// ── payload normalization ────────────────────────────────────────────────────

export interface NormalizedChain {
    quotes: OptionQuote[];
    rejected: number;
    spot: number | null;
}

interface DeribitBookSummary {
    instrument_name?: unknown;
    open_interest?: unknown;
    mark_iv?: unknown;
    underlying_price?: unknown;
}

/** Normalize a Deribit `public/get_book_summary_by_currency` result array. */
export function normalizeDeribitPayload(raw: unknown): NormalizedChain {
    const result = (raw as { result?: unknown })?.result;
    if (!Array.isArray(result)) throw new Error("deribit-unexpected-shape");

    const quotes: OptionQuote[] = [];
    let rejected = 0;
    let spot: number | null = null;

    for (const item of result as DeribitBookSummary[]) {
        if (typeof item?.instrument_name !== "string") continue;
        const parsed = parseDeribitInstrument(item.instrument_name);
        if (!parsed) continue;
        const openInterest = typeof item.open_interest === "number" ? item.open_interest : Number(item.open_interest);
        const markIv = typeof item.mark_iv === "number" ? item.mark_iv : Number(item.mark_iv);
        const underlyingPrice = typeof item.underlying_price === "number" ? item.underlying_price : Number(item.underlying_price);
        const quote = validateOptionQuote({
            strike: parsed.strike,
            expiration: deribitExpiryMs(parsed.expiryDdMmmYy),
            type: parsed.type,
            openInterest,
            impliedVolatility: deribitIvToFraction(markIv),
            underlyingPrice,
        });
        if (quote.value === null) {
            rejected += 1;
            continue;
        }
        quotes.push(quote.value);
        if (spot === null && Number.isFinite(underlyingPrice) && underlyingPrice > 0) spot = underlyingPrice;
    }

    return { quotes, rejected, spot };
}

interface CboeOptionRow {
    option?: unknown;
    open_interest?: unknown;
    iv?: unknown;
    gamma?: unknown;
    prev_day_close?: unknown;
}

/**
 * Normalize a CBOE delayed-quotes chain (`data.options` rows) + optional
 * quote payload (`data.current_price` as spot). Spot falls back to the most
 * common `prev_day_close` across chain rows when the quote endpoint failed.
 */
export function normalizeCboePayload(chainRaw: unknown, quoteRaw: unknown): NormalizedChain {
    const options = (chainRaw as { data?: { options?: unknown } })?.data?.options;
    if (!Array.isArray(options)) throw new Error("cboe-unexpected-shape");

    const quoteData = (quoteRaw as { data?: { current_price?: unknown } } | null)?.data;
    const quoteSpot = quoteData && typeof quoteData.current_price === "number" && quoteData.current_price > 0 ? quoteData.current_price : null;

    const fallbackSpot = (() => {
        const closes = (options as CboeOptionRow[])
            .map((o) => (typeof o.prev_day_close === "number" ? o.prev_day_close : 0))
            .filter((v) => v > 0);
        if (closes.length === 0) return null;
        const tally = new Map<number, number>();
        for (const v of closes) tally.set(v, (tally.get(v) ?? 0) + 1);
        return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    })();

    const spot = quoteSpot ?? fallbackSpot;
    if (spot === null) throw new Error("cboe-spot-unresolvable");

    const quotes: OptionQuote[] = [];
    let rejected = 0;

    for (const item of options as CboeOptionRow[]) {
        if (typeof item.option !== "string") continue;
        const parsed = parseOccSymbol(item.option);
        if (!parsed) continue;
        const openInterest = typeof item.open_interest === "number" ? item.open_interest : Number(item.open_interest);
        const iv = typeof item.iv === "number" ? item.iv : Number(item.iv);
        const gamma = typeof item.gamma === "number" ? item.gamma : Number(item.gamma);
        const quote = validateOptionQuote({
            strike: parsed.strike,
            expiration: occExpiryMs(parsed.expiryYymmdd),
            type: parsed.type,
            openInterest,
            impliedVolatility: iv,
            gamma: Number.isFinite(gamma) && gamma > 0 ? gamma : undefined,
            underlyingPrice: spot,
        });
        if (quote.value === null) {
            rejected += 1;
            continue;
        }
        quotes.push(quote.value);
    }

    return { quotes, rejected, spot };
}
