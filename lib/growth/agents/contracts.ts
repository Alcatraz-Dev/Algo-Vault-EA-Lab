/**
 * Growth Engine — specialized AI agents (multi-agent marketing pipeline).
 *
 * Agents work as a controlled pipeline — never one giant agent:
 *
 *   Research → Content → SEO → Social → Compliance → Approval → Publish
 *   → Analytics → Optimization
 *
 * Action nodes (publish) are gated: they require explicit authorization and
 * only act through the channel adapters, which never fake success.
 */
import { AgentContract } from "@/lib/agents/types";
import { registerAgentContract } from "@/lib/agents/catalog";

const HYBRID = { poweredBy: "hybrid" as const, provider: undefined, model: undefined, temperature: 0.3, maxTokens: 1200, responseFormat: "text" as const };
const DETERMINISTIC = { poweredBy: "deterministic" as const };

const RETRY = { maxRetries: 2, backoffMs: 1000 };

export const GROWTH_AGENT_IDS = {
    research: "growth-research",
    content: "growth-content",
    seo: "growth-seo",
    social: "growth-social",
    compliance: "growth-compliance",
    campaign: "growth-campaign",
    analytics: "growth-analytics",
    optimization: "growth-optimization",
    publisher: "growth-publisher",
    report: "growth-report",
} as const;

