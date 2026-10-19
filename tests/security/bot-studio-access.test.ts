/**
 * SECURITY NEGATIVE TEST — Bot Studio route authorization.
 *
 * Bot Studio route handlers read and write through the Firebase Admin SDK,
 * which BYPASSES Realtime Database security rules. These tests drive the
 * real route handlers against the in-memory firebase-admin stub
 * (`tests/security/firebase-admin-stub.ts`) and assert that:
 *
 *   1. A non-Pro, non-admin caller is rejected (401) — entitlement is
 *      re-derived server-side from the server-authored subscription record.
 *   2. An unauthenticated caller is rejected (401).
 *   3. A Pro user can only list THEIR OWN deployments — the listing route
 *      must not leak another user's deployments (owner, MT5 account, runtime
 *      state) to a peer Pro user.
 *   4. An admin can list every deployment.
 *   5. A Pro user cannot read, rename or delete another user's strategy
 *      (404, not 403 — the resource must not even be confirmed to exist).
 *
 * RTDB rule behaviour is covered separately by
 * `tests/security/rtdb-rules.emulator.mjs` (Firebase emulator).
 */

import { GET as listDeployments } from "@/app/api/bot-studio/deployments/route";
import {
    GET as getStrategy,
    PATCH as patchStrategy,
    DELETE as deleteStrategy,
} from "@/app/api/bot-studio/strategies/[strategyId]/route";
import { rtDbStore } from "./firebase-admin-stub";

function assert(condition: boolean, msg: string) {
    if (!condition) {
        throw new Error(`FAIL: ${msg}`);
    }
}

/** Sign a fake token for the given uid (the stub decodes the middle segment). */
function signToken(uid: string): string {
    const payload = JSON.stringify({ sub: uid, role: uid === "superAdmin" ? "admin" : "customer" });
    return "fake-token-" + uid + "." + btoa(payload) + ".sig";
}

/** Minimal NextRequest-shaped object (routes only read the auth header/body). */
function request(uid: string | null, body?: unknown) {
    return {
        headers: { get: (name: string) => (name === "authorization" && uid ? "Bearer " + signToken(uid) : null) },
        json: async () => body ?? {},
    } as unknown as Parameters<typeof listDeployments>[0];
}

function seedRtdb(): void {
    rtDbStore.clear();

    // Users. The stub resolves a path either exactly or as a subtree, and the
    // guards read `users/{uid}/role` and `users/{uid}/subscription` as exact
    // paths — so both are seeded the way the real database stores them.
    rtDbStore.set("users/proUser/role", "customer");
    rtDbStore.set("users/proUser/subscription", { plan: "pro", status: "active" });
    rtDbStore.set("users/otherProUser/role", "customer");
    rtDbStore.set("users/otherProUser/subscription", { plan: "pro", status: "active" });
    rtDbStore.set("users/freeUser/role", "customer");
    rtDbStore.set("users/superAdmin/role", "admin");

    // Strategies (private per author)
    rtDbStore.set("bot_strategies/STRAT_MINE", {
        id: "STRAT_MINE",
        authorId: "proUser",
        name: "Mine",
        state: "valid",
    });
    rtDbStore.set("bot_strategies/STRAT_THEIRS", {
        id: "STRAT_THEIRS",
        authorId: "otherProUser",
        name: "Theirs",
        state: "valid",
    });

    // Deployments (private per owner)
    rtDbStore.set("bot_deployments/BOT_MINE", {
        id: "BOT_MINE",
        ownerId: "proUser",
        strategyId: "STRAT_MINE",
        mt5Account: "acct-mine",
        runtimeState: "running",
    });
    rtDbStore.set("bot_deployments/BOT_THEIRS", {
        id: "BOT_THEIRS",
        ownerId: "otherProUser",
        strategyId: "STRAT_THEIRS",
        mt5Account: "acct-theirs",
        runtimeState: "running",
    });
}

