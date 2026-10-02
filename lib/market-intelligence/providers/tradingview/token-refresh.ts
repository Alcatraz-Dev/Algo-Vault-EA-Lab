/**
 * Opportunistic token refresh for the TradingView MCP connection.
 *
 * Called by route handlers when a call fails with TOKEN_EXPIRED and a refresh
 * token exists. With no refresh token the user must reconnect (REAUTH_REQUIRED
 * UX). Refresh tokens are only ever read from / written to the encrypted
 * connection store — never logged, never returned.
 */
import { refreshTokens, resolveOAuthConfig } from "./oauth";
import { loadTokenBundle, markConnected, markReauthRequired, saveTokenBundle } from "./connection-store";

export type RefreshOutcome = "refreshed" | "no_refresh_token" | "refresh_failed";

export async function tryRefreshTradingViewToken(uid: string): Promise<RefreshOutcome> {
    const bundle = await loadTokenBundle(uid).catch(() => null);
    if (!bundle?.refreshToken) return "no_refresh_token";

    const config = await resolveOAuthConfig().catch(() => null);
    if (!config) return "refresh_failed";

    try {
        const response = await refreshTokens({ refreshToken: bundle.refreshToken, config });
        const expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
        await saveTokenBundle(uid, {
            accessToken: response.access_token,
            // Some providers rotate refresh tokens; keep the new one when given.
            ...(response.refresh_token ? { refreshToken: response.refresh_token } : { refreshToken: bundle.refreshToken }),
            expiresAt,
            scope: response.scope ? response.scope.split(/[\s,]+/).filter(Boolean) : bundle.scope,
            issuedAt: bundle.issuedAt,
        });
        await markConnected(uid);
        return "refreshed";
    } catch {
        await markReauthRequired(uid, "TradingView refresh failed. Please reconnect.");
        return "refresh_failed";
    }
}
