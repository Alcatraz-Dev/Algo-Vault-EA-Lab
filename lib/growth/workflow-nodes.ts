/**
 * Growth Engine — workflow node contracts.
 *
 * These are the marketing nodes exposed to the workflow automation editor.
 * Every node declares its input/output schema and whether it requires explicit
 * authorization (all action nodes do — administrators approve before any
 * publish/email/send node can act).
 */
import { MARKETING_WORKFLOW_ACTIONS, MarketingWorkflowAction } from "./constants";
import { WorkflowNodeSchema } from "./types";
import { GROWTH_AGENT_IDS } from "./agents/contracts";

export const MARKETING_WORKFLOW_NODES: WorkflowNodeSchema[] = [
    {
        action: "TRIGGER_MARKETING",
        agentId: "",
        label: "Trigger marketing",
        description: "Starts a growth pipeline: campaign, content-generation or report run.",
        input: { campaignId: "string", objective: "string", channels: "string[]" },
        output: { triggered: "boolean", runId: "string" },
        requiresAuthorization: false,
    },
    {
        action: "AI_RESEARCH",
        agentId: GROWTH_AGENT_IDS.research,
        label: "AI research",
        description: "Research brief from a topic/objective. Never invents data.",
        input: { topic: "string", objective: "string", audience: "string" },
        output: { brief: "string", angles: "string[]" },
        requiresAuthorization: false,
    },
    {
        action: "AI_CONTENT",
        agentId: GROWTH_AGENT_IDS.content,
        label: "AI content",
        description: "Draft marketing content in the requested type/tone/language.",
        input: { brief: "string", type: "string", tone: "string", language: "string", channels: "string[]" },
        output: { contentBlocks: "Record<string, AIContentBlock>" },
        requiresAuthorization: false,
    },
    {
        action: "AI_SEO",
        agentId: GROWTH_AGENT_IDS.seo,
        label: "AI SEO",
        description: "SEO metadata (title, meta description, slug, keywords).",
        input: { draft: "string", title: "string" },
        output: { seoTitle: "string", metaDescription: "string", slug: "string", keywords: "string[]" },
        requiresAuthorization: false,
    },
    {
        action: "AI_SOCIAL",
        agentId: GROWTH_AGENT_IDS.social,
        label: "AI social",
        description: "Per-channel social variants that keep claims intact.",
        input: { draft: "string", channels: "string[]" },
        output: { variants: "Record<string, string>", hashtags: "string[]" },
        requiresAuthorization: false,
    },
    {
        action: "AI_COMPLIANCE",
        agentId: GROWTH_AGENT_IDS.compliance,
        label: "AI compliance",
        description: "Blocks content with high-severity compliance flags.",
        input: { draft: "string", isAffiliateContent: "boolean" },
        output: { passed: "boolean", flags: "string[]" },
        requiresAuthorization: false,
    },
    {
        action: "AI_APPROVAL",
        agentId: "",
        label: "AI approval gate",
        description: "Waits for an administrator decision before any action node runs.",
        input: { taskId: "string", required: "boolean" },
        output: { decision: "APPROVED | REJECTED", decidedBy: "string" },
        requiresAuthorization: false,
    },
    {
        action: "SOCIAL_PUBLISH",
        agentId: GROWTH_AGENT_IDS.publisher,
        label: "Publish to social",
        description: "Publishes approved content via the social channel adapters. Refuses when not configured.",
        input: { taskId: "string", channels: "string[]" },
        output: { published: "string[]", blocked: "string[]" },
        requiresAuthorization: true,
    },
    {
        action: "EMAIL_SEND",
        agentId: GROWTH_AGENT_IDS.publisher,
        label: "Send email",
        description: "Sends an email via the EMAIL channel adapter.",
        input: { taskId: "string", subject: "string", body: "string", to: "string[]" },
        output: { sent: "boolean", externalId: "string" },
        requiresAuthorization: true,
    },
    {
        action: "DISCORD_SEND",
        agentId: GROWTH_AGENT_IDS.publisher,
        label: "Send Discord message",
        description: "Posts to Discord via the DISCORD channel adapter.",
        input: { taskId: "string", text: "string", channelId: "string" },
        output: { sent: "boolean", externalId: "string" },
        requiresAuthorization: true,
    },
    {
        action: "BLOG_PUBLISH",
        agentId: GROWTH_AGENT_IDS.publisher,
        label: "Publish blog post",
        description: "Publishes an approved article through the BLOG channel adapter.",
        input: { taskId: "string", title: "string", body: "string" },
        output: { published: "boolean", url: "string" },
        requiresAuthorization: true,
    },
    {
        action: "TRACK_CAMPAIGN",
        agentId: "",
        label: "Track campaign",
        description: "Attaches tracking parameters (UTM + affiliate attribution) to campaign links.",
        input: { campaignId: "string", url: "string", source: "string", medium: "string" },
        output: { trackingUrl: "string", campaignId: "string" },
        requiresAuthorization: false,
    },
    {
        action: "ANALYZE_CAMPAIGN",
        agentId: GROWTH_AGENT_IDS.analytics,
        label: "Analyze campaign",
        description: "Computes KPIs from stored events only. Reports 'Insufficient data' when sparse.",
        input: { periodStart: "number", periodEnd: "number" },
        output: { kpis: "Record<string, number>", insufficient: "string[]" },
        requiresAuthorization: false,
    },
    {
        action: "OPTIMIZE_CAMPAIGN",
        agentId: GROWTH_AGENT_IDS.optimization,
        label: "Optimize campaign",
        description: "Produces recommendations (RECOMMENDATION_ONLY default; AUTO_OPTIMIZE for safe knobs only).",
        input: { mode: "string", periodStart: "number", periodEnd: "number" },
        output: { recommendations: "OptimizationRecommendation[]" },
        requiresAuthorization: false,
    },
    {
        action: "GENERATE_REPORT",
        agentId: GROWTH_AGENT_IDS.report,
        label: "Generate report",
        description: "Compiles a growth report from stored analytics.",
        input: { interval: "string", periodStart: "number", periodEnd: "number" },
        output: { sections: "ReportSection[]" },
        requiresAuthorization: false,
    },
];

const BY_ACTION: Record<MarketingWorkflowAction, WorkflowNodeSchema> = Object.fromEntries(
    MARKETING_WORKFLOW_NODES.map((n) => [n.action, n])
) as Record<MarketingWorkflowAction, WorkflowNodeSchema>;

export const MARKETING_WORKFLOW_ACTION_LIST = MARKETING_WORKFLOW_ACTIONS;

export function getWorkflowNodeSchema(action: MarketingWorkflowAction): WorkflowNodeSchema | undefined {
    return BY_ACTION[action];
}

/** Action nodes cannot run without prior administrator authorization. */
export function actionNodeRequiresApproval(action: MarketingWorkflowAction): boolean {
    return getWorkflowNodeSchema(action)?.requiresAuthorization ?? false;
}