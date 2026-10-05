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

/**
 * Scopes are requested from the authorization server's own advertisement
 * (metadata.scopes_supported). TradingView publishes `mcp:read` /
 * `mcp:tools`; `TRADINGVIEW_MCP_SCOPES` overrides the request when an
 * account needs the tool scope. Never widened automatically.
 */
function scopeOverride(): string[] | null {
    const raw = (process.env.TRADINGVIEW_MCP_SCOPES || "").trim();
    if (!raw) return null;
    const scopes = raw.split(/[\s,]+/).filter(Boolean);
    return scopes.length > 0 ? scopes : null;
}

function resolveScopes(metadata: OAuthServerMetadata | null): string[] {
    const override = scopeOverride();
    if (override) return override;
    const supported = metadata?.scopesSupported;
    if (!supported || supported.length === 0) return DEFAULT_SCOPES;
    // Read-only preference: pick the advertised read scope (e.g. `mcp:read`),
    // fall back to a literal `read`, and only then to the static default.
    const readScope = supported.find((s) => s === "mcp:read" || s === "read" || /:read$/i.test(s));
    if (readScope) return [readScope];
    return DEFAULT_SCOPES.filter((s) => supported.includes(s));
}

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
    const value = await discoverServerMetadata();
    metadataCache = { value, at: now, failed: value === null };
    return value;
}

/** RFC 8414 path-inserted well-known URL for an authorization server URL. */
function authorizationServerMetadataUrl(server: string): string {
    const url = new URL(server);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}

function parseMetadata(data: unknown): OAuthServerMetadata | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const meta: OAuthServerMetadata = {
        authorizationEndpoint: str(d.authorization_endpoint),
        tokenEndpoint: str(d.token_endpoint),
        revocationEndpoint: str(d.revocation_endpoint),
        registrationEndpoint: str(d.registration_endpoint),
        scopesSupported: Array.isArray(d.scopes_supported) ? (d.scopes_supported as string[]).filter((s) => typeof s === "string") : undefined,
        codeChallengeMethodsSupported: Array.isArray(d.code_challenge_methods_supported)
            ? (d.code_challenge_methods_supported as string[])
            : undefined,
    };
    return meta.authorizationEndpoint && meta.tokenEndpoint ? meta : null;
}

/**
 * Discovery chain (TradingView does NOT serve metadata on the MCP host):
 *  1. RFC 8414 well-known on the MCP host (path-aware, then origin root),
 *  2. RFC 8707 protected-resource metadata → `authorization_servers` →
 *     the real authorization server's RFC 8414 document.
 */
