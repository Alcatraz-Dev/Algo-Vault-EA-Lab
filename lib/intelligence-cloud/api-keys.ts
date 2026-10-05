/**
 * Intelligence Cloud — API Key lifecycle (Phase 13)
 *
 * Security properties enforced here:
 *
 *  1. The secret is returned exactly once, at creation, and is never persisted.
 *     Only a peppered HMAC-SHA256 digest is stored.
 *  2. Keys are indexed by a public lookup prefix, so verification is one RTDB
 *     point read. The previous implementation read the entire `api_keys` node
 *     and compared plaintext — both a data-exposure and an enumeration hazard.
 *  3. Verification is a constant-time digest comparison.
 *  4. Revocation and expiry are checked server-side on every request; a client
 *     cannot assert its own key state.
 *  5. A key is always bound to exactly one tenant. Tenant is never taken from
 *     the request.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import {
    DEFAULT_KEY_SCOPES,
    hasScope,
    sanitiseScopes,
    type ApiScope,
} from "./auth";
import { generateApiKey, hashApiKey, parseApiKeyPrefix, safeEqualDigest } from "./crypto";
import { errors, IntelligenceError } from "./errors";
import { sanitizeSegment, type Tenant } from "./tenancy";

/** RTDB root for Intelligence Cloud server-owned data. */
export const CLOUD_ROOT = "intelligenceCloud";
export const API_KEYS_PATH = `${CLOUD_ROOT}/apiKeys`;

export type ApiKeyStatus = "active" | "revoked";

export interface ApiKeyRecord {
    keyId: string;
    /** Public lookup prefix (the middle segment of the secret). */
    lookupPrefix: string;
    /** Peppered HMAC digest of the full secret. Never the secret itself. */
    hashedSecret: string;
    /** Owning tenant. Immutable — a key cannot be moved between tenants. */
    tenantId: string;
    /** Firebase uid of the human who created it (audit only, not authorisation). */
    createdBy: string;
    /** Human label, e.g. "CI production". */
    name?: string;
    scopes: ApiScope[];
    status: ApiKeyStatus;
    createdAt: number;
    lastUsedAt?: number;
    expiresAt?: number;
    revokedAt?: number;
    revokedBy?: string;
    /** Rolling counters maintained by the usage layer. */
    usage?: { requests: number; billableUnits: number; lastResetAt: number };
}

/** Server-side rate-limit override for this key. Absent ⇒ plan default applies. */
export interface ApiKeyRateLimit {
    requestsPerMinute?: number;
    requestsPerDay?: number;
}

export interface CreateApiKeyInput {
    tenantId: string;
    createdBy: string;
    name?: string;
    scopes?: readonly string[];
    expiresAt?: number;
    rateLimit?: ApiKeyRateLimit;
}

export interface CreatedApiKey {
    /** The only time the caller ever sees this. */
    secret: string;
    record: Omit<ApiKeyRecord, "hashedSecret">;
}

export interface VerifiedApiKey {
    keyId: string;
    tenantId: string;
    scopes: ApiScope[];
    keyName?: string;
    rateLimit?: ApiKeyRateLimit;
}

/**
 * Create a key. Returns the plaintext secret once.
 *
 * Refuses scopes that are not grantable, so a crafted body cannot mint an
 * execution-capable key through this endpoint.
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    if (!input.tenantId) throw errors.invalidRequest("tenantId is required.");

    const scopes = input.scopes === undefined ? [...DEFAULT_KEY_SCOPES] : sanitiseScopes(input.scopes);
    if (scopes.length === 0) {
        throw errors.invalidRequest("At least one grantable scope is required.", [
            { field: "scopes", issue: "empty after filtering ungrantable scopes" },
        ]);
    }
    if (input.expiresAt !== undefined && input.expiresAt <= Date.now()) {
        throw errors.invalidRequest("expiresAt must be in the future.", [
            { field: "expiresAt", issue: "not in the future" },
        ]);
    }

    const { secret, lookupPrefix } = generateApiKey();
    const now = Date.now();

    const record: ApiKeyRecord = {
        keyId: `key_${lookupPrefix}`,
        lookupPrefix,
        hashedSecret: hashApiKey(secret),
        tenantId: sanitizeSegment(input.tenantId),
        createdBy: input.createdBy,
        name: input.name,
        scopes,
        status: "active",
        createdAt: now,
        expiresAt: input.expiresAt,
        usage: { requests: 0, billableUnits: 0, lastResetAt: now },
    };

    // `rateLimit` and `hashedSecret` live alongside; never expose in listings.
    await adminDatabase.ref(`${API_KEYS_PATH}/${lookupPrefix}`).set({
        ...record,
        ...(input.rateLimit ? { rateLimit: input.rateLimit } : {}),
    });

    const { hashedSecret: _secret, ...safe } = record;
    return { secret, record: safe };
}

function isExpired(record: ApiKeyRecord, now: number): boolean {
    return typeof record.expiresAt === "number" && record.expiresAt <= now;
}

/**
 * Verify a presented bearer token.
 *
 * Returns the verified key, or null for *any* failure (unknown prefix,
 * digest mismatch, revoked, expired, malformed). Callers must not distinguish
 * those cases in the response, or key validity becomes an enumeration oracle.
 * `failClosedReason` exists only for server-side logging and tests.
 */
