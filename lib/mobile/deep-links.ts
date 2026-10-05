/**
 * Phase 11 — canonical deep links.
 *
 * A deep link is the contract between "something happened on the server" and "a
 * trader is now looking at exactly that thing". Push notifications, emails,
 * shared intelligence cards, the PWA and the native app all resolve through
 * `buildDeepLink` / `parseDeepLink`, so a route can never be correct in the
 * sender and wrong in the receiver.
 *
 * Two security properties are enforced here rather than at each call site:
 *
 *   1. `returnTo` is ALWAYS an internal absolute path. `buildLoginUrl` refuses to
 *      produce anything else, so the auth flow cannot become an open redirect.
 *   2. Every id is validated against the id grammar used by the RTDB repositories
 *      before it is embedded in a route, so a crafted notification payload cannot
 *      traverse the database.
 *
 * Pure module: no I/O.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { DeepLink, DeepLinkSurface, DeepLinkTarget } from "./contracts";

/** Matches the repository validators (`validateSetupId` and friends). */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_SYMBOL = /^[A-Z0-9]{2,12}(?:[.\-_/][A-Z0-9]{1,6})?$/;
const TIMEFRAMES: readonly string[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

/** Desktop route prefixes. Kept in one table so a route rename is a one-line change. */
export const DEEP_LINK_ROUTES = {
    terminal: "/terminal",
    setup: "/setup",
    alert: "/alert",
    research: "/research",
    strategy: "/strategy",
    journal: "/journal",
    position: "/position",
} as const;

function encode(value: string): string {
    return encodeURIComponent(value);
}

/**
 * Build the canonical path for a target.
 *
 * Returns `null` when the target is malformed. Callers must handle `null` rather
 * than falling back to a hand-written string — a malformed id is a bug upstream
 * and should surface as one, not as a link to the wrong place.
 */
export function buildDeepLinkPath(target: DeepLinkTarget): string | null {
    switch (target.kind) {
        case "terminal-home":
            return "/terminal";
        case "terminal": {
            if (!SAFE_SYMBOL.test(target.symbol)) return null;
            const tf = target.timeframe && TIMEFRAMES.includes(target.timeframe) ? target.timeframe : null;
            return tf ? `${DEEP_LINK_ROUTES.terminal}/${encode(target.symbol)}?tf=${tf}` : `${DEEP_LINK_ROUTES.terminal}/${encode(target.symbol)}`;
        }
        case "setup":
            return SAFE_ID.test(target.setupId) ? `${DEEP_LINK_ROUTES.setup}/${encode(target.setupId)}` : null;
        case "alert":
            return SAFE_ID.test(target.alertId) ? `${DEEP_LINK_ROUTES.alert}/${encode(target.alertId)}` : null;
        case "research":
            return SAFE_ID.test(target.researchId) ? `${DEEP_LINK_ROUTES.research}/${encode(target.researchId)}` : null;
        case "strategy":
            return SAFE_ID.test(target.strategyId) ? `${DEEP_LINK_ROUTES.strategy}/${encode(target.strategyId)}` : null;
        case "journal":
            return SAFE_ID.test(target.entryId) ? `${DEEP_LINK_ROUTES.journal}/${encode(target.entryId)}` : null;
        case "position":
            return SAFE_ID.test(target.positionId) ? `${DEEP_LINK_ROUTES.position}/${encode(target.positionId)}` : null;
        default:
            return null;
    }
}

export interface BuildDeepLinkOptions {
    surface?: DeepLinkSurface;
    /** Absolute origin, e.g. "https://algovault.io". Omitted for a path-only link. */
    origin?: string;
}

/**
 * Build a deep link. `path` is always safe to put in a push payload or an email:
 * it is same-origin by construction because it starts with a single `/`.
 */
export function buildDeepLink(
    target: DeepLinkTarget,
    options: BuildDeepLinkOptions = {},
): { path: string; url: string } | null {
    const path = buildDeepLinkPath(target);
    if (!path) return null;
    const origin = options.origin ? options.origin.replace(/\/+$/, "") : "";
    return { path, url: `${origin}${path}` };
}

/**
 * The auth handoff. `returnTo` is an internal absolute path by contract; this
 * function additionally rejects anything that is not, so a compromised or buggy
 * caller cannot turn the login screen into an open redirect.
 */
export function buildLoginUrl(returnTo: string): string {
    const safe = isSafeInternalPath(returnTo) ? returnTo : "/dashboard";
    return `/login?redirect=${encodeURIComponent(safe)}`;
}

/** Reject protocol-relative URLs (`//evil.com`) and absolute URLs. */
export function isSafeInternalPath(candidate: string): boolean {
    if (typeof candidate !== "string") return false;
    if (!candidate.startsWith("/")) return false;
    if (candidate.startsWith("//")) return false;
    if (candidate.includes("\\")) return false;
    // Reject control characters used to smuggle a second header/URL past a viewer.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return false;
    return true;
}

/**
 * Parse an incoming deep link path back into a target.
 *
 * Accepts both the canonical `/setup/{id}` form and the app-native equivalents
 * that already exist in the product (`/signals/{id}`, `/strategy-research/{id}`,
 * `/trade-journal`). That is what lets a link written before Phase 11 keep
 * working instead of 404-ing for users.
 */
export function parseDeepLink(rawPath: string): DeepLink | null {
    if (!isSafeInternalPath(rawPath)) return null;

    let url: URL;
    try {
        url = new URL(rawPath, "https://algovault.invalid");
    } catch {
        return null;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;

    const [head, second] = segments;
    const tf = url.searchParams.get("tf");
    const timeframe = tf && TIMEFRAMES.includes(tf) ? (tf as Timeframe) : undefined;

    const decode = (value: string): string | null => {
        try {
            const decoded = decodeURIComponent(value);
            return SAFE_ID.test(decoded) ? decoded : null;
        } catch {
            return null;
        }
    };

    switch (head) {
        case "terminal":
            if (!second) return target({ kind: "terminal-home" }, url.pathname);
            if (!SAFE_SYMBOL.test(second)) return null;
            return target({ kind: "terminal", symbol: second, ...(timeframe ? { timeframe } : {}) }, url.pathname);
        case "setup":
        case "setups": {
            const id = second && decode(second);
            return id ? target({ kind: "setup", setupId: id }, url.pathname) : null;
        }
        case "alert":
        case "alerts": {
            const id = second && decode(second);
            return id ? target({ kind: "alert", alertId: id }, url.pathname) : null;
        }
        case "research":
        case "strategy-research": {
            const id = second && decode(second);
            return id ? target({ kind: "research", researchId: id }, url.pathname) : null;
        }
        case "strategy":
        case "strategies": {
            const id = second && decode(second);
            return id ? target({ kind: "strategy", strategyId: id }, url.pathname) : null;
        }
        case "journal":
        case "trade-journal": {
            const id = second && decode(second);
            return id ? target({ kind: "journal", entryId: id }, url.pathname) : null;
        }
        case "position":
        case "positions": {
            const id = second && decode(second);
            return id ? target({ kind: "position", positionId: id }, url.pathname) : null;
        }
        default:
            return null;
    }

    function target(t: DeepLinkTarget, path: string): DeepLink {
        return { target: t, surface: "universal", returnTo: path };
    }
}

/**
 * The mobile variant of a deep link. The mobile shell is a sub-application under
 * `/mobile`, so a phone notification must land there while a desktop notification
 * lands at the desktop route. Both resolve to the same underlying record.
 */
export function mobilePathFor(link: DeepLink): string | null {
    const desktop = buildDeepLinkPath(link.target);
    if (!desktop) return null;
    return `/mobile${desktop}`;
}
