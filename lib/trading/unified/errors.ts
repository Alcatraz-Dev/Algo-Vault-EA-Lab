/**
 * Normalized, provider-neutral error model.
 *
 * Provider adapters translate their native failures into `TradingError` with a
 * `TradingErrorCode`. The UI, the AI surfaces and the Telegram/Discord bots
 * only ever branch on the code — they never see an MT5 retcode.
 */

import type { TradingError, TradingErrorCode } from "./domain";

const RETRYABLE: ReadonlySet<TradingErrorCode> = new Set<TradingErrorCode>([
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_STALE",
    "EXECUTION_TIMEOUT",
]);

/** HTTP status for a normalized error. 5xx means "server/provider problem". */
const HTTP_STATUS: Record<TradingErrorCode, number> = {
    ACCOUNT_NOT_CONNECTED: 409,
    ACCOUNT_NOT_FOUND: 404,
    PROVIDER_UNAVAILABLE: 503,
    PROVIDER_STALE: 409,
    INVALID_SYMBOL: 400,
    INVALID_VOLUME: 400,
    INSUFFICIENT_MARGIN: 422,
    MARKET_CLOSED: 409,
    ORDER_REJECTED: 422,
    EXECUTION_TIMEOUT: 504,
    DUPLICATE_REQUEST: 409,
    PERMISSION_DENIED: 403,
    LIVE_EXECUTION_DISABLED: 403,
    RISK_REJECTED: 422,
    UNKNOWN_PROVIDER_ERROR: 502,
    INVALID_REQUEST: 400,
    UNSUPPORTED_OPERATION: 501,
    PROVIDER_NOT_CONFIGURED: 501,
    TRADING_DISABLED: 403,
};

export interface TradingErrorInit {
    providerCode?: string | null;
    providerRetcode?: number | null;
}

/**
 * Short, actionable message per code for the Pro Terminal. Longer context
 * stays in the audit log; this is the one line the user sees.
 */
const USER_FACING_MESSAGE: Record<TradingErrorCode, string> = {
    ACCOUNT_NOT_CONNECTED: "Trading account is not connected. Open the gateway EA and reconnect.",
    ACCOUNT_NOT_FOUND: "Trading account or position was not found on this account.",
    PROVIDER_UNAVAILABLE: "Trading provider is temporarily unavailable. Try again shortly.",
    PROVIDER_STALE: "MT5 Gateway is stale — execution is blocked until the terminal reconnects.",
    INVALID_SYMBOL: "Invalid symbol for this account.",
    INVALID_VOLUME: "Invalid volume for this symbol.",
    INSUFFICIENT_MARGIN: "Insufficient margin for this trade.",
    MARKET_CLOSED: "The market is closed for this symbol.",
    ORDER_REJECTED: "The broker rejected the order.",
    EXECUTION_TIMEOUT: "Execution timed out — the gateway did not confirm in time. Check the terminal before retrying.",
    DUPLICATE_REQUEST: "This order was already submitted. Wait for the original result.",
    PERMISSION_DENIED: "You do not have permission to trade on this account.",
    LIVE_EXECUTION_DISABLED: "Live execution is disabled. Only demo accounts can trade on AlgoVault.",
    RISK_REJECTED: "The risk engine rejected this request.",
    UNKNOWN_PROVIDER_ERROR: "The provider reported an unexpected error.",
    INVALID_REQUEST: "The order request is invalid.",
    UNSUPPORTED_OPERATION: "This action is not supported by the connected provider.",
    PROVIDER_NOT_CONFIGURED: "No trading provider is configured for this account.",
    TRADING_DISABLED: "Trading is disabled on this platform.",
};

export function userFacingMessage(code: TradingErrorCode, detail?: string | null): string {
    const base = USER_FACING_MESSAGE[code] ?? "The order could not be executed.";
    // A provider rejection reason (e.g. an MT5 retcode text) is appended so
    // the user learns WHY, without ever exposing stack traces or internals.
    const extra = detail && detail !== base ? ` (${detail})` : "";
    return `${base}${extra}`;
}

export function tradingError(
    code: TradingErrorCode,
    message: string,
    init: TradingErrorInit = {},
    now: number = Date.now()
): TradingError {
    return {
        code,
        message,
        providerCode: init.providerCode ?? null,
        providerRetcode: init.providerRetcode ?? null,
        retryable: RETRYABLE.has(code),
        at: now,
    };
}

export function httpStatusForTradingError(error: TradingError): number {
    return HTTP_STATUS[error.code] ?? 500;
}

/**
 * MT5 retcode → normalized code.
 *
 * Source: the `TRADE_RETCODE_*` constants shipped with the MetaTrader 5
 * standard library (`Trade/Trade.mqh`), which is also what the
 * `AlgoVaultTradeGateway` EA reports back to `/api/trading/gateway/execution`.
 * Values are stable public API constants, not invented.
 */
