/**
 * AlgoVault — Portfolio Intelligence service (Phase 15).
 *
 * ── Server-only ───────────────────────────────────────────────────────────
 * Imports `lib/firebase-admin` and the market-data engine. Never import from a
 * client component.
 *
 * This module is the ONE place that assembles a portfolio bundle. Every surface
 * (Command Center, Pro Terminal, chat, agents, workflows, API) calls it, so no
 * two surfaces can disagree about the portfolio.
 *
 * Performance rules enforced here (Phase 15 §41):
 *   • the correlation matrix is cached in-process for a bounded TTL;
 *   • candles are only fetched for symbols actually held;
 *   • a failed market-data fetch degrades to `UNAVAILABLE`, never to an
 *     invented number;
 *   • nothing polls — the caller decides when to recompute.
 */

import { fetchDeepHistoryPage } from "@/lib/market-data/twelvedata/candle-bridge";
import { normalizeSymbolInput } from "@/lib/market-data/twelvedata/symbol-map";
import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    buildCorrelationMatrix,
    computeCorrelationRisk,
    PRIMARY_CORRELATION_WINDOW,
    type PriceSeries,
} from "./correlation";
import { computeExposure } from "./exposure";
import { computeRegime } from "./regime";
import { buildSnapshot, loadRawBook, loadRiskBudgets, normalizeBook, type NormalizedBook } from "./snapshot";
import { computeStrategyIntelligence, type StrategyPerformanceInput } from "./strategy-intelligence";
import type {
    AutomationMode,
    CorrelationMatrix,
    Portfolio,
    PortfolioKind,
    PortfolioSnapshot,
    PortfolioStrategyIntelligence,
} from "./types";

/** Primary portfolio id for a user. Explicit portfolios extend this. */
export const DEFAULT_PORTFOLIO_ID = "primary";

/** Correlation matrix TTL. Long enough to keep renders cheap, short enough to notice regime shifts. */
export const CORRELATION_CACHE_TTL_MS = 5 * 60_000;

/** Bars fetched per symbol for the primary correlation window plus headroom. */
const CORRELATION_BARS = PRIMARY_CORRELATION_WINDOW * 3;

/* ── In-process cache ─────────────────────────────────────────────────────── */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

const matrixCache = new Map<string, CacheEntry<CorrelationMatrix | boolean>>();
const snapshotCache = new Map<string, CacheEntry<PortfolioSnapshot>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string, now: number): T | null {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
        map.delete(key);
        return null;
    }
    return entry.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number, now: number): void {
    // Bound the cache so a long-lived server cannot accumulate entries forever.
    if (map.size > 500) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, { value, expiresAt: now + ttl });
}

/**
 * The matrix cache also stores short-lived "no data" markers (boolean `true`)
 * so a symbol with no market history does not re-hit the provider on every
 * request. Only an actual matrix is returned to callers.
 */
function readMatrixCache(
    map: Map<string, CacheEntry<CorrelationMatrix | boolean>>,
    key: string,
    now: number
): CorrelationMatrix | null {
    const entry = cacheGet<CorrelationMatrix | boolean>(map, key, now);
    return entry && typeof entry === "object" ? entry : null;
}

/** Read the "no data available" marker for a matrix key. */
function readMissCache(
    map: Map<string, CacheEntry<CorrelationMatrix | boolean>>,
    key: string,
    now: number
): boolean {
    return cacheGet<CorrelationMatrix | boolean>(map, key, now) === true;
}

export function invalidatePortfolioCache(userId?: string, portfolioId?: string): void {
    const prefix = userId ? `${userId}:${portfolioId ?? ""}` : null;
    for (const key of Array.from(matrixCache.keys())) {
        if (!prefix || key.startsWith(prefix)) matrixCache.delete(key);
    }
    for (const key of Array.from(snapshotCache.keys())) {
        if (!prefix || key.startsWith(prefix)) snapshotCache.delete(key);
    }
}

/* ── Portfolio configuration ──────────────────────────────────────────────── */

