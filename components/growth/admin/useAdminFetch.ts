"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "./session";

type State<T> = {
    data: T | null;
    loading: boolean;
    error: string | null;
};

/**
 * useAdminFetch — single source of truth for admin data loading:
 * loading → error (with retry) → success, plus manual refresh.
 * Supports JSON list or object payloads; errors stay human-readable.
 */
export function useAdminFetch<T>(path: string, deps: unknown[] = []) {
    const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
    const [nonce, setNonce] = useState(0);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        let cancelled = false;
        (async () => {
            setState((s) => ({ ...s, loading: true, error: null }));
            try {
                const data = await adminFetch<T>(path);
                if (!cancelled && mounted.current) {
                    setState({ data, loading: false, error: null });
                }
            } catch (err) {
                if (!cancelled && mounted.current) {
                    setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load data." });
                }
            }
        })();
        return () => {
            cancelled = true;
            mounted.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, nonce, ...deps]);

    const refresh = useCallback(() => setNonce((n) => n + 1), []);
    return { ...state, refresh };
}