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
      const stored = (result.settings ?? {}) as Partial<ExtensionSettings>;
      // Heal stale URLs: (1) dev builds produced before the production
      // default persisted http://localhost:3000 — users must never silently
      // keep talking to a local server; (2) builds pointed at algovault.dev —
      // that domain does not resolve (NXDOMAIN, verified 2026-10-01), so any
      // stored reference to it can never be reached and must be dropped so the
      // build's own default takes over.
      const storedUrl = typeof stored.algovaultUrl === "string" ? stored.algovaultUrl : "";
      if (
        (!import.meta.env?.DEV && /localhost|127\.0\.0\.1/.test(storedUrl)) ||
        /algovault\.dev/.test(storedUrl)
      ) {
        delete stored.algovaultUrl;
      }
      resolve({ ...DEFAULT_SETTINGS, ...stored });
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

/* ── copilot threads, memory & preferences (v3) ─────────────────────── */

import type {
  CopilotThread,
  CopilotMemory,
  CopilotPreferences,
  ResearchNote,
} from "@/types/copilot";
import { DEFAULT_COPILOT_PREFS } from "@/types/copilot";

const COPILOT_THREADS_KEY = "copilotThreads";
const COPILOT_MEMORY_KEY = "copilotMemory";
const COPILOT_PREFS_KEY = "copilotPrefs";
const RESEARCH_CACHE_KEY = "researchCache";

export async function getCopilotThreads(): Promise<CopilotThread[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(COPILOT_THREADS_KEY, (result) => {
      resolve(Array.isArray(result[COPILOT_THREADS_KEY]) ? result[COPILOT_THREADS_KEY] : []);
    });
  });
}

export async function saveCopilotThreads(threads: CopilotThread[]): Promise<void> {
  // Cap stored history: 60 threads / 200 messages per thread keeps chrome.storage.local
  // well below its 10 MB limit even with heavy daily use.
  const trimmed = threads.slice(0, 60).map((t) => ({ ...t, messages: t.messages.slice(-200) }));
  return new Promise((resolve) => {
    chrome.storage.local.set({ [COPILOT_THREADS_KEY]: trimmed }, resolve);
  });
}

export async function getCopilotMemory(): Promise<Record<string, CopilotMemory>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(COPILOT_MEMORY_KEY, (result) => {
      resolve((result[COPILOT_MEMORY_KEY] as Record<string, CopilotMemory>) || {});
    });
  });
}

export async function saveCopilotMemory(memory: Record<string, CopilotMemory>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [COPILOT_MEMORY_KEY]: memory }, resolve);
  });
}

export async function getCopilotPrefs(): Promise<CopilotPreferences> {
  return new Promise((resolve) => {
    chrome.storage.local.get(COPILOT_PREFS_KEY, (result) => {
      resolve({ ...DEFAULT_COPILOT_PREFS, ...(result[COPILOT_PREFS_KEY] || {}) });
    });
  });
}

export async function saveCopilotPrefs(prefs: Partial<CopilotPreferences>): Promise<void> {
  const current = await getCopilotPrefs();
  return new Promise((resolve) => {
    chrome.storage.local.set({ [COPILOT_PREFS_KEY]: { ...current, ...prefs } }, resolve);
  });
}

/* ── research notes cache ────────────────────────────────────────────── */

export async function getResearchCache(): Promise<Record<string, ResearchNote>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(RESEARCH_CACHE_KEY, (result) => {
      resolve((result[RESEARCH_CACHE_KEY] as Record<string, ResearchNote>) || {});
    });
  });
}

export async function setResearchCache(cache: Record<string, ResearchNote>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [RESEARCH_CACHE_KEY]: cache }, resolve);
  });
}

/* ── overlay persistence ─────────────────────────────────────────────── */

