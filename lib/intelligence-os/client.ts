"use client";

import { useEffect, useRef, useState } from "react";
import type { IntelligenceOSContext } from "@/lib/intelligence-os/types";

type ContextState =
  | { status: "loading" }
  | { status: "ready"; context: IntelligenceOSContext; elapsedMs: number; generatedAt: number }
  | { status: "unavailable"; reason: string };

export function useIntelligenceOS(refreshKey = 0) {
  const [state, setState] = useState<ContextState>({ status: "loading" });
  const mountedRef = useRef(true);
  const loadRef = useRef<ReturnType<typeof setTimeout> | null>(null);    const load = async () => {
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
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      void load();
    }, 0);
    return () => {
      clearTimeout(timer);
      if (loadRef.current) clearTimeout(loadRef.current);
    };
  }, [refreshKey, load]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (loadRef.current) clearTimeout(loadRef.current);
    };
  }, []);

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
