"use client";

/**
 * AlgoVault — Portfolio Intelligence client (Phase 15).
 *
 * One typed fetch helper for every portfolio surface, so the Command Center,
 * the Pro Terminal panel, the chat and mobile all read the SAME endpoints and
 * therefore the SAME numbers.
 *
 * Rules encoded here:
 *   • every response carries freshness; the hook surfaces it so the UI can show
 *     "updated Ns ago" and render STALE_DATA instead of pretending to be live;
 *   • a Pro-gated endpoint returns 403 and the hook exposes `proRequired` so the
 *     UI can render an upgrade prompt rather than a broken panel;
 *   • no client-side computation of equity, PnL, exposure or risk. Ever.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";

export interface PortfolioFreshness {
    dataTimestamp: number;
    calculatedAt: number;
    dataAgeMs: number;
    freshness: "FRESH" | "STALE" | "UNAVAILABLE";
    sources?: Array<{ source: string; ageMs: number }>;
    reason?: string;
}

export interface PortfolioEnvelope<T> {
    ok: boolean;
    portfolioId?: string;
    data?: T;
    error?: string;
    message?: string;
    freshness?: PortfolioFreshness;
    limitations?: string[];
    entitlements?: { plan: string; denied: string[] };
}

export interface PortfolioSnapshotPayload {
    portfolioId: string;
    timestamp: number;
    equity: number;
    balance: number;
    unrealizedPnL: number;
    realizedPnL: number;
    grossExposure: number;
    netExposure: number;
    marginUsed: number;
    freeMargin: number;
    leverage: number;
    drawdown: number;
    dailyLoss: number;
    positionCount: number;
    strategyCount: number;
    assetCount: number;
    concentrationScore: number;
    correlationRiskScore: number;
    portfolioRiskScore: number;
    regime: string;
    riskBudgetUsage: Array<{
        budgetId: string;
        scope: string;
        scopeKey: string;
        kind: string;
        limitPercent: number;
        usedPercent: number;
        utilization: number;
        status: "OK" | "WATCH" | "BREACHED" | "UNKNOWN";
        note?: string;
    }>;
    health: PortfolioHealthPayload;
    exposure: {
        grossExposure: number;
        netExposure: number;
        grossToEquity: number | null;
        netToEquity: number | null;
        bySymbol: PortfolioSlice[];
        byAssetClass: PortfolioSlice[];
        byCurrency: PortfolioSlice[];
        byStrategy: PortfolioSlice[];
        byAccount: PortfolioSlice[];
        byDirection: PortfolioSlice[];
        supportedAssetClasses: string[];
        unsupportedAssetClasses: string[];
    };
    concentration: PortfolioConcentrationPayload;
    correlation: {
        clusterSize: number;
        clusteredExposureWeight: number;
        meanCorrelation: number;
        severity: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
        clusters: Array<{ symbols: string[]; meanCorrelation: number; exposureWeight: number }>;
        shiftingPairs: Array<{ pair: string; from: number; to: number; delta: number }>;
        evidence: Array<{ kind: string; text: string }>;
        limitations: string[];
    };
    correlationMatrix: {
        symbols: string[];
        timeframe: string;
        window: number;
        method: string;
        matrix: Array<Array<number | null>>;
        pairs: Array<{ a: string; b: string; coefficient: number | null; status: string; observations: number }>;
    } | null;
    regimeState: {
        regime: string;
        confidence: number;
        evidence: Array<{ metric: string; observed: number; threshold: number }>;
        notSupported: string[];
    };
    risk: {
        openRisk: number | null;
        openRiskPercent: number | null;
        drawdown: number | null;
        drawdownPercent: number | null;
        dailyLoss: number | null;
        dailyLossPercent: number | null;
        marginUsed: number | null;
        freeMargin: number | null;
        marginLevelPercent: number | null;
        warnings: PortfolioWarningPayload[];
        limitations: string[];
    };
    accounts: Array<{
        accountId: string;
        kind: string;
        currency: string;
        balance: number;
        equity: number;
        marginUsed: number;
        connected: boolean;
        dataTimestamp: number;
    }>;
    positions: Array<{
        positionId: string;
        accountId: string;
        symbol: string;
        side: "LONG" | "SHORT";
        quantity: number;
        entryPrice: number;
        currentPrice: number;
        stopLoss: number | null;
        unrealizedPnL: number;
        notional: number;
        assetClass: string;
        strategyId: string;
        riskAmount: number | null;
        openedAt: number;
    }>;
    limitations: string[];
    baseCurrency: string;
    freshness: PortfolioFreshness;
}

export interface PortfolioSlice {
    key: string;
    label: string;
    grossWeight: number;
    signedWeight: number | null;
    grossNotional: number;
    signedNotional: number;
    positionCount: number;
    status: "AVAILABLE" | "UNAVAILABLE";
    reason?: string;
}

export interface PortfolioConcentrationPayload {
    concentrationScore: number;
    severity: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
    maxAxis: string | null;
    axes: Array<{
        axis: string;
        hhi: number;
        effectiveCount: number;
        topShare: number;
        topThreeShare: number;
        maxEntry: { key: string; weight: number } | null;
        status: string;
        entries?: Array<{ key: string; weight: number; notional: number }>;
        reason?: string;
    }>;
    limitations: string[];
}

export interface PortfolioHealthPayload {
    overall: string;
    components: Array<{ component: string; rating: string; score: number; reasons: string[] }>;
    worstComponents: string[];
    unavailableComponents: string[];
}

export interface PortfolioWarningPayload {
    code: string;
    severity: "INFO" | "WATCH" | "WARNING" | "CRITICAL";
    message: string;
    detail?: string;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<PortfolioEnvelope<T>> {
    const user = auth.currentUser;
    if (!user) return { ok: false, error: "UNAUTHENTICATED", message: "Sign in to load portfolio intelligence." };
    const token = await user.getIdToken();
    const res = await fetch(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({ ok: false, error: "BAD_RESPONSE" }))) as PortfolioEnvelope<T>;
    if (!res.ok && !body.error) body.error = `HTTP_${res.status}`;
    return body;
}

export interface UsePortfolioOptions {
    portfolioId?: string;
    /** Poll interval. 0 disables polling entirely (the default). */
    refreshMs?: number;
    enabled?: boolean;
}

