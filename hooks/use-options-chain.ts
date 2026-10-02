"use client";

/**
 * useOptionsChain — polled options-chain state for the GEX layer.
 *
 * Fetches /api/order-flow/options for the active symbol on a bounded timer.
 * Symbols without a wired options source (forex/metals) are known client-side
 * (`GEX_SUPPORTED_SYMBOLS` mirrors the route) and are never requested — the
 * hook reports them as `supported: false` with no network traffic.
 *
 * State discipline: the fetch effect never calls setState directly (only the
 * async loader does); symbol switches are resolved by storing the loaded
 * symbol in state and deriving the view, so a stale chain can never be shown
 * for a different symbol. Results are plain data; the hook never derives
 * market state from Date.now() — only the fetch cadence uses the clock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OptionQuote, FeatureAvailability, OrderFlowFeatureId } from "@/lib/order-flow/types";
import { GEX_SUPPORTED_SYMBOLS } from "@/lib/order-flow/options-types";

export interface OptionsChainState {
    /** Symbol the currently-stored chain was fetched for (null = nothing yet). */
    symbol: string | null;
    /** True when a source is wired for this symbol (fetch may still fail). */
    available: boolean;
    loading: boolean;
    quotes: OptionQuote[];
    source: string | null;
    spot: number | null;
    /** Contract multiplier for the GEX calculator (crypto = 1, else 100). */
    contractMultiplier: number;
    error: string | null;
    fetchedAt: number | null;
    featureAvailability: Partial<Record<OrderFlowFeatureId, FeatureAvailability>> | null;
}

const EMPTY: OptionsChainState = {
    symbol: null,
    available: false,
    loading: false,
    quotes: [],
    source: null,
    spot: null,
    contractMultiplier: 100,
    error: null,
    fetchedAt: null,
    featureAvailability: null,
};

export function useOptionsChain(symbol: string, token: string | null, options?: { pollMs?: number }) {
    const pollMs = Math.max(15_000, options?.pollMs ?? 120_000);
    const symbolKey = symbol.toUpperCase();
    const supported = GEX_SUPPORTED_SYMBOLS.has(symbolKey);

    const [state, setState] = useState<OptionsChainState>(EMPTY);
    const inflight = useRef(false);

    const load = useCallback(async () => {
        if (!token || inflight.current) return;
        inflight.current = true;
        try {
            const res = await fetch(`/api/order-flow/options?symbol=${encodeURIComponent(symbolKey)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (await res.json()) as {
                available?: boolean;
                source?: string | null;
                spot?: number | null;
                quoteCount?: number;
                contractMultiplier?: number;
                error?: string | null;
                fetchedAt?: number;
                quotes?: OptionQuote[];
                featureAvailability?: OptionsChainState["featureAvailability"];
            };
            setState({
                symbol: symbolKey,
                available: data.available === true && (data.quoteCount ?? 0) > 0,
                loading: false,
                quotes: Array.isArray(data.quotes) ? data.quotes : [],
                source: data.source ?? null,
                spot: data.spot ?? null,
                contractMultiplier: typeof data.contractMultiplier === "number" ? data.contractMultiplier : 100,
                error: data.error ?? null,
                fetchedAt: typeof data.fetchedAt === "number" ? data.fetchedAt : null,
                featureAvailability: data.featureAvailability ?? null,
            });
        } catch {
            setState({ ...EMPTY, symbol: symbolKey, error: "options-fetch-failed" });
        } finally {
            inflight.current = false;
        }
    }, [token, symbolKey]);

    useEffect(() => {
        if (!supported) return;
        // load() is async — its setState runs in a promise continuation after
        // the await, never synchronously within this effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
        const timer = setInterval(() => void load(), pollMs);
        return () => clearInterval(timer);
    }, [supported, load, pollMs]);

    // Derived view — symbol switches and unsupported symbols resolve here,
    // never via setState inside the effect.
    return useMemo(() => {
        if (!supported) return { ...EMPTY, error: "no-options-source", supported: false };
        if (state.symbol !== symbolKey) return { ...EMPTY, loading: true, supported: true };
        return { ...state, supported: true };
    }, [supported, state, symbolKey]);
}