export interface OverlayState {
  position: { x: number; y: number };
  collapsed: boolean;
  visible: boolean;
  /** True when the panel is minimized to the tiny quick-open launcher. */
  closed: boolean;
  /** Persisted position of the mini launcher (quick-open pill). */
  launcher: { x: number; y: number };
}

const DEFAULT_OVERLAY_STATE: OverlayState = {
  position: { x: 24, y: 140 },
  collapsed: false,
  visible: true,
  closed: false,
  launcher: { x: -1, y: -1 }, // resolved to a corner on first render
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

/* ── daily AI signals ─────────────────────────────────────────────── */

export interface DailySignalsState {
  day: string;
  used: number;
}

export async function getDailySignalsState(): Promise<DailySignalsState> {
  return new Promise((resolve) => {
    chrome.storage.local.get("dailySignals", (result) => {
      resolve(result.dailySignals ?? { day: "", used: 0 });
    });
  });
}

export async function saveDailySignalsState(state: DailySignalsState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ dailySignals: state }, resolve);
  });
}

export async function getSelectedSignalSymbols(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get("signalSymbols", (result) => {
      const list = Array.isArray(result.signalSymbols) ? (result.signalSymbols as string[]) : [];
      resolve(list.map((s) => String(s).toUpperCase()));
    });
  });
}

export async function saveSelectedSignalSymbols(symbols: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ signalSymbols: symbols }, resolve);
  });
}

/* ── demo trading (paper account + test capital) ────────────────────── */

import type { DemoState } from "@/services/demo-trading";

const DEMO_STATE_KEY = "demoTradingState";
const DEMO_CAPITAL_KEY = "demoTestCapital";

export async function getDemoTradingState(): Promise<DemoState | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEMO_STATE_KEY, (result) => {
      const raw = result[DEMO_STATE_KEY];
      resolve(raw && typeof raw === "object" && typeof (raw as DemoState).balance === "number" ? (raw as DemoState) : null);
    });
  });
}

export async function saveDemoTradingState(state: DemoState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [DEMO_STATE_KEY]: state }, resolve);
  });
}

export async function clearDemoTradingState(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([DEMO_STATE_KEY, DEMO_CAPITAL_KEY], resolve);
  });
}

/** Remembered test-capital amount so the setup screen pre-fills next time. */
export async function getDemoTestCapital(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEMO_CAPITAL_KEY, (result) => {
      const v = Number(result[DEMO_CAPITAL_KEY]);
      resolve(Number.isFinite(v) && v > 0 ? v : null);
    });
  });
}

export async function saveDemoTestCapital(capital: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [DEMO_CAPITAL_KEY]: capital }, resolve);
  });
}

/* ── server-bound install identity (survives extension removal) ──────── */

/**
 * Random id generated by the AlgoVault WEBSITE (not the extension) and
 * mirrored into chrome.storage.sync. Because the source of truth lives in
 * the site's localStorage under the extension's origin, removing or
 * reinstalling the extension does NOT reset it — the server-side free daily
 * signal quota keyed by this id therefore survives reinstalls.
 *
 * storage.sync additionally rides the Chrome profile, so the same user keeps
 * their quota across machines.
 */
export async function getServerInstallId(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.sync.get("serverInstallId", (result) => {
      const id = typeof result.serverInstallId === "string" ? result.serverInstallId : null;
      resolve(id && id.length >= 8 ? id : null);
    });
  });
}

export async function setServerInstallId(id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ serverInstallId: id }, resolve);
  });
}

/* ── last open view (quick popup resume) ────────────────────────────── */

/**
 * Remembers the view the user was on when they closed the popup, so the
 * next open resumes there instead of always landing on Home. "ai-signals"
 * is intentionally excluded — the free daily quota state is ephemeral and
 * Home is the better landing surface for it.
 */
export async function getLastView(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get("lastPopupView", (result) => {
      resolve(typeof result.lastPopupView === "string" ? result.lastPopupView : null);
    });
  });
}

export async function saveLastView(view: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ lastPopupView: view }, resolve);
  });
}