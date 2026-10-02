/**
 * Connection store for TradingView MCP authorizations (PHASE 3).
 *
 * Persists per-user OAuth token bundles ENCRYPTED (AES-256-GCM, AAD-bound to
 * the user) in Firebase RTDB — the only database in AlgoVault. No Firestore.
 * Tokens never leave the server; API responses contain state only.
 */
import { adminDatabase } from "@/lib/firebase-admin";
import {
    decryptTokenPayload,
    encryptTokenPayload,
    isTokenEncryptionConfigured,
} from "./token-crypto";

export interface OAuthTokenBundle {
    accessToken: string;
    /** Undefined when the provider issued a non-expiring token. */
    refreshToken?: string;
    /** ms epoch when accessToken expires. */
    expiresAt: number;
    /** Granted scopes. */
    scope: string[];
    /** ms epoch created. */
    issuedAt: number;
    /** Resource indicator bound during authorization (RFC 8707), if used. */
    resource?: string;
}

export interface ConnectionRecord {
    state: "CONNECTED" | "TOKEN_EXPIRED" | "REAUTH_REQUIRED" | "ERROR" | "DISCONNECTED";
    /** Encrypted envelope — never returned to clients. */
    tokenEnvelope?: string;
    /** Non-secret metadata: scopes + expiry only. */
    scope: string[];
    tokenExpiresAt?: number | null;
    connectedAt?: number | null;
    lastRefreshAt?: number | null;
    lastError?: string | null;
    updatedAt: number;
}

const CONNECTIONS_PATH = (uid: string) => `tradingviewMcp/connections/${uid}`;

/** Strip Firebase-invalid `undefined` values (RTDB rejects them). */
function clean<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => clean(v)) as unknown as T;
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v !== undefined) out[k] = clean(v);
        }
        return out as T;
    }
    return value;
}

export async function saveConnection(uid: string, record: ConnectionRecord): Promise<void> {
    await adminDatabase.ref(CONNECTIONS_PATH(uid)).set(clean(record));
}

export async function getConnectionRecord(uid: string): Promise<ConnectionRecord | null> {
    const snap = await adminDatabase.ref(CONNECTIONS_PATH(uid)).get();
    if (!snap.exists()) return null;
    return snap.val() as ConnectionRecord;
}

export async function saveTokenBundle(uid: string, bundle: OAuthTokenBundle): Promise<void> {
    const envelope = encryptTokenPayload(uid, bundle);
    const record: ConnectionRecord = {
        state: "CONNECTED",
        tokenEnvelope: envelope.ciphertext,
        scope: bundle.scope,
        tokenExpiresAt: bundle.expiresAt,
        connectedAt: Date.now(),
        lastRefreshAt: Date.now(),
        lastError: null,
        updatedAt: Date.now(),
    };
    await saveConnection(uid, record);
}

export async function loadTokenBundle(uid: string): Promise<OAuthTokenBundle | null> {
    const record = await getConnectionRecord(uid);
    if (!record?.tokenEnvelope) return null;
    if (!isTokenEncryptionConfigured()) {
        // Fail closed: refuse to operate on tokens when encryption is unavailable.
        return null;
    }
    try {
        return decryptTokenPayload<OAuthTokenBundle>(uid, record.tokenEnvelope);
    } catch {
        // Wrong key or tampered envelope → treat as lost authorization.
        await markConnectionError(uid, "Stored TradingView credentials could not be decrypted (key changed?). Reconnect required.");
        return null;
    }
}

export async function updateConnectionState(
    uid: string,
    patch: Partial<Pick<ConnectionRecord, "state" | "lastError" | "tokenExpiresAt" | "lastRefreshAt" | "tokenEnvelope" | "scope">>,
): Promise<void> {
    const record = await getConnectionRecord(uid);
    if (!record) return;
    const next: ConnectionRecord = { ...record, ...patch, updatedAt: Date.now() };
    await saveConnection(uid, next);
}

export async function markConnectionError(uid: string, message: string): Promise<void> {
    await updateConnectionState(uid, { state: "ERROR", lastError: message });
}

export async function markReauthRequired(uid: string, message: string): Promise<void> {
    await updateConnectionState(uid, { state: "REAUTH_REQUIRED", lastError: message });
}

export async function markTokenExpired(uid: string): Promise<void> {
    await updateConnectionState(uid, { state: "TOKEN_EXPIRED" });
}

export async function markConnected(uid: string): Promise<void> {
    await updateConnectionState(uid, { state: "CONNECTED", lastError: null });
}

/**
 * Disconnect: remove the token material entirely and keep a tombstone so the
 * UI can show "Not connected" without stale state.
 */
export async function disconnectConnection(uid: string): Promise<void> {
    await adminDatabase.ref(CONNECTIONS_PATH(uid)).set({
        state: "DISCONNECTED",
        scope: [],
        tokenExpiresAt: null,
        connectedAt: null,
        lastRefreshAt: null,
        lastError: null,
        updatedAt: Date.now(),
    } satisfies ConnectionRecord);
}

/** True when the stored bundle has an encrypted envelope (i.e. was authorized). */
export async function hasStoredAuthorization(uid: string): Promise<boolean> {
    const record = await getConnectionRecord(uid);
    return Boolean(record?.tokenEnvelope);
}