const MT5_RETCODE_MAP: Readonly<Record<number, TradingErrorCode>> = {
    // Success (never surfaced as an error, but mapped so callers can branch).
    10009: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_DONE — sentinel, unused here
    10004: "ORDER_REJECTED", // TRADE_RETCODE_REQUOTE
    10006: "ORDER_REJECTED", // TRADE_RETCODE_REJECT
    10007: "ORDER_REJECTED", // TRADE_RETCODE_CANCEL
    10008: "INVALID_REQUEST", // TRADE_RETCODE_PLACED
    10010: "INVALID_REQUEST", // TRADE_RETCODE_DONE_PARTIAL
    10011: "UNKNOWN_PROVIDER_ERROR", // TRADE_RETCODE_ERROR
    10012: "EXECUTION_TIMEOUT", // TRADE_RETCODE_TIMEOUT
    10013: "INVALID_REQUEST", // TRADE_RETCODE_INVALID
    10014: "INVALID_VOLUME", // TRADE_RETCODE_INVALID_VOLUME
    10015: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_PRICE
    10016: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_STOPS
    10017: "TRADING_DISABLED", // TRADE_RETCODE_TRADE_DISABLED
    10018: "MARKET_CLOSED", // TRADE_RETCODE_MARKET_CLOSED
    10019: "INSUFFICIENT_MARGIN", // TRADE_RETCODE_NO_MONEY
    10020: "ORDER_REJECTED", // TRADE_RETCODE_PRICE_CHANGED
    10021: "ORDER_REJECTED", // TRADE_RETCODE_PRICE_OFF
    10022: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_EXPIRATION
    10023: "ORDER_REJECTED", // TRADE_RETCODE_ORDER_CHANGED
    10024: "PROVIDER_UNAVAILABLE", // TRADE_RETCODE_TOO_MANY_REQUESTS
    10025: "INVALID_REQUEST", // TRADE_RETCODE_NO_CHANGES
    10026: "TRADING_DISABLED", // TRADE_RETCODE_SERVER_DISABLES_AT
    10027: "TRADING_DISABLED", // TRADE_RETCODE_CLIENT_DISABLES_AT
    10028: "ORDER_REJECTED", // TRADE_RETCODE_LOCKED
    10029: "ORDER_REJECTED", // TRADE_RETCODE_FROZEN
    10030: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_FILL
    10031: "PROVIDER_UNAVAILABLE", // TRADE_RETCODE_CONNECTION
    10032: "TRADING_DISABLED", // TRADE_RETCODE_ONLY_REAL
    10033: "ORDER_REJECTED", // TRADE_RETCODE_LIMIT_ORDERS
    10034: "INVALID_VOLUME", // TRADE_RETCODE_LIMIT_VOLUME
    10035: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_ORDER
    10036: "ACCOUNT_NOT_FOUND", // TRADE_RETCODE_POSITION_CLOSED
    10038: "INVALID_VOLUME", // TRADE_RETCODE_INVALID_CLOSE_VOLUME
    10039: "ORDER_REJECTED", // TRADE_RETCODE_CLOSE_ORDER_EXIST
    10040: "ORDER_REJECTED", // TRADE_RETCODE_LIMIT_POSITIONS
    10041: "ORDER_REJECTED", // TRADE_RETCODE_REJECT_CANCEL
    10042: "ORDER_REJECTED", // TRADE_RETCODE_LONG_ONLY
    10043: "ORDER_REJECTED", // TRADE_RETCODE_SHORT_ONLY
    10044: "ORDER_REJECTED", // TRADE_RETCODE_CLOSE_ONLY
    10045: "ORDER_REJECTED", // TRADE_RETCODE_FIFO_CLOSE
};

/**
 * Maps an MT5 retcode (as reported by the gateway EA) onto the neutral model.
 * Unknown retcodes deliberately collapse to `UNKNOWN_PROVIDER_ERROR` instead
 * of being passed through — the UI must never branch on a broker enum.
 */
export function mapMt5Retcode(retcode: number): TradingErrorCode {
    const mapped = MT5_RETCODE_MAP[retcode];
    return mapped && mapped !== "ACCOUNT_NOT_CONNECTED" ? mapped : "UNKNOWN_PROVIDER_ERROR";
}

/** Human-facing default message per normalized code. */
const DEFAULT_MESSAGE: Record<TradingErrorCode, string> = {
    ACCOUNT_NOT_CONNECTED: "The trading account is not connected.",
    ACCOUNT_NOT_FOUND: "The trading account was not found for this user.",
    PROVIDER_UNAVAILABLE: "The trading provider is unavailable.",
    PROVIDER_STALE: "The trading provider connection is stale.",
    INVALID_SYMBOL: "The symbol is unavailable on this account.",
    INVALID_VOLUME: "The requested volume is invalid for this symbol.",
    INSUFFICIENT_MARGIN: "The account has insufficient free margin.",
    MARKET_CLOSED: "The market is closed or trading is disabled for this symbol.",
    ORDER_REJECTED: "The provider rejected the order.",
    EXECUTION_TIMEOUT: "The provider did not confirm the execution in time.",
    DUPLICATE_REQUEST: "This request was already submitted.",
    PERMISSION_DENIED: "You are not allowed to perform this action.",
    LIVE_EXECUTION_DISABLED: "Live execution is disabled on this platform.",
    RISK_REJECTED: "The risk engine rejected this request.",
    UNKNOWN_PROVIDER_ERROR: "The trading provider reported an unknown error.",
    INVALID_REQUEST: "The request is invalid.",
    UNSUPPORTED_OPERATION: "This provider does not support that operation.",
    PROVIDER_NOT_CONFIGURED: "This trading provider is not configured.",
    TRADING_DISABLED: "Trading is disabled on this account.",
};

export function defaultMessageFor(code: TradingErrorCode): string {
    return DEFAULT_MESSAGE[code];
}