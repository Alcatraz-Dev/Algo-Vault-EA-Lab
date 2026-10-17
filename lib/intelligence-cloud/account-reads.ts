/**
 * Intelligence Cloud — Account / position read contract (v1).
 *
 * ── Server-only ────────────────────────────────────────────────────────────
 * Imports `lib/firebase-admin` transitively. Never import from a client
 * component.
 *
 * This module is the ONE reader behind `GET /api/v1/accounts`,
 * `GET /api/v1/positions` and `GET /api/v1/analytics`. It does not read RTDB
 * paths of its own: it reuses the canonical portfolio book
 * (`loadRawBook` + `normalizeBook`) so the public API cannot disagree with the
 * portfolio surfaces about what an account holds.
 *
 * Ownership invariant:
 *   The user id always comes from the verified API key binding
 *   (`requireKeyOwner`), never from a query parameter or body field. A caller
 *   may pass `accountId` as a FILTER, but only over accounts already loaded
 *   for that user — it can never widen the read.
 */

import {
    ACCOUNT_HEARTBEAT_STALE_MS,
    computeFreshness,
    drawdownPercent,
    loadRawBook,
    marginLevelPercent,
    normalizeBook,
    openRiskPercent,
    type NormalizedBook,
} from "@/lib/portfolio/snapshot";
import type { DataFreshness, PortfolioAccount, PortfolioPosition } from "@/lib/portfolio/types";
import { errors } from "./errors";

/** Read scope required by every account-facing endpoint. */
export const ACCOUNT_READ_SCOPE = "portfolio:read" as const;

/** Portfolio id used when an account read has no explicit portfolio. */
export const ACCOUNT_READ_PORTFOLIO_ID = "primary";

export interface AccountReadBook {
    book: NormalizedBook;
    freshness: DataFreshness;
    now: number;
    /** Honest, response-level statements about what this read does NOT know. */
    limitations: string[];
}

/**
 * Load the user's real broker book and normalise it with the canonical
 * portfolio pipeline. No market-data refresh happens here: prices are the
 * gateway's last pushed values, which the response labels by timestamp.
 */
export async function loadAccountRead(userId: string): Promise<AccountReadBook> {
    if (!userId) throw errors.unauthorized("A user binding is required for account reads.");

    const now = Date.now();
    const raw = await loadRawBook(userId);
    const book = normalizeBook({
        userId,
        portfolioId: ACCOUNT_READ_PORTFOLIO_ID,
        raw,
        now,
        // No mark-price refresh on a read endpoint. normalizeBook falls back to
        // the gateway's pushed `currentPrice`, exactly as the portfolio does.
        markPrices: {},
    });
    const freshness = computeFreshness(book, now);

    const limitations: string[] = [
        "Prices are the gateway's last pushed values; this endpoint does not refresh market data.",
    ];
    if (book.accounts.length === 0) {
        limitations.push("No broker account is connected to this user.");
    }
    if (book.realizedPnL === null) {
        limitations.push(
            "Realized P&L is not persisted by the gateway and is not estimated."
        );
    }
    if (book.inconsistent.length > 0) {
        limitations.push(
            `${book.inconsistent.length} record(s) were internally inconsistent and are excluded or flagged: ${book.inconsistent
                .slice(0, 4)
                .join(" | ")}`
        );
    }
    limitations.push(
        `An account heartbeat older than ${Math.round(ACCOUNT_HEARTBEAT_STALE_MS / 1000)}s is reported as OFFLINE.`
    );

    return { book, freshness, now, limitations };
}

/* ── Projections ──────────────────────────────────────────────────────────── */

export interface AccountSummary {
    accountId: string;
    kind: PortfolioAccount["kind"];
    broker: string | null;
    server: string | null;
    currency: string;
    balance: number;
    equity: number;
    marginUsed: number;
    freeMargin: number;
    leverage: number;
    unrealizedPnL: number;
    drawdownPercent: number;
    status: PortfolioAccount["status"];
    connected: boolean;
    dataTimestamp: number;
}

/** Public account shape. Internal ownership fields are deliberately not exposed. */
export function projectAccounts(
    book: Pick<NormalizedBook, "accounts">
): AccountSummary[] {
    return book.accounts.map((a) => ({
        accountId: a.accountId,
        kind: a.kind,
        broker: a.broker,
        server: a.server,
        currency: a.currency,
        balance: a.balance,
        equity: a.equity,
        marginUsed: a.marginUsed,
        freeMargin: a.freeMargin,
        leverage: a.leverage,
        unrealizedPnL: a.unrealizedPnL,
        drawdownPercent: a.drawdownPercent,
        status: a.status,
        connected: a.connected,
        dataTimestamp: a.dataTimestamp,
    }));
}

