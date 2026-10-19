/**
 * AlgoVault Bot Studio — Ownership Boundary Unit Tests
 *
 * Bot Studio route handlers read and write through the Firebase Admin SDK,
 * which BYPASSES Realtime Database security rules. Ownership is therefore
 * enforced in the route layer, and these helpers are the single decision
 * point used by every strategy / deployment route.
 *
 * Covered:
 *   1. Strategy ownership (owner, non-owner, admin, missing record)
 *   2. Deployment ownership (owner, non-owner, admin, missing record)
 *   3. Fail-closed behaviour for malformed records
 */

import { canAccessStrategy, canAccessDeployment } from "../auth";
import type { BotStudioAccess } from "../auth";

function assert(condition: boolean, msg: string) {
    if (!condition) {
        throw new Error(`FAIL: ${msg}`);
    }
}

export function runBotStudioAccessTests(): void {
    console.log("Running Bot Studio Ownership Boundary Tests...\n");

    const owner: BotStudioAccess = { uid: "owner-uid", isAdmin: false };
    const other: BotStudioAccess = { uid: "other-uid", isAdmin: false };
    const admin: BotStudioAccess = { uid: "admin-uid", isAdmin: true };

    // ── 1. Strategy ownership ──
    console.log("• Testing strategy ownership...");
    assert(
        canAccessStrategy(owner, { authorId: "owner-uid" }),
        "owner must access own strategy",
    );
    assert(
        !canAccessStrategy(other, { authorId: "owner-uid" }),
        "non-owner must NOT access another user's strategy",
    );
    assert(
        canAccessStrategy(admin, { authorId: "owner-uid" }),
        "admin must access any strategy",
    );
    assert(
        !canAccessStrategy(owner, { authorId: "other-uid" }),
        "owner must NOT access a strategy they do not own",
    );
    assert(
        !canAccessStrategy(owner, null) && !canAccessStrategy(owner, undefined),
        "missing strategy must fail closed",
    );
    assert(
        !canAccessStrategy(owner, {}),
        "strategy without authorId must fail closed",
    );
    console.log("  ✓ Strategy ownership boundaries enforced.");

    // ── 2. Deployment ownership ──
    console.log("• Testing deployment ownership...");
    assert(
        canAccessDeployment(owner, { ownerId: "owner-uid" }),
        "owner must access own deployment",
    );
    assert(
        !canAccessDeployment(other, { ownerId: "owner-uid" }),
        "non-owner must NOT access another user's deployment",
    );
    assert(
        canAccessDeployment(admin, { ownerId: "owner-uid" }),
        "admin must access any deployment",
    );
    assert(
        !canAccessDeployment(owner, { ownerId: "other-uid" }),
        "owner must NOT access a deployment they do not own",
    );
    assert(
        !canAccessDeployment(owner, null) && !canAccessDeployment(owner, undefined),
        "missing deployment must fail closed",
    );
    assert(
        !canAccessDeployment(owner, {}),
        "deployment without ownerId must fail closed",
    );
    console.log("  ✓ Deployment ownership boundaries enforced.");

    console.log("\n========================================");
    console.log("  ALL BOT STUDIO ACCESS TESTS PASSED   ");
    console.log("========================================\n");
}

runBotStudioAccessTests();
