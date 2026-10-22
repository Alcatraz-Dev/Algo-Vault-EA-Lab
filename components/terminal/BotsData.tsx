"use client";

/**
 * BotsData — the terminal's single bot source.
 *
 * Mounted ONCE by `TerminalShell` (never by the panel, which is rendered in two
 * responsive trees). It owns:
 *
 *   · the owner-scoped deployment list + server-computed summaries,
 *   · on-demand detail (positions / executions) for an expanded bot,
 *   · lifecycle mutations through the EXISTING authorized route.
 *
 * Polling is slow (30s) and only runs while the Bots panel is actually visible;
 * every mutation triggers an immediate refresh instead of a faster timer. Bot
 * state stays authoritative on the backend — this provider caches what the
 * server last said and never invents a state transition.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useAuthToken } from "@/lib/scalping/client";
import type {
    BotDeployment,
    BotDeploymentSummary,
    BotExecution,
    BotOpenPosition,
    BotStrategy,
} from "@/lib/bot-studio/types";
import { botActionTargetState, type BotActionId } from "@/lib/terminal/bots";

export const BOTS_REFRESH_MS = 30_000;

export interface BotDetail {
    deployment: BotDeployment;
    strategy: BotStrategy | null;
    executions: BotExecution[];
    positions: BotOpenPosition[];
}

export interface BotsActionResult {
    ok: boolean;
    error?: string;
}

export interface BotsDataValue {
    loading: boolean;
    error: string | null;
    /** The endpoints refused this session (Pro / Bot Studio entitlement). */
    accessDenied: boolean;
    deployments: BotDeployment[];
    summaries: Record<string, BotDeploymentSummary>;
    updatedAt: number | null;
    refresh: () => void;
    detailFor: (botId: string) => BotDetail | null;
    detailLoadingFor: string | null;
    loadDetail: (botId: string) => Promise<void>;
    /** Bot whose lifecycle action is currently in flight (blocks duplicates). */
    actingBotId: string | null;
    act: (botId: string, action: BotActionId) => Promise<BotsActionResult>;
    actionError: string | null;
    clearActionError: () => void;
}

const BotsDataContext = createContext<BotsDataValue | null>(null);

export function useBotsData(): BotsDataValue {
    const ctx = useContext(BotsDataContext);
    if (!ctx) throw new Error("useBotsData must be used inside <BotsDataProvider>");
    return ctx;
}

interface ListPayload {
    ok?: boolean;
    deployments?: BotDeployment[];
    summaries?: Record<string, BotDeploymentSummary>;
    error?: string;
}

interface DetailPayload {
    ok?: boolean;
    deployment?: BotDeployment;
    strategy?: BotStrategy | null;
    executions?: BotExecution[];
    positions?: BotOpenPosition[];
    error?: string;
}

