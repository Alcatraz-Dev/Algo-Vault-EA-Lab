"use client";

import { useEffect, useState, useCallback } from "react";
import { auth } from "@/lib/firebase";

export type EligibleAdItem = {
    placementKey: string;
    id: string;
    type: "native_ad" | "sponsored_card" | "banner";
    provider: "CUSTOM";
    creative: {
        title: string;
        body?: string;
        imageUrl?: string;
        ctaLabel?: string;
        advertiser?: string;
        disclosure?: string;
        destinationUrl: string;
        type: "NATIVE" | "BANNER" | "SPONSORED_CARD";
    };
    frequency: { allowed: boolean; remaining: number | null };
};

export type EligibleAffiliateItem = {
    placementKey: string;
    id: string;
    name: string;
    provider?: string;
    category: string;
    description?: string;
    disclosure: string;
    destinationUrl: string;
    imageUrl?: string;
};

export type EligiblePayload = {
    eligible: boolean;
    placementKey: string;
    items: EligibleAdItem[];
    affiliate?: EligibleAffiliateItem;
    frequency: { allowed: boolean; remaining: number | null };
    visitorKey: string;
};

type State = {
    data: EligiblePayload | null;
    loading: boolean;
    error: string | null;
};

/**
 * Fetches the public eligibility payload for a placement key.
 * Attaches a Firebase ID token only when a user is signed in — anonymous
 * visitors (no token) still get eligibility based on their sid cookie.
 */
export async function fetchEligible(placementKey: string): Promise<EligiblePayload> {
    const params = new URLSearchParams({ placement: placementKey });
    const headers: Record<string, string> = {};

    try {
        const user = auth.currentUser;
        if (user) {
            const token = await user.getIdToken(/* forceRefresh */ true);
            headers.Authorization = `Bearer ${token}`;
        }
    } catch {
        // Token refresh may fail if the user signed out mid-flight — fall back to anonymous
    }

    const res = await fetch(`/api/monetization/eligible?${params}`, {
        headers,
        credentials: "include", // send/receive av_sid cookie
        cache: "no-store",
    });

    if (!res.ok) {
        // Non-500 errors mean "not eligible" (or anonymous blocked) — not a crash
        if (res.status === 405) throw new Error("Method not allowed");
        if (res.status >= 500) throw new Error("Server error");
        // 401/403/404/etc → simply not eligible for this visitor
        return { eligible: false, placementKey, items: [], frequency: { allowed: false, remaining: null }, visitorKey: "" };
    }

    return (await res.json()) as EligiblePayload;
}

/**
 * useEligiblePlacement — a self-hiding hook: returns null data when there is
 * no eligible item so callers render nothing (no skeleton, no placeholder).
 */
export function useEligiblePlacement(placementKey: string): {
    data: EligiblePayload | null;
    loading: boolean;
    error: string | null;
    refresh: () => void;
} {
    const [state, setState] = useState<State>({ data: null, loading: true, error: null });

    const load = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null, data: null }));
        try {
            const payload = await fetchEligible(placementKey);
            setState({ data: payload, loading: false, error: null });
        } catch (err) {
            // Any fetch error → self-hide (ads never block core product)
            setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Unknown error" });
        }
    }, [placementKey]);

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [placementKey]);

    return {
        data: state.data,
        loading: state.loading,
        error: state.error,
        refresh: load,
    };
}

/**
 * Reports a rendered impression to the server (for analytics + counters).
 * Idempotent — the clientEventId from the eligibility response is supplied by
 * the server at serve-time, so it cannot be forged/repeated maliciously.
 */
export async function reportImpression(input: {
    placementKey: string;
    clientEventId: string;
    adId?: string;
}): Promise<void> {
    try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const user = auth.currentUser;
        if (user) {
            const token = await user.getIdToken(true);
            headers.Authorization = `Bearer ${token}`;
        }

        await fetch("/api/monetization/impression", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({
                placementKey: input.placementKey,
                clientEventId: input.clientEventId,
                ...(input.adId ? { campaignId: input.adId } : {}),
            }),
        });
    } catch {
        // Impressions are best-effort; never block the page on analytics
    }
}

/**
 * Builds a click-tracking redirect URL for the server to record the click
 * before redirecting to the destination.
 */
export function buildClickUrl(params: {
    destinationUrl: string;
    placementKey: string;
    offerId?: string;
    campaignId?: string;
    clientEventId: string;
}): string {
    const url = new URL("/api/monetization/click", window.location.origin);
    url.searchParams.set("url", params.destinationUrl);
    url.searchParams.set("placementKey", params.placementKey);
    if (params.offerId) url.searchParams.set("offerId", params.offerId);
    if (params.campaignId) url.searchParams.set("campaignId", params.campaignId);
    url.searchParams.set("clientEventId", params.clientEventId);
    return url.toString();
}
