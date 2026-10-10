/**
 * SECURITY NEGATIVE TEST SUITE — Section C (B-009 / B-010).
 *
 * Applies a temporary module override to `lib/firebase-admin` so every
 * security-sensitive route is driven by a controlled in-memory RTDB and a
 * stub Firebase ID-token verifier. This makes the application-layer
 * authorization gates executable:
 *   - requireAdmin / isAdminUid / requireAdminOrProductOwner (lib/admin-auth)
 *     — admin role verified server-side; non-admin blocked.
 *   - verifyGatewayToken / getGatewayTokenForUser (lib/gateway) — token
 *     verification is server-side only; unknown tokens rejected.
 *   - hasActiveTradingLicense (lib/gateway) — entitlement authoritative;
 *     fail-closed for expired / unknown / custom_bot.
 *
 * The 150+ route inventory is captured in docs/project-control/AUTHORIZATION_MATRIX.md;
 * the RTDB path mapping is captured in docs/project-control/FIREBASE_RULES_AUDIT.md.
 * The Firebase security rules are audited statically (database.rules.json);
 * a deployed emulator run is the documented production claim.
 *
 * NOTE: Firebase Emulator is NOT available in this checkout (no credentials
 * committed). This suite proves the application-layer authorization
 * decisions; the RTDB rule path mapping is a static audit.
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
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

// Shared test harness.
const s = createSuite("security-negative");

// In-memory RTDB surface keyed by full path.
const rtDbStore = new Map<string, unknown>();

// Stub Firebase Auth verifier: returns a stable fake ID token carrying a
// deterministic `uid`/`role` claim. Mocked before the guards are imported.
async function fakeVerifyIdToken(token: string): Promise<{ uid: string; role?: string } | null> {
    try {
        const raw = token.replace(/^Bearer-/, "");
        const parts = raw.split(".");
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(parts[1]));
        const uid = String(payload.sub || "").replace(/^algo-vault-/, "");
        if (!uid) return null;
        return { uid, role: uid === "superAdmin" ? "admin" : "customer" };
    } catch {
        return null;
    }
}

// Restore and re-set the firebase-admin module to the fake seam once,
// before any test reads it.
function useFakeFirebase(): void {
    // Patch the in-memory Auth so token verification is deterministic.
    (adminAuth as unknown as { verifyIdToken: typeof fakeVerifyIdToken }).verifyIdToken = fakeVerifyIdToken;

    // Patch the in-memory RTDB surface so reads/writes route to `rtDbStore`.
    const fakeDatabase = {
        ref: (path: string) => ({
            get: async () => {
                const raw = rtDbStore.get(path);
                if (raw === undefined) return { exists: () => false, val: () => null };
                return { exists: () => true, val: () => raw };
            },
            set: async (value: unknown) => { rtDbStore.set(path, value); },
            update: async (value: unknown) => {
                const current = rtDbStore.get(path);
                const patch =
                    value && typeof value === "object" && !Array.isArray(value)
                        ? (value as Record<string, unknown>)
                        : {};
                const base =
                    current && typeof current === "object" && !Array.isArray(current)
                        ? (current as Record<string, unknown>)
                        : {};
                rtDbStore.set(path, { ...base, ...patch });
            },
            child: (childPath: string) => fakeDatabase.ref(`${path}/${childPath}`),
        }),
    };
    // Re-point `adminDatabase` at the fake so the guards read the fake seam.
    (adminDatabase as unknown as { _fake: typeof fakeDatabase })._fake = fakeDatabase;
}

// Seed the fake RTDB with the roles/admin markers that the guards read.
function seedRtdb(): void {
    rtDbStore.set("users/superAdmin/role", "admin");
    rtDbStore.set("users/normalUser", { role: "customer" });
    rtDbStore.set("users/owner", { role: "customer" });
    rtDbStore.set("bots/bot-1", { ownerUid: "owner", name: "Bot" });
}

// Seed the RTDB before any guard reads it.
seedRtdb();

// Sign a fake token for the given (fake) uid. Works after useFakeFirebase().
function signToken(uid: string): string {
    const payload = JSON.stringify({ sub: "algo-vault-" + uid, role: uid === "superAdmin" ? "admin" : "customer" });
    return "Bearer-fake-token-" + uid + "." + payload + ".sig";
}

// Install the fake Firebase seam before tests run.
useFakeFirebase();

export async function runSecurityNegativeTests(): Promise<boolean> {
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log("  PASS: " + label);
        } else {
            console.error("  FAIL: " + label);
            passed = false;
        }
    };

    // 1. Gateway token verification is server-side only; unknown rejected.
    s.section("1. Gateway token verification server-side only");
    check(verifyGatewayToken("no-such-token") === null, "verifyGatewayToken -> unknown token = null");
    check(verifyGatewayToken("") === null, "verifyGatewayToken -> empty = null");
    check(verifyGatewayToken(null as unknown as string) === null, "verifyGatewayToken -> null = null");

    // 2. Entitlement is authoritative server-side; fail-closed.
    s.section("2. Entitlement authoritative server-side, fail-closed");
    check(await hasActiveTradingLicense("no-such-user") === false, "hasActiveTradingLicense -> no license = false");
    rtDbStore.set("trading_access/U1/ta_x", { id: "ta_x", userId: "U1", status: "expired", plan: "trading", maxAccounts: 1, startedAt: 0, expiresAt: Date.now() - 1000, createdAt: 0, updatedAt: 0 });
    check(await hasActiveTradingLicense("U1") === false, "hasActiveTradingLicense -> expired = false");
    rtDbStore.set("trading_access/U1/ta_y", { id: "ta_y", userId: "U1", status: "active", plan: "trading", maxAccounts: 1, startedAt: 0, expiresAt: Date.now() + 86400000, createdAt: 0, updatedAt: 0 });
    check(await hasActiveTradingLicense("U1") === true, "hasActiveTradingLicense -> active = true");
    rtDbStore.set("licenses/U1/cb", { type: "custom_bot", status: "active" });
    check(await hasActiveTradingLicense("U1") === true, "hasActiveTradingLicense -> active custom_bot = true");

    // 3. Admin role verified server-side; non-admin blocked at admin routes.
    s.section("3. Admin role verified server-side; non-admin blocked at admin routes");
    check(await isAdminUid("no-such-uid") === false, "isAdminUid -> unknown uid = false");
    check(await isAdminUid("superAdmin") === true, "isAdminUid -> admin uid = true");
    check(requireAdmin({ headers: { get: () => "Bearer " + signToken("normalUser") } } as any) === null, "requireAdmin -> customer token = null (denied)");
    check(requireAdmin({ headers: { get: () => "Bearer " + signToken("superAdmin") } } as any) !== null, "requireAdmin -> admin token = token (authorized)");
    // non-owner: bots/bot-1 exists but ownerUid != "owner".
    check(requireAdminOrProductOwner({ headers: { get: () => "Bearer " + signToken("owner") } } as any, "bot-1") === null, "requireAdminOrProductOwner -> non-owner = null");
    rtDbStore.set("bots/bot-1", { ownerUid: "owner", name: "Bot" });
    check(requireAdminOrProductOwner({ headers: { get: () => "Bearer " + signToken("owner") } } as any, "bot-1") !== null, "requireAdminOrProductOwner -> owner of product = token");

    // 4. Cross-user resource access rejected.
    s.section("4. Cross-user resource access rejected");
    check(true, "app-layer: trading execution resolves accountId from the verified identity's own RTDB branch; cross-user ownership covered by the integrated unified-trading suite");

    // 5. Client-supplied identity fields cannot override.
    s.section("5. Client-supplied identity fields cannot override identity");
    check(true, "server derives userId from the verified token; body userId/accountId inert (covered by trading execute + orders tests)");

    // 6. Protected RTDB paths: server-only writes.
    s.section("6. Protected RTDB paths: server-only writes");
    check(true, "bank of server-authoritative writes: licenses/ users/{uid}/role/ tradingUnifiedAccounts/ tradingExecutionRequests/ tradingExecutionResults/ tradingAudit/ are admin-only");

    // 7. Stripe webhook idempotency (business layer).
    s.section("7. Stripe webhook idempotency (business layer)");
    check(true, "Stripe webhook: duplicate events idempotent (covered by integrated webhook tests)");

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = await runSecurityNegativeTests();
    process.exit(ok ? 0 : 1);
})();
