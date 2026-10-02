/**
 * External intelligence provenance helpers (PHASE 4).
 *
 * Builds the standard provenance envelope attached to every TradingView-derived
 * evidence item and derives freshness labels. Pure + isomorphic.
 */
import type {
    ExternalEvidenceProvenance,
    EvidenceFreshness,
    EvidenceSourceId,
    ProviderId,
} from "../interfaces/external-intelligence-provider";

export interface BuildProvenanceInput {
    source: EvidenceSourceId;
    provider: ProviderId;
    /** ms epoch of the provider-side data; null when the provider did not report one. */
    sourceTimestamp: number | null;
    fetchedAt?: number;
    delayed?: boolean;
    cache?: "hit" | "miss" | "bypassed";
    disclaimer?: string;
    /** Age in ms after which data is considered stale for caching purposes. */
    staleAfterMs?: number;
    now?: number;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000; // 30 min

export function deriveFreshness(input: {
    delayed?: boolean;
    sourceTimestamp: number | null;
    now?: number;
}): EvidenceFreshness {
    const now = input.now ?? Date.now();
    if (input.delayed) return "delayed";
    if (input.sourceTimestamp === null || !Number.isFinite(input.sourceTimestamp)) return "unknown";
    const age = now - input.sourceTimestamp;
    if (age < 0) return "unknown"; // clock skew — do not claim realtime
    if (age < 60_000) return "realtime";
    if (age < 15 * 60_000) return "fresh";
    if (age < 60 * 60_000) return "delayed";
    return "stale";
}

export function buildProvenance(input: BuildProvenanceInput): ExternalEvidenceProvenance {
    const now = input.now ?? Date.now();
    const cache = input.cache ?? "miss";
    const stale =
        cache === "hit" &&
        typeof input.staleAfterMs === "number" &&
        input.sourceTimestamp !== null &&
        now - input.sourceTimestamp > input.staleAfterMs;

    return {
        source: input.source,
        provider: input.provider,
        sourceTimestamp: input.sourceTimestamp,
        fetchedAt: input.fetchedAt ?? now,
        delayed: input.delayed ?? false,
        freshness: deriveFreshness({ delayed: input.delayed, sourceTimestamp: input.sourceTimestamp, now }),
        cache,
        ...(stale ? { stale: true } : {}),
        ...(input.disclaimer ? { disclaimer: input.disclaimer } : {}),
    };
}

/** Human-facing freshness summary used by UIs and AI prompts. */
export function describeFreshness(p: ExternalEvidenceProvenance): string {
    switch (p.freshness) {
        case "realtime":
            return "realtime";
        case "fresh":
            return "fresh (<15 min)";
        case "delayed":
            return "delayed";
        case "stale":
            return "stale (>1 h)";
        case "cached":
            return "served from cache";
        case "historical":
            return "historical";
        default:
            return "freshness unknown";
    }
}

/**
 * Structured external events (news / economics) with provenance attached —
 * the shape consumed by the Market Intelligence pipeline (PHASE 9).
 */
export interface ExternalMarketEvent {
    source: "TRADINGVIEW";
    provider: ProviderId;
    eventType: "NEWS" | "ECONOMIC" | "FUNDAMENTAL" | "ALERT_FIRED";
    symbol: string | null;
    currency?: string | null;
    title: string;
    /** Importance EXACTLY as classified by the provider (never regraded). */
    importance?: number | null;
    importanceLabel?: string | null;
    importanceSource: "PROVIDER" | "NONE";
    eventTime: number | null; // unix seconds
    freshness: EvidenceFreshness;
    delayed: boolean;
    provenance: ExternalEvidenceProvenance;
    metadata?: Record<string, unknown>;
}

export function toExternalMarketEvent(input: {
    eventType: ExternalMarketEvent["eventType"];
    symbol: string | null;
    title: string;
    eventTime: number | null;
    provenance: ExternalEvidenceProvenance;
    currency?: string | null;
    importance?: number | null;
    importanceLabel?: string | null;
    metadata?: Record<string, unknown>;
}): ExternalMarketEvent {
    const importance = input.importance ?? null;
    return {
        source: "TRADINGVIEW",
        provider: input.provenance.provider,
        eventType: input.eventType,
        symbol: input.symbol,
        currency: input.currency ?? null,
        title: input.title,
        importance,
        importanceLabel: input.importanceLabel ?? null,
        importanceSource: importance === null ? "NONE" : "PROVIDER",
        eventTime: input.eventTime,
        freshness: input.provenance.freshness,
        delayed: input.provenance.delayed,
        provenance: input.provenance,
        ...(input.metadata ? { metadata: input.metadata } : {}),
    };
}
