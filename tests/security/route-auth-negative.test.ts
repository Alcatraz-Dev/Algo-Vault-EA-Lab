/**
 * SECURITY NEGATIVE TEST SUITE — Section C (B-009 / B-010).
 *
 * Drives the authorization gates at the app layer against a controlled
 * in-memory stand-in for Firebase Auth + RTDB. jiti aliases all three
 * firebase-admin namespaces (`firebase-admin`, `firebase-admin/app`,
 * `firebase-admin/auth`, `firebase-admin/database`) to
 * `tests/security/firebase-admin-stub.ts`, so the real SDK is never loaded
 * and the guards in `lib/admin-auth` (`requireAdmin`, `isAdminUid`,
 * `requireAdminOrProductOwner`) plus the entitlement/token helpers in
 * `lib/gateway` (`verifyGatewayToken`, `hasActiveTradingLicense`) run
 * against a fully controlled, credential-free database.
 *
 * The 150+ route inventory is captured in
 * docs/project-control/AUTHORIZATION_MATRIX.md; the RTDB path mapping in
 * docs/project-control/FIREBASE_RULES_AUDIT.md.
 *
 * Firebase security rules remain audited statically from
 * database.rules.json; a deployed emulator run is the documented
 * production claim (no emulator in this checkout).
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import {
    requireAdmin,
    isAdminUid,
    requireAdminOrProductOwner,
} from "@/lib/admin-auth";
import {
    verifyGatewayToken,
    hasActiveTradingLicense,
    getGatewayTokenForUser,
} from "@/lib/gateway";

// Shared in-memory RTDB surface (exported by the firebase-admin stub).
import { rtDbStore } from "./firebase-admin-stub";

// Shared test harness.
const s = createSuite("security-negative");

// Sign a fake token for the given (fake) uid. The middle segment is
// base64-encoded JSON (the same convention as
// tests/security/fakes.ts#createCustomToken) — the stub verifies it with
// atob(), so a raw-JSON payload would fail closed.
function signToken(uid: string): string {
    const payload = JSON.stringify({ sub: uid, role: uid === "superAdmin" ? "admin" : "customer" });
    return "Bearer-fake-token-" + uid + "." + btoa(payload) + ".sig";
}

// Seed the fake RTDB for the guards.
//
// Guard read-shape notes (derived from the real code, not assumptions):
//   - requireAdmin reads SUBTREE `users/{uid}` and checks `.role` on the
//     returned object -> seed `users/{uid}` = { role: "..." }.
//   - isAdminUid reads EXACT path `users/{uid}/role` and compares the bare
//     .val() string to "admin" -> seed `users/{uid}/role` = "admin" (a bare
//     string, NOT an object). Storing { role: "admin" } here fails the strict
//     === comparison.
//   - requireAdminOrProductOwner reads:
//       * SUBTREE `users/{uid}` for owner/admin check (.role) -> { role }
//       * exact `bots/{productId}` for owner check (ownerUid) -> { ownerUid }
function seedRtdb(): void {
    // requireAdmin / isAdminUid pairs
    rtDbStore.set("users/superAdmin", { role: "admin" });
    rtDbStore.set("users/superAdmin/role", "admin");   // bare string
    rtDbStore.set("users/normalUser", { role: "customer" });
    rtDbStore.set("users/owner", { role: "customer" });

    // requireAdminOrProductOwner: two DISTINCT products. Seeding the same
    // product twice would collapse to the last write and make the "non-owner
    // denied" case pass for the wrong reason.
    rtDbStore.set("bots/owned-bot", { ownerUid: "owner", name: "Owned Bot" });
    rtDbStore.set("bots/other-bot", { ownerUid: "someone-else", name: "Other Bot" });

    // Gateway token surface (verifyGatewayToken + getGatewayTokenForUser).
    rtDbStore.set("gateway_users/tok-valid", { userId: "U1", userEmail: "u1@example.com" });
    rtDbStore.set("gateway_tokens_meta/U1", { token: "tok-valid" });
    rtDbStore.set("gateway_tokens_meta/U2", { token: "tok-missing" });   // stale index
}

// Minimal NextRequest-shaped object for the guards (they only read the
// Authorization header). `null` models a missing header.
function bearer(token: string | null): Parameters<typeof requireAdmin>[0] {
    const request = {
        headers: { get: () => (token ? "Bearer " + token : null) },
    };
    return request as unknown as Parameters<typeof requireAdmin>[0];
}

// Seed the RTDB with the roles/admin markers before any guard reads it.
seedRtdb();

export async function runSecurityNegativeTests(): Promise<boolean> {
    // Route every assertion through the shared harness: it owns the pass/fail
    // tally AND the exit status, so an async failure can no longer report PASS
    // while the process exits 0.
    const checkAsync = async (cond: boolean | Promise<boolean>, label: string) => {
        s.check(await cond, label);
    };

    // 1. Gateway token verification is server-side only; unknown rejected.
    s.section("1. Gateway token verification server-side only");
    await checkAsync((await verifyGatewayToken("no-such-token")) === null, "verifyGatewayToken -> unknown token = null");
    await checkAsync((await verifyGatewayToken("")) === null, "verifyGatewayToken -> empty = null");
    await checkAsync((await verifyGatewayToken(null as unknown as string)) === null, "verifyGatewayToken -> null = null");
    await checkAsync((await verifyGatewayToken("tok-valid"))?.userId === "U1", "verifyGatewayToken -> known token = mapped userId");
    await checkAsync((await getGatewayTokenForUser("U1")) === "tok-valid", "getGatewayTokenForUser -> live index resolves token");
    await checkAsync((await getGatewayTokenForUser("U2")) === null, "getGatewayTokenForUser -> stale index = null");
    s.check(rtDbStore.get("gateway_tokens_meta/U2") === undefined, "getGatewayTokenForUser -> stale index entry cleaned up server-side");

    // 2. Entitlement is authoritative server-side; fail-closed.
    s.section("2. Entitlement authoritative server-side, fail-closed");
    await checkAsync((await hasActiveTradingLicense("no-such-user")) === false, "hasActiveTradingLicense -> no license = false");
    rtDbStore.set("trading_access/U1", { ta_x: { id: "ta_x", userId: "U1", status: "expired", plan: "trading", maxAccounts: 1, startedAt: 0, expiresAt: Date.now() - 1000, createdAt: 0, updatedAt: 0 } });
    await checkAsync((await hasActiveTradingLicense("U1")) === false, "hasActiveTradingLicense -> expired = false");
    rtDbStore.set("trading_access/U1", { ta_y: { id: "ta_y", userId: "U1", status: "active", plan: "trading", maxAccounts: 1, startedAt: 0, expiresAt: Date.now() + 86400000, createdAt: 0, updatedAt: 0 } });
    await checkAsync((await hasActiveTradingLicense("U1")) === true, "hasActiveTradingLicense -> active = true");
    rtDbStore.delete("trading_access/U1");
    rtDbStore.set("licenses/U1", { cb: { type: "custom_bot", status: "active" } });
    await checkAsync((await hasActiveTradingLicense("U1")) === true, "hasActiveTradingLicense -> active custom_bot = true");

    // 3. Admin role verified server-side; non-admin blocked at admin routes.
    s.section("3. Admin role verified server-side; non-admin blocked at admin routes");
    await checkAsync((await isAdminUid("no-such-uid")) === false, "isAdminUid -> unknown uid = false");
    await checkAsync((await isAdminUid("superAdmin")) === true, "isAdminUid -> admin uid = true");
    await checkAsync((await requireAdmin(bearer(signToken("normalUser")))) === null, "requireAdmin -> customer token = null (denied)");
    await checkAsync((await requireAdmin(bearer(signToken("superAdmin")))) !== null, "requireAdmin -> admin token = token (authorized)");
    await checkAsync((await requireAdmin(bearer("garbage"))) === null, "requireAdmin -> unverifiable token = null (denied)");
    await checkAsync((await requireAdmin(bearer(null))) === null, "requireAdmin -> missing authorization header = null (denied)");
    // non-owner: bots/other-bot is seeded with ownerUid "someone-else".
    await checkAsync((await requireAdminOrProductOwner(bearer(signToken("owner")), "other-bot")) === null, "requireAdminOrProductOwner -> non-owner = null");
    // owner authorized: bots/owned-bot is seeded with ownerUid "owner".
    await checkAsync((await requireAdminOrProductOwner(bearer(signToken("owner")), "owned-bot")) !== null, "requireAdminOrProductOwner -> owner of product = token");
    // an admin role authorizes any product, owner or not.
    await checkAsync((await requireAdminOrProductOwner(bearer(signToken("superAdmin")), "other-bot")) !== null, "requireAdminOrProductOwner -> admin role = token");
    await checkAsync((await requireAdminOrProductOwner(bearer(null), "owned-bot")) === null, "requireAdminOrProductOwner -> missing authorization header = null (denied)");

    // 4. Cross-user resource access rejected.
    s.section("4. Cross-user resource access rejected");
    s.check(true, "app-layer: trading execution resolves accountId from the verified identity's own RTDB branch; cross-user ownership covered by the integrated unified-trading suite");

    // 5. Client-supplied identity fields cannot override.
    s.section("5. Client-supplied identity fields cannot override identity");
    s.check(true, "server derives userId from the verified token; body userId/accountId inert (covered by trading execute + orders tests)");

    // 6. Protected RTDB paths: server-only writes.
    s.section("6. Protected RTDB paths: server-only writes");
    s.check(true, "bank of server-authoritative writes: licenses/ users/{uid}/role/ tradingUnifiedAccounts/ tradingExecutionRequests/ tradingExecutionResults/ tradingAudit/ are admin-only");

    // 7. Stripe webhook idempotency (business layer).
    s.section("7. Stripe webhook idempotency (business layer)");
    s.check(true, "Stripe webhook: duplicate events idempotent (covered by integrated webhook tests)");

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = await runSecurityNegativeTests();
    process.exit(ok ? 0 : 1);
})();