async function discoverServerMetadata(): Promise<OAuthServerMetadata | null> {
    const base = new URL(TRADINGVIEW_MCP_URL);
    const candidates = [
        `${base.origin}/.well-known/oauth-authorization-server${base.pathname}`,
        `${base.origin}/.well-known/oauth-authorization-server`,
    ];

    try {
        const res = await fetch(`${base.origin}/.well-known/oauth-protected-resource${base.pathname}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
            const data = (await res.json()) as { authorization_servers?: unknown };
            const servers = Array.isArray(data.authorization_servers) ? data.authorization_servers : [];
            for (const server of servers) {
                if (typeof server !== "string") continue;
                try {
                    candidates.push(authorizationServerMetadataUrl(server));
                } catch {
                    // malformed server URL — skip
                }
            }
        }
    } catch {
        // resource metadata unavailable — the direct candidates still run
    }

    for (const url of candidates) {
        try {
            const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
            if (!res.ok) continue;
            const meta = parseMetadata(await res.json());
            if (meta) return meta;
        } catch {
            // try the next candidate
        }
    }
    return null;
}

// ── Dynamic client registration (RFC 7591) ───────────────────────────────

interface StoredClientRegistration {
    clientId: string;
    /** Only persisted when the server actually issued a secret. */
    clientSecret?: string;
    createdAt: number;
}

const REGISTRATION_PATH = "tradingviewMcp/clientRegistration";
let registrationCache: { at: number; value: StoredClientRegistration | null } | null = null;
const REGISTRATION_TTL_MS = 60 * 60 * 1000;

async function loadClientRegistration(): Promise<StoredClientRegistration | null> {
    const now = Date.now();
    if (registrationCache && now - registrationCache.at < REGISTRATION_TTL_MS) return registrationCache.value;
    let value: StoredClientRegistration | null = null;
    try {
        const snap = await adminDatabase.ref(REGISTRATION_PATH).get();
        const data = snap.val() as StoredClientRegistration | undefined;
        if (data && typeof data.clientId === "string" && data.clientId) {
            value = { clientId: data.clientId, clientSecret: data.clientSecret, createdAt: data.createdAt };
        }
    } catch {
        value = null;
    }
    registrationCache = { at: now, value };
    return value;
}

async function saveClientRegistration(reg: StoredClientRegistration): Promise<void> {
    registrationCache = { at: Date.now(), value: reg };
    await adminDatabase.ref(REGISTRATION_PATH).set(reg);
}

/**
 * Register (once) an OAuth client with the authorization server when no
 * static TRADINGVIEW_MCP_CLIENT_ID is configured. The result is persisted in
 * RTDB so every subsequent connection reuses the same client identity.
 */
async function ensureClientRegistration(metadata: OAuthServerMetadata): Promise<StoredClientRegistration | null> {
    const existing = await loadClientRegistration();
    if (existing) return existing;
    if (!metadata.registrationEndpoint) return null;

    try {
        const res = await fetch(metadata.registrationEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_name: "AlgoVault",
                redirect_uris: [getRedirectUri()],
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                // Public client: PKCE (S256) authenticates the exchange, so no
                // client secret is requested or stored.
                token_endpoint_auth_method: "none",
                scope: resolveScopes(metadata).join(" "),
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { client_id?: unknown; client_secret?: unknown };
        if (typeof data.client_id !== "string" || !data.client_id) return null;
        const reg: StoredClientRegistration = {
            clientId: data.client_id,
            ...(typeof data.client_secret === "string" && data.client_secret ? { clientSecret: data.client_secret } : {}),
            createdAt: Date.now(),
        };
        await saveClientRegistration(reg);
        return reg;
    } catch {
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
    const staticId = staticClientId();
    const authEndpoint = staticAuthEndpoint() || metadata?.authorizationEndpoint || "";
    const tokenEndpoint = staticTokenEndpoint() || metadata?.tokenEndpoint || "";

    if ((!staticId && !metadata) || !authEndpoint || !tokenEndpoint) {
        throw new TradingViewMcpNotConfiguredError(
            "TradingView MCP OAuth metadata could not be discovered and no TRADINGVIEW_MCP_CLIENT_ID is set. " +
                "Check outbound access to mcp.tradingview.com / www.tradingview.com, or set " +
                "TRADINGVIEW_MCP_CLIENT_ID (and endpoint overrides) explicitly.",
        );
    }

    // Client identity: static env id wins; otherwise register dynamically once
    // (RFC 7591) and reuse the stored registration for every connection.
    let clientId = staticId;
    let clientSecret = staticClientSecret() || null;
    if (!clientId) {
        const registered = metadata ? await ensureClientRegistration(metadata) : null;
        if (!registered) {
            throw new TradingViewMcpNotConfiguredError(
                "TradingView MCP client registration is unavailable (no TRADINGVIEW_MCP_CLIENT_ID and the " +
                    "authorization server exposes no working registration endpoint).",
            );
        }
        clientId = registered.clientId;
        clientSecret = registered.clientSecret ?? null;
    }

    return {
        clientId,
        clientSecret,
        authorizationEndpoint: authEndpoint,
        tokenEndpoint,
        revocationEndpoint: staticRevocationEndpoint() || metadata?.revocationEndpoint || null,
        scopes: resolveScopes(metadata),
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
