"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { Timeframe } from "@/lib/market-data/types";

/**
 * Authenticated, throttled fetch helper for the terminal.
 *
 * Behaviour that matters for the performance budget:
 *  • Waits for the Firebase auth token instead of firing an unauthenticated
 *    request that would 401.
 *  • Aborts the in-flight request when inputs change or the component unmounts,
 *    so a fast symbol switch cannot deliver a stale response.
 *  • `minIntervalMs` coalesces rapid re-fetches (e.g. a slider drag) into one
 *    request per window.
 */

export type AuthedFetchOptions = {
  /** Minimum gap between two requests, in ms. */
  minIntervalMs?: number;
  /** Skip the request entirely (e.g. not signed in yet). */
  enabled?: boolean;
};

export function useAuthToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;
      if (user) {
        try {
          const t = await user.getIdToken();
          if (!cancelled) setToken(t);
        } catch {
          if (!cancelled) setToken(null);
        }
      } else if (!cancelled) {
        setToken(null);
      }
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return ready ? token : null;
}

export function useThrottledAuthedFetch<T>(
  url: string | null,
  options: AuthedFetchOptions = {}
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  lastUpdated: number | null;
} {
  const { minIntervalMs = 0, enabled = true } = options;
  const token = useAuthToken();

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const lastFetchRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url || !enabled || !token) return;

    const run = async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await res.json();

        if (res.status === 401) {
          setError("Session expired. Sign in again to continue.");
          setData(null);
        } else if (res.status === 403) {
          setError(
            body?.error ?? "Your plan does not include this workspace."
          );
          setData(null);
        } else if (!res.ok) {
          setError(body?.error ?? `Request failed (${res.status}).`);
          setData(null);
        } else {
          if (body?.error && !body?.radar && !body?.analysis && !body?.signals && !body?.run) {
            // A 200 that carries only an `error` is a data-unavailable state,
            // not a successful payload. Keep it visible instead of blanking.
            setError(body.error);
            setData(null);
          } else {
            setError(null);
            setData(body as T);
          }
        }
        setLastUpdated(Date.now());
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Request failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    const elapsed = Date.now() - lastFetchRef.current;
    const wait = Math.max(0, minIntervalMs - elapsed);

    if (wait === 0) {
      lastFetchRef.current = Date.now();
      void run();
    } else {
      timerRef.current = setTimeout(() => {
        lastFetchRef.current = Date.now();
        void run();
      }, wait);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [url, token, enabled, minIntervalMs, nonce]);

  return { data, error, loading, refresh, lastUpdated };
}

/** Poll interval presets, kept in one place so the UI can offer sane choices. */
export const REFRESH_INTERVALS = [
  { label: "15s", value: 15_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
  { label: "5m", value: 300_000 },
  { label: "Off", value: 0 },
] as const;

/** Live ticking clock for the "last update" readout. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function relativeTime(from: number | null, now: number): string {
  if (from === null) return "never";
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function formatPrice(value: number | null | undefined, digits = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export const SCALPING_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1"];
