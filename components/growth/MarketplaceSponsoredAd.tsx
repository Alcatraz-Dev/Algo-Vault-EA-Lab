"use client";

import { useEligiblePlacement } from "@/components/growth/eligible";
import { SponsoredCard } from "@/components/growth/SponsoredCard";
import { PlacementType } from "@/lib/growth/constants";

export function MarketplaceSponsoredAd() {
    const { data, loading, error } = useEligiblePlacement("MARKETPLACE_SPONSORED");

    // Self-hide: no eligible placement = nothing rendered
    if (loading || error || !data || !data.eligible || data.items.length === 0) return null;

    const item = data.items[0];
    const creative = item.creative;
    return (
        <SponsoredCard
            title={creative.title}
            description={creative.body || ""}
            imageUrl={creative.imageUrl}
            targetUrl={creative.destinationUrl}
            advertiser={creative.advertiser}
            disclosure={creative.disclosure || "Sponsored"}
            placementKey={item.placementKey as PlacementType}
        />
    );
}