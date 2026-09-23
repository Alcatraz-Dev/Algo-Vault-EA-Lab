import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

/**
 * Growth status → canonical StatusBadge tone mapping.
 * Keeps every Growth/Monetization surface visually consistent.
 */
export type GrowthStatusKind =
    | "campaign"
    | "task"
    | "channel"
    | "placement"
    | "offer"
    | "interval"
    | "revenue"
    | "network"
    | "experiment";

const TONES: Record<GrowthStatusKind, Record<string, StatusTone>> = {
    campaign: {
        DRAFT: "neutral",
        ACTIVE: "active",
        PAUSED: "warning",
        COMPLETED: "info",
        ARCHIVED: "stale",
    },
    task: {
        DRAFT: "neutral",
        GENERATING: "pending",
        READY_FOR_REVIEW: "info",
        APPROVED: "connected",
        SCHEDULED: "info",
        PUBLISHED: "positive",
        FAILED: "error",
        REJECTED: "negative",
    },
    channel: {
        CONFIGURED: "connected",
        NOT_CONFIGURED: "neutral",
        ERROR: "error",
        DISABLED: "stale",
    },
    placement: {
        ACTIVE: "active",
        INACTIVE: "neutral",
    },
    offer: {
        ACTIVE: "active",
        INACTIVE: "neutral",
    },
    interval: {
        DAILY: "neutral",
        WEEKLY: "info",
        MONTHLY: "info",
    },
    revenue: {
        AD: "info",
        SPONSORED: "info",
        AFFILIATE: "info",
        SUBSCRIPTION: "positive",
        MARKETPLACE: "info",
    },
    network: {
        CONFIGURED: "connected",
        NOT_CONFIGURED: "neutral",
        ENABLED: "active",
        TEST_MODE: "warning",
    },
    experiment: {
        DRAFT: "neutral",
        RUNNING: "active",
        COMPLETED: "info",
        ARCHIVED: "stale",
    },
};

export function GrowthStatusBadge({
    kind,
    value,
    pulse = false,
}: {
    kind: GrowthStatusKind;
    value: string;
    pulse?: boolean;
}) {
    const tone = TONES[kind]?.[value] ?? "neutral";
    return <StatusBadge tone={tone} label={value} pulse={pulse} />;
}

/** Human label for the value (falls back to the raw value). */
export function growthStatusLabel(kind: GrowthStatusKind, value: string): string {
    const labels: Record<GrowthStatusKind, Record<string, string>> = {
        campaign: {
            DRAFT: "Draft",
            ACTIVE: "Active",
            PAUSED: "Paused",
            COMPLETED: "Completed",
            ARCHIVED: "Archived",
        },
        task: {
            DRAFT: "Draft",
            GENERATING: "Generating",
            READY_FOR_REVIEW: "Ready for review",
            APPROVED: "Approved",
            SCHEDULED: "Scheduled",
            PUBLISHED: "Published",
            FAILED: "Failed",
            REJECTED: "Rejected",
        },
        channel: {
            CONFIGURED: "Configured",
            NOT_CONFIGURED: "Not configured",
            ERROR: "Configuration error",
            DISABLED: "Disabled",
        },
        placement: { ACTIVE: "Active", INACTIVE: "Inactive" },
        offer: { ACTIVE: "Active", INACTIVE: "Inactive" },
        interval: { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" },
        revenue: {
            AD: "Ad revenue",
            SPONSORED: "Sponsored",
            AFFILIATE: "Affiliate",
            SUBSCRIPTION: "Subscriptions",
            MARKETPLACE: "Marketplace",
        },
        network: {
            CONFIGURED: "Configured",
            NOT_CONFIGURED: "Not configured",
            ENABLED: "Enabled",
            TEST_MODE: "Test mode",
        },
        experiment: {
            DRAFT: "Draft",
            RUNNING: "Running",
            COMPLETED: "Completed",
            ARCHIVED: "Archived",
        },
    };
    return labels[kind]?.[value] ?? value;
}