export async function verifyApiKey(
    presented: string
): Promise<{ key: VerifiedApiKey } | { key: null; failClosedReason: string }> {
    const parsed = parseApiKeyPrefix(presented);
    if (!parsed) return { key: null, failClosedReason: "malformed" };

    const snap = await adminDatabase.ref(`${API_KEYS_PATH}/${parsed.lookupPrefix}`).get();
    if (!snap.exists()) return { key: null, failClosedReason: "unknown_key" };

    const record = snap.val() as ApiKeyRecord;
    if (typeof record?.hashedSecret !== "string") {
        return { key: null, failClosedReason: "corrupt_record" };
    }
    if (!safeEqualDigest(hashApiKey(presented), record.hashedSecret)) {
        return { key: null, failClosedReason: "digest_mismatch" };
    }

    const now = Date.now();
    if (record.status === "revoked") return { key: null, failClosedReason: "revoked" };
    if (isExpired(record, now)) return { key: null, failClosedReason: "expired" };

    // Fire-and-forget last-used touch: never fail auth on telemetry.
    void adminDatabase
        .ref(`${API_KEYS_PATH}/${parsed.lookupPrefix}/lastUsedAt`)
        .set(now)
        .catch(() => undefined);

    return {
        key: {
            keyId: record.keyId,
            tenantId: record.tenantId,
            scopes: Array.isArray(record.scopes) ? record.scopes : [],
            keyName: record.name,
            rateLimit: (snap.val() as { rateLimit?: ApiKeyRateLimit }).rateLimit,
        },
    };
}

/**
 * Verify and then assert a scope. Raises the contract error that names the
 * missing scope so a developer can fix their key without guessing.
 */
export async function authenticateWithScope(
    presented: string,
    required: ApiScope
): Promise<VerifiedApiKey> {
    const result = await verifyApiKey(presented);
    if (!result.key) throw errors.unauthorized("The API key is missing, invalid, revoked or expired.");
    if (!hasScope(result.key.scopes, required)) throw errors.scopeInsufficient(required);
    return result.key;
}

export async function revokeApiKey(
    tenantId: string,
    lookupPrefix: string,
    revokedBy: string
): Promise<void> {
    const prefix = sanitizeSegment(lookupPrefix);
    const ref = adminDatabase.ref(`${API_KEYS_PATH}/${prefix}`);
    const snap = await ref.get();
    if (!snap.exists()) throw errors.notFound("API key not found.");

    const record = snap.val() as ApiKeyRecord;
    // Tenant isolation: a key is only revocable by its own tenant.
    if (record.tenantId !== sanitizeSegment(tenantId)) {
        throw errors.forbidden("This API key belongs to another tenant.");
    }
    if (record.status === "revoked") return;

    await ref.update({
        status: "revoked",
        revokedAt: Date.now(),
        revokedBy,
    });
}

/** Keys for a tenant, with digests stripped. Safe to return from a portal. */
export async function listApiKeys(tenantId: string): Promise<
    Array<Omit<ApiKeyRecord, "hashedSecret" | "lookupPrefix">>
> {
    const snap = await adminDatabase.ref(`${API_KEYS_PATH}`).orderByChild("tenantId").equalTo(
        sanitizeSegment(tenantId)
    ).get();
    const out: Array<Omit<ApiKeyRecord, "hashedSecret" | "lookupPrefix">> = [];
    snap.forEach((child) => {
        const record = child.val() as ApiKeyRecord;
        const { hashedSecret: _h, lookupPrefix: _p, ...safe } = record;
        out.push(safe);
    });
    return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Guard used by routes that accept a key id from the client. */
export function assertApiKeyOwnedBy(keyTenantId: string, tenantId: string): void {
    if (sanitizeSegment(keyTenantId) !== sanitizeSegment(tenantId)) {
        throw new IntelligenceError("FORBIDDEN", "The resource belongs to another tenant.");
    }
}

export type { Tenant };
