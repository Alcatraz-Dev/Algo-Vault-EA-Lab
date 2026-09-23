/**
 * Growth Engine — attribution IDs for affiliate / campaign tracking.
 *
 * Pure module. Attribution IDs are opaque, URL-safe identifiers that let every
 * click and conversion be tied back to offer, campaign, source, medium and
 * content without exposing internal database keys.
 */
import { createHash } from "node:crypto";

export type AttributionParams = {
    offerId?: string;
    campaignId?: string;
    source?: string;
    medium?: string;
    content?: string;
    placementKey?: string;
};

export type ParsedAttribution = AttributionParams & {
    affiliateClickId?: string;
    raw: string;
};

const SAFE_CHARS = /^[A-Za-z0-9_-]+$/;

function safeSegment(value?: string): string {
    if (!value) return "";
    const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    return cleaned;
}

/** Deterministic short id for a click, in case the caller cannot push(). */
export function createClickFingerprint(params: AttributionParams & { ts?: number }): string {
    const raw = [params.offerId, params.campaignId, params.source, params.medium, params.content, params.placementKey, params.ts ?? Date.now()].join("|");
    return createHash("sha1").update(raw).digest("hex").slice(0, 24);
}

/**
 * Builds the query-arg attribution package appended to a tracked destination.
 * Example: ?av_offer=OFF&av_campaign=CAM&av_src=blog&av_med=affiliate&av_cnt=sidebar
 */
export function buildAttributionQuery(attribution: AttributionParams): string {
    const parts: string[] = [];
    const offer = safeSegment(attribution.offerId);
    if (offer) parts.push(`av_offer=${offer}`);
    const campaign = safeSegment(attribution.campaignId);
    if (campaign) parts.push(`av_campaign=${campaign}`);
    const source = safeSegment(attribution.source);
    if (source) parts.push(`av_src=${source}`);
    const medium = safeSegment(attribution.medium);
    if (medium) parts.push(`av_med=${medium}`);
    const content = safeSegment(attribution.content);
    if (content) parts.push(`av_cnt=${content}`);
    const placement = safeSegment(attribution.placementKey);
    if (placement) parts.push(`av_plc=${placement}`);
    return parts.join("&");
}

/** Parses attribution out of a URLSearchParams or query string. */
export function parseAttribution(searchParams: URLSearchParams | string): ParsedAttribution {
    const params = typeof searchParams === "string" ? new URLSearchParams(searchParams) : searchParams;
    const read = (key: string) => {
        const value = params.get(key);
        if (!value || !SAFE_CHARS.test(value)) return undefined;
        return value;
    };
    return {
        offerId: read("av_offer") ?? read("offerId"),
        campaignId: read("av_campaign") ?? read("campaignId"),
        source: read("av_src") ?? read("source"),
        medium: read("av_med") ?? read("medium"),
        content: read("av_cnt") ?? read("content"),
        placementKey: read("av_plc") ?? read("placement") ?? undefined,
        affiliateClickId: read("av_clk"),
        raw: params.toString(),
    };
}

/** Packs attribution params onto an existing URL preserving its query params. */
export function appendAttribution(url: string, attribution: AttributionParams): string {
    try {
        const parsed = new URL(url);
        const query = buildAttributionQuery(attribution);
        if (query) {
            parsed.search = parsed.search ? `${parsed.search.replace(/^\?/, "")}&${query}` : query;
        }
        return parsed.toString();
    } catch {
        return url;
    }
}

/** UTM-style params for campaign-driven traffic. */
export function buildUtm(attribution: AttributionParams): string {
    const parts: string[] = [];
    const add = (key: string, value?: string) => {
        const seg = safeSegment(value);
        if (seg) parts.push(`utm_${key}=${encodeURIComponent(seg)}`);
    };
    add("source", attribution.source || "algovault");
    add("medium", attribution.medium || "affiliate");
    add("campaign", attribution.campaignId);
    add("content", attribution.content);
    return parts.join("&");
}