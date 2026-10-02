/**
 * External error codes re-exported as a local alias so consumers of the
 * intelligence service can type-check against provider failures without
 * importing the provider internals.
 */
export type ExternalProviderErrorCode =
    | "DISABLED"
    | "NOT_CONNECTED"
    | "REAUTH_REQUIRED"
    | "TOKEN_EXPIRED"
    | "RATE_LIMITED"
    | "TIMEOUT"
    | "PROVIDER_OUTAGE"
    | "UNSUPPORTED_CAPABILITY"
    | "INVALID_REQUEST"
    | "NOT_FOUND"
    | "PERMISSION_DENIED"
    | "UNKNOWN_ERROR";
