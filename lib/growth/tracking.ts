/**
 * Growth Engine — server-side tracking (impressions, clicks, conversions,
 * revenue). All writes are idempotent (clientEventId) and every mutable
 * counter is server-authoritative.
 */
import { GROWTH_COLLECTIONS } from "./constants";
import { adminDatabase, incrementCounter, writeEventIdempotent, writeGrowthAudit, genId } from "./database";
import { AffiliateOffer, GrowthEvent, RevenueEntry } from "./types";
import { PlacementType } from "./constants";

export type RecordImpressionInput = {
    placementKey?: string;
    offerId?: string;
    campaignId?: string;
    channel?: string;
    uid?: string | null;
    clientEventId?: string;
    device?: string;
    country?: string;
    sessionId?: string;
};

/**
 * Records an ad/placement impression. An impression is only counted once per
 * clientEventId, and counters on the placement/ad are incremented atomically.
 */
export async function recordImpression(input: RecordImpressionInput): Promise<{ counted: boolean }> {
    const now = Date.now();
    const event: GrowthEvent = {
        type: "impression",
        placementKey: input.placementKey as never,
        offerId: input.offerId,
        campaignId: input.campaignId,
        channel: input.channel as never,
        uid: input.uid ?? null,
        anonymous: !input.uid,
        clientEventId: input.clientEventId,
        device: input.device,
        country: input.country,
        sessionId: input.sessionId,
        createdAt: now,
    };
    const outcome = await writeEventIdempotent(input.clientEventId, GROWTH_COLLECTIONS.events, event as unknown as Record<string, unknown>);
    if (!outcome.written || !outcome.id) return { counted: false };

    if (input.placementKey) {
        await incrementCounter(`${GROWTH_COLLECTIONS.placements}/${input.placementKey}/impressions`);
    }
    if (input.offerId) {
        await incrementCounter(`${GROWTH_COLLECTIONS.affiliateOffers}/${input.offerId}/impressions`);
    }
    return { counted: true };
}

export type RecordClickInput = {
    placementKey?: string;
    offerId?: string;
    campaignId?: string;
    uid?: string | null;
    clientEventId?: string;
    device?: string;
    country?: string;
    sessionId?: string;
    referer?: string;
    source?: string;
    medium?: string;
    content?: string;
    targetUrl: string;
};

/**
 * Records a placement click and returns the destination URL. Idempotent per
 * clientEventId. The caller (API route) performs the redirect.
 */
export async function recordClick(input: RecordClickInput): Promise<{ counted: boolean; targetUrl: string; clickId: string }> {
    const clickId = genId("av_clk");
    const now = Date.now();
    const event: GrowthEvent = {
        type: "click",
        placementKey: input.placementKey as never,
        offerId: input.offerId,
        campaignId: input.campaignId,
        uid: input.uid ?? null,
        anonymous: !input.uid,
        clientEventId: input.clientEventId,
        device: input.device,
        country: input.country,
        sessionId: input.sessionId,
        createdAt: now,
    };
    const outcome = await writeEventIdempotent(input.clientEventId, GROWTH_COLLECTIONS.events, event as unknown as Record<string, unknown>);
    if (outcome.written) {
        if (input.placementKey) await incrementCounter(`${GROWTH_COLLECTIONS.placements}/${input.placementKey}/clicks`);
        if (input.offerId) await incrementCounter(`${GROWTH_COLLECTIONS.affiliateOffers}/${input.offerId}/clicks`);
    }
    return { counted: outcome.written, targetUrl: input.targetUrl, clickId };
}

/**
 * Records an affiliate conversion (e.g. signup or commission confirmed by the
 * partner). Optionally writes affiliateRevenue for commission conversions.
 * Gated server-side — callers must verify the offer exists and is active.
 */
