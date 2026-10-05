"use client";

/**
 * useAiDrawGate — Pro entitlement gate for the chart's AI Draw feature.
 *
 * `canUseAiDraw` (when a boolean) short-circuits the check for callers that
 * already know the user's plan. Otherwise the gate asks the server
 * (/api/pro-terminal/access) — the client never decides entitlements itself.
 */

import { useCallback, useState } from "react";
import { auth } from "@/lib/firebase";

export interface AiDrawGate {
    /** True while AI Draw is switched on. */
    enabled: boolean;
    /** True when the server said the current session lacks Pro. */
    locked: boolean;
    /** True while the entitlement check is in flight. */
    checking: boolean;
    /** Message to surface in the UI (sign-in / upgrade prompts). */
    error: string | null;
    toggle: () => Promise<void>;
}

export function useAiDrawGate(options: {
    token?: string | null;
    canUseAiDraw?: boolean;
}): AiDrawGate {
    const { token = null, canUseAiDraw } = options;
    const [enabled, setEnabled] = useState(false);
    const [locked, setLocked] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggle = useCallback(async () => {
        if (enabled) {
            setEnabled(false);
            return;
        }
        if (typeof canUseAiDraw === "boolean") {
            if (!canUseAiDraw) {
                setLocked(true);
                setError("AI Draw requires the Pro plan.");
                return;
            }
            setLocked(false);
            setError(null);
            setEnabled(true);
            return;
        }
        setChecking(true);
        try {
            const t = token ?? (await auth.currentUser?.getIdToken()) ?? null;
            if (!t) {
                setLocked(true);
                setError("Sign in with a Pro plan to unlock AI Draw on the chart.");
                return;
            }
            const res = await fetch("/api/pro-terminal/access", {
                headers: { Authorization: `Bearer ${t}` },
            });
            if (res.ok) {
                setLocked(false);
                setError(null);
                setEnabled(true);
            } else {
                setLocked(true);
                setError("AI Draw requires the Pro plan — upgrade to draw AI entry/SL/TP levels on the chart.");
            }
        } catch {
            setError("Could not verify Pro access — AI Draw stays off.");
        } finally {
            setChecking(false);
        }
    }, [enabled, canUseAiDraw, token]);

    return { enabled, locked, checking, error, toggle };
}