export function BotsDataProvider({
    children,
    enabled,
}: {
    children: ReactNode;
    /** True when the Bots panel is on screen. Disabled = no polling at all. */
    enabled: boolean;
}) {
    const token = useAuthToken();

    const [deployments, setDeployments] = useState<BotDeployment[]>([]);
    const [summaries, setSummaries] = useState<Record<string, BotDeploymentSummary>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accessDenied, setAccessDenied] = useState(false);
    const [updatedAt, setUpdatedAt] = useState<number | null>(null);
    const [nonce, setNonce] = useState(0);

    const [details, setDetails] = useState<Record<string, BotDetail>>({});
    const [detailLoadingFor, setDetailLoadingFor] = useState<string | null>(null);
    const [actingBotId, setActingBotId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Guards against a click racing its own in-flight request: the ref is set
    // synchronously, so two rapid clicks on Start cannot both POST.
    const inFlight = useRef<string | null>(null);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const load = useCallback(
        async (opts: { silent?: boolean } = {}) => {
            if (!token || !enabled) return;
            if (!opts.silent) setLoading(true);
            try {
                const res = await fetch("/api/bot-studio/deployments", {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                if (res.status === 401 || res.status === 403) {
                    // Signed in but not entitled (or the session went away).
                    // Either way this session may not see bot data.
                    if (!alive.current) return;
                    setAccessDenied(true);
                    setDeployments([]);
                    setSummaries({});
                    setError(null);
                    return;
                }
                const body = (await res.json().catch(() => ({}))) as ListPayload;
                if (!res.ok || body.ok === false) {
                    throw new Error(body.error || `Failed to load bots (${res.status}).`);
                }
                if (!alive.current) return;
                setAccessDenied(false);
                setError(null);
                setDeployments(Array.isArray(body.deployments) ? body.deployments : []);
                setSummaries(body.summaries && typeof body.summaries === "object" ? body.summaries : {});
                setUpdatedAt(Date.now());
            } catch (err) {
                if (!alive.current) return;
                setError(err instanceof Error ? err.message : "Failed to load bots.");
            } finally {
                if (alive.current) setLoading(false);
            }
        },
        [token, enabled]
    );

    /* eslint-disable react-hooks/set-state-in-effect -- the bots list is an external system read; the fetch result has to land in state. */
    useEffect(() => {
        if (!token || !enabled) return;
        void load();
        const timer = setInterval(() => void load({ silent: true }), BOTS_REFRESH_MS);
        return () => clearInterval(timer);
    }, [token, enabled, load, nonce]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const refresh = useCallback(() => setNonce((n) => n + 1), []);

    const loadDetail = useCallback(
        async (botId: string) => {
            if (!token) return;
            setDetailLoadingFor(botId);
            try {
                const res = await fetch(`/api/bot-studio/deployments/${botId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                const body = (await res.json().catch(() => ({}))) as DetailPayload;
                if (!res.ok || body.ok === false || !body.deployment) {
                    throw new Error(body.error || "Failed to load bot detail.");
                }
                if (!alive.current) return;
                setDetails((prev) => ({
                    ...prev,
                    [botId]: {
                        deployment: body.deployment!,
                        strategy: body.strategy ?? null,
                        executions: Array.isArray(body.executions) ? body.executions : [],
                        positions: Array.isArray(body.positions) ? body.positions : [],
                    },
                }));
                setError(null);
            } catch (err) {
                if (!alive.current) return;
                setActionError(err instanceof Error ? err.message : "Failed to load bot detail.");
            } finally {
                if (alive.current) setDetailLoadingFor(null);
            }
        },
        [token]
    );

    /**
     * Runs one lifecycle intent through the existing authorized endpoint.
     *
     * A rejected or failed request is surfaced verbatim: the bot's state stays
     * whatever the server last reported, and no optimistic transition is
     * applied — the UI must never claim a bot started when it did not.
     */
    const act = useCallback(
        async (botId: string, action: BotActionId): Promise<BotsActionResult> => {
            if (!token) return { ok: false, error: "Not signed in." };
            if (inFlight.current) {
                return { ok: false, error: "A bot action is already in progress." };
            }
            inFlight.current = botId;
            setActingBotId(botId);
            setActionError(null);
            try {
                const res = await fetch(`/api/bot-studio/deployments/${botId}/lifecycle`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ targetState: botActionTargetState(action) }),
                });
                const body = (await res.json().catch(() => ({}))) as {
                    ok?: boolean;
                    error?: string;
                    deployment?: BotDeployment;
                };
                if (!res.ok || body.ok === false) {
                    const message =
                        body.error ||
                        (res.status === 403
                            ? "This action is not permitted for your account."
                            : `Bot action failed (${res.status}).`);
                    if (alive.current) setActionError(message);
                    return { ok: false, error: message };
                }
                if (alive.current && body.deployment) {
                    // Apply the SERVER's post-transition record, then refresh so
                    // counters/summaries catch up.
                    const updated = body.deployment;
                    setDeployments((prev) =>
                        prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d))
                    );
                    setDetails((prev) => {
                        const existing = prev[botId];
                        if (!existing) return prev;
                        return { ...prev, [botId]: { ...existing, deployment: { ...existing.deployment, ...updated } } };
                    });
                }
                await load({ silent: true });
                if (details[botId]) await loadDetail(botId);
                return { ok: true };
            } catch (err) {
                const message = err instanceof Error ? err.message : "Bot action failed.";
                if (alive.current) setActionError(message);
                return { ok: false, error: message };
            } finally {
                inFlight.current = null;
                if (alive.current) setActingBotId(null);
            }
        },
        [token, load, loadDetail, details]
    );

    const detailFor = useCallback((botId: string) => details[botId] ?? null, [details]);
    const clearActionError = useCallback(() => setActionError(null), []);

    const value = useMemo<BotsDataValue>(
        () => ({
            loading,
            error,
            accessDenied,
            deployments,
            summaries,
            updatedAt,
            refresh,
            detailFor,
            detailLoadingFor,
            loadDetail,
            actingBotId,
            act,
            actionError,
            clearActionError,
        }),
        [
            loading,
            error,
            accessDenied,
            deployments,
            summaries,
            updatedAt,
            refresh,
            detailFor,
            detailLoadingFor,
            loadDetail,
            actingBotId,
            act,
            actionError,
            clearActionError,
        ]
    );

    return <BotsDataContext.Provider value={value}>{children}</BotsDataContext.Provider>;
}