export interface PositionSummary {
    positionId: string;
    accountId: string;
    symbol: string;
    side: PortfolioPosition["side"];
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    riskAmount: number | null;
    unrealizedPnL: number;
    notional: number;
    equityWeight: number;
    strategyId: string;
    openedAt: number;
    dataTimestamp: number;
}

/** Public position shape. */
export function projectPositions(
    book: Pick<NormalizedBook, "positions">
): PositionSummary[] {
    return book.positions.map((p) => ({
        positionId: p.positionId,
        accountId: p.accountId,
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        riskAmount: p.riskAmount,
        unrealizedPnL: p.unrealizedPnL,
        notional: p.notional,
        equityWeight: p.equityWeight,
        strategyId: p.strategyId,
        openedAt: p.openedAt,
        dataTimestamp: p.dataTimestamp,
    }));
}

/**
 * Reject an `accountId` filter that does not exist in the caller's own book.
 *
 * Returning an empty list for an unknown id would be ambiguous (no positions
 * vs. no such account), so this fails explicitly. It is also the IDOR guard:
 * `book` was loaded from the key's user binding, so an account belonging to
 * anyone else can never appear here.
 */
export function requireVisibleAccount(
    book: Pick<NormalizedBook, "accounts" | "positions">,
    accountId: string
): void {
    const visible =
        book.accounts.some((a) => a.accountId === accountId) ||
        book.positions.some((p) => p.accountId === accountId);
    if (!visible) throw errors.notFound("Account not found for this API key.");
}

/** Filter positions to one account. Ownership was established before this call. */
export function selectPositions(
    book: Pick<NormalizedBook, "positions">,
    accountId?: string
): PortfolioPosition[] {
    if (!accountId) return book.positions;
    return book.positions.filter((p) => p.accountId === accountId);
}

/* ── Aggregate analytics ──────────────────────────────────────────────────── */

export interface AccountAnalytics {
    accountCount: number;
    positionCount: number;
    baseCurrency: string;
    balance: number;
    equity: number;
    floatingPnL: number;
    realizedPnL: number | null;
    marginUsed: number;
    freeMargin: number;
    marginLevelPercent: number | null;
    openRisk: number | null;
    openRiskPercent: number | null;
    drawdownPercent: number | null;
    dataTimestamp: number;
    limitations: string[];
}

type AnalyticsSource = Pick<
    NormalizedBook,
    | "accounts"
    | "positions"
    | "balance"
    | "equity"
    | "realizedPnL"
    | "marginUsed"
    | "freeMargin"
    | "storedDrawdownPercent"
    | "baseCurrency"
    | "dataTimestamp"
>;

/**
 * Aggregate the canonical book into the totals the old ad-hoc analytics route
 * used to recompute by hand. Every figure is derived from normalised records;
 * anything the gateway does not persist (`realizedPnL`, open risk without a
 * stop loss) is returned as null with an explicit limitation.
 */
export function buildAccountAnalytics(book: AnalyticsSource): AccountAnalytics {
    const openRiskPct = openRiskPercent(book);
    const ddPercent = drawdownPercent(book);
    const marginLevel = marginLevelPercent(book);

    const limitations: string[] = [];
    if (book.accounts.length === 0) {
        limitations.push("No broker account is connected to this user.");
    }
    if (book.realizedPnL === null) {
        limitations.push("Realized P&L is not persisted by the gateway and is not estimated.");
    }
    if (openRiskPct === null) {
        limitations.push(
            "Open risk is unavailable: no open position has a recorded stop loss."
        );
    }
    if (ddPercent === null) {
        limitations.push(
            "No recorded equity high-water mark: drawdown reflects the current float only."
        );
    }

    return {
        accountCount: book.accounts.length,
        positionCount: book.positions.length,
        baseCurrency: book.baseCurrency,
        balance: book.balance,
        equity: book.equity,
        floatingPnL: book.equity - book.balance,
        realizedPnL: book.realizedPnL,
        marginUsed: book.marginUsed,
        freeMargin: book.freeMargin,
        marginLevelPercent: marginLevel,
        openRisk: openRiskPct !== null && book.equity > 0 ? (openRiskPct / 100) * book.equity : null,
        openRiskPercent: openRiskPct,
        drawdownPercent: ddPercent,
        dataTimestamp: book.dataTimestamp,
        limitations,
    };
}