export async function recordAffiliateConversion(input: {
    offerId: string;
    type: "SIGNUP" | "CONVERSION" | "COMMISSION";
    clickId?: string;
    uid?: string | null;
    amount?: number;
    currency?: string;
    commission?: number;
    orderId?: string;
    campaignId?: string;
    source?: string;
    recordedBy?: string;
}): Promise<{ id: string }> {
    const now = Date.now();
    const ref = adminDatabase.ref(GROWTH_COLLECTIONS.affiliateConversions).push();
    const id = ref.key as string;
    const record = {
        id,
        offerId: input.offerId,
        clickId: input.clickId,
        uid: input.uid ?? null,
        type: input.type,
        amount: input.amount ?? 0,
        currency: input.currency ?? "USD",
        commission: input.commission ?? 0,
        orderId: input.orderId,
        campaignId: input.campaignId,
        source: input.source ?? "manual",
        createdAt: now,
        updatedAt: now,
        createdBy: input.recordedBy ?? "system",
        status: "RECORDED",
    };
    await ref.set(record);
    await incrementCounter(`${GROWTH_COLLECTIONS.affiliateOffers}/${input.offerId}/conversions`);

    // Commission-bearing conversions produce affiliate revenue.
    if (input.type === "COMMISSION" && (input.commission ?? 0) > 0) {
        await recordRevenue({
            type: "AFFILIATE",
            amount: input.commission as number,
            currency: input.currency ?? "USD",
            sourceId: id,
            offerId: input.offerId,
            campaignId: input.campaignId,
            recordedBy: input.recordedBy ?? "system",
            metadata: { conversionId: id, clickId: input.clickId, orderId: input.orderId },
        });
    }

    await writeGrowthAudit({
        actor: input.recordedBy ?? "system",
        action: "affiliate_conversion_recorded",
        targetType: "affiliateConversion",
        targetId: id,
        detail: { offerId: input.offerId, type: input.type, amount: input.amount, commission: input.commission },
    });
    return { id };
}

/**
 * Records a revenue entry (ad/sponsored/affiliate). Real amounts only —
 * `estimated` marks config-derived figures so they are never presented as
 * settled revenue.
 */
export async function recordRevenue(input: {
    type: RevenueEntry["type"];
    amount: number;
    currency?: string;
    sourceId?: string;
    placementKey?: string;
    offerId?: string;
    campaignId?: string;
    estimated?: boolean;
    recordedBy?: string;
    metadata?: Record<string, unknown>;
}): Promise<{ id: string }> {
    if (!Number.isFinite(input.amount) || input.amount < 0) {
        throw new Error("Revenue amount must be a non-negative number.");
    }
    const now = Date.now();
    const ref = adminDatabase.ref(GROWTH_COLLECTIONS.revenue).push();
    const id = ref.key as string;
    const record: RevenueEntry = {
        id,
        type: input.type,
        amount: input.amount,
        currency: input.currency ?? "USD",
        recordedAt: now,
        sourceId: input.sourceId,
        placementKey: input.placementKey as PlacementType | undefined,
        offerId: input.offerId,
        campaignId: input.campaignId,
        estimated: input.estimated ?? false,
        createdAt: now,
        updatedAt: now,
        createdBy: input.recordedBy ?? "system",
        status: "RECORDED",
        metadata: input.metadata,
    };
    await ref.set(record);

    // Keep aggregated revenue per placement for fast dashboards.
    if (input.placementKey) {
        await incrementCounter(`${GROWTH_COLLECTIONS.revenue}_byPlacement/${input.placementKey}/amount`, Math.round(input.amount * 100));
    }
    await writeGrowthAudit({
        actor: input.recordedBy ?? "system",
        action: "revenue_recorded",
        targetType: "revenue",
        targetId: id,
        detail: { type: input.type, amount: input.amount, currency: input.currency, estimated: input.estimated },
    });
    return { id };
}

/** Verify an offer exists, is active and returns it. Used by public routes. */
export async function getActiveOffer(offerId: string): Promise<AffiliateOffer | null> {
    const snap = await adminDatabase.ref(`${GROWTH_COLLECTIONS.affiliateOffers}/${offerId}`).get();
    const offer = snap.exists() ? (snap.val() as AffiliateOffer) : null;
    if (!offer || offer.status !== "active" || offer.active !== true) return null;
    return { ...offer, id: offerId };
}