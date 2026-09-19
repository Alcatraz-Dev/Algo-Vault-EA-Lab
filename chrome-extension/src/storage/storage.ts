import { ExtensionSettings, TradingViewContext } from "@/types";
import { getAlgoVaultUrl } from "@/config/environment";

const DEFAULT_SETTINGS: ExtensionSettings = {
  algovaultUrl: getAlgoVaultUrl(),
  autoDetectTradingView: true,
  showOverlay: true,
  enableChartAnalysis: true,
  defaultRiskPercent: 1,
  defaultTimeframe: "H1",
  confirmBeforeExecution: true,
  theme: "dark",
};

export async function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings", (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...result.settings });
    });
  });
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  const current = await getSettings();
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: { ...current, ...settings } }, resolve);
  });
}

export async function getAuthToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get("authToken", (result) => {
      resolve(result.authToken || null);
    });
  });
}

export async function setAuthToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ authToken: token }, resolve);
  });
}

export async function clearAuthToken(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove("authToken", resolve);
  });
}

export async function getUser(): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get("user", (result) => {
      resolve(result.user || null);
    });
  });
}

export async function setUser(user: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ user }, resolve);
  });
}

export async function clearUser(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove("user", resolve);
  });
}

/* ── canonical chart context ─────────────────────────────────────────── */

export async function getCachedContext(): Promise<{ context: TradingViewContext | null; timestamp: number }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tradingViewContext", "tradingViewContextTimestamp"], (result) => {
      resolve({
        context: result.tradingViewContext || null,
        timestamp: (result.tradingViewContextTimestamp as number) || 0,
      });
    });
  });
}

export async function setCachedContext(ctx: TradingViewContext): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ tradingViewContext: ctx, tradingViewContextTimestamp: Date.now() }, resolve);
  });
}

/* ── market data cache (service worker enrichment) ───────────────────── */

export interface MarketCacheEntry {
  marketContext: unknown;
  timestamp: number;
}

export async function getMarketCache(key: string): Promise<MarketCacheEntry | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(`marketCache:${key}`, (result) => {
      const entry = result[`marketCache:${key}`] as MarketCacheEntry | undefined;
      resolve(entry || null);
    });
  });
}

export async function setMarketCache(key: string, marketContext: unknown): Promise<void> {
  const entry: MarketCacheEntry = { marketContext, timestamp: Date.now() };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [`marketCache:${key}`]: entry }, resolve);
  });
}

export async function clearMarketCache(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (all) => {
      const toRemove = Object.keys(all).filter((k) => k.startsWith("marketCache:"));
      if (toRemove.length === 0) return resolve();
      chrome.storage.local.remove(toRemove, resolve);
    });
  });
}

/* ── overlay persistence ─────────────────────────────────────────────── */

export interface OverlayState {
  position: { x: number; y: number };
  collapsed: boolean;
  visible: boolean;
}

const DEFAULT_OVERLAY_STATE: OverlayState = {
  position: { x: 24, y: 140 },
  collapsed: false,
  visible: true,
};

export async function getOverlayState(): Promise<OverlayState> {
  return new Promise((resolve) => {
    chrome.storage.local.get("overlayState", (result) => {
      resolve({ ...DEFAULT_OVERLAY_STATE, ...(result.overlayState || {}) });
    });
  });
}

export async function setOverlayState(state: Partial<OverlayState>): Promise<void> {
  const current = await getOverlayState();
  return new Promise((resolve) => {
    chrome.storage.local.set({ overlayState: { ...current, ...state } }, resolve);
  });
}