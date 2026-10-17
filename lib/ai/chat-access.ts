/**
 * Access control for POST /api/ai/chat.
 *
 * Three independent controls, deliberately kept out of the route handler so
 * each can be unit-tested:
 *
 *  1. Origin policy — same-origin and the Chrome extension are the only
 *     legitimate browser clients; a custom web deployment must be listed
 *     explicitly. There is never a wildcard. Origin is NOT authentication.
 *  2. Authentication — a Firebase ID token verified through the existing
 *     Admin SDK wrapper. The verified uid is the only identity used; nothing
 *     from the request body can select or impersonate a user.
 *  3. Rate limiting — the existing in-memory sliding-window limiter, keyed by
 *     the verified uid. This is per server instance (see the note below).
 */

import { AIConfig } from "./config";
import { checkRateLimit, type RateLimitResult } from "../security/rate-limiter";

export interface ChatAccessConfig {
    allowedOrigins: string[];
    rateLimitMax: number;
    rateLimitWindowMs: number;
}

/** Read access policy from config. Called per request so env changes apply. */
export function chatAccessConfig(): ChatAccessConfig {
    return {
        allowedOrigins: AIConfig.chatAllowedOrigins,
        rateLimitMax: AIConfig.chatRateLimitPerMinute,
        rateLimitWindowMs: 60_000,
    };
}

/** Canonical origin, or null when the value is not a valid absolute URL. */
export function normalizeOrigin(origin: string | null | undefined): string | null {
    if (typeof origin !== "string" || origin.trim() === "") return null;
    try {
        const url = new URL(origin.trim());
        // `URL.origin` is the opaque string "null" for non-special schemes
        // such as chrome-extension:, so rebuild the canonical value there.
        if (url.protocol === "chrome-extension:") {
            return url.host ? `chrome-extension://${url.host}` : null;
        }
        return url.origin === "null" ? null : url.origin;
    } catch {
        return null;
    }
}

function isChromeExtensionOrigin(origin: string): boolean {
    return origin.startsWith("chrome-extension://");
}

/**
 * True when a browser Origin may call the endpoint.
 *
 * - no Origin: a non-browser client (server, CLI); authentication still applies.
 * - same-origin: the web app and the desktop shell's loopback renderer.
 * - `chrome-extension://`: the packaged browser extension, which is a
 *   first-party client. Authentication still applies, so this does not grant
 *   access to anyone who does not already hold the user's token.
 * - explicit allowlist: custom web deployments only.
 *
 * A malformed Origin fails closed.
 */
export function isChatOriginAllowed(
    origin: string | null,
    requestHost: string | null,
    allowedOrigins: string[],
): boolean {
    if (!origin) return true;

    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;

    if (requestHost) {
        try {
            if (new URL(normalized).host === requestHost) return true;
        } catch {
            // Fall through to the allowlist.
        }
    }

    if (isChromeExtensionOrigin(normalized)) return true;

    return allowedOrigins.some((entry) => normalizeOrigin(entry) === normalized);
}

/** CORS response headers for an allowed browser origin. */
export function chatCorsHeaders(origin: string | null): Record<string, string> {
    if (!origin) return {};
    const normalized = normalizeOrigin(origin);
    if (!normalized) return {};
    return {
        "Access-Control-Allow-Origin": normalized,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Expose-Headers":
            "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
    };
}

export interface ChatCorsDecision {
    allowed: boolean;
    headers: Record<string, string>;
}

/** Evaluate the Origin once and return the exact headers to send. */
export function evaluateChatOrigin(origin: string | null, requestHost: string | null): ChatCorsDecision {
    const allowed = isChatOriginAllowed(origin, requestHost, AIConfig.chatAllowedOrigins);
    return { allowed, headers: allowed ? chatCorsHeaders(origin) : {} };
}

/** A caller identity derived exclusively from a verified credential. */
export interface ChatCaller {
    uid: string;
}

/**
 * Resolve the caller from an Authorization header.
 *
 * The verifier is injected so tests can exercise every outcome without
 * Firebase. Missing/malformed headers and verifier failures fail closed; no
 * user id is ever read from the request body.
 */
export async function resolveChatCaller(
    authorization: string | null,
    verify: (token: string) => Promise<{ uid: string } | null>,
): Promise<ChatCaller | null> {
    if (typeof authorization !== "string") return null;
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!match) return null;

    try {
        const token = await verify(match[1]);
        if (!token || typeof token.uid !== "string" || token.uid.trim() === "") return null;
        return { uid: token.uid };
    } catch {
        return null;
    }
}

/** Rate-limit bucket for one verified user. */
export function chatRateLimitKey(uid: string): string {
    return `ai-chat:${uid}`;
}

/**
 * Consume one request from the user's window.
 *
 * The limiter is process-local: multiple instances each maintain their own
 * window, so the effective limit scales with the number of instances. No
 * external store is introduced (no paid service, no new dependency).
 */
export function checkChatRateLimit(
    uid: string,
    config: ChatAccessConfig = chatAccessConfig(),
): RateLimitResult {
    return checkRateLimit(chatRateLimitKey(uid), {
        max: config.rateLimitMax,
        windowMs: config.rateLimitWindowMs,
    });
}

/** Standard rate-limit response headers. */
export function chatRateLimitHeaders(result: RateLimitResult): Record<string, string> {
    return {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
        "X-RateLimit-Reset": String(result.reset),
    };
}
