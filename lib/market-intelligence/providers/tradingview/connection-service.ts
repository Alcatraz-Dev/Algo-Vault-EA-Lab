/**
 * TradingView MCP connection service (PHASE 3/15).
 *
 * Orchestrates the OAuth 2.1 browser authorization flow end-to-end for an
 * authenticated AlgoVault user:
 *   connect      → build authorization URL (PKCE + single-use state)
 *   complete     → verify state, exchange code, encrypt + store tokens
 *   disconnect   → best-effort provider revocation + encrypted record wipe
 *   status       → connection state for UIs (never exposes tokens)
 */
import {
    consumeOAuthState,
    exchangeAuthorizationCode,
    getRedirectUri,
    resolveOAuthConfig,
    revokeToken,
    TradingViewMcpNotConfiguredError,
} from "./oauth";
import {
    disconnectConnection,
    getConnectionRecord,
    loadTokenBundle,
    saveTokenBundle,
    updateConnectionState,
} from "./connection-store";
import { getTradingViewFlags } from "./feature-flags";
import { clearCacheForUser } from "./cache";
import type { ProviderConnectionStatus } from "../interfaces/external-intelligence-provider";

export class TradingViewConnectionError extends Error {
    readonly status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.name = "TradingViewConnectionError";
        this.status = status;
    }
}

export interface BeginConnectionResult {
    authorizationUrl: string;
    expiresInSeconds: number;
}

/** Step 1: create state + PKCE and return the authorization URL to redirect to. */
export async function beginTradingViewConnection(uid: string): Promise<BeginConnectionResult> {
    const flags = getTradingViewFlags();
    if (!flags.master) {
        throw new TradingViewConnectionError("TradingView MCP integration is disabled.", 403);
    }
    let config;
    try {
        config = await resolveOAuthConfig();
    } catch (err) {
        if (err instanceof TradingViewMcpNotConfiguredError) {
            throw new TradingViewConnectionError(err.message, 503);
        }
        throw err;
    }

    const { createOAuthState } = await import("./oauth");
    const { state } = await createOAuthState(uid);
    const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: getRedirectUri(),
        state,
        scope: config.scopes.join(" "),
    });
    // PKCE: challenge must match the verifier stored inside the state record.
    const { createPkcePair } = await import("./oauth");
    void createPkcePair; // verifier was already generated inside createOAuthState
    // Recompute the challenge from the stored verifier at callback time is not
    // possible (server does not keep it after state creation) — instead the
    // authorization request includes the challenge derived from the SAME
    // verifier that createOAuthState persisted, exposed here via state lookup.
    const stateRef = await import("./oauth");
    const record = await (stateRef as unknown as { __peekState?: never }).__peekState ?? null;
    void record;

    // The challenge is derived from the verifier inside createOAuthState; to
    // keep a single source of truth we re-derive it from the state record.
    const { adminDatabase } = await import("@/lib/firebase-admin");
    const snap = await adminDatabase.ref(`tradingviewMcp/oauthStates/${state}`).get();
    const stored = snap.val() as { verifier?: string } | undefined;
    if (!stored?.verifier) {
        throw new TradingViewConnectionError("Failed to persist OAuth state.", 500);
    }
    const { createHash } = await import("crypto");
    const challenge = createHash("sha256").update(stored.verifier).digest("base64url");
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");

    const url = `${config.authorizationEndpoint}?${params.toString()}`;
    return { authorizationUrl: url, expiresInSeconds: 600 };
}

export interface CompleteConnectionArgs {
    code: string;
    state: string;
}

/** Step 2: verify state, exchange the code, persist encrypted tokens. */
export async function completeTradingViewConnection(args: CompleteConnectionArgs): Promise<{ uid: string }> {
    const flags = getTradingViewFlags();
    if (!flags.master) {
        throw new TradingViewConnectionError("TradingView MCP integration is disabled.", 403);
    }
    const consumed = await consumeOAuthState(args.state);
    if (!consumed) {
        throw new TradingViewConnectionError("Invalid or expired OAuth state. Please restart the connection.", 400);
    }
    const config = await resolveOAuthConfig();
    try {
        const tokenResponse = await exchangeAuthorizationCode({
            code: args.code,
            verifier: consumed.verifier,
            config,
        });
        const expiresAt = Date.now() + (tokenResponse.expires_in ?? 3600) * 1000;
        await saveTokenBundle(consumed.uid, {
            accessToken: tokenResponse.access_token,
            ...(tokenResponse.refresh_token ? { refreshToken: tokenResponse.refresh_token } : {}),
            expiresAt,
            scope: tokenResponse.scope ? tokenResponse.scope.split(/[\s,]+/).filter(Boolean) : ["read"],
            issuedAt: Date.now(),
        });
        clearCacheForUser(consumed.uid);
        return { uid: consumed.uid };
    } catch (err) {
        // Persist a reauth-required state so the UI shows the right action.
        await updateConnectionState(consumed.uid, {
            state: "ERROR",
            lastError: err instanceof Error ? err.message : "TradingView authorization failed.",
        });
        throw new TradingViewConnectionError(
            err instanceof Error ? err.message : "TradingView authorization failed.",
            502,
        );
    }
}

/** Disconnect: revoke at provider (best-effort) then wipe the local record. */
export async function disconnectTradingView(uid: string): Promise<{ revoked: boolean }> {
    const config = await resolveOAuthConfig().catch(() => null);
    let revoked = false;
    if (config) {
        const bundle = await loadTokenBundle(uid).catch(() => null);
        if (bundle?.accessToken) {
            revoked = await revokeToken({ token: bundle.accessToken, config });
        }
    }
    await disconnectConnection(uid);
    clearCacheForUser(uid);
    return { revoked };
}

/** UI-facing status (no secrets). */
export async function getTradingViewStatusForUser(uid: string): Promise<ProviderConnectionStatus> {
    const flags = getTradingViewFlags();
    if (!flags.master) {
        return {
            provider: "tradingview-mcp",
            state: "DISABLED",
            enabled: false,
            authorized: false,
            scopes: [],
            message: "TradingView MCP integration is disabled.",
            lastCheckedAt: Date.now(),
        };
    }
    const record = await getConnectionRecord(uid);
    if (!record || !record.tokenEnvelope) {
        return {
            provider: "tradingview-mcp",
            state: "DISCONNECTED",
            enabled: true,
            authorized: false,
            scopes: [],
            message: "TradingView is not connected.",
            lastCheckedAt: Date.now(),
        };
    }
    if (record.state === "REAUTH_REQUIRED" || record.state === "ERROR") {
        return {
            provider: "tradingview-mcp",
            state: record.state,
            enabled: true,
            authorized: false,
            scopes: record.scope ?? [],
            message: record.lastError ?? "Reconnection required.",
            lastCheckedAt: Date.now(),
        };
    }
    const expired = typeof record.tokenExpiresAt === "number" && record.tokenExpiresAt <= Date.now() + 5_000;
    if (expired) {
        return {
            provider: "tradingview-mcp",
            state: "TOKEN_EXPIRED",
            enabled: true,
            authorized: true,
            scopes: record.scope ?? [],
            message: "The TradingView authorization has expired. Please reconnect.",
            lastCheckedAt: Date.now(),
        };
    }
    return {
        provider: "tradingview-mcp",
        state: "CONNECTED",
        enabled: true,
        authorized: true,
        scopes: record.scope ?? [],
        message: "Connected to TradingView MCP.",
        lastCheckedAt: Date.now(),
    };
}
