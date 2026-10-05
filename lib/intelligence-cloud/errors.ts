/**
 * Intelligence Cloud — API Error Contract (Phase 13)
 *
 * Every public API response is either a contract payload or this envelope.
 * Clients can branch on `code` alone; `message` is human-facing and may change.
 *
 * Security note: internal error causes are never serialised into `message`.
 * See `publicMessage` — it deliberately collapses internal failures into a
 * generic message while keeping a correlatable `requestId` for support.
 */

export const INTELLIGENCE_ERROR_CODES = [
    "UNAUTHORIZED",
    "FORBIDDEN",
    "INVALID_REQUEST",
    "RATE_LIMITED",
    "QUOTA_EXCEEDED",
    "DATA_UNAVAILABLE",
    "DATA_STALE",
    "ENGINE_UNAVAILABLE",
    "RESOURCE_NOT_FOUND",
    "RESEARCH_RUNNING",
    "SCOPE_INSUFFICIENT",
    "TENANT_REQUIRED",
    "INTERNAL_ERROR",
] as const;

export type IntelligenceErrorCode = (typeof INTELLIGENCE_ERROR_CODES)[number];

/** Default HTTP status per code. Overridable where a route has a better fit. */
const STATUS_BY_CODE: Record<IntelligenceErrorCode, number> = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    INVALID_REQUEST: 400,
    RATE_LIMITED: 429,
    QUOTA_EXCEEDED: 429,
    DATA_UNAVAILABLE: 503,
    DATA_STALE: 503,
    ENGINE_UNAVAILABLE: 503,
    RESOURCE_NOT_FOUND: 404,
    RESEARCH_RUNNING: 409,
    SCOPE_INSUFFICIENT: 403,
    TENANT_REQUIRED: 400,
    INTERNAL_ERROR: 500,
};

/**
 * Whether a client retrying the identical request could succeed later.
 * Drives SDK backoff and webhook retry policy.
 */
const RETRYABLE_BY_CODE: Record<IntelligenceErrorCode, boolean> = {
    UNAUTHORIZED: false,
    FORBIDDEN: false,
    INVALID_REQUEST: false,
    RATE_LIMITED: true,
    QUOTA_EXCEEDED: false,
    DATA_UNAVAILABLE: true,
    DATA_STALE: true,
    ENGINE_UNAVAILABLE: true,
    RESOURCE_NOT_FOUND: false,
    RESEARCH_RUNNING: true,
    SCOPE_INSUFFICIENT: false,
    TENANT_REQUIRED: false,
    INTERNAL_ERROR: true,
};

export interface IntelligenceErrorBody {
    error: {
        code: IntelligenceErrorCode;
        message: string;
        requestId: string;
        retryable: boolean;
        /** Set on rate limiting so clients can self-throttle without guessing. */
        retryAfterSeconds?: number;
        /** Field-level validation detail; safe to echo (client-supplied input only). */
        details?: Array<{ field: string; issue: string }>;
    };
}

/**
 * A failure that carries its own contract code, so a route can throw it and a
 * shared handler can render the envelope without re-deriving status/retryability.
 */
export class IntelligenceError extends Error {
    readonly code: IntelligenceErrorCode;
    readonly status: number;
    readonly retryable: boolean;
    readonly retryAfterSeconds?: number;
    readonly details?: Array<{ field: string; issue: string }>;

    constructor(
        code: IntelligenceErrorCode,
        message: string,
        options?: {
            status?: number;
            retryable?: boolean;
            retryAfterSeconds?: number;
            details?: Array<{ field: string; issue: string }>;
        }
    ) {
        super(message);
        this.name = "IntelligenceError";
        this.code = code;
        this.status = options?.status ?? STATUS_BY_CODE[code];
        this.retryable = options?.retryable ?? RETRYABLE_BY_CODE[code];
        this.retryAfterSeconds = options?.retryAfterSeconds;
        this.details = options?.details;
    }
}

export function statusForErrorCode(code: IntelligenceErrorCode): number {
    return STATUS_BY_CODE[code];
}

export function isRetryableCode(code: IntelligenceErrorCode): boolean {
    return RETRYABLE_BY_CODE[code];
}

/**
 * Render any thrown value into the public error envelope.
 *
 * Unknown throwables are reported as INTERNAL_ERROR with a fixed message: an
 * internal stack, engine path or database detail must never reach an external
 * caller (SSRF/IDOR/enumeration information leakage).
 */
export function toErrorBody(
    error: unknown,
    requestId: string,
    fallbackCode: IntelligenceErrorCode = "INTERNAL_ERROR"
): IntelligenceErrorBody {
    if (error instanceof IntelligenceError) {
        return {
            error: {
                code: error.code,
                message: error.message,
                requestId,
                retryable: error.retryable,
                ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
                ...(error.details ? { details: error.details } : {}),
            },
        };
    }

    return {
        error: {
            code: fallbackCode,
            message: "The request could not be completed.",
            requestId,
            retryable: RETRYABLE_BY_CODE[fallbackCode],
        },
    };
}

/** Convenience guards so route code reads as intent, not as string literals. */
export const errors = {
    unauthorized: (message = "Authentication is required.") =>
        new IntelligenceError("UNAUTHORIZED", message),
    forbidden: (message = "The caller is not permitted to perform this action.") =>
        new IntelligenceError("FORBIDDEN", message),
    invalidRequest: (
        message = "The request is invalid.",
        details?: Array<{ field: string; issue: string }>
    ) => new IntelligenceError("INVALID_REQUEST", message, { details }),
    rateLimited: (retryAfterSeconds: number) =>
        new IntelligenceError("RATE_LIMITED", "Rate limit exceeded for this caller.", {
            retryAfterSeconds,
            retryable: true,
        }),
    quotaExceeded: (message = "The plan quota for this operation is exhausted.") =>
        new IntelligenceError("QUOTA_EXCEEDED", message),
    dataUnavailable: (message = "Market data is unavailable for this instrument.") =>
        new IntelligenceError("DATA_UNAVAILABLE", message),
    dataStale: (message = "Market data is older than the permitted freshness window.") =>
        new IntelligenceError("DATA_STALE", message),
    engineUnavailable: (message = "The intelligence engine is temporarily unavailable.") =>
        new IntelligenceError("ENGINE_UNAVAILABLE", message),
    notFound: (message = "The requested resource does not exist.") =>
        new IntelligenceError("RESOURCE_NOT_FOUND", message),
    scopeInsufficient: (required: string) =>
        new IntelligenceError(
            "SCOPE_INSUFFICIENT",
            `This API key is missing the required scope: ${required}.`,
            { details: [{ field: "scopes", issue: `missing ${required}` }] }
        ),
    tenantRequired: (message = "A tenant context is required for this operation.") =>
        new IntelligenceError("TENANT_REQUIRED", message),
};
