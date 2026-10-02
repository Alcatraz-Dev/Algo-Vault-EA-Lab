/**
 * OAuth 2.1 (draft) flow for the TradingView MCP server (PHASE 3).
 *
 * Implements the browser authorization step correctly: PKCE (S256) +
 * server-side state (RTDB, single-use, 10-minute TTL) + authorization-code
 * exchange + refresh + revocation. The TradingView MCP endpoint exposes
 * OAuth metadata at /.well-known/oauth-authorization-server so server config
 * (authorization/token endpoints, client id) is discovered, with
 * TRADINGVIEW_MCP_CLIENT_* env fallbacks. All secret handling is server-side.
 */
import crypto from "crypto";
import { adminDatabase } from "@/lib/firebase-admin";

export const TRADINGVIEW_MCP_URL = "https://mcp.tradingview.com/mcp";

export interface OAuthServerMetadata {
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    revocationEndpoint?: string;
    registrationEndpoint?: string;
    scopesSupported?: string[];
    codeChallengeMethodsSupported?: string[];
}

interface CachedMetadata {
    value: OAuthServerMetadata | null;
    at: number;
    failed: boolean;
}

let metadataCache: CachedMetadata | null = null;
const METADATA_TTL_MS = 60 * 60 * 1000;

export class TradingViewMcpNotConfiguredError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "TradingViewMcpNotConfiguredError";
    }
}

/** Default scopes are read-only (PHASE 14: default to read-only). */
export const DEFAULT_SCOPES = ["read"];

/** Env-provided static client registration (fallback when discovery is unavailable). */
function staticClientId(): string {
    return (process.env.TRADINGVIEW_MCP_CLIENT_ID || "").trim();
}
function staticClientSecret(): string {
    return (process.env.TRADINGVIEW_MCP_CLIENT_SECRET || "").trim();
}
function staticAuthEndpoint(): string {
    return (process.env.TRADINGVIEW_MCP_AUTHORIZATION_ENDPOINT || "").trim();
}
function staticTokenEndpoint(): string {
    return (process.env.TRADINGVIEW_MCP_TOKEN_ENDPOINT || "").trim();
}
function staticRevocationEndpoint(): string {
    return (process.env.TRADINGVIEW_MCP_REVOCATION_ENDPOINT || "").trim();
}

export function getRedirectUri(): string {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
    return `${appUrl}/api/integrations/tradingview/callback`;
}

