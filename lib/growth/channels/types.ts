/**
 * Growth Engine — provider-independent social channel abstraction.
 *
 * Every channel implements the MarketingChannelAdapter contract. Adapters may
 * only report success when a real external API accepted the content — missing
 * credentials always surface as NOT_CONFIGURED and never fake a publication.
 */
import { ChannelConfigState, ChannelType } from "../constants";

export type ChannelCapability = "generate" | "schedule" | "publish" | "delete" | "analytics";

export type PublishPayload = {
    text?: string;
    title?: string;
    url?: string;
    imageUrl?: string;
    scheduledAt?: number;
    metadata?: Record<string, unknown>;
};

export type PublishResult =
    | { ok: true; externalId: string; url?: string; publishedAt: number }
    | { ok: false; state: ChannelConfigState; reason: string };

export type ScheduleResult =
    | { ok: true; scheduledId: string; scheduledAt: number }
    | { ok: false; state: ChannelConfigState; reason: string };

export type AnalyticsResult =
    | { ok: true; metrics: { impressions?: number; clicks?: number; engagements?: number }; period?: string }
    | { ok: false; state: ChannelConfigState; reason: string };

export type ChannelStatus = {
    type: ChannelType;
    state: ChannelConfigState;
    configured: boolean;
    reason?: string;
    capabilities: ChannelCapability[];
};

export interface MarketingChannelAdapter {
    readonly type: ChannelType;
    readonly capabilities: ChannelCapability[];
    status(): ChannelStatus;
    publish(payload: PublishPayload): Promise<PublishResult>;
    schedule?(payload: PublishPayload): Promise<ScheduleResult>;
    delete?(externalId: string): Promise<{ ok: boolean; reason?: string }>;
    analytics?(periodStart?: number, periodEnd?: number): Promise<AnalyticsResult>;
}

export const NOT_CONFIGURED = (reason: string): Extract<PublishResult, { ok: false }> => ({
    ok: false,
    state: "NOT_CONFIGURED",
    reason,
});