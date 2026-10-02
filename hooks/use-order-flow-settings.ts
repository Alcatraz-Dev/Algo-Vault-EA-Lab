"use client";

/**
 * useOrderFlowSettings — user-configurable order-flow parameters.
 *
 * Resolution order (fast → authoritative):
 *   1. localStorage cache (instant first paint),
 *   2. GET /api/order-flow/settings → Firebase Realtime DB
 *      (`users/{uid}/orderFlowSettings`) once authenticated,
 *   3. PUT persists changes (debounced) and refreshes the cache.
 *
 * Malformed stored values are sanitized at every layer, so a corrupted cache
 * or DB record degrades to defaults instead of breaking the chart.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_ORDER_FLOW_SETTINGS, mergeOrderFlowSettings, sanitizeOrderFlowSettings, type OrderFlowSettings } from "@/lib/order-flow/settings";
import { useAuthToken } from "@/lib/scalping/client";

const LS_KEY = "algovault.orderFlowSettings.v1";

function readLocal(): OrderFlowSettings {
    if (typeof window === "undefined") return { ...DEFAULT_ORDER_FLOW_SETTINGS };
    try {
        const raw = window.localStorage.getItem(LS_KEY);
        if (!raw) return { ...DEFAULT_ORDER_FLOW_SETTINGS };
        return mergeOrderFlowSettings(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_ORDER_FLOW_SETTINGS };
    }
}

function writeLocal(s: OrderFlowSettings): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch {
        // storage unavailable (private mode) — session-only settings
    }
}

export function useOrderFlowSettings(): {
    settings: OrderFlowSettings;
    update: (patch: Partial<OrderFlowSettings>) => void;
    reset: () => void;
    synced: boolean;
} {
    const token = useAuthToken();
    const [settings, setSettings] = useState<OrderFlowSettings>(() => readLocal());
    const [synced, setSynced] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Hydrate from the server once authenticated (authoritative over cache).
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        fetch("/api/order-flow/settings", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { settings?: Partial<OrderFlowSettings> } | null) => {
                if (cancelled || !body?.settings) return;
                const merged = sanitizeOrderFlowSettings(body.settings);
                setSettings(merged);
                writeLocal(merged);
                setSynced(true);
            })
            .catch(() => {
                // server unavailable — the localStorage cache keeps working
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const update = useCallback(
        (patch: Partial<OrderFlowSettings>) => {
            setSettings((prev) => {
                const next = sanitizeOrderFlowSettings({ ...prev, ...patch });
                writeLocal(next);
                if (token) {
                    if (saveTimer.current) clearTimeout(saveTimer.current);
                    saveTimer.current = setTimeout(() => {
                        void fetch("/api/order-flow/settings", {
                            method: "PUT",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ settings: next }),
                        }).catch(() => {
                            // persistence failure is non-fatal; cache already updated
                        });
                    }, 600);
                }
                return next;
            });
        },
        [token],
    );

    const reset = useCallback(() => {
        setSettings({ ...DEFAULT_ORDER_FLOW_SETTINGS });
        writeLocal({ ...DEFAULT_ORDER_FLOW_SETTINGS });
        if (token) {
            void fetch("/api/order-flow/settings", {
                method: "PUT",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ settings: DEFAULT_ORDER_FLOW_SETTINGS }),
            }).catch(() => {});
        }
    }, [token]);

    return { settings, update, reset, synced };
}