async function readObject(path: string): Promise<Record<string, unknown>> {
    try {
        const snap = await adminDatabase.ref(path).get();
        return snap.exists() && typeof snap.val() === "object" ? (snap.val() as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/**
 * Load a portfolio definition. The primary portfolio is always derivable from
 * the user's connected accounts, so it exists even when nothing is stored.
 */
export async function loadPortfolio(userId: string, portfolioId: string = DEFAULT_PORTFOLIO_ID): Promise<Portfolio> {
    const stored = await readObject(`portfolios/${userId}/${portfolioId}`);
    const rawAccounts = await loadRawBook(userId);
    const now = Date.now();

    if (portfolioId === DEFAULT_PORTFOLIO_ID && Object.keys(stored).length === 0) {
        return {
            portfolioId,
            userId,
            name: "Primary Portfolio",
            kind: "PERSONAL",
            baseCurrency: String(rawAccounts.accounts[0]?.record.currency ?? "USD").toUpperCase(),
            version: 1,
            automationMode: "OBSERVE",
            accountIds: rawAccounts.accounts.map((a) => a.accountId),
            createdAt: now,
            updatedAt: now,
        };
    }

    return {
        portfolioId,
        userId,
        tenantId: stored.tenantId ? String(stored.tenantId) : undefined,
        name: String(stored.name ?? "Portfolio"),
        kind: (String(stored.kind ?? "PERSONAL").toUpperCase() as PortfolioKind) ?? "PERSONAL",
        baseCurrency: String(stored.baseCurrency ?? "USD").toUpperCase(),
        version: Number(stored.version ?? 1) || 1,
        automationMode: (String(stored.automationMode ?? "OBSERVE").toUpperCase() as AutomationMode) ?? "OBSERVE",
        accountIds: Array.isArray(stored.accountIds)
            ? stored.accountIds.map(String)
            : rawAccounts.accounts.map((a) => a.accountId),
        createdAt: Number(stored.createdAt ?? now),
        updatedAt: Number(stored.updatedAt ?? now),
    };
}

/** List portfolios the user owns. The primary portfolio always exists. */
export async function listPortfolios(userId: string): Promise<Portfolio[]> {
    const node = await readObject(`portfolios/${userId}`);
    const ids = Array.from(new Set([DEFAULT_PORTFOLIO_ID, ...Object.keys(node).filter((k) => k !== "_meta")]));
    return Promise.all(ids.map((id) => loadPortfolio(userId, id)));
}

/* ── Market data ──────────────────────────────────────────────────────────── */

export interface SymbolMarketData {
    series: PriceSeries | null;
    latest: { price: number; timestamp: number } | null;
    status: "AVAILABLE" | "UNAVAILABLE";
    reason?: string;
}

/**
 * Fetch candles for one symbol through the existing market-data engine.
 * Returns UNAVAILABLE rather than fabricating candles.
 *
 * Provider fallback (Phase 16): when TwelveData cannot serve the window (daily
 * credit limit, outage), the loader falls back to the Biquote OHLC endpoint —
 * the same source the signals/alerts layer already uses — so correlation and
 * cross-asset intelligence degrade to a second REAL source before they report
 * INSUFFICIENT_DATA. Both sources are real market data; neither is simulated.
 */
export async function loadSymbolSeries(
    symbol: string,
    timeframe: Timeframe,
    limit: number
): Promise<SymbolMarketData> {
    const normalized = normalizeSymbolInput(symbol);
    if (!normalized) {
        return { series: null, latest: null, status: "UNAVAILABLE", reason: `${symbol} is not a supported instrument.` };
    }

    const primary = await fetchDeepHistoryPage(normalized, timeframe, { limit }).catch(() => null);
    const candles: MarketCandle[] = primary ?? [];

    if (candles.length < 20) {
        // Try the page before this one so a partial first page still yields
        // enough aligned history for a coefficient.
        const older = await fetchDeepHistoryPage(normalized, timeframe, {
            limit,
            beforeMs: candles[0]?.timestamp ?? Date.now(),
        }).catch(() => null);
        if (older && older.length > 0) candles.unshift(...older);
    }

    if (candles.length < 20) {
        const fallback = await fetchBiquoteCandles(normalized, timeframe, limit).catch(() => null);
        if (fallback && fallback.length >= 20) candles.splice(0, candles.length, ...fallback);
    }

    if (candles.length < 20) {
        return {
            series: null,
            latest: candles.length > 0 ? { price: candles[candles.length - 1].close, timestamp: candles[candles.length - 1].timestamp } : null,
            status: "UNAVAILABLE",
            reason: `Only ${candles.length} candle(s) available for ${normalized} ${timeframe}; a correlation coefficient needs at least 20 aligned bars.`,
        };
    }

    return {
        series: {
            symbol: normalized,
            timestamps: candles.map((c) => c.timestamp),
            closes: candles.map((c) => c.close),
        },
        latest: { price: candles[candles.length - 1].close, timestamp: candles[candles.length - 1].timestamp },
        status: "AVAILABLE",
    };
}

/** Biquote OHLC intervals per platform timeframe. */
const BIQUOTE_INTERVALS: Partial<Record<Timeframe, string>> = {
    M1: "1m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
    H4: "4h",
    D1: "1d",
    W1: "1w",
};

/**
 * Real candles from the Biquote OHLC endpoint (ascending order, ≥ 20 bars or
 * null). Used ONLY as a fallback when the primary provider cannot serve the
 * window — never as a synthetic source. Provider symbol aliases are tried in
 * order; the first response with enough bars wins.
 */
const BIQUOTE_ALIASES: Record<string, string> = {
    SPX500: "US500",
    SP500: "US500",
};

async function fetchBiquoteCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number
): Promise<MarketCandle[] | null> {
    const interval = BIQUOTE_INTERVALS[timeframe];
    if (!interval) return null;
    const candidates = Array.from(
        new Set([symbol, BIQUOTE_ALIASES[symbol] ?? ""].filter(Boolean))
    );
    for (const candidate of candidates) {
        const candles = await fetchBiquoteCandlesFor(candidate, interval, limit).catch(() => null);
        if (candles && candles.length >= 20) return candles;
    }
    return null;
}

async function fetchBiquoteCandlesFor(
    providerSymbol: string,
    interval: string,
    limit: number
): Promise<MarketCandle[] | null> {
    const res = await fetch(
        `https://biquote.io/api/${encodeURIComponent(providerSymbol)}/ohlc?interval=${interval}&limit=${Math.max(20, Math.min(limit, 1000))}`,
        { headers: { accept: "application/json" } }
    ).catch(() => null);
    if (!res || !res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
        bars?: Array<{ openTime?: string; open?: number | string; high?: number | string; low?: number | string; close?: number | string }>;
    } | null;
    const bars = Array.isArray(data?.bars) ? data.bars : [];
    const candles: MarketCandle[] = [];
    for (const bar of bars) {
        const timestamp = bar.openTime ? Date.parse(bar.openTime) : NaN;
        const close = Number(bar.close);
        if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) continue;
        candles.push({
            timestamp,
            open: Number(bar.open ?? close),
            high: Number(bar.high ?? close),
            low: Number(bar.low ?? close),
            close,
        });
    }
    candles.sort((a, b) => a.timestamp - b.timestamp);
    // De-duplicate identical timestamps (defensive: partial pages can overlap).
    const deduped = candles.filter((c, i) => i === 0 || c.timestamp !== candles[i - 1].timestamp);
    return deduped.length >= 20 ? deduped : null;
}

/* ── Strategy inputs ──────────────────────────────────────────────────────── */

async function loadStrategyPerformance(userId: string, portfolioId: string): Promise<StrategyPerformanceInput[]> {
    const node = await readObject(`portfolioStrategies/${userId}/${portfolioId}`);
    const out: StrategyPerformanceInput[] = [];

    for (const [strategyId, raw] of Object.entries(node)) {
        const s = (raw ?? {}) as Record<string, unknown>;
        const openSymbols = Array.isArray(s.openSymbols) ? s.openSymbols.map(String) : [];
        const signalSymbols = Array.isArray(s.signalSymbols) ? s.signalSymbols.map(String) : [];
        const regimeTagged = Array.isArray(s.regimeTrades)
            ? (s.regimeTrades as Array<{ regime?: string; netPnL?: number }>)
                  .filter((t) => typeof t?.regime === "string")
                  .map((t) => ({ regime: String(t.regime), netPnL: Number(t.netPnL ?? 0) }))
            : undefined;

        out.push({
            strategyId,
            name: s.name ? String(s.name) : null,
            active: s.active !== false,
            openSymbols,
            signalSymbols,
            unrealizedPnL: Number(s.unrealizedPnL ?? 0),
            grossNotional: Number(s.grossNotional ?? 0),
            riskAmount: Number.isFinite(Number(s.riskAmount)) ? Number(s.riskAmount) : null,
            maxDrawdownPercent: Number.isFinite(Number(s.maxDrawdownPercent)) ? Number(s.maxDrawdownPercent) : null,
            worstDrawdownWindow:
                s.worstDrawdownFrom && s.worstDrawdownTo
                    ? { from: Number(s.worstDrawdownFrom), to: Number(s.worstDrawdownTo) }
                    : null,
            regimeTaggedTrades: regimeTagged,
            health: normaliseHealth(String(s.health ?? "UNKNOWN")),
            oosSharpe: Number.isFinite(Number(s.oosSharpe)) ? Number(s.oosSharpe) : null,
            sampleSize: Number(s.sampleSize ?? 0) || 0,
        });
    }

    return out;
}

function normaliseHealth(value: string): StrategyPerformanceInput["health"] {
    const upper = value.toUpperCase();
    if (upper === "GOOD" || upper === "HEALTHY") return "GOOD";
    if (upper === "WATCH" || upper === "DEGRADED") return "WATCH";
    if (upper === "WARNING") return "WARNING";
    if (upper === "CRITICAL" || upper === "FAILED") return "CRITICAL";
    return "UNKNOWN";
}

/* ── Bundle assembly ──────────────────────────────────────────────────────── */

export interface PortfolioBundle {
    portfolio: Portfolio;
    snapshot: PortfolioSnapshot;
    book: NormalizedBook;
    strategyIntelligence: PortfolioStrategyIntelligence;
    matrix: CorrelationMatrix | null;
    unavailableSymbols: string[];
    limitations: string[];
}

export interface BuildBundleOptions {
    userId: string;
    portfolioId?: string;
    /** Timeframe used for correlation. All symbols use the SAME timeframe. */
    timeframe?: Timeframe;
    /** Skip the cache (used by mutation paths and tests). */
    force?: boolean;
    now?: number;
}

/**
 * Assemble the complete portfolio intelligence bundle.
 *
 * Ordering matters and is deliberate:
 *   1. read the real book
 *   2. normalise positions (mark prices come from candles/quotes)
 *   3. correlation matrix from real candles (cached)
 *   4. correlation risk from the matrix
 *   5. regime from equity history
 *   6. strategy overlap
 *   7. the canonical snapshot
 */
export async function buildPortfolioBundle(options: BuildBundleOptions): Promise<PortfolioBundle> {
    const now = options.now ?? Date.now();
    const portfolioId = options.portfolioId ?? DEFAULT_PORTFOLIO_ID;
    const timeframe = options.timeframe ?? "H1";
    const cacheKey = `${options.userId}:${portfolioId}:${timeframe}`;

    if (!options.force) {
        const cached = cacheGet(snapshotCache, cacheKey, now);
        if (cached) {
            const portfolio = await loadPortfolio(options.userId, portfolioId);
            const book = cached.accounts.length > 0 ? await normalizeForCache(options.userId, portfolioId, portfolio, now) : null;
            return {
                portfolio,
                snapshot: cached,
                book: book ?? { accounts: [], positions: [], equity: 0, balance: 0, realizedPnL: null, marginUsed: 0, freeMargin: 0, leverage: 0, peakEquity: null, storedDrawdownPercent: null, dailyLossPercent: null, warnings: [], dataTimestamp: 0, baseCurrency: portfolio.baseCurrency, inconsistent: [] },
                strategyIntelligence: { portfolioId, calculatedAt: cached.timestamp, strategies: [], overlaps: [], hiddenConcentrationDetected: false, limitations: ["Cached snapshot: strategy overlap was not recomputed."] },
                matrix: cached.correlationMatrix,
                unavailableSymbols: [],
                limitations: ["Served from the deterministic portfolio cache."],
            };
        }
    }

    const portfolio = await loadPortfolio(options.userId, portfolioId);
    const raw = await loadRawBook(options.userId);

    // First pass: discover which symbols are held.
    const heldSymbols = new Set<string>();
    for (const account of raw.accounts) {
        for (const rawPosition of Object.values(account.positions)) {
            const p = rawPosition as Record<string, unknown>;
            const symbol = String(p.symbol ?? "").toUpperCase();
            if (symbol && Number(p.volume ?? 0) > 0) heldSymbols.add(symbol);
        }
    }

    const marketData = new Map<string, SymbolMarketData>();
    await Promise.all(
        Array.from(heldSymbols).map(async (symbol) => {
            marketData.set(symbol, await loadSymbolSeries(symbol, timeframe, CORRELATION_BARS));
        })
    );

    const markPrices: Record<string, { price: number; timestamp: number }> = {};
    const unavailableSymbols: string[] = [];
    const series: Record<string, PriceSeries> = {};
    for (const [symbol, data] of marketData) {
        if (data.latest) markPrices[symbol] = data.latest;
        if (data.series) series[symbol] = data.series;
        else unavailableSymbols.push(symbol);
    }

    const book = normalizeBook({
        userId: options.userId,
        portfolioId,
        raw,
        now,
        markPrices,
    });

    const freshness = {
        dataTimestamp: book.dataTimestamp,
        calculatedAt: now,
        dataAgeMs: Math.max(0, now - book.dataTimestamp),
        freshness: book.accounts.length === 0 ? ("UNAVAILABLE" as const) : ("FRESH" as const),
        sources: book.accounts.map((a) => ({ source: `account:${a.accountId}`, ageMs: Math.max(0, now - a.dataTimestamp) })),
    };

    const symbols = Array.from(heldSymbols).sort();

    // Correlation matrices are the single most expensive artefact here, so
    // they are cached and never recomputed on a UI render.
    let matrix = options.force ? null : readMatrixCache(matrixCache, `${cacheKey}:matrix`, now);
    const hadMiss = readMissCache(matrixCache, `${cacheKey}:matrix-miss`, now);
    if (!matrix && (!hadMiss || options.force)) {
        matrix = buildCorrelationMatrix({
            portfolioId,
            symbols,
            series,
            timeframe,
            window: PRIMARY_CORRELATION_WINDOW,
            dataTimestamp: book.dataTimestamp,
            calculatedAt: now,
            freshness,
        });
        if (matrix.pairs.length > 0) {
            cacheSet(matrixCache, `${cacheKey}:matrix`, matrix, CORRELATION_CACHE_TTL_MS, now);
        } else {
            // Remember the miss for a short window so a position with no market
            // history does not re-hit the provider on every request.
            cacheSet(matrixCache, `${cacheKey}:matrix-miss`, true, 30_000, now);
        }
    }

    const effectiveMatrix =
        matrix ??
        emptyMatrix(portfolioId, symbols, timeframe, now, book.dataTimestamp, freshness);

    const exposureForCorrelation = computeExposure({
        portfolioId,
        positions: book.positions,
        accounts: book.accounts,
        equity: book.equity,
        calculatedAt: now,
        dataTimestamp: book.dataTimestamp,
        freshness,
    });

    const correlationFinal = computeCorrelationRisk({
        portfolioId,
        matrix: effectiveMatrix,
        positions: book.positions,
        exposure: exposureForCorrelation,
        calculatedAt: now,
    });

    const equityHistory = await loadEquityHistory(options.userId, portfolioId, now);
    const regime = computeRegime({
        portfolioId,
        equitySeries: equityHistory,
        correlation: correlationFinal,
        correlationShift: meanAbsDelta(matrix),
        clusteredWeight: correlationFinal.clusteredExposureWeight,
        calculatedAt: now,
        dataTimestamp: book.dataTimestamp,
    });

    const strategies = await loadStrategyPerformance(options.userId, portfolioId);
    const strategyIntelligence = computeStrategyIntelligence({
        portfolioId,
        strategies,
        positions: book.positions,
        exposure: exposureForCorrelation,
        equity: book.equity,
        matrix,
        calculatedAt: now,
        dataTimestamp: book.dataTimestamp,
    });

    const riskBudgets = await loadRiskBudgets(portfolioId, options.userId, now);

    const snapshot = buildSnapshot({
        portfolio,
        book,
        correlation: correlationFinal,
        correlationMatrix: matrix,
        regime,
        strategyIntelligence,
        allocation: null,
        riskBudgets,
        now,
    });

    cacheSet(snapshotCache, cacheKey, snapshot, 15_000, now);

    const limitations = [
        ...(unavailableSymbols.length > 0
            ? [`Correlation UNAVAILABLE for: ${unavailableSymbols.join(", ")}. These symbols are excluded from the matrix rather than treated as uncorrelated.`]
            : []),
        ...(equityHistory.length < 6
            ? ["Equity history is too short to classify a portfolio regime; the regime is reported as UNKNOWN."]
            : []),
        ...(raw.orphanPositions.length > 0
            ? [`${raw.orphanPositions.length} position(s) reference an account that no longer exists and were excluded.`]
            : []),
    ];

    return { portfolio, snapshot, book, strategyIntelligence, matrix: effectiveMatrix.pairs.length > 0 ? effectiveMatrix : null, unavailableSymbols, limitations };
}

async function normalizeForCache(
    userId: string,
    portfolioId: string,
    portfolio: Portfolio,
    now: number
): Promise<NormalizedBook | null> {
    const raw = await loadRawBook(userId);
    if (raw.accounts.length === 0) return null;
    return normalizeBook({ userId, portfolioId, raw, now, markPrices: {} });
}

function emptyMatrix(
    portfolioId: string,
    symbols: string[],
    timeframe: string,
    now: number,
    dataTimestamp: number,
    freshness: PortfolioSnapshot["freshness"]
): CorrelationMatrix {
    return {
        portfolioId,
        symbols,
        timeframe,
        window: PRIMARY_CORRELATION_WINDOW,
        method: "pearson",
        matrix: symbols.map((_, i) => symbols.map((__, j) => (i === j ? 1 : null))),
        pairs: [],
        calculatedAt: now,
        dataTimestamp,
        freshness,
        limitations: ["No market history was available, so no coefficient was computed. Correlations are UNAVAILABLE, not zero."],
    };
}

function meanAbsDelta(matrix: CorrelationMatrix | null): number | null {
    if (!matrix) return null;
    const deltas = matrix.pairs.map((p) => p.delta).filter((d): d is number => typeof d === "number");
    if (deltas.length === 0) return null;
    return deltas.reduce((a, b) => a + Math.abs(b), 0) / deltas.length;
}

/**
 * Equity history for the regime engine. Uses stored immutable snapshots when
 * available; falls back to the live value so the regime has at least one point
 * rather than inventing a curve.
 */
async function loadEquityHistory(
    userId: string,
    portfolioId: string,
    now: number
): Promise<Array<{ timestamp: number; equity: number }>> {
    const history: Array<{ timestamp: number; equity: number }> = [];
    try {
        const snap = await adminDatabase
            .ref(`portfolioSnapshots/${userId}/${portfolioId}`)
            .orderByChild("timestamp")
            .limitToLast(120)
            .get();
        if (snap.exists()) {
            snap.forEach((child) => {
                const v = child.val() as { timestamp?: number; state?: { equity?: number } } | null;
                if (v && Number.isFinite(v.timestamp) && Number.isFinite(v.state?.equity)) {
                    history.push({ timestamp: Number(v.timestamp), equity: Number(v.state?.equity) });
                }
            });
        }
    } catch {
        // History is best-effort; the regime engine degrades to UNKNOWN.
    }
    history.sort((a, b) => a.timestamp - b.timestamp);
    void now;
    return history;
}
