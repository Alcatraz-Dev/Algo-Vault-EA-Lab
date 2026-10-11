"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntelligenceOSContext } from "@/lib/intelligence-os/types";

type ContextState =
  | { status: "loading" }
  | { status: "ready"; context: IntelligenceOSContext; elapsedMs: number; generatedAt: number }
  | { status: "unavailable"; reason: string };

export function useIntelligenceOS(refreshKey = 0) {
  const [state, setState] = useState<ContextState>({ status: "loading" });
  const mountedRef = useRef(true);
  // Defined via useCallback so its identity is stable: the loading effect below
  // depends on it, and a fresh function every render would clear and re-arm the
  // 0 ms timer on every parent render — the initial load could be deferred
  // indefinitely and each parent render would trigger another fetch.
  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setState((s) => (s.status === "loading" ? s : { status: "loading" }));

    try {
      const token = await getToken();
      if (!token || !mountedRef.current) {
        setState({ status: "unavailable", reason: "Session expired." });
        return;
      }

      const res = await fetch("/api/intelligence-os", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!mountedRef.current) return;
      if (!res.ok) {
        setState({ status: "unavailable", reason: res.status === 401 ? "Session expired." : "Intelligence OS unavailable." });
        return;
      }
      const json = await res.json();
      if (!mountedRef.current) return;
      if (!json.success || !json.context) {
        setState({ status: "unavailable", reason: json.error || "Invalid intelligence context response." });
        return;
      }
      setState({
        status: "ready",
        context: json.context as IntelligenceOSContext,
        elapsedMs: json.elapsedMs ?? 0,
        generatedAt: json.generatedAt ?? Date.now(),
      });
    } catch {
      if (!mountedRef.current) return;
      setState({ status: "unavailable", reason: "Could not reach AlgoVault Intelligence OS." });
    }
  }, []);

  // Re-arm the ref in the setup phase. React Strict Mode (on by default with
  // the app router in development) runs setup → cleanup → setup on the SAME
  // component instance, so a ref that is only cleared on unmount stays false
  // for the rest of the mount: every guarded `load()` then bails out and the
  // panel sits on its skeleton forever without issuing a request.
  // (Same pattern as components/tradingview/TradingViewChart.tsx.)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshKey, load]);

  return state;
}

async function getToken(): Promise<string | null> {
  try {
    const { auth } = await import("@/lib/firebase");
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}
