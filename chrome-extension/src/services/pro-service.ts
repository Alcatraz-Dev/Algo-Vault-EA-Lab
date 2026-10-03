/**
 * Pro Service — lightweight React hook + helpers for Pro entitlement in the
 * extension surfaces (popup + sidepanel).
 *
 * The hook wraps the existing `getProAccess` / `getProFeatureFlags` API
 * clients from `@/api/pro` with a TTL-based in-memory cache so callers
 * don't hammer the server. It NEVER trusts client-supplied flags — every
 * answer is server-derived.
 *
 * Usage:
 *   const { isPro, flags, loading, refetch } = useProAccess();
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { getProAccess, getProFeatureFlags } from "@/api/pro";
import type { ProAccess, ProFeatureFlags } from "@/types/pro";

/* ── in-memory cache (survives React re-renders, clears on SW restart) ── */

interface CacheEntry<T> {
  value: T;
  at: number;
}

let accessCache: CacheEntry<ProAccess> | null = null;
let flagCache: CacheEntry<ProFeatureFlags> | null = null;
const ACCESS_TTL_MS = 5 * 60 * 1000; // 5 min
const FLAG_TTL_MS = 60 * 1000; // 1 min

function accessFresh(): ProAccess | null {
  if (!accessCache) return null;
  if (Date.now() - accessCache.at > ACCESS_TTL_MS) return null;
  return accessCache.value;
}

function flagFresh(): ProFeatureFlags | null {
  if (!flagCache) return null;
  if (Date.now() - flagCache.at > FLAG_TTL_MS) return null;
  return flagCache.value;
}

/* ── default flags (all off — fail-closed until server responds) ─────── */

export const DEFAULT_FLAGS: ProFeatureFlags = {
  tradingViewProExtension: false,
  aiChartCopilot: false,
  setupRadar: false,
  smartAlerts: false,
  aiIndicatorGenerator: false,
  aiStrategyGenerator: false,
  mtfIntelligence: false,
  commandBar: false,
  liveIntelligencePanel: false,
  copilotMemory: false,
  preTradeChecklist: false,
  historicalReplay: false,
  strategyHealth: false,
  marketRadar: false,
  visualStrategyBuilder: false,
  researchPipeline: false,
  aiOverlay: false,
  proCommandCenter: false,
  tradingViewExecutionBridge: false,
};

/* ── hook ────────────────────────────────────────────────────────────── */

export interface ProState {
  isPro: boolean;
  access: ProAccess | null;
  flags: ProFeatureFlags;
  loading: boolean;
  error: string | null;
  /** Force a fresh server check (bypasses TTL). */
  refetch: () => Promise<void>;
}

export function useProAccess(): ProState {
  const [access, setAccess] = useState<ProAccess | null>(accessFresh);
  const [flags, setFlags] = useState<ProFeatureFlags>(flagFresh() ?? DEFAULT_FLAGS);
  const [loading, setLoading] = useState(!accessFresh());
  const [error, setError] = useState<string | null>(null);
  const inflightRef = useRef(false);

  const fetch = useCallback(async (force = false) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [a, f] = await Promise.all([
        getProAccess(force),
        getProFeatureFlags(force),
      ]);
      accessCache = { value: a, at: Date.now() };
      flagCache = { value: f, at: Date.now() };
      setAccess(a);
      setFlags(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pro check failed");
      // Keep stale values if available — better than showing nothing.
    } finally {
      setLoading(false);
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!accessFresh() || !flagFresh()) {
      void fetch(false);
    }
  }, [fetch]);

  const refetch = useCallback(() => fetch(true), [fetch]);

  return {
    isPro: access?.access === "granted",
    access,
    flags,
    loading,
    error,
    refetch,
  };
}
