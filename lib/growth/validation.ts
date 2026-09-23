/**
 * Growth Engine — input validation. Pure module (no I/O) so it can be unit
 * tested and reused by every API route. Every validator returns a string[]
 * of errors (empty array = valid).
 */
import {
    AFFILIATE_CATEGORIES,
    CAMPAIGN_OBJECTIVES,
    CAMPAIGN_STATUSES,
    CHANNEL_TYPES,
    CONTENT_TYPES,
    FREQUENCY_CAP_TYPES,
    MARKETING_TASK_STATES,
    PLACEMENT_TYPES,
    PREMIUM_AD_MODES,
} from "./constants";
import { Campaign, MarketingTask, MonetizationAd, MonetizationPlacement } from "./types";

export function isNonEmptyString(value: unknown, max = 500): value is string {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

export function isOptionalString(value: unknown, max = 500): boolean {
    return value === undefined || value === null || isNonEmptyString(value, max);
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

const isOneOf =
    <T extends string>(allowed: readonly T[]) =>
    (value: unknown): value is T =>
        typeof value === "string" && (allowed as readonly string[]).includes(value);

export const isPlacementType = isOneOf(PLACEMENT_TYPES);
export const isObjective = isOneOf(CAMPAIGN_OBJECTIVES);
export const isCampaignStatus = isOneOf(CAMPAIGN_STATUSES);
export const isChannelType = isOneOf(CHANNEL_TYPES);
export const isContentType = isOneOf(CONTENT_TYPES);
export const isTaskState = isOneOf(MARKETING_TASK_STATES);
export const isAffiliateCategory = isOneOf(AFFILIATE_CATEGORIES);
export const isFrequencyCapType = isOneOf(FREQUENCY_CAP_TYPES);
export const isPremiumMode = isOneOf(PREMIUM_AD_MODES);

export function isHttpsUrl(value: unknown): value is string {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

// ─── Placement ───────────────────────────────────────────────────────────────

export function validatePlacement(input: Partial<MonetizationPlacement>): string[] {
    const errors: string[] = [];
    if (!isPlacementType(input.key)) errors.push("Placement key must be one of the supported types.");
    if (!isNonEmptyString(input.name, 200)) errors.push("Placement name is required (max 200 chars).");
    if (input.priority !== undefined && (!isFiniteNumber(input.priority) || input.priority < 0)) {
        errors.push("Priority must be a non-negative number.");
    }
    if (input.frequencyCap !== undefined) {
        const cap = input.frequencyCap;
        if (!isFrequencyCapType(cap.type)) errors.push("frequencyCap.type must be PER_SESSION or PER_DAY.");
        if (!isFiniteNumber(cap.limit) || cap.limit < 1 || cap.limit > 1000) {
            errors.push("frequencyCap.limit must be between 1 and 1000.");
        }
    }
    if (input.startAt !== undefined && !isFiniteNumber(input.startAt)) errors.push("startAt must be a timestamp.");
    if (input.endAt !== undefined && !isFiniteNumber(input.endAt)) errors.push("endAt must be a timestamp.");
    if (isFiniteNumber(input.startAt) && isFiniteNumber(input.endAt) && input.startAt! >= input.endAt!) {
        errors.push("startAt must be before endAt.");
    }
    const targeting = input.targetingRules;
    if (targeting) {
        if (targeting.premium && (!isPremiumMode(targeting.premium.mode))) {
            errors.push("targetingRules.premium.mode must be SHOW, REDUCED or HIDE.");
        }
        if (targeting.premium?.mode === "REDUCED") {
            const ratio = targeting.premium.reductionRatio;
            if (ratio === undefined || !isFiniteNumber(ratio) || ratio < 0 || ratio > 1) {
                errors.push("targetingRules.premium.reductionRatio must be between 0 and 1 when mode is REDUCED.");
            }
        }
    }
    return errors;
}

// ─── Ad ──────────────────────────────────────────────────────────────────────

export function validateAd(input: Partial<MonetizationAd>): string[] {
    const errors: string[] = [];
    if (!isNonEmptyString(input.title, 160)) errors.push("Ad title is required (max 160 chars).");
    if (!isHttpsUrl(input.targetUrl)) errors.push("Ad target URL is required and must be a valid URL.");
    if (input.type !== "NATIVE" && input.type !== "BANNER" && input.type !== "SPONSORED_CARD") {
        errors.push("Ad type must be NATIVE, BANNER or SPONSORED_CARD.");
    }
    if (input.eCPM !== undefined && (!isFiniteNumber(input.eCPM) || input.eCPM < 0)) {
        errors.push("eCPM must be a non-negative number.");
    }
    if (input.startAt !== undefined && !isFiniteNumber(input.startAt)) errors.push("startAt must be a timestamp.");
    if (input.endAt !== undefined && !isFiniteNumber(input.endAt)) errors.push("endAt must be a timestamp.");
    if (isFiniteNumber(input.startAt) && isFiniteNumber(input.endAt) && input.startAt! >= input.endAt!) {
        errors.push("startAt must be before endAt.");
    }
    if (input.active !== undefined && typeof input.active !== "boolean") errors.push("active must be a boolean.");
    return errors;
}

// ─── Campaign ────────────────────────────────────────────────────────────────

export function validateCampaign(input: Partial<Campaign>): string[] {
    const errors: string[] = [];
    if (!isNonEmptyString(input.name, 200)) errors.push("Campaign name is required (max 200 chars).");
    if (input.objective !== undefined && !isObjective(input.objective)) {
        errors.push("Objective must be one of the supported campaign objectives.");
    }
    if (input.status !== undefined && !isCampaignStatus(input.status)) {
        errors.push("Status must be DRAFT, ACTIVE, PAUSED, COMPLETED or ARCHIVED.");
    }
    if (input.budget !== undefined && (!isFiniteNumber(input.budget) || input.budget < 0)) {
        errors.push("Budget must be a non-negative number.");
    }
    if (input.channels !== undefined) {
        if (!Array.isArray(input.channels) || input.channels.some((c) => !isChannelType(c))) {
            errors.push("Channels must be an array of supported channel types.");
        }
    }
    if (input.startAt !== undefined && !isFiniteNumber(input.startAt)) errors.push("startAt must be a timestamp.");
    if (input.endAt !== undefined && !isFiniteNumber(input.endAt)) errors.push("endAt must be a timestamp.");
    if (isFiniteNumber(input.startAt) && isFiniteNumber(input.endAt) && input.startAt! >= input.endAt!) {
        errors.push("startAt must be before endAt.");
    }
    return errors;
}

// ─── Marketing task ──────────────────────────────────────────────────────────

export function validateMarketingTask(input: Partial<MarketingTask>): string[] {
    const errors: string[] = [];
    if (!isNonEmptyString(input.topic, 500)) errors.push("Topic is required (max 500 chars).");
    if (input.type !== undefined && !isContentType(input.type)) {
        errors.push("Task type must be a supported content type.");
    }
    if (input.channels !== undefined) {
        if (!Array.isArray(input.channels) || input.channels.some((c) => !isChannelType(c))) {
            errors.push("Channels must be an array of supported channel types.");
        }
    }
    if (input.state !== undefined && !isTaskState(input.state)) {
        errors.push("State must be a supported marketing task state.");
    }
    if (input.approvalRequired !== undefined && typeof input.approvalRequired !== "boolean") {
        errors.push("approvalRequired must be a boolean.");
    }
    return errors;
}

// ─── Publish guidance ────────────────────────────────────────────────────────

/** A URL that is safe to redirect/anchor to from placement cards. */
export function isSafeDestUrl(value: unknown): boolean {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

export function clampText(value: string, max: number): string {
    const trimmed = value.trim();
    return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}