/** Fetch (and cache) RFC 8414 server metadata; null when unavailable. */
export async function fetchServerMetadata(force = false): Promise<OAuthServerMetadata | null> {
    const now = Date.now();
    if (!force && metadataCache && now - metadataCache.at < METADATA_TTL_MS) {
        return metadataCache.value;
    }
    try {
        const base = new URL(TRADINGVIEW_MCP_URL);
        const wellKnown = `${base.origin}/.well-known/oauth-authorization-server${base.pathname}`;
        const res = await fetch(wellKnown, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
        if (!res.ok) throw new Error(`metadata ${res.status}`);
        const data = (await res.json()) as Record<string, unknown>;
        const value: OAuthServerMetadata = {
            authorizationEndpoint: typeof data.authorization_endpoint === "string" ? data.authorization_endpoint : undefined,
            tokenEndpoint: typeof data.token_endpoint === "string" ? data.token_endpoint : undefined,
            revocationEndpoint: typeof data.revocation_endpoint === "string" ? data.revocation_endpoint : undefined,
            registrationEndpoint: typeof data.registration_endpoint === "string" ? data.registration_endpoint : undefined,
            scopesSupported: Array.isArray(data.scopes_supported) ? (data.scopes_supported as string[]) : undefined,
            codeChallengeMethodsSupported: Array.isArray(data.code_challenge_methods_supported)
                ? (data.code_challenge_methods_supported as string[])
                : undefined,
        };
        metadataCache = { value, at: now, failed: false };
        return value;
    } catch {
        metadataCache = { value: null, at: now, failed: true };
        return null;
    }
}

export interface ResolvedOAuthConfig {
    clientId: string;
    clientSecret: string | null;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint: string | null;
    scopes: string[];
}

/**
 * Resolve the OAuth endpoints/client. Throws TradingViewMcpNotConfiguredError
 * when neither discovery nor env provides a workable configuration.
 */
export async function resolveOAuthConfig(): Promise<ResolvedOAuthConfig> {
    const metadata = await fetchServerMetadata();
    const clientId = staticClientId();
    const authEndpoint = staticAuthEndpoint() || metadata?.authorizationEndpoint || "";
    const tokenEndpoint = staticTokenEndpoint() || metadata?.tokenEndpoint || "";

    if (!clientId || !authEndpoint || !tokenEndpoint) {
        throw new TradingViewMcpNotConfiguredError(
            "TradingView MCP OAuth is not configured. Set TRADINGVIEW_MCP_CLIENT_ID (and optionally TRADINGVIEW_MCP_CLIENT_SECRET / endpoint overrides) so the authorization flow can run.",
        );
    }
    return {
        clientId,
        clientSecret: staticClientSecret() || null,
        authorizationEndpoint: authEndpoint,
        tokenEndpoint,
        revocationEndpoint: staticRevocationEndpoint() || metadata?.revocationEndpoint || null,
        scopes: DEFAULT_SCOPES,
    };
}

// ── PKCE ────────────────────────────────────────────────────────────────────

export interface PkcePair {
    verifier: string;
    challenge: string;
}

export function createPkcePair(): PkcePair {
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

// ── Server-side state (RTDB, single use, TTL) ──────────────────────────────

export interface OAuthStateRecord {
    uid: string;
    verifier: string;
    createdAt: number;
    expiresAt: number;
}

const STATE_PATH = (state: string) => `tradingviewMcp/oauthStates/${state}`;
const STATE_TTL_MS = 10 * 60 * 1000;

export async function createOAuthState(uid: string): Promise<{ state: string; verifier: string }> {
    const { verifier, challenge } = createPkcePair();
    const state = crypto.randomBytes(32).toString("hex");
    await adminDatabase.ref(STATE_PATH(state)).set({
        uid,
        verifier,
        createdAt: Date.now(),
        expiresAt: Date.now() + STATE_TTL_MS,
    } satisfies OAuthStateRecord);
    // challenge is derived from verifier and not stored (recomputed client-side not needed)
    void challenge;
    return { state, verifier };
}

/** Consume the state (single use). Returns uid + verifier, or null. */
export async function consumeOAuthState(state: string): Promise<{ uid: string; verifier: string } | null> {
    if (!state || state.length > 128) return null;
    const ref = adminDatabase.ref(STATE_PATH(state));
    const snap = await ref.get();
    const data = snap.val() as OAuthStateRecord | undefined;
    // Always delete — replay-proof.
    await ref.remove();
    if (!data?.uid || !data.verifier) return null;
    if (!data.expiresAt || data.expiresAt < Date.now()) return null;
    return { uid: data.uid, verifier: data.verifier };
}

// ── Token exchange / refresh / revoke ──────────────────────────────────────

export interface TokenEndpointResponse {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
}

export class OAuthExchangeError extends Error {
    readonly status: number;
    readonly oauthError?: string;
    constructor(message: string, status: number, oauthError?: string) {
        super(message);
        this.name = "OAuthExchangeError";
        this.status = status;
        this.oauthError = oauthError;
    }
}

function sanitizeTokenResponse(data: Record<string, unknown>): TokenEndpointResponse | null {
    const accessToken = typeof data.access_token === "string" ? data.access_token : null;
    if (!accessToken) return null;
    return {
        access_token: accessToken,
        token_type: typeof data.token_type === "string" ? data.token_type : undefined,
        expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
        refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
        scope: typeof data.scope === "string" ? data.scope : undefined,
    };
}

async function postTokenRequest(
    endpoint: string,
    params: URLSearchParams,
    authHeader: string | null,
): Promise<TokenEndpointResponse> {
    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: params.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
    });
    const raw = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
        parsed = raw ? JSON.parse(raw) : {};
    } catch {
        parsed = {};
    }
    if (!res.ok) {
        // RFC 6749 error codes (invalid_grant, …) surface without secrets.
        throw new OAuthExchangeError(
            typeof parsed.error_description === "string" ? parsed.error_description : "TradingView token exchange failed.",
            res.status,
            typeof parsed.error === "string" ? parsed.error : undefined,
        );
    }
    const token = sanitizeTokenResponse(parsed);
    if (!token) throw new OAuthExchangeError("TradingView did not return an access token.", res.status);
    return token;
}

export interface ExchangeCodeArgs {
    code: string;
    verifier: string;
    config: ResolvedOAuthConfig;
    resource?: string;
}

/** Exchange the authorization code for tokens (PKCE verifier; secret when present). */
export async function exchangeAuthorizationCode(args: ExchangeCodeArgs): Promise<TokenEndpointResponse> {
    const params = new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: getRedirectUri(),
        client_id: args.config.clientId,
        code_verifier: args.verifier,
    });
    if (args.resource) params.set("resource", args.resource);
    const authHeader = args.config.clientSecret
        ? `Basic ${Buffer.from(`${args.config.clientId}:${args.config.clientSecret}`).toString("base64")}`
        : null;
    if (args.config.clientSecret) params.set("client_secret", args.config.clientSecret);
    return postTokenRequest(args.config.tokenEndpoint, params, authHeader);
}

export interface RefreshTokensArgs {
    refreshToken: string;
    config: ResolvedOAuthConfig;
}

/** Refresh tokens using the stored refresh token. */
export async function refreshTokens(args: RefreshTokensArgs): Promise<TokenEndpointResponse> {
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: args.refreshToken,
        client_id: args.config.clientId,
    });
    const authHeader = args.config.clientSecret
        ? `Basic ${Buffer.from(`${args.config.clientId}:${args.config.clientSecret}`).toString("base64")}`
        : null;
    if (args.config.clientSecret) params.set("client_secret", args.config.clientSecret);
    return postTokenRequest(args.config.tokenEndpoint, params, authHeader);
}

export interface RevokeArgs {
    token: string;
    config: ResolvedOAuthConfig;
}

/** Best-effort revocation at the provider. Never logs the token. */
export async function revokeToken(args: RevokeArgs): Promise<boolean> {
    if (!args.config.revocationEndpoint) return false;
    try {
        const params = new URLSearchParams({ token: args.token, client_id: args.config.clientId });
        const res = await fetch(args.config.revocationEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                ...(args.config.clientSecret
                    ? { Authorization: `Basic ${Buffer.from(`${args.config.clientId}:${args.config.clientSecret}`).toString("base64")}` }
                    : {}),
            },
            body: params.toString(),
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
        return res.ok || res.status === 200;
    } catch {
        return false;
    }
}
