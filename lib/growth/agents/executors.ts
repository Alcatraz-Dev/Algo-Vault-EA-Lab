/**
 * Growth Engine — agent executor implementations.
 *
 * Executors are registered into the existing workflow engine
 * (registerAgentExecutor) and follow the standard AgentOutput contract.
 * AI narration goes through the existing gateway; deterministic cores provide
 * honest fallbacks. No executor fabricates success.
 */
import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "@/lib/agents/types";
import { registerAgentExecutor } from "@/lib/agents/workflow-engine";
import { successOutput, failureOutput, tryNarrate } from "@/lib/agents/implementations/shared";
import { checkCompliance, affiliateDisclosureSnippet } from "../compliance";
import { GROWTH_AGENT_IDS } from "./contracts";
import { getAdapter, publishWithTimeout } from "../channels";
import { listCollection, writeGrowthAudit } from "../database";
import { getActiveOffer } from "../tracking";
import { COLLECTION_PATHS } from "../paths";
import { AIContentBlock } from "../types";
import { ct } from "../content-templates";
import { ctr, rpm as rpmMetric } from "../metrics";

type GrowthContext = WorkflowContext & { config: Record<string, unknown> };

function readConfig(ctx: WorkflowContext): Record<string, unknown> {
    return (ctx.config || {}) as Record<string, unknown>;
}

function findingsFromFlags(flags: { rule: string; label: string; severity: string; matches: string[] }[]): AgentOutput["findings"] {
    return flags.map((f, i) => ({
        id: `comp_${i}_${f.rule}`,
        title: f.label,
        detail: f.matches.slice(0, 2).join(" · ") || f.rule,
        tags: [f.severity, f.rule],
    }));
}

// ─── Research Agent ──────────────────────────────────────────────────────────

const researchExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const topic = String(config.topic || "AlgoVault trading platform");
    const objective = String(config.objective || "AWARENESS");
    const audience = String(config.audience || "traders");

    const prompt = [
        `Produce a short research brief for a trading-education marketing piece.`,
        `Topic: ${topic}`,
        `Objective: ${objective}`,
        `Audience: ${audience}`,
        `Return: 1) three honest angles, 2) suggested sources to cite (labels only, no invented URLs), 3) any compliance-sensitive aspects.`,
        `Do not include any performance statistics or returns.`,
    ].join("\n");

    const narration = await tryNarrate(prompt, "You are the AlgoVault Marketing Research Agent. Be factual, concise, and never invent data.", { maxTokens: 500 });

    const brief = narration.ok
        ? String(narration.text || "")
        : `Research brief for "${topic}" targeting ${audience} (objective: ${objective}). Angles: education over hype; honest risk framing; practical platform capabilities.`;
    const angles = narration.ok ? brief.split("\n").filter((l) => l.trim().startsWith("-") || /^\d\)/.test(l.trim())).map((l) => l.trim()).slice(0, 5) : [
        `Explain ${topic} for ${audience}`,
        "Focus on risk-conscious education",
        "Highlight practical AlgoVault capabilities",
    ];

    return successOutput({
        agentId: GROWTH_AGENT_IDS.research,
        summary: `Research brief prepared for "${topic}".`,
        confidence: 0.7,
        findings: [{ id: "research_brief", title: "Brief ready", detail: brief.slice(0, 300), evidence: [], tags: ["research"] }],
        dataUsed: ["growth:research:topic"],
        nextStep: GROWTH_AGENT_IDS.content,
        aiEnhanced: narration.ok,
        metadata: { brief, angles, aiEnhancement: narration.ok ? narration.provider : undefined },
    });
};

// ─── Content Agent ───────────────────────────────────────────────────────────

const contentExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const brief = String(config.brief || config.topic || "");
    const topic = String(config.topic || "AlgoVault");
    const type = String(config.type || "EDUCATIONAL_CONTENT");
    const tone = String(config.tone || "professional");
    const language = String(config.language || "en");
    const channels = (Array.isArray(config.channels) ? config.channels : ["BLOG"]) as string[];
    const isAffiliate = Boolean(config.affiliateContent) || Boolean(config.offerId);
    const offer = config.offerId ? await getActiveOffer(String(config.offerId)) : null;

    const prompt = [
        `Write the main ${type} content (${tone} tone, ${language}) for the AlgoVault brand about: ${topic}.`,
        isAffiliate && offer ? `Include an honest mention of a partner offer (${offer.provider || offer.name}) with a clear affiliate disclosure: ${affiliateDisclosureSnippet(offer.provider)}.` : "",
        `If the topic touches trading, include: Past performance is not indicative of future results.`,
        `Forbidden: guaranteed returns, fabricated backtests, fake testimonials, "risk-free" claims.`,
    ].filter(Boolean).join("\n");

    const narration = await tryNarrate(prompt, "You are the AlgoVault Content Agent. Write honest, compliance-safe marketing content.", { maxTokens: 900 });

    const mainText = narration.ok
        ? String(narration.text || "")
        : ct.mainDraft(topic, type, brief, {
              tone,
              language,
              affiliateDisclosure: isAffiliate && offer ? affiliateDisclosureSnippet(offer.provider) : undefined,
          });

    const contentBlocks: Record<string, AIContentBlock> = {
        main: { format: "markdown", value: mainText },
    };
    if (channels.includes("EMAIL")) {
        contentBlocks.email = { format: "text", value: ct.emailVariant(mainText) };
    }

    return successOutput({
        agentId: GROWTH_AGENT_IDS.content,
        summary: `Generated ${type} content (${channels.length} channel variant(s) planned).`,
        confidence: narration.ok ? 0.6 : 0.4,
        findings: [
            { id: "content_main", title: "Main draft ready", detail: `${mainText.length} chars`, evidence: [], tags: [type] },
        ],
        dataUsed: [`growth:content:${type}`, ...(offer ? [`growth:offer:${offer.id}`] : [])],
        nextStep: GROWTH_AGENT_IDS.seo,
        aiEnhanced: narration.ok,
        warnings: narration.ok ? [] : ["AI gateway unavailable — deterministic template used."],
        metadata: { contentBlocks, reviewNotes: narration.ok ? "Enriched by AI; verify claims before approval." : "Deterministic template; verify claims before approval." },
    });
};

// ─── SEO Agent ───────────────────────────────────────────────────────────────

const seoExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const content = (config.contentBlocks as Record<string, AIContentBlock> | undefined)?.main?.value || String(config.draft || config.topic || "");
    const title = String(config.title || config.topic || "AlgoVault");

    const narration = await tryNarrate(
        [
            `Given this draft, propose SEO metadata: title (max 60 chars), meta description (max 160 chars), slug (URL-safe), and 5 honest keywords.`,
            `Draft title: ${title}`,
            `Draft excerpt: ${content.slice(0, 800)}`,
            `Do not overpromise.`,
        ].join("\n"),
        "You are the AlgoVault SEO Agent.",
        { maxTokens: 300 }
    );

    const seoTitle = (narration.ok ? (narration.text || "").split("\n").find((l) => /title|slug/i.test(l)) : undefined) || `${title.slice(0, 55)}`;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "algovault-update";

    return successOutput({
        agentId: GROWTH_AGENT_IDS.seo,
        summary: `SEO metadata prepared for "${seoTitle}".`,
        confidence: 0.6,
        findings: [{ id: "seo_meta", title: "SEO metadata", detail: `slug: ${slug}`, evidence: [], tags: ["seo"] }],
        dataUsed: ["growth:seo:draft"],
        nextStep: GROWTH_AGENT_IDS.social,
        aiEnhanced: narration.ok,
        metadata: { seoTitle, metaDescription: (narration.ok ? (narration.text || "").slice(0, 180) : content.slice(0, 155) + "…"), slug, keywords: [] },
    });
};

// ─── Social Agent ────────────────────────────────────────────────────────────

const socialExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const content = (config.contentBlocks as Record<string, AIContentBlock> | undefined)?.main?.value || String(config.draft || "");
    const channels = (Array.isArray(config.channels) ? config.channels : []) as string[];
    const main = content.slice(0, 220);

    const narration = await tryNarrate(
        [
            `Create short social variants from this content for channels: ${channels.join(", ")}.`,
            `Keep the exact same substance and risk framing. Do not add hype or guarantees.`,
            `Content: ${main}`,
        ].join("\n"),
        "You are the AlgoVault Social Agent.",
        { maxTokens: 500 }
    );

    const variants: Record<string, string> = {};
    for (const channel of channels) {
        variants[channel] = ct.socialVariant(main, channel);
    }
    if (narration.ok) {
        // Only keep AI variants per channel if reasonably shaped.
        const parsed = String(narration.text || "").split(/\n(?=-{3,}|###|##)/);
        let idx = 0;
        for (const channel of channels) {
            const snippet = parsed[idx + 1] || parsed[0];
            if (snippet && snippet.length > variants[channel].length) variants[channel] = snippet.trim().slice(0, 700);
            idx++;
        }
    }

    return successOutput({
        agentId: GROWTH_AGENT_IDS.social,
        summary: `Prepared ${Object.keys(variants).length} social variant(s).`,
        confidence: 0.5,
        findings: [{ id: "social_variants", title: "Social variants", detail: Object.keys(variants).join(", ") || "none", evidence: [], tags: ["social"] }],
        dataUsed: ["growth:social:draft"],
        nextStep: GROWTH_AGENT_IDS.compliance,
        aiEnhanced: narration.ok,
        metadata: { variants, hashtags: [] },
    });
};

// ─── Compliance Agent ────────────────────────────────────────────────────────

const complianceExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const content = (config.contentBlocks as Record<string, AIContentBlock> | undefined)?.main?.value || String(config.draft || "");
    const isAffiliate = Boolean(config.affiliateContent) || Boolean(config.offerId);

    const result = checkCompliance(content, { affiliateType: isAffiliate ? "OFFER" : "NONE", isAffiliateContent: isAffiliate });
    const high = result.flags.filter((f) => f.severity === "high");

    return successOutput({
        agentId: GROWTH_AGENT_IDS.compliance,
        summary: high.length > 0 ? `BLOCKED: ${high.length} high-severity compliance flag(s).` : "Compliance check passed.",
        confidence: 1,
        findings: findingsFromFlags(result.flags),
        dataUsed: ["growth:compliance:rules"],
        nextStep: high.length > 0 ? "" : GROWTH_AGENT_IDS.campaign,
        metadata: {
            passed: result.passed && high.length === 0,
            blocked: high.length > 0,
            flags: result.flags.map((f) => ({ rule: f.rule, label: f.label, severity: f.severity })),
            requiresRiskDisclosure: result.requiresRiskDisclosure,
            riskDisclosurePresent: result.riskDisclosurePresent,
            tradingContext: result.tradingContext,
        },
    });
};

// ─── Campaign Agent ──────────────────────────────────────────────────────────

const campaignExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const channels = (Array.isArray(config.channels) ? config.channels : []) as string[];
    const objective = String(config.objective || "AWARENESS");
    const campaignId = String(config.campaignId || "");

    return successOutput({
        agentId: GROWTH_AGENT_IDS.campaign,
        summary: `Campaign plan prepared (${channels.length} channels, objective ${objective}).`,
        confidence: 0.5,
        findings: [{ id: "campaign_plan", title: "Plan", detail: `channels=${channels.join(",")}`, evidence: [], tags: [objective] }],
        dataUsed: [`growth:campaign:${campaignId}`],
        nextStep: GROWTH_AGENT_IDS.publisher,
        metadata: { plan: { channels, objective, campaignId }, suggestedSchedule: [] },
    });
};

// ─── Analytics Agent ─────────────────────────────────────────────────────────

const analyticsExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const start = Number(config.periodStart || 0);
    const end = Number(config.periodEnd || Date.now());
    const kpis: Record<string, number> = {};
    const insufficient: string[] = [];

    try {
        const [events, revenue, conversions] = await Promise.all([
            listCollection<{ type: string; createdAt: number; placementKey?: string; offerId?: string; value?: number }>(COLLECTION_PATHS.events),
            listCollection<{ type: string; amount: number; createdAt: number; estimated?: boolean }>(COLLECTION_PATHS.revenue),
            listCollection<{ type: string; createdAt: number; offerId?: string }>(COLLECTION_PATHS.affiliateConversions),
        ]);

        const scoped = <T extends { createdAt: number }>(items: T[]) => items.filter((i) => i.createdAt >= start && i.createdAt <= end);

        const scopedEvents = scoped(events);
        const impressions = scopedEvents.filter((e) => e.type === "impression").length;
        const clicks = scopedEvents.filter((e) => e.type === "click").length;
        const scopedRevenue = scoped(revenue).filter((r) => r.estimated !== true);
        const revenueSum = scopedRevenue.reduce((acc, r) => acc + Number(r.amount || 0), 0);
        const conversionsCount = scoped(conversions).length;

        kpis.impressions = impressions;
        kpis.clicks = clicks;
        kpis.revenue = revenueSum;
        kpis.conversions = conversionsCount;
        if (impressions > 0 && clicks > 0) kpis.ctr = ctr(clicks, impressions)?.value ?? 0;
        const rpmValue = rpmMetric(revenueSum, impressions);
        if (rpmValue !== null) kpis.rpm = rpmValue;

        if (impressions < 50) insufficient.push("impressions");
        if (clicks < 5) insufficient.push("clicks");
        if (revenueSum <= 0) insufficient.push("revenue");
    } catch (err) {
        console.error("[growth:analytics]", err);
        insufficient.push("analytics store unavailable");
    }

    return successOutput({
        agentId: GROWTH_AGENT_IDS.analytics,
        summary: `Analytics snapshot prepared for ${start ? new Date(start).toISOString().slice(0, 10) : "all"} → ${new Date(end).toISOString().slice(0, 10)}.`,
        confidence: 0.7,
        findings: [{ id: "analytics_kpis", title: "KPIs", detail: JSON.stringify(kpis), evidence: [], tags: ["analytics"] }],
        dataUsed: ["growth:events", "growth:revenue", "growth:conversions"],
        nextStep: GROWTH_AGENT_IDS.optimization,
        metadata: { kpis, insufficient },
    });
};

// ─── Optimization Agent ──────────────────────────────────────────────────────

const optimizationExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const kpis = (config.kpis || {}) as Record<string, number>;
    const mode = String(config.mode || "RECOMMENDATION_ONLY");
    const periodStart = Number(config.periodStart || 0);
    const periodEnd = Number(config.periodEnd || Date.now());
    const recommendations: Record<string, unknown>[] = [];

    if ((kpis.impressions || 0) > 0) {
        recommendations.push({
            kind: "CONTENT_TOPIC",
            title: "Double down on top-performing format",
            description: "Content on the best-performing channels drove the most engagement this period.",
            rationale: `Based on ${kpis.impressions} impressions and ${kpis.clicks || 0} clicks.`,
            status: "PENDING",
            mode,
            safeToAutoApply: true,
            data: { periodStart, periodEnd, sampleSize: kpis.impressions },
        });
    }
    if ((kpis.revenue || 0) > 0 && mode === "AUTO_OPTIMIZE") {
        recommendations.push({
            kind: "MONETIZATION_PLACEMENT",
            title: "Shift placements toward higher-RPM surfaces",
            description: "AUTO_OPTIMIZE only adjusts placement priority, never financial settings.",
            rationale: `Revenue ${kpis.revenue} recorded this period.`,
            status: "PENDING",
            mode,
            safeToAutoApply: true,
            data: { periodStart, periodEnd, sampleSize: kpis.impressions || 0 },
        });
    }

    return successOutput({
        agentId: GROWTH_AGENT_IDS.optimization,
        summary: `${recommendations.length} optimization recommendation(s) produced (${mode}).`,
        confidence: 0.5,
        findings: recommendations.map((r, i) => ({ id: `opt_${i}`, title: String(r.title), detail: String(r.description), evidence: [], tags: [String(r.kind)] })),
        dataUsed: ["growth:kpis"],
        nextStep: "",
        metadata: { recommendations, mode },
    });
};

// ─── Publisher Agent ─────────────────────────────────────────────────────────

const publisherExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const taskId = String(config.taskId || "");
    const channels = (Array.isArray(config.channels) ? config.channels : []) as string[];
    const content = (config.contentBlocks as Record<string, AIContentBlock> | undefined)?.main?.value || String(config.draft || "");
    const taskState = String(config.taskState || "");

    // Safety gate: only publishable states may be published.
    if (!["APPROVED", "SCHEDULED", "PUBLISHED"].includes(taskState)) {
        return failureOutput(GROWTH_AGENT_IDS.publisher, `Refused to publish: task state "${taskState}" is not publishable.`);
    }

    const published: { channel: string; externalId: string }[] = [];
    const blocked: string[] = [];

    for (const channel of channels) {
        const adapter = getAdapter(channel as Parameters<typeof getAdapter>[0]);
        const variant = (config.variants as Record<string, string> | undefined)?.[channel] || content;
        const result = await publishWithTimeout(adapter, {
            title: String(config.title || ""),
            text: variant,
            url: String(config.url || ""),
            metadata: { taskId },
        });
        if (result.ok) {
            published.push({ channel, externalId: result.externalId });
            await writeGrowthAudit({
                actor: "growth:publisher",
                action: "content_published",
                targetType: "marketingTask",
                targetId: taskId,
                detail: { channel, externalId: result.externalId, url: result.url },
            });
        } else {
            blocked.push(`${channel}:${result.reason}`);
        }
    }

    return successOutput({
        agentId: GROWTH_AGENT_IDS.publisher,
        summary: published.length > 0 ? `Published to ${published.length} channel(s).` : "Nothing published (channels not configured or blocked).",
        confidence: published.length > 0 ? 1 : 0.8,
        findings: [
            { id: "publish_result", title: "Publish result", detail: `published=${published.length} blocked=${blocked.length}`, evidence: [], tags: ["publish"] },
        ],
        dataUsed: ["growth:channels", "growth:task"],
        nextStep: "",
        warnings: blocked.length > 0 ? blocked : undefined,
        metadata: { published, blocked, taskId },
    });
};

// ─── Report Agent ────────────────────────────────────────────────────────────

const reportExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
    const config = readConfig(ctx);
    const analytics = (config.analyticsOutput as AgentOutput | undefined)?.metadata || {};
    const kpis = (analytics.kpis || {}) as Record<string, number>;
    const interval = String(config.interval || "WEEKLY");

    const sections = [
        {
            key: "traffic",
            title: "Traffic",
            metrics: [
                { label: "Impressions", value: String(kpis.impressions ?? 0) },
                { label: "Clicks", value: String(kpis.clicks ?? 0) },
                { label: "CTR", value: kpis.ctr !== undefined ? `${kpis.ctr.toFixed(2)}%` : "Insufficient data" },
            ],
        },
        {
            key: "revenue",
            title: "Revenue",
            metrics: [
                { label: "Revenue", value: kpis.revenue !== undefined ? `$${Number(kpis.revenue).toFixed(2)}` : "Insufficient data" },
                { label: "RPM", value: kpis.rpm !== undefined ? `$${kpis.rpm.toFixed(2)}` : "Insufficient data" },
            ],
        },
        {
            key: "conversions",
            title: "Conversions",
            metrics: [{ label: "Conversions", value: String(kpis.conversions ?? 0) }],
        },
    ];

    return successOutput({
        agentId: GROWTH_AGENT_IDS.report,
        summary: `Growth report compiled (${interval}).`,
        confidence: 0.8,
        findings: [{ id: "report_sections", title: "Report sections", detail: sections.map((s) => s.key).join(", "), evidence: [], tags: ["report"] }],
        dataUsed: ["growth:analytics"],
        nextStep: "",
        metadata: { sections, interval },
    });
};

// ─── Registration ────────────────────────────────────────────────────────────

let executorsRegistered = false;

export function registerGrowthExecutors(): void {
    if (executorsRegistered) return;
    executorsRegistered = true;
    registerAgentExecutor(GROWTH_AGENT_IDS.research, researchExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.content, contentExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.seo, seoExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.social, socialExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.compliance, complianceExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.campaign, campaignExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.analytics, analyticsExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.optimization, optimizationExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.publisher, publisherExecutor);
    registerAgentExecutor(GROWTH_AGENT_IDS.report, reportExecutor);
}

registerGrowthExecutors();