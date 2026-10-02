/**
 * AlgoVault Chrome Extension — TradingView MCP integration client (PHASE 11).
 *
 * The extension NEVER stores TradingView OAuth tokens, never embeds secrets,
 * and never talks to TradingView directly. It calls the authenticated AlgoVault
 * backend, which acts as the secure gateway to the TradingView MCP provider.
 *
 *   Chrome Extension ── bearer token ─▶ AlgoVault Extension API ─▶ providers
 *
 * All endpoints require the user's Firebase bearer token (same session model
 * as every other extension API call in algovault.ts).
 */
import { getAuthToken, getSettings } from "@/storage/storage";

const EXT_PREFIX = "[AlgoVault Extension]";

async function authedGet<T>(path: string): Promise<T> {
  const settings = await getSettings();
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${settings.algovaultUrl}${path}`, { headers, method: "GET" });
  console.log(`${EXT_PREFIX} GET ${path} -> ${res.status}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

/* ── connection status ─────────────────────────────────────────────────── */

export type TradingViewConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "TOKEN_EXPIRED"
  | "REAUTH_REQUIRED"
  | "ERROR"
  | "DISABLED";

export interface TradingViewStatus {
  provider: "tradingview-mcp";
  state: TradingViewConnectionState;
  enabled: boolean;
  authorized: boolean;
  scopes: string[];
  message?: string;
  lastCheckedAt?: number | null;
}

export interface TradingViewCapabilities {
  success: boolean;
  status: TradingViewStatus;
  capabilities: Array<{ id: string; label: string; supported: boolean; read: boolean }>;
  notice: string;
  beta: boolean;
}

export async function getTradingViewStatus(): Promise<TradingViewCapabilities> {
  return authedGet<TradingViewCapabilities>("/api/integrations/tradingview");
}

/* ── external intelligence context ─────────────────────────────────────── */

export interface TradingViewContextSection {
  available: boolean;
  state: string;
  message?: string;
  items: Array<{ label: string; value: string; freshnessLabel: string }>;
}

export interface TradingViewContextResponse {
  success: boolean;
  mode: string;
  symbol: string;
  timeframe: string;
  status: TradingViewStatus;
  tradingview: {
    technicals: TradingViewContextSection;
    news: TradingViewContextSection;
    economicCalendar: TradingViewContextSection;
  };
  anyExternalEvidence: boolean;
  aiEvidenceText?: string;
  limitations: string[];
}

export type TradingViewContextMode = "terminal" | "scalping" | "research" | "summary";

/**
 * Fetch the TradingView external context for the given chart identity.
 * Returns null when TradingView is disabled/disconnected so callers can
 * degrade gracefully to AlgoVault-only mode.
 */
export async function getTradingViewContext(
  symbol: string,
  timeframe: string,
  mode: TradingViewContextMode = "summary"
): Promise<TradingViewContextResponse | null> {
  try {
    return await authedGet<TradingViewContextResponse>(
      `/api/integrations/tradingview/context?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&mode=${mode}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "context failed";
    console.log(`${EXT_PREFIX} TradingView context unavailable: ${message}`);
    return null;
  }
}

/**
 * Open the AlgoVault web app on the TradingView integrations settings page —
 * the secure entry point for Connect / Reconnect. The OAuth flow runs in the
 * browser on the AlgoVault site (state + PKCE live server-side); the
 * extension never sees tokens.
 */
export async function openTradingViewConnectPage(): Promise<void> {
  const settings = await getSettings();
  const url = `${settings.algovaultUrl}/account/settings?tab=integrations`;
  try {
    await chrome.tabs.create({ url });
  } catch {
    // Fallback for contexts without tabs permission guarantees.
    await chrome.windows.create({ url, type: "popup" });
  }
}
