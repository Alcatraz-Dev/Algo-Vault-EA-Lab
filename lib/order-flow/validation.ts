/**
 * Order-flow input validation — fail-closed.
 *
 * Malformed market data must never produce a valid-looking signal. Every
 * validator returns the typed value or null; callers drop nulls and count
 * rejects. Impossible values (negative prices, non-monotonic timestamps in
 * streams, absurd sizes, expired options chains) are rejected here, once.
 */

import type { L2Level, L2Snapshot, OptionQuote, OrderFlowTrade } from "./types";

export interface ValidationResult<T> {
    value: T | null;
    reason: string | null;
}

const MAX_REASONABLE_PRICE = 1e9;
const MAX_REASONABLE_SIZE = 1e12;
const MAX_FUTURE_SKEW_MS = 60_000; // allow small clock skew, reject the rest

/** Validate one classified trade. Returns null for impossible values. */
export function validateTrade(raw: unknown, nowMs = Date.now()): ValidationResult<OrderFlowTrade> {
    if (!raw || typeof raw !== "object") return { value: null, reason: "not-an-object" };
    const r = raw as Record<string, unknown>;
    const timestamp = typeof r.timestamp === "number" ? r.timestamp : Number(r.timestamp);
    const price = typeof r.price === "number" ? r.price : Number(r.price);
    const size = typeof r.size === "number" ? r.size : Number(r.size);
    const side = r.side;

    if (!Number.isFinite(timestamp)) return { value: null, reason: "timestamp-not-finite" };
    if (timestamp <= 0) return { value: null, reason: "timestamp-non-positive" };
    if (timestamp > nowMs + MAX_FUTURE_SKEW_MS) return { value: null, reason: "timestamp-in-future" };
    if (!Number.isFinite(price) || price <= 0 || price > MAX_REASONABLE_PRICE) return { value: null, reason: "price-out-of-range" };
    if (!Number.isFinite(size) || size <= 0 || size > MAX_REASONABLE_SIZE) return { value: null, reason: "size-out-of-range" };
    if (side !== "buy" && side !== "sell") return { value: null, reason: "side-invalid" };

    return {
        value: { timestamp, price, size, side },
        reason: null,
    };
}

/** Validate a batch of trades, keeping chronological order and dropping rejects. */
export function validateTradeBatch(raw: unknown[], nowMs = Date.now()): { trades: OrderFlowTrade[]; rejected: number } {
    const out: OrderFlowTrade[] = [];
    let rejected = 0;
    let prevTs = -Infinity;
    for (const item of raw) {
        const res = validateTrade(item, nowMs);
        if (res.value === null) {
            rejected += 1;
            continue;
        }
        // Streams must be chronological; a monotonicity violation is a data
        // corruption signal — reject rather than silently reordering.
        if (res.value.timestamp < prevTs) {
            rejected += 1;
            continue;
        }
        prevTs = res.value.timestamp;
        out.push(res.value);
    }
    return { trades: out, rejected };
}

/** Validate one L2 level. */
export function validateL2Level(raw: unknown): ValidationResult<L2Level> {
    if (!raw || typeof raw !== "object") return { value: null, reason: "not-an-object" };
    const r = raw as Record<string, unknown>;
    const price = typeof r.price === "number" ? r.price : Number(r.price);
    const size = typeof r.size === "number" ? r.size : Number(r.size);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_REASONABLE_PRICE) return { value: null, reason: "price-out-of-range" };
    if (!Number.isFinite(size) || size < 0 || size > MAX_REASONABLE_SIZE) return { value: null, reason: "size-out-of-range" };
    return { value: { price, size }, reason: null };
}

