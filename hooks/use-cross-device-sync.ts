"use client";

/**
 * Phase 11 — cross-device sync + transport state for React clients.
 *
 * One hook owns the sync loop (auth token, pull, merge, rebase, retry) and one
 * owns connectivity. Every surface — desktop web, PWA, `/mobile` — calls these,
 * so "is my state current?" has a single answer everywhere rather than a
 * different localStorage read per screen.
 *
 * Retries are backed off, not hammered, and are paused entirely when the tab is
 * hidden: a phone with a backgrounded browser must not be waking the server every
 * few seconds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    describeFreshness,
    type TransportState,
} from "@/lib/mobile/freshness";
import type {
    DataFreshness,
    FreshnessDescriptor,
    SyncEnvelope,
    UserPreferences,
    WorkspaceState,
} from "@/lib/mobile/contracts";
import {
    readCachedPreferences,
    readCachedWorkspace,
    setSyncToken,
    stagePreferences,
    stageWorkspace,
    syncPreferences,
    syncWorkspace,
    type SyncStatus,
} from "@/lib/mobile/sync-client";
import { trackMobile, trackSync } from "@/lib/mobile/analytics";

const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 2_000;

interface SyncState<T> {
    envelope: SyncEnvelope<T>;
    status: SyncStatus;
    conflicts: Array<{ key: string; outcome: string; reason: string }>;
    /** True while the very first pull is in flight and nothing is cached. */
    bootstrapping: boolean;
}

function useTokenProvider(): { user: User | null; ready: boolean } {
    const [user, setUser] = useState<User | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const unsubscribe = onIdTokenChanged(auth, async (next) => {
            setUser(next);
            setSyncToken(next ? await next.getIdToken() : null);
            setReady(true);
        });
        return () => unsubscribe();
    }, []);

    return { user, ready };
}

/**
 * The workspace sync hook.
 *
 * `update` applies an optimistic local edit and schedules a push. It never
 * blocks on the network: the UI reflects the change immediately and the sync
 * state tells the user honestly whether it has landed yet.
 */
export function useWorkspaceSync() {
    const { user, ready } = useTokenProvider();
    const [state, setState] = useState<SyncState<WorkspaceState>>(() => ({
        envelope: readCachedWorkspace(),
        status: "idle",
        conflicts: [],
        bootstrapping: true,
    }));

    const attemptRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const run = useCallback(async () => {
        if (typeof document !== "undefined" && document.hidden) return;
        setState((prev) => ({ ...prev, status: "syncing" }));
        try {
            const result = await syncWorkspace();
            attemptRef.current = 0;
            setState({
                envelope: result.envelope,
                status: result.status,
                conflicts: result.conflicts,
                bootstrapping: false,
            });
            trackSync(result.status, result.conflicts.length);
            // A conflict means another device changed something this device had
            // never seen. It is worth counting because it is the direct measure
            // of whether cross-device continuity actually works.
            if (result.conflicts.some((c) => c.outcome === "merged")) {
                trackMobile("WORKSPACE_CONFLICT_RESOLVED", { count: result.conflicts.length });
            }
        } catch {
            attemptRef.current += 1;
            const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attemptRef.current - 1));
            setState((prev) => ({ ...prev, status: "error", bootstrapping: false }));
            trackSync("error", 0);
            timerRef.current = setTimeout(run, delay);
        }
    }, []);

    useEffect(() => {
        if (!ready) return;
        if (!user) {
            setState((prev) => ({ ...prev, status: "idle", bootstrapping: false }));
            return;
        }
        void run();
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [ready, user, run]);

    // Re-sync when the tab comes back: this is the reconnect path, and it is also
    // what makes "switch from the desktop to the phone" feel immediate.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const onVisible = () => {
            if (document.visibilityState === "visible" && user) void run();
        };
        const onOnline = () => {
            if (user) void run();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", onOnline);
        return () => {
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("online", onOnline);
        };
    }, [user, run]);

    const update = useCallback((updater: (current: WorkspaceState) => WorkspaceState) => {
        const current = readCachedWorkspace();
        const next = updater(current.data);
        const envelope = stageWorkspace(next);
        setState((prev) => ({ ...prev, envelope, status: "syncing" }));
        window.setTimeout(() => void run(), 0);
    }, [run]);

    return { ...state, workspace: state.envelope.data, update, refresh: run, signedIn: Boolean(user) };
}

/** The preferences sync hook. Same loop, smaller payload. */
export function usePreferencesSync() {
    const { user, ready } = useTokenProvider();
    const [state, setState] = useState<SyncState<UserPreferences>>(() => ({
        envelope: readCachedPreferences(),
        status: "idle",
        conflicts: [],
        bootstrapping: true,
    }));

    const run = useCallback(async () => {
        if (!user) return;
        try {
            const result = await syncPreferences();
            trackSync(result.status, result.conflicts.length);
            setState({
                envelope: result.envelope,
                status: result.status,
                conflicts: result.conflicts,
                bootstrapping: false,
            });
        } catch {
            trackSync("error");
            setState((prev) => ({ ...prev, status: "offline", bootstrapping: false }));
        }
    }, [user]);

    useEffect(() => {
        if (ready) void run();
    }, [ready, run]);

    const update = useCallback(
        (updater: (current: UserPreferences) => UserPreferences) => {
            const current = readCachedPreferences();
            const envelope = stagePreferences(updater(current.data));
            setState((prev) => ({ ...prev, envelope }));
            window.setTimeout(() => void run(), 0);
        },
        [run],
    );

    return { ...state, preferences: state.envelope.data, update, refresh: run };
}

/**
 * Transport state. Deliberately small: online, offline, reconnecting. It does NOT
 * claim data is live — that is `describeFreshness`'s job, and conflating "the
 * socket is up" with "the numbers are current" is exactly the bug this phase
 * exists to prevent.
 */
export function useTransportState(): TransportState {
    const [transport, setTransport] = useState<TransportState>("online");

    useEffect(() => {
        if (typeof window === "undefined") return;
        const update = () => setTransport(navigator.onLine ? "online" : "offline");
        update();
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        return () => {
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
        };
    }, []);

    return transport;
}

/**
 * Derive a freshness descriptor from the newest datum a screen actually holds.
 * Screens call this instead of inventing a "LIVE" badge.
 */
export function useDataFreshness(input: {
    dataTimestamp: number | null;
    source: string;
    timeframe?: string;
    fromCache?: boolean;
}): FreshnessDescriptor {
    const transport = useTransportState();
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 5_000);
        return () => clearInterval(timer);
    }, []);

    return useMemo(
        () =>
            describeFreshness({
                dataTimestamp: input.dataTimestamp,
                now,
                transport,
                source: input.source,
                fromCache: input.fromCache,
                ...(input.timeframe
                    ? (() => {
                          const t = timeframeThresholds(input.timeframe as string);
                          return { liveThresholdMs: t.liveThresholdMs, staleThresholdMs: t.staleThresholdMs };
                      })()
                    : {}),
            }),
        [input.dataTimestamp, input.source, input.timeframe, input.fromCache, now, transport],
    );
}

/** Re-exported so screens import thresholds from one place. */
function timeframeThresholds(timeframe: string) {
    const unit = timeframe.startsWith("M") ? 60_000 : timeframe.startsWith("H") ? 3_600_000 : 86_400_000;
    const interval = Number(timeframe.replace(/[^\d]/g, "")) || 1;
    const period = unit * interval;
    return {
        liveThresholdMs: Math.max(30_000, period / 2),
        staleThresholdMs: Math.max(180_000, period * 2),
    };
}

export type { DataFreshness };
