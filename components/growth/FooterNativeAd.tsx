"use client";

import { useEligiblePlacement } from "@/components/growth/eligible";
import { NativeAdCard } from "@/components/growth/NativeAdCard";

export function FooterNativeAd() {
    const { data, loading, error } = useEligiblePlacement("FOOTER");

    // Self-hide: no eligible placement = nothing rendered
    if (loading || error || !data || !data.eligible || data.items.length === 0) return null;

    const item = data.items[0];
    return (
        <NativeAdCard
            title={item.creative.title}
            summary={item.creative.body || ""}
            url={item.creative.destinationUrl}
            placementKey={item.placementKey}
            content={item.creative.body}
        />
    );
}