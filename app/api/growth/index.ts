/**
 * AlgoVault — Growth & Monetization API routes.
 * All routes verify Firebase auth + admin role server-side.
 */

export { getGrowthOverviewMetrics } from "./overview/route";
export { getCampaigns, createCampaign } from "./campaigns/route";
export { updateCampaign, pauseCampaign, resumeCampaign, archiveCampaign } from "./campaigns/manage/route";
export { getPlacements } from "./placements/route";
export { createPlacement } from "./placements/manage/route";
export { getAds } from "./ads/route";
export { getRevenue } from "./revenue/route";
export { getChannels } from "./channels/route";
export { getReports } from "./reports/route";
export { getSettings } from "./settings/route";
export { getExperiments } from "./experiments/route";
export { getAffiliateOffers } from "./affiliates/route";
export { GET as authCheck } from "./auth/route";
export { POST as runCronJob } from "./cron/[job]/route";
