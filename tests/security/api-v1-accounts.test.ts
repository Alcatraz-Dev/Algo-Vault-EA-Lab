/**
 * API v1 account-read security suite.
 *
 * Exercises the real route handlers (`GET /api/v1/accounts|positions|analytics`)
 * end to end against the in-memory firebase-admin seam:
 *
 *   unauthorized → 401 contract envelope
 *   scoped key, bound user → 200, only that user's book
 *   second tenant/user → cannot see the first user's data
 *   `accountId` filter for someone else's account → 404, never data
 *   missing scope → 403 SCOPE_INSUFFICIENT
 *   unbound (tenant-only) key → 403, fail closed
 *   exhausted budget → 429 RATE_LIMITED
 *
 * The runner aliases `firebase-admin*` to `tests/security/firebase-admin-stub`,
 * so no real credentials, database or network are touched.
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { createApiKey } from "@/lib/intelligence-cloud/api-keys";
import {
    __resetRateLimitCacheForTests,
    FALLBACK_RATE_LIMITS,
    PLAN_RATE_LIMITS,
    resolvePolicy,
} from "@/lib/intelligence-cloud/rate-limit";
import { GET as getAccounts } from "@/app/api/v1/accounts/route";
import { GET as getPositions } from "@/app/api/v1/positions/route";
import { GET as getAnalytics } from "@/app/api/v1/analytics/route";
import { rtDbStore } from "./firebase-admin-stub";

type Json = Record<string, unknown>;
type Route = (request: Request) => Promise<Response>;

const s = createSuite("api-v1-accounts");
const BASE = "http://localhost";

function asObject(value: unknown): Json {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Json)
        : {};
}

async function bodyOf(response: Response): Promise<Json> {
    return asObject(await response.json());
}

async function call(
    route: Route,
    path: string,
    secret?: string
): Promise<Response> {
    const headers: Record<string, string> = {};
    if (secret) headers.authorization = `Bearer ${secret}`;
    return route(new Request(`${BASE}${path}`, { headers }));
}

function seedTenant(tenantId: string): void {
    rtDbStore.set(`intelligenceCloud/tenants/${tenantId}/settings/profile`, {
        plan: "developer",
        status: "active",
    });
}

function seedBook(uid: string, accountId: string, balance: number): void {
    const now = Date.now();
    rtDbStore.set(`trading_accounts/${uid}`, {
        [accountId]: {
            balance,
            equity: balance + 250,
            margin: 500,
            freeMargin: balance + 250 - 500,
            currency: "USD",
            leverage: 100,
            broker: "BrokerA",
            lastHeartbeatAt: now,
        },
    });
    rtDbStore.set(`trading_positions/${uid}`, {
        [accountId]: {
            "51": {
                ticket: 51,
                symbol: "XAUUSD",
                type: "BUY",
                volume: 0.1,
                openPrice: 2300,
                currentPrice: 2310,
                profit: 100,
                sl: 2290,
                tp: 2330,
                openedAt: now - 1_000,
            },
        },
    });
}

async function issueKey(input: {
    tenantId: string;
    createdBy: string;
    ownerUserId?: string;
    scopes?: string[];
}): Promise<string> {
    const created = await createApiKey({
        tenantId: input.tenantId,
        createdBy: input.createdBy,
        ownerUserId: input.ownerUserId,
        scopes: input.scopes,
        name: "security-suite",
    });
    return created.secret;
}

async function run(): Promise<boolean> {
    __resetRateLimitCacheForTests();

    const tenantA = "tenant-a";
    const tenantB = "tenant-b";
    const userA = "user-a";
    const userB = "user-b";
    const accountA = "gateway_1001";
    const accountB = "gateway_2002";

    seedTenant(tenantA);
    seedTenant(tenantB);
    seedBook(userA, accountA, 10_000);
    seedBook(userB, accountB, 20_000);

    const keyA = await issueKey({
        tenantId: tenantA,
        createdBy: userA,
        ownerUserId: userA,
        scopes: ["portfolio:read"],
    });
    const keyB = await issueKey({
        tenantId: tenantB,
        createdBy: userB,
        ownerUserId: userB,
        scopes: ["portfolio:read"],
    });

    // ── 1. Authentication ────────────────────────────────────────────────
    s.section("1. Missing credentials use the error contract");
    {
        const response = await call(getAccounts, "/api/v1/accounts");
        const body = await bodyOf(response);
        const error = asObject(body.error);
        s.check(response.status === 401, "no bearer token -> 401");
        s.check(error.code === "UNAUTHORIZED", "error code is UNAUTHORIZED");
        s.check(
            typeof error.requestId === "string" && error.requestId.length > 0,
            "response carries a requestId"
        );
        s.check(
            response.headers.get("x-request-id") === error.requestId,
            "x-request-id header matches the body requestId"
        );
        s.check(error.retryable === false, "auth failures are not retryable");
    }

    // ── 2. Authorized reads ──────────────────────────────────────────────
    s.section("2. A bound, scoped key reads only its own book");
    {
        const response = await call(getAccounts, "/api/v1/accounts", keyA);
        const body = await bodyOf(response);
        const accounts = Array.isArray(body.accounts) ? body.accounts : [];
        const first = asObject(accounts[0]);
        s.check(response.status === 200, "valid key -> 200");
        s.check(accounts.length === 1, "exactly one account is returned");
        s.check(first.accountId === accountA, "the key's account is returned");
        s.check(!("userId" in first), "internal userId is not exposed");
        s.check(
            asObject(body.freshness).freshness === "FRESH",
            "freshness is reported explicitly"
        );
    }

    // ── 3. Cross-user isolation ──────────────────────────────────────────
    s.section("3. A second user's data is unreachable");
    {
        const response = await call(getAccounts, "/api/v1/accounts", keyB);
        const body = await bodyOf(response);
        const accounts = (Array.isArray(body.accounts) ? body.accounts : []).map(
            (a) => asObject(a).accountId
        );
        s.check(accounts.length === 1, "user B sees exactly one account");
        s.check(accounts[0] === accountB, "user B sees their own account");
        s.check(!accounts.includes(accountA), "user A's account never appears");

        const filtered = await call(
            getPositions,
            `/api/v1/positions?accountId=${encodeURIComponent(accountB)}`,
            keyA
        );
        const filteredBody = await bodyOf(filtered);
        s.check(
            filtered.status === 404,
            "filtering on another user's accountId -> 404"
        );
        s.check(
            asObject(filteredBody.error).code === "RESOURCE_NOT_FOUND",
            "cross-user filter returns RESOURCE_NOT_FOUND, not data"
        );

        const own = await call(
            getPositions,
            `/api/v1/positions?accountId=${encodeURIComponent(accountA)}`,
            keyA
        );
        const ownBody = await bodyOf(own);
        const positions = Array.isArray(ownBody.positions) ? ownBody.positions : [];
        s.check(own.status === 200, "own account filter -> 200");
        s.check(positions.length === 1, "own position is returned");
        s.check(
            asObject(positions[0]).accountId === accountA,
            "position belongs to the caller's account"
        );
    }

    // ── 4. Authorization / scopes ────────────────────────────────────────
    s.section("4. Scope and user binding are enforced server-side");
    {
        const unscoped = await issueKey({
            tenantId: tenantA,
            createdBy: userA,
            ownerUserId: userA,
        });
        const response = await call(getAccounts, "/api/v1/accounts", unscoped);
        const body = await bodyOf(response);
        s.check(response.status === 403, "key without portfolio:read -> 403");
        s.check(
            asObject(body.error).code === "SCOPE_INSUFFICIENT",
            "missing scope is named in the contract error"
        );

        const unbound = await issueKey({
            tenantId: tenantA,
            createdBy: userA,
            scopes: ["portfolio:read"],
        });
        const unboundResponse = await call(
            getAccounts,
            "/api/v1/accounts",
            unbound
        );
        const unboundBody = await bodyOf(unboundResponse);
        s.check(
            unboundResponse.status === 403,
            "tenant-only key without a user binding -> 403 (fail closed)"
        );
        s.check(
            asObject(unboundBody.error).code === "FORBIDDEN",
            "unbound key is forbidden, never widened to createdBy"
        );
    }

    // ── 5. Analytics from the canonical book ─────────────────────────────
    s.section("5. Analytics are derived from the same canonical book");
    {
        const response = await call(getAnalytics, "/api/v1/analytics", keyA);
        const body = await bodyOf(response);
        const analytics = asObject(body.analytics);
        s.check(response.status === 200, "analytics -> 200");
        s.check(analytics.accountCount === 1, "one account counted");
        s.check(analytics.positionCount === 1, "one position counted");
        s.check(analytics.balance === 10_000, "balance comes from user A only");
        s.check(analytics.equity === 10_250, "equity comes from user A only");
        s.check(
            analytics.floatingPnL === 250,
            "floating PnL is equity minus balance"
        );
        s.check(
            analytics.realizedPnL === null,
            "unpersisted realized PnL is null, not zero"
        );
    }

    // ── 6. Rate limiting ─────────────────────────────────────────────────
    s.section("6. The shared rate limiter blocks an exhausted budget");
    {
        __resetRateLimitCacheForTests();
        const limitedKey = await issueKey({
            tenantId: tenantA,
            createdBy: userA,
            ownerUserId: userA,
            scopes: ["portfolio:read"],
        });
        const policy = resolvePolicy(
            PLAN_RATE_LIMITS.developer,
            FALLBACK_RATE_LIMITS
        );
        const minuteLimit = policy.requestsPerMinute ?? 30;

        let limited: Response | null = null;
        for (let i = 0; i <= minuteLimit; i += 1) {
            const response = await call(
                getAccounts,
                "/api/v1/accounts",
                limitedKey
            );
            if (response.status === 429) {
                limited = response;
                break;
            }
        }
        s.check(limited !== null, `request ${minuteLimit + 1} is rate limited`);
        if (limited) {
            const body = await bodyOf(limited);
            const error = asObject(body.error);
            s.check(error.code === "RATE_LIMITED", "429 uses RATE_LIMITED");
            s.check(
                typeof error.retryAfterSeconds === "number" &&
                    (error.retryAfterSeconds as number) > 0,
                "429 tells the client when to retry"
            );
        }
        __resetRateLimitCacheForTests();
    }

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = await run();
    process.exit(ok ? 0 : 1);
})();
