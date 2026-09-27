"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateDemoActivities,
  nextLiveActivities,
  buildCountryClusters,
  activeSessionNames,
} from "@/lib/live/live-aggregator";
import type { LiveActivity, CountryCluster } from "@/lib/live/live-types";

export interface UseLiveActivitiesResult {
  /** Newest-first rolling activity rows (feed + map consume the same array). */
  activities: LiveActivity[];
  /** Per-country aggregated clusters derived from `activities`. */
  clusters: CountryCluster[];
  /** UTC-hour-aware list of currently open FX sessions, e.g. ["London","New York"]. */
  sessions: string[];
  /** Timestamp of the last rotation, for "updated Ns ago" labels. */
  lastTick: number;
  /** Manual refresh — rotates the feed immediately. */
  refresh: () => void;
}

/**
 * Holds a rolling window of LiveActivity rows and rotates it on an interval.
 * Cluster aggregation, country stats and the world map all derive from the
 * same array so every panel on the page tells the same story.
 *
 * Demo/production mode comes from NEXT_PUBLIC_LIVE_MODE (live-aggregator);
 * when production mode is enabled the hook should be fed real events instead
 * (see aggregateFromEvents) — the rotation keeps working either way.
 */
export function useLiveActivities(count = 60, intervalMs = 15_000): UseLiveActivitiesResult {
  // Seeded on mount (not in the initializer) so SSR and the client's first
  // render agree — the generator is wall-clock dependent.
  const [activities, setActivities] = useState<LiveActivity[]>([]);
  const [lastTick, setLastTick] = useState<number>(0);
  const activitiesRef = useRef<LiveActivity[]>([]);
  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);

  const refresh = useMemo(
    () => () => {
      setActivities((prev) => nextLiveActivities(prev, count));
      setLastTick(Date.now());
    },
    [count]
  );

  useEffect(() => {
    // Deferred so no state is set synchronously inside the effect body.
    const t = setTimeout(() => {
      setActivities(generateDemoActivities(count));
      setLastTick(Date.now());
    }, 0);
    return () => clearTimeout(t);
  }, [count]);

  useEffect(() => {
    if (lastTick === 0) return; // wait for the mount seed
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs, lastTick]);

  const clusters = useMemo(() => buildCountryClusters(activities), [activities]);
  const sessions = useMemo(() => activeSessionNames(), []);

  return { activities, clusters, sessions, lastTick, refresh };
}