/** Validate an L2 snapshot (bids + asks). */
export function validateL2Snapshot(raw: unknown, nowMs = Date.now()): ValidationResult<L2Snapshot> {
    if (!raw || typeof raw !== "object") return { value: null, reason: "not-an-object" };
    const r = raw as Record<string, unknown>;
    const timestamp = typeof r.timestamp === "number" ? r.timestamp : Number(r.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > nowMs + MAX_FUTURE_SKEW_MS) {
        return { value: null, reason: "timestamp-invalid" };
    }
    const bids = Array.isArray(r.bids) ? r.bids : [];
    const asks = Array.isArray(r.asks) ? r.asks : [];
    const validBids: L2Level[] = [];
    const validAsks: L2Level[] = [];
    for (const b of bids) {
        const res = validateL2Level(b);
        if (res.value) validBids.push(res.value);
    }
    for (const a of asks) {
        const res = validateL2Level(a);
        if (res.value) validAsks.push(res.value);
    }
    if (validBids.length === 0 && validAsks.length === 0) return { value: null, reason: "empty-book" };
    // Sanity: best bid should not exceed best ask (crossed book = bad feed).
    const bestBid = validBids.length ? Math.max(...validBids.map((l) => l.price)) : null;
    const bestAsk = validAsks.length ? Math.min(...validAsks.map((l) => l.price)) : null;
    if (bestBid !== null && bestAsk !== null && bestBid > bestAsk) {
        return { value: null, reason: "crossed-book" };
    }
    return { value: { timestamp, bids: validBids, asks: validAsks }, reason: null };
}

/** Validate an options quote for GEX. Expiries in the past are rejected. */
export function validateOptionQuote(raw: unknown, nowMs = Date.now()): ValidationResult<OptionQuote> {
    if (!raw || typeof raw !== "object") return { value: null, reason: "not-an-object" };
    const r = raw as Record<string, unknown>;
    const strike = typeof r.strike === "number" ? r.strike : Number(r.strike);
    const expiration = typeof r.expiration === "number" ? r.expiration : Number(r.expiration);
    const openInterest = typeof r.openInterest === "number" ? r.openInterest : Number(r.openInterest);
    const impliedVolatility = typeof r.impliedVolatility === "number" ? r.impliedVolatility : Number(r.impliedVolatility);
    const underlyingPrice = typeof r.underlyingPrice === "number" ? r.underlyingPrice : Number(r.underlyingPrice);
    const type = r.type;

    if (!Number.isFinite(strike) || strike <= 0) return { value: null, reason: "strike-invalid" };
    if (!Number.isFinite(expiration) || expiration <= nowMs) return { value: null, reason: "expiration-past" };
    if (!Number.isFinite(openInterest) || openInterest < 0) return { value: null, reason: "oi-invalid" };
    if (!Number.isFinite(impliedVolatility) || impliedVolatility <= 0 || impliedVolatility > 10) {
        return { value: null, reason: "iv-invalid" };
    }
    if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0) return { value: null, reason: "spot-invalid" };
    if (type !== "call" && type !== "put") return { value: null, reason: "type-invalid" };

    return {
        value: {
            strike,
            expiration,
            type,
            openInterest,
            impliedVolatility,
            ...(typeof r.gamma === "number" && Number.isFinite(r.gamma) ? { gamma: r.gamma } : {}),
            underlyingPrice,
        },
        reason: null,
    };
}

/** Validate a batch of option quotes. */
export function validateOptionChain(raw: unknown[], nowMs = Date.now()): { quotes: OptionQuote[]; rejected: number } {
    const out: OptionQuote[] = [];
    let rejected = 0;
    for (const item of raw) {
        const res = validateOptionQuote(item, nowMs);
        if (res.value === null) rejected += 1;
        else out.push(res.value);
    }
    return { quotes: out, rejected };
}

/** Validate a candle-shaped record for profile math (volume optional). */
export function validateCandleForProfile(raw: { timestamp: number; open: number; high: number; low: number; close: number; volume?: number }): boolean {
    const c = raw;
    if (!Number.isFinite(c.timestamp) || c.timestamp <= 0) return false;
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0 && v <= MAX_REASONABLE_PRICE)) return false;
    if (c.high < c.low || c.close < c.low || c.close > c.high || c.open < c.low || c.open > c.high) return false;
    if (c.volume !== undefined && (!Number.isFinite(c.volume) || c.volume < 0)) return false;
    return true;
}
