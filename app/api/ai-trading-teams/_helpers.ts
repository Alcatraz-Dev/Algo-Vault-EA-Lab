/**
 * Shared helpers for AI Trading Teams API routes.
 *
 * Every route enforces, server-side and in this order:
 *   1. feature flag (AI_TRADING_TEAMS_ENABLED)
 *   2. authentication (Firebase ID token)
 *   3. Pro entitlement (server-side subscription read — never client input)
 *   4. rate limiting (per user)
 *   5. input schema validation
 *
 * UI hiding is never treated as enforcement.
 */

import { NextRequest } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled, featureFlagSnapshot } from "@/lib/ai-trading-teams/flags";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limiter";

export interface TeamsAuth {
    uid: string;
    isAdmin: boolean;
    error?: string;
}

export async function authenticateTeams(request: NextRequest): Promise<TeamsAuth> {
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
        return { uid: "", isAdmin: false, error: "Missing authorization." };
    }
    try {
        const token = await adminAuth.verifyIdToken(header.slice(7));
        let isAdmin = token.admin === true || token.role === "admin";
        if (!isAdmin) {
            try {
                const snap = await adminDatabase.ref(`users/${token.uid}/role`).get();
                isAdmin = snap.exists() && snap.val() === "admin";
            } catch {
                isAdmin = false;
            }
        }
        return { uid: token.uid, isAdmin };
    } catch {
        return { uid: "", isAdmin: false, error: "Invalid token." };
    }
}

export function deny(error = "AI Trading Teams is a Pro feature.", extra: Record<string, unknown> = {}): Response {
    return Response.json({ error, hasPro: false, upgrade: true, ...extra }, { status: 403 });
}

export function flagDisabled(): Response {
    return Response.json(
        {
            error: "AI Trading Teams is currently disabled by feature flag.",
            flags: featureFlagSnapshot(),
            hasPro: false,
            upgrade: false,
        },
        { status: 423 },
    );
}

export function unauthorized(error = "Authentication required."): Response {
    return Response.json({ error }, { status: 401 });
}

export function badRequest(error: string, details?: unknown): Response {
    return Response.json({ error, ...(details !== undefined ? { details } : {}) }, { status: 400 });
}

export function notFound(error = "Not found."): Response {
    return Response.json({ error }, { status: 404 });
}

export function serverError(error = "Request failed."): Response {
    return Response.json({ error }, { status: 500 });
}

export function ok(data: unknown, init?: ResponseInit): Response {
    return Response.json(data, init);
}

/**
 * Resolves auth + flag + entitlement + rate limit in one call.
 * Returns either the authenticated context or a ready-to-return error Response.
 */
export async function requireTeamsAccess(
    request: NextRequest,
    opts: { rateLimit?: { key: string; max?: number; windowMs?: number } } = {},
): Promise<{ auth: TeamsAuth; isPro: true } | { response: Response }> {
    if (!isAITeamsEnabled()) return { response: flagDisabled() };

    const auth = await authenticateTeams(request);
    if (!auth.uid) return { response: unauthorized(auth.error) };

    if (opts.rateLimit) {
        const ip = getClientIp(request);
        const limit = checkRateLimit(
            `ai-teams:${opts.rateLimit.key}:${auth.uid}:${ip}`,
            { max: opts.rateLimit.max ?? 30, windowMs: opts.rateLimit.windowMs ?? 60_000 },
        );
        if (!limit.success) {
            return {
                response: Response.json(
                    { error: "Rate limit exceeded. Please wait before retrying.", retryAfterSeconds: Math.ceil((limit.reset - Date.now() / 1000)) },
                    { status: 429 },
                ),
            };
        }
    }

    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) {
        return { response: deny() };
    }

    return { auth, isPro: true as const };
}

/** Pro entitlement visibility for read-only surfaces (library, previews). */
export async function readEntitlement(request: NextRequest): Promise<{ uid: string; isAdmin: boolean; isPro: boolean }> {
    const auth = await authenticateTeams(request);
    if (!auth.uid) return { uid: "", isAdmin: false, isPro: false };
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    return { uid: auth.uid, isAdmin: auth.isAdmin, isPro };
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
    try {
        const body = await request.json();
        return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
