/**
 * AlgoVault — Portfolio authorization primitives (Phase 15 §39).
 *
 * Deliberately dependency-free so it can be imported by edge middleware, API
 * routes and tests without pulling in firebase-admin. Every function is pure.
 */

/** Marker returned when a request carries a verified identity. */
export const AUTHENTICATED_MARKER = "algovault.portfolio.authenticated";

/** Every RTDB path a portfolio read or write may touch. */
export const PORTFOLIO_OWNED_ROOTS = [
    "portfolios",
    "portfolioSnapshots",
    "portfolioDecisions",
    "portfolioStressTests",
    "portfolioAllocations",
    "portfolioJournal",
    "portfolioMemory",
    "portfolioEvents",
    "portfolioObservability",
    "portfolioStrategies",
] as const;

export type PortfolioOwnedRoot = (typeof PORTFOLIO_OWNED_ROOTS)[number];

export interface AuthorizationContext {
    uid: string;
    /** API key / tenant roles when the caller is not the end user. */
    scopes?: readonly string[];
    isAdmin?: boolean;
}

/**
 * The single ownership predicate. Every portfolio path is `{root}/{uid}/...`, so
 * ownership is decided by the uid segment — there is no per-path special case
 * that could be forgotten.
 */
export function ownsPortfolio(ctx: AuthorizationContext, ownerUid: string): boolean {
    if (!ctx.uid || typeof ownerUid !== "string" || ownerUid.length === 0) return false;
    if (ctx.uid === ownerUid) return true;
    return ctx.isAdmin === true;
}

/** Whether a caller may read a portfolio owned by `ownerUid`. */
export function canReadPortfolio(ctx: AuthorizationContext, ownerUid: string): boolean {
    return ownsPortfolio(ctx, ownerUid);
}

/**
 * Whether a caller may WRITE portfolio artefacts. Client writes are limited to
 * a user's own configuration; snapshots, decisions, journal, memory, events and
 * observability are server-written only, so they are refused here regardless of
 * ownership.
 */
export function canWritePortfolio(
    ctx: AuthorizationContext,
    ownerUid: string,
    root: PortfolioOwnedRoot
): boolean {
    if (!ownsPortfolio(ctx, ownerUid)) return false;
    if (root === "portfolios") return true;
    return ctx.isAdmin === true;
}

/** Whether an API key scope grants access to a portfolio surface. */
export function hasPortfolioScope(scopes: readonly string[] | undefined, required: string): boolean {
    if (!Array.isArray(scopes)) return false;
    return scopes.includes(required);
}

/** The scope required for each read surface. */
export const PORTFOLIO_SCOPE_BY_SURFACE = {
    read: "portfolio:read",
    stress: "portfolio:stress",
    allocation: "portfolio:allocation",
} as const;

/**
 * Validate a portfolio id supplied by a client. Portfolio ids become RTDB path
 * segments, so anything containing a separator is refused rather than escaped.
 */
export function isValidPortfolioId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 64 && !/[/.\\#$\[\]]/.test(value);
}

/** Validate a uid used as a path segment. */
export function isValidUid(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[/.\\#$\[\]]/.test(value);
}