export const GROWTH_AGENTS: AgentContract[] = [
    {
        id: GROWTH_AGENT_IDS.research,
        name: "Marketing Research Agent",
        version: "1.0.0",
        role: "custom",
        description:
            "Turns a topic/objective into a research brief: audience, angles, sources, compliance-relevant context. Never invents data points.",
        capabilities: ["market_research", "topic_research", "audience_analysis"],
        requiredPermissions: [],
        inputSchema: { topic: "string", objective: "string", audience: "string" },
        outputSchema: { brief: "string", angles: "string[]", sources: "string[]" },
        systemInstructions:
            "You are the Research Agent of the AlgoVault Growth Engine. Produce a factual research brief from the given topic. Never invent statistics, performance figures or third-party claims. Label anything uncertain as unverified.",
        tools: ["growth_brief", "topic_analyzer"],
        modelConfiguration: HYBRID,
        timeoutMs: 30000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0.3 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.content,
        name: "Content Agent",
        version: "1.0.0",
        role: "custom",
        description:
            "Generates content in the requested type/tone/language from the research brief. Never fabricates performance or backtest results.",
        capabilities: ["content_generation", "copywriting", "format_adaptation"],
        requiredPermissions: [],
        inputSchema: { brief: "string", type: "string", tone: "string", language: "string", channels: "string[]" },
        outputSchema: { contentBlocks: "Record<string, AIContentBlock>", reviewNotes: "string" },
        systemInstructions:
            "You are the Content Agent of the AlgoVault Growth Engine. Write honest, useful trading-education content. Strictly forbidden: guaranteed profits, fabricated performance/backtests, fake testimonials, deceptive financial claims. Include a trading risk disclosure whenever the topic touches trading.",
        tools: ["content_templates", "copywriter"],
        modelConfiguration: HYBRID,
        timeoutMs: 45000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0.3 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.seo,
        name: "SEO Agent",
        version: "1.0.0",
        role: "custom",
        description: "Produces SEO metadata (title, meta description, slug, keywords) and checks draft structure.",
        capabilities: ["seo_metadata", "keyword_suggestion", "structure_check"],
        requiredPermissions: [],
        inputSchema: { draft: "string", title: "string" },
        outputSchema: { seoTitle: "string", metaDescription: "string", slug: "string", keywords: "string[]" },
        systemInstructions:
            "You are the SEO Agent of the AlgoVault Growth Engine. Suggest metadata that is honest and specific. Never keyword-stuff; never promise rankings.",
        tools: ["seo_checklist"],
        modelConfiguration: HYBRID,
        timeoutMs: 20000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0.2 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.social,
        name: "Social Agent",
        version: "1.0.0",
        role: "custom",
        description:
            "Adapts approved content into per-channel variants (threads, captions, hashtags, short scripts). Keeps claims intact — never strengthens them.",
        capabilities: ["social_variants", "channel_adaptation", "hashtag_suggestion"],
        requiredPermissions: [],
        inputSchema: { draft: "string", channels: "string[]" },
        outputSchema: { variants: "Record<string, string>", hashtags: "string[]" },
        systemInstructions:
            "You are the Social Agent of the AlgoVault Growth Engine. Reformat content for each channel without adding hype or guarantees. Keep the same substance and disclosures.",
        tools: ["channel_variant_builder"],
        modelConfiguration: HYBRID,
        timeoutMs: 30000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0.2 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.compliance,
        name: "Compliance Agent",
        version: "1.0.0",
        role: "custom",
        description:
            "Screens every draft for prohibited financial claims, missing disclosures and affiliate-disclosure gaps. Blocks high-severity flags.",
        capabilities: ["compliance_review", "risk_disclosure", "claim_audit"],
        requiredPermissions: [],
        inputSchema: { draft: "string", isAffiliateContent: "boolean" },
        outputSchema: { passed: "boolean", flags: "string[]", requiresRiskDisclosure: "boolean" },
        systemInstructions:
            "You are the Compliance Agent of the AlgoVault Growth Engine. Flag any content that could mislead traders. Your block is authoritative for the pipeline.",
        tools: ["compliance_rules", "disclosure_checker"],
        modelConfiguration: DETERMINISTIC,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 500 },
        validationRules: { failOnError: true, minConfidence: 0 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.campaign,
        name: "Campaign Agent",
        version: "1.0.0",
        role: "custom",
        description:
            "Plans campaign batches: assigns content to channels, recommends schedule windows and audience targeting from the campaign definition.",
        capabilities: ["campaign_planning", "channel_assignment", "scheduling"],
        requiredPermissions: [],
        inputSchema: { campaignId: "string", objective: "string", channels: "string[]" },
        outputSchema: { plan: "Record<string, unknown>", suggestedSchedule: "number[]" },
        systemInstructions:
            "You are the Campaign Agent of the AlgoVault Growth Engine. Plan honest execution steps; never state expected outcomes as certain.",
        tools: ["campaign_planner"],
        modelConfiguration: DETERMINISTIC,
        timeoutMs: 10000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0.2 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.analytics,
        name: "Analytics Agent",
        version: "1.0.0",
        role: "custom",
        description: "Computes performance from stored events/metrics only. Never guesses when data is sparse.",
        capabilities: ["performance_analysis", "kpi_computation", "trend_detection"],
        requiredPermissions: [],
        inputSchema: { periodStart: "number", periodEnd: "number" },
        outputSchema: { kpis: "Record<string, number>", insufficient: "string[]" },
        systemInstructions:
            "You are the Analytics Agent of the AlgoVault Growth Engine. Report only computed metrics from stored data. Mark anything without sufficient data as 'insufficient data'.",
        tools: ["growth_metrics", "event_store"],
        modelConfiguration: DETERMINISTIC,
        timeoutMs: 15000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.optimization,
        name: "Optimization Agent",
        version: "1.0.0",
        role: "custom",
        description:
            "Recommends content topics, posting times, channels, formats and placement changes from historical performance. RECOMMENDATION_ONLY by default; AUTO_OPTIMIZE only on safe non-financial knobs.",
        capabilities: ["performance_optimization", "topic_recommendation", "placement_recommendation"],
        requiredPermissions: [],
        inputSchema: { kpis: "Record<string, number>", periodStart: "number", periodEnd: "number" },
        outputSchema: { recommendations: "OptimizationRecommendation[]" },
        systemInstructions:
            "You are the Optimization Agent of the AlgoVault Growth Engine. Recommend based on measured performance with a clear rationale. Never recommend changes to financial, account or security settings.",
        tools: ["performance_history", "recommendation_builder"],
        modelConfiguration: DETERMINISTIC,
        timeoutMs: 15000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0.3 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.publisher,
        name: "Publisher Agent",
        version: "1.0.0",
        role: "custom",
        description:
            "Action node: publishes approved content through configured channel adapters. Refuses (NOT_CONFIGURED / BLOCKED) when credentials are missing or content is not approved.",
        capabilities: ["publish_content", "channel_dispatch"],
        requiredPermissions: [],
        inputSchema: { taskId: "string", channels: "string[]", content: "Record<string, string>" },
        outputSchema: { published: "{ channel, externalId }[]", blocked: "string[]" },
        systemInstructions:
            "You are the Publisher Agent of the AlgoVault Growth Engine. Only publish content that is APPROVED/SCHEDULED. Never claim success without a real API confirmation.",
        tools: ["channel_adapters"],
        modelConfiguration: DETERMINISTIC,
        timeoutMs: 30000,
        retryPolicy: { maxRetries: 1, backoffMs: 1000 },
        validationRules: { failOnError: false, minConfidence: 0 },
        status: "active",
    },
    {
        id: GROWTH_AGENT_IDS.report,
        name: "Growth Report Agent",
        version: "1.0.0",
        role: "custom",
        description: "Compiles daily/weekly/monthly growth reports from stored analytics.",
        capabilities: ["report_generation", "narrative_synthesis"],
        requiredPermissions: [],
        inputSchema: { interval: "string", periodStart: "number", periodEnd: "number" },
        outputSchema: { sections: "ReportSection[]", recommendations: "string[]" },
        systemInstructions:
            "You are the Growth Report Agent of the AlgoVault Growth Engine. Every number in a report must come from stored analytics. Everything else is 'Insufficient data'.",
        tools: ["growth_metrics", "event_store", "revenue_store"],
        modelConfiguration: DETERMINISTIC,
        timeoutMs: 15000,
        retryPolicy: RETRY,
        validationRules: { failOnError: false, minConfidence: 0 },
        status: "active",
    },
];

let registered = false;

/** Register contracts + a registry of executors (idempotent). */
export function ensureGrowthAgentsRegistered(): void {
    if (registered) return;
    registered = true;
    for (const agent of GROWTH_AGENTS) {
        registerAgentContract(agent);
    }
}

ensureGrowthAgentsRegistered();