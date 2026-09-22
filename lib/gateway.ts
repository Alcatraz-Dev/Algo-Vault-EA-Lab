import crypto from "crypto";
import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Per-user gateway tokens for the AlgoVaultTradeGateway EA.
 *
 * The EA sends `gatewayToken` as a Bearer token on every request. Each token is
 * a unique secret minted per user and stored under `gateway_users/{token}`
 * (server-write only), with a reverse index at `gateway_tokens_meta/{userId}`.
 *
 * This replaces the earlier design where every EA used the same global
 * `GATEWAY_SECRET` value. Existing tokens stored in `gateway_users/` keep
 * working; the env-based check is no longer required.
 */

export type GatewayUser = { userId: string; userEmail?: string };

const TOKEN_BYTES = 24; // 48 base64url chars

/**
 * Resolves the gateway token from the `Authorization: Bearer <token>` header
 * first (this is how the AlgoVaultTradeGateway EA authenticates every request),
 * then falls back to `gatewayToken` in the body/query for backwards
 * compatibility with older clients.
 */
export function resolveGatewayToken(
    authorizationHeader: string | null,
    bodyOrQuery?: Record<string, unknown>
): string {
    if (authorizationHeader && typeof authorizationHeader === "string") {
        const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
        if (match) return match[1].trim();
    }
    if (bodyOrQuery && typeof bodyOrQuery.gatewayToken === "string") {
        return bodyOrQuery.gatewayToken.trim();
    }
    return "";
}

export async function verifyGatewayToken(gatewayToken: string): Promise<GatewayUser | null> {
    const token = String(gatewayToken || "").trim();
    if (!token) return null;

    const snap = await adminDatabase.ref(`gateway_users/${token}`).get();
    if (!snap.exists()) return null;

    const val = snap.val();
    if (!val || typeof val !== "object" || !(val as { userId?: unknown }).userId) return null;

    const mapped = val as { userId: unknown; userEmail?: unknown };
    return {
        userId: String(mapped.userId),
        userEmail: mapped.userEmail ? String(mapped.userEmail) : undefined,
    };
}

export async function getGatewayTokenForUser(userId: string): Promise<string | null> {
    const metaSnap = await adminDatabase.ref(`gateway_tokens_meta/${userId}`).get();
    if (!metaSnap.exists()) return null;

    const meta = metaSnap.val() as { token?: unknown };
    if (!meta || typeof meta !== "object" || !meta.token) return null;

    const token = String(meta.token);

    // Ensure the mapping still exists; clean up stale meta if it went missing.
    const mapSnap = await adminDatabase.ref(`gateway_users/${token}`).get();
    if (!mapSnap.exists()) {
        await adminDatabase.ref(`gateway_tokens_meta/${userId}`).remove();
        return null;
    }

    return token;
}

export async function mintGatewayToken(
    userId: string,
    userEmail?: string
): Promise<{ token: string; reused: boolean }> {
    const existing = await getGatewayTokenForUser(userId);
    if (existing) return { token: existing, reused: true };

    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const now = Date.now();

    await adminDatabase.ref(`gateway_users/${token}`).set({
        userId,
        userEmail: userEmail ?? null,
        createdAt: now,
    });

    await adminDatabase.ref(`gateway_tokens_meta/${userId}`).set({
        token,
        createdAt: now,
    });

    return { token, reused: false };
}

export async function revokeGatewayToken(userId: string): Promise<boolean> {
    const token = await getGatewayTokenForUser(userId);
    if (!token) return false;

    await adminDatabase.ref(`gateway_users/${token}`).remove();
    await adminDatabase.ref(`gateway_tokens_meta/${userId}`).remove();
    return true;
}

export async function hasActiveTradingLicense(userId: string): Promise<boolean> {
    const snapshot = await adminDatabase.ref(`trading_access/${userId}`).get();
    const data = snapshot.val() || {};
    const now = Date.now();

    for (const raw of Object.values(data)) {
        if (!raw || typeof raw !== "object") continue;
        const license = raw as Record<string, unknown>;
        if (license.status === "active" && Number(license.expiresAt || 0) > now) {
            return true;
        }
    }

    return false;
}

/**
 * Generates a CLIENT order ID used to bridge pending orders to the MQL5
 * gateway (DB keys under mt5_orders/, live_positions/, trading_order_requests/).
 *
 * This is deliberately NOT an MT5 broker ticket: the real ticket number is
 * minted by the AlgoVaultTradeGateway EA when the order fills and arrives back
 * through gateway state updates. Fabricating 8-digit "tickets" here would fake
 * execution state, which is forbidden. The prefix keeps provenance clear and
 * the timestamp + random suffix keeps keys collision-safe in RTDB paths.
 */
export function newClientOrderId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2, 10).toLowerCase();
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}