export async function runBotStudioRouteAuthTests(): Promise<void> {
    console.log("Running Bot Studio route authorization tests...\n");
    seedRtdb();

    // ── 1. Entitlement gate ────────────────────────────────────────────────
    const freeRes = await listDeployments(request("freeUser"));
    assert(freeRes.status === 401, `non-Pro user must be rejected (got ${freeRes.status})`);

    const anonRes = await listDeployments(request(null));
    assert(anonRes.status === 401, `unauthenticated caller must be rejected (got ${anonRes.status})`);

    const garbage = {
        headers: { get: () => "Bearer garbage" },
        json: async () => ({}),
    } as unknown as Parameters<typeof listDeployments>[0];
    const garbageRes = await listDeployments(garbage);
    assert(garbageRes.status === 401, `unverifiable token must be rejected (got ${garbageRes.status})`);
    console.log("  ✓ Non-Pro / anonymous callers rejected with 401.");

    // ── 2. Deployment listing is owner-scoped ──────────────────────────────
    const mineRes = await listDeployments(request("proUser"));
    assert(mineRes.status === 200, `Pro user must be allowed (got ${mineRes.status})`);
    const mineBody = (await mineRes.json()) as { deployments: Array<{ id: string }> };
    const mineIds = mineBody.deployments.map((d) => d.id).sort();
    assert(
        mineIds.length === 1 && mineIds[0] === "BOT_MINE",
        `Pro user must only see own deployments (saw ${JSON.stringify(mineIds)})`,
    );

    const otherRes = await listDeployments(request("otherProUser"));
    const otherBody = (await otherRes.json()) as { deployments: Array<{ id: string }> };
    const otherIds = otherBody.deployments.map((d) => d.id).sort();
    assert(
        otherIds.length === 1 && otherIds[0] === "BOT_THEIRS",
        `peer Pro user must only see own deployments (saw ${JSON.stringify(otherIds)})`,
    );

    const adminRes = await listDeployments(request("superAdmin"));
    const adminBody = (await adminRes.json()) as { deployments: Array<{ id: string }> };
    const adminIds = adminBody.deployments.map((d) => d.id).sort();
    assert(
        adminIds.length === 2,
        `admin must see every deployment (saw ${JSON.stringify(adminIds)})`,
    );
    console.log("  ✓ Deployment listing is owner-scoped (admins see all).");

    // ── 3. Strategy access is owner-scoped ─────────────────────────────────
    const ownGet = await getStrategy(request("proUser"), { params: Promise.resolve({ strategyId: "STRAT_MINE" }) });
    assert(ownGet.status === 200, `owner must read own strategy (got ${ownGet.status})`);

    const foreignGet = await getStrategy(request("proUser"), { params: Promise.resolve({ strategyId: "STRAT_THEIRS" }) });
    assert(foreignGet.status === 404, `non-owner must not read another strategy (got ${foreignGet.status})`);

    const foreignPatch = await patchStrategy(
        request("proUser", { name: "Hijacked" }),
        { params: Promise.resolve({ strategyId: "STRAT_THEIRS" }) }
    );
    assert(foreignPatch.status === 404, `non-owner must not rename another strategy (got ${foreignPatch.status})`);
    const stored = rtDbStore.get("bot_strategies/STRAT_THEIRS") as { name: string };
    assert(stored.name === "Theirs", "non-owner rename must not mutate the stored strategy");

    const foreignDelete = await deleteStrategy(
        request("proUser"),
        { params: Promise.resolve({ strategyId: "STRAT_THEIRS" }) }
    );
    assert(foreignDelete.status === 404, `non-owner must not delete another strategy (got ${foreignDelete.status})`);
    assert(
        rtDbStore.get("bot_strategies/STRAT_THEIRS") !== undefined,
        "non-owner delete must not remove the stored strategy",
    );
    console.log("  ✓ Strategy read / rename / delete are owner-scoped.");

    console.log("\nAll Bot Studio route authorization tests passed.\n");
}

await runBotStudioRouteAuthTests();
