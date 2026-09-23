/**
 * Growth Engine — Realtime Database path helpers (single source of truth).
 */
import { GROWTH_COLLECTIONS } from "./constants";

export const COLLECTION_PATHS = {
    campaigns: GROWTH_COLLECTIONS.campaigns,
    content: GROWTH_COLLECTIONS.content,
    channels: GROWTH_COLLECTIONS.channels,
    experiments: GROWTH_COLLECTIONS.experiments,
    events: GROWTH_COLLECTIONS.events,
    metrics: GROWTH_COLLECTIONS.metrics,
    reports: GROWTH_COLLECTIONS.reports,
    placements: GROWTH_COLLECTIONS.placements,
    ads: GROWTH_COLLECTIONS.ads,
    sponsors: GROWTH_COLLECTIONS.sponsors,
    revenue: GROWTH_COLLECTIONS.revenue,
    settings: GROWTH_COLLECTIONS.settings,
    affiliatePrograms: GROWTH_COLLECTIONS.affiliatePrograms,
    affiliateOffers: GROWTH_COLLECTIONS.affiliateOffers,
    affiliateClicks: GROWTH_COLLECTIONS.affiliateClicks,
    affiliateConversions: GROWTH_COLLECTIONS.affiliateConversions,
    affiliateRevenue: GROWTH_COLLECTIONS.affiliateRevenue,
    tasks: GROWTH_COLLECTIONS.tasks,
    runs: GROWTH_COLLECTIONS.runs,
    approvals: GROWTH_COLLECTIONS.approvals,
    auditLogs: GROWTH_COLLECTIONS.auditLogs,
    jobs: GROWTH_COLLECTIONS.jobs,
    recommendations: GROWTH_COLLECTIONS.recommendations,
    opportunities: GROWTH_COLLECTIONS.opportunities,
    growthApprovals: GROWTH_COLLECTIONS.growthApprovals,
    loopExecutions: GROWTH_COLLECTIONS.loopExecutions,
    fatigueSignals: GROWTH_COLLECTIONS.fatigueSignals,
    feedback: GROWTH_COLLECTIONS.feedback,
    policies: GROWTH_COLLECTIONS.policies,
} as const;