export interface PortfolioQuery<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    message: string | null;
    proRequired: boolean;
    freshness: PortfolioFreshness | null;
    limitations: string[];
    reload: () => void;
}

/** GET helper with freshness, Pro-gating and abort handling. */
export function usePortfolioQuery<T>(path: string | null, options: UsePortfolioOptions = {}): PortfolioQuery<T> {
    const { refreshMs = 0, enabled = true } = options;
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [proRequired, setProRequired] = useState(false);
    const [freshness, setFreshness] = useState<PortfolioFreshness | null>(null);
    const [limitations, setLimitations] = useState<string[]>([]);
    const [nonce, setNonce] = useState(0);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const url = path
        ? options.portfolioId
            ? `${path}${path.includes("?") ? "&" : "?"}portfolioId=${encodeURIComponent(options.portfolioId)}`
            : path
        : null;

    useEffect(() => {
        if (!url || !enabled) return;
        let cancelled = false;

        const run = async () => {
            setLoading(true);
            try {
                const res = await authedFetch<T>(url);
                if (cancelled || !alive.current) return;
                if (res.ok && res.data !== undefined) {
                    setData(res.data);
                    setError(null);
                    setMessage(null);
                    setProRequired(false);
                } else {
                    setData(null);
                    setError(res.error ?? "PORTFOLIO_UNAVAILABLE");
                    setMessage(res.message ?? null);
                    setProRequired(res.error === "PRO_REQUIRED");
                }
                setFreshness(res.freshness ?? null);
                setLimitations(res.limitations ?? []);
            } catch (e) {
                if (cancelled || !alive.current) return;
                setData(null);
                setError("PORTFOLIO_INTELLIGENCE_UNAVAILABLE");
                setMessage(e instanceof Error ? e.message : "Portfolio intelligence unavailable.");
            } finally {
                if (!cancelled && alive.current) setLoading(false);
            }
        };

        void run();
        if (refreshMs > 0) {
            const timer = setInterval(() => void run(), refreshMs);
            return () => {
                cancelled = true;
                clearInterval(timer);
            };
        }
        return () => {
            cancelled = true;
        };
    }, [url, refreshMs, enabled, nonce]);

    const reload = useCallback(() => setNonce((n) => n + 1), []);

    return { data, loading, error, message, proRequired, freshness, limitations, reload };
}

/** POST helper for analyze / stress / allocation endpoints. */
export function usePortfolioAction<TBody, TRes>(path: string) {
    const [data, setData] = useState<TRes | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const run = useCallback(
        async (body?: TBody) => {
            setLoading(true);
            try {
                const res = await authedFetch<TRes>(path, {
                    method: "POST",
                    body: JSON.stringify(body ?? {}),
                });
                if (res.ok && res.data !== undefined) {
                    setData(res.data);
                    setError(null);
                    setMessage(null);
                } else {
                    setData(null);
                    setError(res.error ?? "ACTION_FAILED");
                    setMessage(res.message ?? null);
                }
                return res;
            } catch (e) {
                setError("PORTFOLIO_INTELLIGENCE_UNAVAILABLE");
                setMessage(e instanceof Error ? e.message : "Portfolio intelligence unavailable.");
                return { ok: false } as PortfolioEnvelope<TRes>;
            } finally {
                setLoading(false);
            }
        },
        [path]
    );

    return { data, loading, error, message, run };
}

/* ── Formatting helpers shared by every portfolio surface ─────────────────── */

export function fmtMoney(value: number | null | undefined, currency = "USD", digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "unavailable";
    const sign = value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    })} ${currency}`;
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "unavailable";
    return `${(value * 100).toFixed(digits)}%`;
}

export function fmtAge(freshness: PortfolioFreshness | null): string {
    if (!freshness) return "unknown";
    if (freshness.freshness === "UNAVAILABLE") return "unavailable";
    const seconds = Math.max(0, Math.round(freshness.dataAgeMs / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
}
