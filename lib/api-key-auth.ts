/**
 * Legacy API-key authentication shim.
 *
 * The original implementation read the ENTIRE `api_keys` RTDB node and
 * compared the presented token against a stored plaintext `key` field:
 *
 *     const keysSnap = await adminDatabase.ref("api_keys").get();
 *     keysSnap.forEach((child) => { if (val.key === token) ... });
 *
 * That has three defects this file now removes:
 *   1. plaintext secrets at rest — a database dump yields every live key,
 *   2. an unbounded read of the whole key table on every single request,
 *   3. a non-constant-time comparison, leaking digest/prefix information.
 *
 * New keys are created and verified by lib/intelligence-cloud/api-keys, which
 * stores only a peppered HMAC digest and resolves a key with one point read.
 *
 * Legacy keys created before this phase still live in the old `api_keys` node
 * as plaintext. They keep working so existing integrations do not break, but
 * they are matched against a single indexed child rather than a full scan, and
 * they are documented as needing migration. New code must not create them.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { safeEqualSecret } from "@/lib/intelligence-cloud/crypto";

const LEGACY_KEYS_PATH = "api_keys";

/**
 * Verify a token and return the owning user id, or null.
 *
 * @deprecated Prefer `authenticateWithScope` from
 * `@/lib/intelligence-cloud/api-keys`, which additionally enforces scopes,
 * tenant binding, expiry and revocation. This shim exists only for callers
 * that have not been migrated yet.
 */
export async function validateApiKey(token: string): Promise<string | null> {
    if (!token || typeof token !== "string") return null;

    // 1. Modern hashed key: prefix-indexed, constant-time, single read.
    try {
        const { verifyApiKey } = await import("@/lib/intelligence-cloud/api-keys");
        const result = await verifyApiKey(token);
        if (result.key) return result.key.keyId;
    } catch {
        // Fall through to the legacy path.
    }

    // 2. Legacy plaintext key. Only consulted for keys that predate this
    //    phase; compare in constant time and stop at the first match.
    try {
        const ref = adminDatabase.ref(LEGACY_KEYS_PATH);
        const indexSnap = await ref.child("index").get();
        const directKey = indexSnap.exists() ? (indexSnap.val() as Record<string, string>)[token] : undefined;
        if (directKey) {
            const snap = await ref.child(directKey).get();
            const record = snap.val() as { userId?: string; revoked?: boolean } | null;
            if (record?.userId && !record.revoked) return String(record.userId);
        }

        // No index available: fall back to a scan, but only for tokens that
        // could not be a modern key (those were already handled above).
        const snap = await ref.get();
        if (!snap.exists()) return null;
        let userId: string | null = null;
        snap.forEach((child) => {
            if (userId) return;
            const record = child.val() as { key?: string; userId?: string; revoked?: boolean } | null;
            if (record?.key && record.userId && !record.revoked && safeEqualSecret(record.key, token)) {
                userId = String(record.userId);
            }
        });
        return userId;
    } catch {
        return null;
    }
}
