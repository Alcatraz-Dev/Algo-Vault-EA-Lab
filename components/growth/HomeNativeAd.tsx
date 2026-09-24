"use client";

import { useEligiblePlacement } from "@/components/growth/eligible";
import { NativeAdCard } from "@/components/growth/NativeAdCard";
import { PlacementType } from "@/lib/growth/constants";

export function HomeNativeAd() {
    const { data, loading, error } = useEligiblePlacement("HOME_NATIVE");

    // Self-hide: no eligible placement = nothing rendered (no skeleton, no placeholder)
    if (loading || error || !data || !data.eligible || data.items.length === 0) return null;

    const item = data.items[0];
    return (
        <NativeAdCard
            title={item.creative.title}
            summary={item.creative.body || ""}
            url={item.creative.destinationUrl}
            placementKey={item.placementKey as PlacementType}
            content={item.creative.body}
        />
    );
}
