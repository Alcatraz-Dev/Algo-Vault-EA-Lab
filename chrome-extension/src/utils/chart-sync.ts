/**
 * Hooks/helpers around the TradingView chart-context sync pipeline.
 *
 * The popup lives in an extension-page context so it can't read the chart
 * directly — instead it relies on a content script + service-worker relay.
 * `useChartSync()` packages the boilerplate so Demo Trades, Trade Ticket and
 * any future view can show a single ChartSyncBadge with consistent state.
 *
 * Source of truth:
 *   - the TradingView content script pushes `TRADINGVIEW_CONTEXT_UPDATE`
 *     every time the active chart identity (symbol / timeframe) changes
 *   - the SW tracks `lastTvHeartbeat` (5s ping from the content script)
 *     so we can tell "stale cache" apart from "no chart open"
 *   - explicit refreshes go through `REFRESH_FROM_ACTIVE_TV`, which
 *     queries the focused TradingView tab and waits for a fresh reply.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartSyncState } from "@/popup/components/ui";
import type { TradingViewContext } from "@/types";

/** Below this age the badge says "live"; above it the badge says "stale". */
export const CHART_LIVE_THRESHOLD_MS = 15_000;
/** Above this age the badge says "offline" — last-resort warning. */
export const CHART_OFFLINE_THRESHOLD_MS = 60_000;

export interface ChartSyncInfo {
  state: ChartSyncState;
  ageMs: number | null;
  activeTabId: number | null;
  activeWindowId: number | null;
  /** True while a manual refresh is in flight. */
  refreshing: boolean;
  /** Force a fresh re-detect from the focused TradingView tab. */
  refresh: () => Promise<void>;
  /** Active TradingView tab found. */
  hasActiveTvTab: boolean;
}

interface ActiveTvResp {
  ok: boolean;
  activeTabId?: number | null;
  activeWindowId?: number | null;
  lastHeartbeatAt?: number;
  ageMs?: number | null;
}

interface RefreshResp {
  ok: boolean;
  reason?: string;
  context?: TradingViewContext | null;
  contextTimestamp?: number;
  tabId?: number;
  cached?: boolean;
}

export function useChartSync(
  context: TradingViewContext | null,
  contextTimestamp: number | null,
): ChartSyncInfo {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [activeWindowId, setActiveWindowId] = useState<number | null>(null);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /* Local heartbeat — bumps every second so the badge's "Xs ago" updates
   * without us relying on external events. */
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const refreshTvState = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_TV_TAB" }, (resp: ActiveTvResp | undefined) => {
        if (resp?.ok) {
          setActiveTabId(resp.activeTabId ?? null);
          setActiveWindowId(resp.activeWindowId ?? null);
          setLastHeartbeatAt(resp.lastHeartbeatAt && resp.lastHeartbeatAt > 0 ? resp.lastHeartbeatAt : null);
        }
      });
    } catch { /* SW unavailable */ }
  }, []);

  useEffect(() => {
    refreshTvState();
    // Re-query every 4s — heartbeat updates come through here so the badge
    // stays current even when the user hasn't switched charts.
    const id = setInterval(refreshTvState, 4000);
    return () => clearInterval(id);
  }, [refreshTvState]);

  /* Listen for live context updates to keep our local heartbeat + tab state
   * in sync without waiting for the next poll. */
  useEffect(() => {
    const listener = (message: { type: string; payload?: unknown }) => {
      if (message.type === "TRADINGVIEW_CONTEXT_UPDATE") {
        refreshTvState();
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, [refreshTvState]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await new Promise<void>((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "REFRESH_FROM_ACTIVE_TV" }, (resp: RefreshResp | undefined) => {
            if (resp?.ok && resp.context) {
              setLastHeartbeatAt(Date.now());
            }
            refreshTvState();
            resolve();
          });
        } catch {
          resolve();
        }
        /* Bound the wait — the popup shouldn't hang on a flaky tab. */
        setTimeout(resolve, 2500);
      });
    } finally {
      setRefreshing(false);
    }
  }, [refreshTvState]);

  const state = useMemo<ChartSyncState>(() => {
    const isManual = context?.manualOverride === true;
    if (isManual) return "manual";
    const now = Date.now();
    const age = contextTimestamp != null ? now - contextTimestamp : null;
    const hbAge = lastHeartbeatAt != null ? now - lastHeartbeatAt : null;

    // No TV tab and no recent heartbeat → offline.
    if (hbAge == null) {
      if (age == null || age > CHART_OFFLINE_THRESHOLD_MS) return "offline";
      // We have a cached context but no live heartbeat — stale.
      return age > CHART_LIVE_THRESHOLD_MS ? "stale" : "stale";
    }
    if (hbAge > CHART_OFFLINE_THRESHOLD_MS) return "offline";
    if (hbAge > CHART_LIVE_THRESHOLD_MS) return "stale";
    return "live";
  }, [context?.manualOverride, contextTimestamp, lastHeartbeatAt]);

  const ageMs = useMemo(() => {
    if (contextTimestamp == null) return null;
    return Math.max(0, Date.now() - contextTimestamp);
  }, [contextTimestamp]);

  return {
    state,
    ageMs,
    activeTabId,
    activeWindowId,
    refreshing,
    refresh,
    hasActiveTvTab: activeTabId != null,
  };
}