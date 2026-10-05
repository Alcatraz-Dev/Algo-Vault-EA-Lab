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
    10004: "MARKET_CLOSED", // TRADE_RETCODE_REQUOTE
    10006: "MARKET_CLOSED", // TRADE_RETCODE_REJECT
    10007: "MARKET_CLOSED", // TRADE_RETCODE_CANCEL
    10008: "MARKET_CLOSED", // TRADE_RETCODE_PLACED
    10010: "INVALID_REQUEST", // TRADE_RETCODE_DONE_PARTIAL
    10011: "ORDER_REJECTED", // TRADE_RETCODE_ERROR
    10012: "INVALID_REQUEST", // TRADE_RETCODE_TIMEOUT
    10013: "INVALID_REQUEST", // TRADE_RETCODE_INVALID
    10014: "INVALID_VOLUME", // TRADE_RETCODE_INVALID_VOLUME
    10015: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_FILL
    10016: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_PRICE
    10017: "MARKET_CLOSED", // TRADE_RETCODE_INVALID_STOPS
    10018: "MARKET_CLOSED", // TRADE_RETCODE_TRADE_DISABLED
    10019: "MARKET_CLOSED", // TRADE_RETCODE_MARKET_CLOSED
    10020: "INSUFFICIENT_MARGIN", // TRADE_RETCODE_NO_MONEY
    10021: "INVALID_SYMBOL", // TRADE_RETCODE_PRICE_CHANGED
    10022: "INVALID_SYMBOL", // TRADE_RETCODE_PRICE_OFF
    10023: "INVALID_SYMBOL", // TRADE_RETCODE_INVALID_EXPIRATION
    10024: "ORDER_REJECTED", // TRADE_RETCODE_ORDER_CHANGED
    10025: "ORDER_REJECTED", // TRADE_RETCODE_TOO_FREQUENT
    10026: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_RECOMMON
    10027: "ORDER_REJECTED", // TRADE_RETCODE_OFF_QUOTES
    10028: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_BROKER_BUSY
    10029: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_REQUOTE_EXPIRED
    10030: "ORDER_REJECTED", // TRADE_RETCODE_ORDER_LOCKED
    10031: "ORDER_REJECTED", // TRADE_RETCODE_LONG_POSITION_ONLY
    10032: "ORDER_REJECTED", // TRADE_RETCODE_SHORT_POSITION_ONLY
    10033: "MARKET_CLOSED", // TRADE_RETCODE_CLOSE_ORDER_EXIST
    10034: "ORDER_REJECTED", // TRADE_RETCODE_NO_ORDER_SELECTED
    10035: "INVALID_REQUEST", // TRADE_RETCODE_INVALID_ORDER_VOLUME
    10036: "ORDER_REJECTED", // TRADE_RETCODE_POSITION_CLOSED
    10039: "ORDER_REJECTED", // TRADE_RETCODE_INVALID_COORDINATES
    10041: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_REFRESH_REQUIRED
    10042: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_CLIENT_DISCONNECTED
    10043: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_SERVER_DISCONNECTED
    10044: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_SERVER_CLOSED_CONNECTION
    10045: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_SERVER_BUSY
    10046: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_SERVER_CLOSE
    10047: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_SERVER_DISABLE_AT
    10048: "ORDER_REJECTED", // TRADE_RETCODE_CLIENT_DISABLE_AT
    10049: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_SERVER_DISABLE
    10050: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_CLIENT_DISABLE
    10051: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_INVALID_REQUEST_TIMEOUT
    10052: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_INVALID_REQUEST
    10053: "ACCOUNT_NOT_CONNECTED", // TRADE_RETCODE_SERVER_ERROR
    10054: "PROVIDER_STALE", // TRADE_RETCODE_SERVER_DISCONNECTED_AT
    10055: "UNKNOWN_PROVIDER_ERROR", // TRADE_RETCODE_CLIENT_ERROR
    10056: "UNKNOWN_PROVIDER_ERROR", // TRADE_RETCODE_SERVER_TIMEOUT
    10057: "EXECUTION_TIMEOUT", // TRADE_RETCODE_EXPIRED
    10058: "ORDER_REJECTED", // TRADE_RETCODE_ORDER_ADD_DENIED
    10059: "ORDER_REJECTED", // TRADE_RETCODE_ORDER_MODIFY_DENIED
    10060: "ORDER_REJECTED", // TRADE_RETCODE_ORDER_DELETE_DENIED
    10061: "PROVIDER_UNAVAILABLE", // TRADE_RETCODE_TOO_MANY_REQUESTS
    10062: "UNKNOWN_PROVIDER_ERROR", // TRADE_RETCODE_NO_CHANGES
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