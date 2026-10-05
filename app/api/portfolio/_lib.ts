/**
 * Shared helpers for the Portfolio Intelligence API surface.
 *
 * Every portfolio route authenticates the caller, resolves the plan, checks
 * ownership of the requested portfolio, and returns the SAME envelope shape so
 * the Command Center, the Pro Terminal, mobile and the public API can never
 * drift apart.
 */

import { NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getAdminSubscriptionStatus } from "@/lib/subscription-server";
import { portfolioEntitlements, type PortfolioFeature } from "@/lib/portfolio/entitlements";
import { DEFAULT_PORTFOLIO_ID, listPortfolios } from "@/lib/portfolio/service";
import { canReadPortfolio, isValidPortfolioId } from "@/lib/portfolio/security";

export interface PortfolioAuthContext {
    uid: string;
    plan: string;
    /** Portfolios this user actually owns. */
    ownedPortfolioIds: string[];
}

/** Authenticate + resolve plan + resolve owned portfolios. */
export async function authorizePortfolio(
    request: Parameters<typeof authenticate>[0]
): Promise<{ ok: true; ctx: PortfolioAuthContext } | { ok: false; response: NextResponse }> {
    const user = await authenticate(request);
    if (!user) {
        return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }

    const [subscription, portfolios] = await Promise.all([
        getAdminSubscriptionStatus(user.uid).catch(() => ({ plan: "free", status: "none", hasSubscription: false })),
        listPortfolios(user.uid).catch(() => []),
    ]);

    return {
        ok: true,
        ctx: {
            uid: user.uid,
            plan: subscription.plan || "free",
            ownedPortfolioIds: portfolios.map((p) => p.portfolioId),
        },
    };
}

/**
 * Tenant isolation check. A portfolio id the caller does not own is refused
 * with 403 — never silently swapped for their own portfolio, which would look
 * like a successful cross-tenant read.
 *
 * The id is also validated as a safe RTDB path segment before it is used: a
 * caller-supplied id never reaches a path unvalidated.
 */
export function resolvePortfolioId(ctx: PortfolioAuthContext, requested: string | null): string | null {
    const portfolioId = requested && requested.trim() ? requested.trim() : DEFAULT_PORTFOLIO_ID;
    if (!isValidPortfolioId(portfolioId)) return null;
    if (!canReadPortfolio({ uid: ctx.uid }, ctx.uid)) return null;
    if (!ctx.ownedPortfolioIds.includes(portfolioId)) return null;
    return portfolioId;
}

export interface PortfolioEnvelope<T> {
    ok: boolean;
    portfolioId?: string;
    data?: T;
    error?: string;
    /** Human-readable explanation. Never carries a raw internal stack. */
    message?: string;
    /** Present on every response so a client never assumes freshness. */
    freshness?: unknown;
    entitlements?: { plan: string; denied: PortfolioFeature[] };
    limitations?: string[];
}

/** Gate a Pro-only feature. Returns a 402-shaped response when it is denied. */
export function requireFeature(
    plan: string,
    feature: PortfolioFeature
): { allowed: true } | { allowed: false; response: NextResponse } {
    const ent = portfolioEntitlements(plan);
    if (ent.allowed.includes(feature)) return { allowed: true };
    return {
        allowed: false,
        response: NextResponse.json(
            {
                ok: false,
                error: `PRO_REQUIRED`,
                feature,
                message: `"${feature}" is a Pro portfolio intelligence capability. Your plan (${plan}) includes: ${ent.allowed.join(", ")}.`,
                upgradeRequiredFor: ent.upgradeRequiredFor,
            },
            { status: 403 }
        ),
    };
}

export function portfolioJson<T>(
    body: PortfolioEnvelope<T>,
    status = 200
): NextResponse {
    return NextResponse.json(body, { status });
}

/** Consistent error envelope — never leaks an internal message verbatim. */
export function portfolioError(error: unknown, status = 500): NextResponse {
    const message = error instanceof Error ? error.message : "Portfolio intelligence unavailable.";
    return NextResponse.json(
        {
            ok: false,
            error: "PORTFOLIO_INTELLIGENCE_UNAVAILABLE",
            message,
            reason: message,
        },
        { status }
    );
}
