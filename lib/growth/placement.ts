/**
 * Growth Engine — monetization placement resolution (pure).
 *
 * Decides *which* placements may render and *which* ads belong to a placement,
 * applying: active/lifecycle windows, targeting rules, premium reductions and
 * frequency caps. No I/O — callers pass the data.
 */
import { MonetizationAd, MonetizationPlacement, TargetingRules } from "./types";
import { FrequencyCap, PremiumAdMode } from "./constants";

export type PlacementContext = {
    uid?: string | null;
    isPremium?: boolean;
    country?: string;
    device?: string;
    loggedOut?: boolean;
    /** Count of impressions already shown to this session/period. */
    capCounts?: Partial<Record<FrequencyCap["type"], number>>;
    /** Deterministic draw salt (e.g. uid or session id) for REDUCED mode. */
    salt?: string;
};

export function isPlacementLive(placement: MonetizationPlacement, now = Date.now()): boolean {
    if (!placement.active) return false;
    if (placement.startAt && now < placement.startAt) return false;
    if (placement.endAt && now > placement.endAt) return false;
    return true;
}

export function isAdLive(ad: MonetizationAd, now = Date.now()): boolean {
    if (!ad.active) return false;
    if (ad.startAt && now < ad.startAt) return false;
    if (ad.endAt && now > ad.endAt) return false;
    return true;
}

function countryRule(rules: TargetingRules | undefined, country?: string): boolean {
    if (!country) return true; // no geo signal → cannot exclude
    if (rules?.countries?.length && !rules.countries.includes(country)) return false;
    if (rules?.excludeCountries?.includes(country)) return false;
    return true;
}

function deviceRule(rules: TargetingRules | undefined, device?: string): boolean {
    if (!device) return true;
    if (rules?.devices?.length && !rules.devices.includes(device)) return false;
    if (rules?.excludeDevices?.includes(device)) return false;
    return true;
}

/** Premium handling for a placement. */
function premiumRule(rules: TargetingRules | undefined, ctx: PlacementContext, globalMode: PremiumAdMode, globalRatio: number): boolean {
    const ic = ctx.isPremium !== true;
    const mode = rules?.premium?.mode ?? globalMode;
    if (ic) return true; // Not premium → rules don't apply
    if (mode === "SHOW") return true;
    if (mode === "HIDE") return false;
    // REDUCED: show ads to a fraction of premium sessions, deterministically.
    const ratio = rules?.premium?.reductionRatio ?? globalRatio ?? 0.5;
    const salt = ctx.salt || ctx.uid || "anonymous";
    let hash = 0;
    for (let i = 0; i < salt.length; i++) {
        hash = (hash * 31 + salt.charCodeAt(i)) | 0;
    }
    const draw = ((Math.abs(hash) % 1000) / 1000);
    return draw < ratio;
}

export function isPlacementTargeted(placement: MonetizationPlacement, ctx: PlacementContext, globalMode: PremiumAdMode = "SHOW", globalRatio = 0.5): boolean {
    const rules = placement.targetingRules;
    if (rules?.loggedOutOnly && !ctx.loggedOut) return false;
    if (!countryRule(rules, ctx.country)) return false;
    if (!deviceRule(rules, ctx.device)) return false;
    if (!premiumRule(rules, ctx, globalMode, globalRatio)) return false;
    return true;
}

export function frequencyCapReached(cap: FrequencyCap | undefined, ctx: PlacementContext): boolean {
    if (!cap?.limit) return false;
    const count = ctx.capCounts?.[cap.type] ?? 0;
    return count >= cap.limit;
}

/**
 * Candidates for a placement: live, targeted, cap-ok ads sorted by priority
 * and rotated around a deterministic counter so ads alternate.
 */
export function resolveAdsForPlacement(
    placement: MonetizationPlacement,
    ads: MonetizationAd[],
    ctx: PlacementContext,
    global: { premiumMode: PremiumAdMode; premiumRatio: number; now?: number }
): MonetizationAd[] {
    const now = global.now ?? Date.now();
    if (!isPlacementLive(placement, now)) return [];
    if (frequencyCapReached(placement.frequencyCap, ctx)) return [];
    if (!isPlacementTargeted(placement, ctx, global.premiumMode, global.premiumRatio)) return [];

    const matched = ads.filter((ad) => {
        if (!isAdLive(ad, now)) return false;
        const byId = Boolean(placement.id && ad.placementIds?.includes(placement.id));
        const byKey = ad.placementKey !== undefined && ad.placementKey === placement.key;
        return byId || byKey;
    });
    const targeted = matched
        .filter((ad) => countryRule(ad.targetingRules, ctx.country))
        .filter((ad) => deviceRule(ad.targetingRules, ctx.device));

    const max = Math.max(0, placement.maxAds ?? 1);
    const rotationSalt = ctx.salt || ctx.uid || "rotation";
    let rotation = 0;
    for (let i = 0; i < rotationSalt.length; i++) rotation = (rotation + rotationSalt.charCodeAt(i)) % 1000;

    const sorted = [...targeted].sort((a, b) => {
        const pa = a.priority ?? 100;
        const pb = b.priority ?? 100;
        if (pa !== pb) return pa - pb;
        const rotated = ((a.impressions ?? 0) + rotation) % 1000;
        const rotatedB = ((b.impressions ?? 0) + rotation) % 1000;
        return rotated - rotatedB;
    });
    return sorted.slice(0, max);
}

/**
 * Whether *any* placement should render for this context — used by the layout
 * layer to decide if a placement component mounts at all. Checks lifecycle,
 * targeting and caps only (ad availability is resolved at fetch time).
 */
export function shouldRender(placement: MonetizationPlacement | null | undefined, ctx: PlacementContext, global: { premiumMode: PremiumAdMode; premiumRatio: number; enabled: boolean; now?: number }): boolean {
    if (!global.enabled) return false;
    if (!placement) return false;
    const now = global.now ?? Date.now();
    if (!isPlacementLive(placement, now)) return false;
    if (frequencyCapReached(placement.frequencyCap, ctx)) return false;
    return isPlacementTargeted(placement, ctx, global.premiumMode, global.premiumRatio);
}