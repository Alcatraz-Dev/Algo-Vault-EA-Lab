/**
 * Growth Engine — public eligibility decision engine (pure).
 *
 * Decides whether a customer-facing placement/ad is eligible for a
 * given visitor, applying: lifecycle windows, targeting rules,
 * premium behavior, frequency caps, and platform constraints.
 *
 * Never includes admin-only fields (revenue, credentials, internal
 * targeting config, eCPM, etc.).
 */

import {
    MonetizationPlacement,
    MonetizationAd,
    MonetizationSponsor,
    MonetizationSettings,
    TargetingRules,
} from "./types";
import {
    isPlacementLive,
    isAdLive,
    isPlacementTargeted,
    frequencyCapReached,
    resolveAdsForPlacement,
    PlacementContext,
} from "./placement";
import {
    PLACEMENT_TYPES,
    FrequencyCapType,
    PremiumAdMode,
} from "./constants";
import { isSafeDestUrl } from "./validation";

// ─── Public-safe payload types ─────────────────────────────────────────

export type PublicCreative = {
    title: string;
    body?: string;
    imageUrl?: string;
    ctaLabel?: string;
    advertiser?: string;
    disclosure?: string;
    destinationUrl: string;
    type: "NATIVE" | "BANNER" | "SPONSORED_CARD";
};

export type PublicFrequency = {
    allowed: boolean;
    remaining: number | null;
};

export type PublicPlacementItem = {
    placementKey: string;
    id: string;
    type: "native_ad" | "sponsored_card" | "banner" | "external_ad";
    provider: "CUSTOM" | "ADSENSE";
    creative: PublicCreative;
    frequency: PublicFrequency;
};

export type PublicAffiliateItem = {
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
    items: PublicPlacementItem[];
    affiliate?: PublicAffiliateItem;
    frequency: PublicFrequency;
    visitorKey: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────

const SAFE_KEYS = new Set([
    "eligible",
    "placementKey",
    "items",
    "affiliate",
    "frequency",
    "visitorKey",
]);

function assertOnlySafeKeys(obj: Record<string, unknown>, label: string): void {
    for (const k of Object.keys(obj)) {
        if (!SAFE_KEYS.has(k)) {
            throw new Error(`[eligibility] unsafe key leaked in ${label}: ${k}`);
        }
    }
}

function sanitizeCreative(ad: MonetizationAd): PublicCreative {
    return {
        title: ad.title,
        body: ad.body,
        imageUrl: ad.imageUrl,
        ctaLabel: ad.ctaLabel,
        advertiser: ad.advertiser,
        disclosure: ad.disclosure,
        destinationUrl: ad.targetUrl,
        type: ad.type,
    };
}

function sanitizeAffiliateOffer(offer: {
    id: string;
    name: string;
    provider?: string;
    category: string;
    description?: string;
    disclosure: string;
    url: string;
    imageUrl?: string;
}): PublicAffiliateItem {
    return {
        placementKey: offer.id,
        id: offer.id,
        name: offer.name,
        provider: offer.provider,
        category: offer.category,
        description: offer.description,
        disclosure: offer.disclosure,
        destinationUrl: offer.url,
        imageUrl: offer.imageUrl,
    };
}

// ─── Core decision functions ────────────────────────────────────────────

export function decidePlacementEligibility(args: {
    placement: MonetizationPlacement;
    ads: MonetizationAd[];
    settings: MonetizationSettings;
    ctx: PlacementContext;
    capCounts?: Partial<Record<FrequencyCapType, number>>;
    now?: number;
}): PublicPlacementItem[] {
    const { placement, ads, settings, ctx, capCounts, now = Date.now() } = args;

    // Lifecycle
    if (!isPlacementLive(placement, now)) return [];

    // Frequency cap (from existing capCounts passed in)
    if (frequencyCapReached(placement.frequencyCap, { ...ctx, capCounts })) return [];

    // Targeting + premium
    if (!isPlacementTargeted(placement, ctx, settings.premiumMode, settings.premiumReductionRatio))
        return [];

    // Resolve ads for this placement
    const matched = resolveAdsForPlacement(placement, ads, ctx, {
        premiumMode: settings.premiumMode,
        premiumRatio: settings.premiumReductionRatio ?? 0.5,
        now,
    });

    return matched.map((ad) => ({
        placementKey: placement.key,
        id: ad.id ?? "",
        type: ad.type === "SPONSORED_CARD" ? "sponsored_card" : ad.type === "BANNER" ? "banner" : "native_ad",
        provider: "CUSTOM" as const,
        creative: sanitizeCreative(ad),
        frequency: {
            allowed: !frequencyCapReached(placement.frequencyCap, { ...ctx, capCounts }),
            remaining: placement.frequencyCap?.limit
                ? Math.max(0, placement.frequencyCap.limit - (capCounts?.[placement.frequencyCap.type] ?? 0))
                : null,
        },
    }));
}

export function decideAffiliateEligibility(args: {
    placement: MonetizationPlacement | null;
    offers: { id: string; name: string; provider?: string; category: string; description?: string; disclosure: string; url: string; imageUrl?: string; active: boolean }[];
    settings: MonetizationSettings;
    ctx: PlacementContext;
    capCounts?: Partial<Record<FrequencyCapType, number>>;
    now?: number;
}): PublicAffiliateItem | null {
    const { placement, offers, settings, ctx, capCounts, now = Date.now() } = args;

    if (!placement) return null;
    if (!isPlacementLive(placement, now)) return null;
    if (frequencyCapReached(placement.frequencyCap, { ...ctx, capCounts })) return null;
    if (!isPlacementTargeted(placement, ctx, settings.premiumMode, settings.premiumReductionRatio))
        return null;

    const active = offers.find((o: any) => o.active && (o.status === "active" || !o.status));
    if (!active) return null;

    return sanitizeAffiliateOffer(active);
}

/**
 * Full eligibility resolution: combines placements + ads + optional affiliate offer.
 * Returns a public-safe EligiblePayload.
 */
export function resolveEligibility(args: {
    placement: MonetizationPlacement | null;
    ads: MonetizationAd[];
    settings: MonetizationSettings;
    ctx: PlacementContext;
    capCounts?: Partial<Record<FrequencyCapType, number>>;
    affiliateOffer?: { id: string; name: string; provider?: string; category: string; description?: string; disclosure: string; url: string; imageUrl?: string; active: boolean } | null;
    now?: number;
}): EligiblePayload {
    const { placement, ads, settings, ctx, capCounts, affiliateOffer, now = Date.now() } = args;
    const visitorKey = ctx.uid ?? ctx.salt ?? "anonymous";

    let items: PublicPlacementItem[] = [];
    if (placement) {
        items = decidePlacementEligibility({ placement, ads, settings, ctx, capCounts, now });
    }

    let affiliate: PublicAffiliateItem | undefined;
    if (affiliateOffer) {
        affiliate = decideAffiliateEligibility({ placement: placement ?? null, offers: [affiliateOffer], settings, ctx, capCounts, now }) ?? undefined;
    }

    const payload: EligiblePayload = {
        eligible: items.length > 0 || !!affiliate,
        placementKey: placement?.key ?? "",
        items,
        ...(affiliate ? { affiliate } : {}),
        frequency: {
            allowed: true,
            remaining: null,
        },
        visitorKey,
    };

    // Safety assert: no sensitive keys leaked
    assertOnlySafeKeys(payload as unknown as Record<string, unknown>, "EligiblePayload");

    return payload;
}
