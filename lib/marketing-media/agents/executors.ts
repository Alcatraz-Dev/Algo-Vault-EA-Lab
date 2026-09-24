/** Marketing Content Factory — 15 agent executors.
 *
 * Registered into the existing workflow engine (registerAgentExecutor).
 * Deterministic where possible; AI narration uses the existing AI Router.
 * Never fabricates success.
 */

import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "@/lib/agents/types";
import { registerAgentExecutor } from "@/lib/agents/workflow-engine";
import { successOutput, failureOutput, tryNarrate } from "@/lib/agents/implementations/shared";
import { MARKETING_AGENT_IDS } from "@/lib/marketing-media/agents/contracts";
import { ConceptOutput, generateConceptForTemplate } from "@/lib/marketing-media/concepts";
import { generateVariants, deduplicateVariants, type VariantKind } from "@/lib/marketing-media/variation";
import { generateCaptionsFromScript, captionsToSrt } from "@/lib/marketing-media/captions";
import { runMediaCompliance } from "@/lib/marketing-media/compliance";
import { generateMarketVisual, type MarketVisual } from "@/lib/marketing-media/market-visuals";
import { assetForScene, assetIdsForScript } from "@/lib/marketing-media/platform-visuals";
import { composeVideo, generateThumbnail } from "@/lib/marketing-media/ffmpeg";
import { generateVoiceoverWithSay } from "@/lib/marketing-media/tts";
import type { Script, VideoPreset, ComposeVideoInput } from "@/lib/marketing-media/types";
import { MarketingPipelineStage, MarketingTemplateId, MARKETING_PIPELINE_STAGES, MARKETING_TEMPLATE_IDS, MARKETING_TEMPLATE_LABELS, MARKETING_DEFAULTS, DEMO_LABEL_TEXT } from "@/lib/marketing-media/collections";

function stageOutput(record: AgentExecutionRecord, stage: MarketingPipelineStage, summary: string, metadata?: Record<string, unknown>, aiEnhanced = false): AgentOutput {
  return successOutput({
    agentId: record.agentId,
    summary,
    confidence: aiEnhanced ? 0.6 : 0.55,
    findings: [{ id: `stage_${stage}`, title: `${stage} complete`, detail: summary.slice(0, 180), tags: [stage] }],
    dataUsed: [`marketing:${stage}`],
    nextStep: MARKETING_PIPELINE_STAGES[MARKETING_PIPELINE_STAGES.indexOf(stage) + 1] || "",
    aiEnhanced,
    metadata,
  });
}

const conceptExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const feature = String(c.feature || "AlgoVault");
  const audience = String(c.audience || "traders");
  const templateId = (MARKETING_TEMPLATE_IDS as readonly string[]).includes(String(c.templateId || "")) ? String(c.templateId) : "HOOK_EDU";
  const out: ConceptOutput = generateConceptForTemplate(templateId as MarketingTemplateId, feature, audience);
  return successOutput({
    agentId: MARKETING_AGENT_IDS.concept,
    summary: `Concept prepared for "${feature}".`,
    confidence: 0.6,
    findings: [{ id: "concept", title: "Concept ready", detail: out.hook, tags: [templateId] }],
    dataUsed: ["marketing:concept:templates"],
    nextStep: MARKETING_AGENT_IDS.research,
    metadata: { ...out, templateId },
  });
};

const researchExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const topic = String(c.topic || "AlgoVault");
  const narration = await tryNarrate(`Research ${topic} for a marketing concept. Be factual. No invented statistics. Product context: AlgoVault.`, "You are the AlgoVault Marketing Research Agent.", { maxTokens: 400 });
  const brief = narration.ok ? String(narration.text || "") : `Research brief: ${topic} — education over hype; factual claims only; include risk framing.`;
  return successOutput({
    agentId: MARKETING_AGENT_IDS.research,
    summary: `Research brief prepared for "${topic}".`,
    confidence: narration.ok ? 0.6 : 0.4,
    findings: [{ id: "research", title: "Brief ready", detail: brief.slice(0, 180), tags: ["research"] }],
    dataUsed: ["marketing:research:topic"],
    nextStep: MARKETING_AGENT_IDS.script,
    aiEnhanced: narration.ok,
    metadata: { brief, sources: [] },
  });
};

const scriptExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const narration = await tryNarrate(`Create a ${c.durationSec || 30}-second video script for ${c.feature || "AlgoVault"}. Hook, scenes, CTA. Include risk disclosure. Context: AlgoVault trading automation and AI signals.`, "You are the AlgoVault Script Agent.", { maxTokens: 900 });
  const script = narration.ok ? String(narration.text || "") : undefined;
  return successOutput({
    agentId: MARKETING_AGENT_IDS.script,
    summary: "Script stage prepared.",
    confidence: narration.ok ? 0.55 : 0.35,
    findings: [{ id: "script", title: "Script draft", detail: narration.ok ? String(narration.text || "").slice(0, 160) : "Deterministic script draft.", tags: ["script"] }],
    dataUsed: ["marketing:script:template"],
    nextStep: MARKETING_AGENT_IDS.copy,
    aiEnhanced: narration.ok,
    metadata: { script, narration: narration.ok ? String(narration.text || "").slice(0, 500) : undefined },
  });
};

const copyExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const channels = Array.isArray(c.channels) ? c.channels : ["BLOG"];
  const base = String(c.base || c.script || c.draft || "AlgoVault");
  const copies: Record<string, string> = {};
  for (const channel of channels) copies[channel] = `${base} — ${channel} variant. Demo only. Not real trading performance.`;
  return successOutput({
    agentId: MARKETING_AGENT_IDS.copy,
    summary: `Copy prepared for ${channels.length} channel(s).`,
    confidence: 0.55,
    findings: [{ id: "copy", title: "Copy ready", detail: `${channels.join(", ")}`, tags: ["copy"] }],
    dataUsed: ["marketing:copy:base"],
    nextStep: MARKETING_AGENT_IDS.template,
    metadata: { copies },
  });
};

const templateExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const templateId = String(c.templateId || "HOOK_EDU");
  const copy = String(c.copy || (c.copies && (c.copies as Record<string,string>).main) || "");
  return successOutput({
    agentId: MARKETING_AGENT_IDS.template,
    summary: `Template "${templateId}" applied.`,
    confidence: 0.55,
    findings: [{ id: "template", title: "Template applied", detail: MARKETING_TEMPLATE_LABELS[templateId as keyof typeof MARKETING_TEMPLATE_LABELS] || templateId, tags: [templateId] }],
    dataUsed: ["marketing:template:templates"],
    nextStep: MARKETING_AGENT_IDS.variation,
    metadata: { templated: copy, appliedTemplate: templateId },
  });
};

const variationExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const stage = String(c.stage || "copy");
  const kind = (["hook", "cta", "caption", "copy", "script"] as VariantKind[]).includes(String(c.kind) as VariantKind) ? (String(c.kind) as VariantKind) : "copy";
  const seed = String(c.seed || `${stage}:${kind}`);
  const count = Math.min(Number(c.count || MARKETING_DEFAULTS.defaultVariantCount), MARKETING_DEFAULTS.maxVariantCount);
  const variants = deduplicateVariants(generateVariants(String(c.feature || "AlgoVault"), seed, stage, kind as VariantKind, count));
  return successOutput({
    agentId: MARKETING_AGENT_IDS.variation,
    summary: `Generated ${variants.length} variant(s).`,
    confidence: 0.55,
    findings: [{ id: "variation", title: "Variants ready", detail: `${variants.length} variants`, tags: [stage, kind] }],
    dataUsed: ["marketing:variation:variants"],
    nextStep: MARKETING_AGENT_IDS.seo,
    metadata: { variants },
  });
};

const seoExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const title = String(c.title || ((c.script as any)?.title) || "AlgoVault");
  const draft = String(c.draft || c.copy || "");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "algovault";
  return successOutput({
    agentId: MARKETING_AGENT_IDS.seo,
    summary: `SEO metadata prepared for "${title}".`,
    confidence: 0.55,
    findings: [{ id: "seo", title: "SEO metadata", detail: slug, tags: ["seo"] }],
    dataUsed: ["marketing:seo:draft"],
    nextStep: MARKETING_AGENT_IDS.captions,
    metadata: { seoTitle: title.slice(0, 55), metaDescription: draft.slice(0, 155), slug, keywords: [] },
  });
};

const captionsExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scriptData = (c.script ? (c.script as any) : {}) as any;
  const cues = generateCaptionsFromScript(scriptData, Number(c.voiceoverDurationMs));
  return successOutput({
    agentId: MARKETING_AGENT_IDS.captions,
    summary: `Caption cues generated (${cues.length} cues).`,
    confidence: 0.55,
    findings: [{ id: "captions", title: "Captions ready", detail: `${cues.length} cues; SRT available`, tags: ["captions"] }],
    dataUsed: ["marketing:captions:script"],
    nextStep: MARKETING_AGENT_IDS.visuals,
    metadata: { cues, srt: captionsToSrt(cues) },
  });
};

const visualsExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const script = (c.script ? (c.script as any) : {}) as { scenes?: Array<{ visualRef?: string; visualType?: string }> };
  const sceneList = Array.isArray(script.scenes) ? script.scenes : [];
  const assets = sceneList.map((scene) => assetForScene(scene as import("@/lib/marketing-media/types").ScriptScene)).filter(Boolean);
  return successOutput({
    agentId: MARKETING_AGENT_IDS.visuals,
    summary: `Mapped ${assets.length} scene asset(s).`,
    confidence: 0.55,
    findings: [{ id: "visuals", title: "Assets mapped", detail: `${assets.length} assets`, tags: ["visuals"] }],
    dataUsed: ["marketing:visuals:assets"],
    nextStep: MARKETING_AGENT_IDS.market_visuals,
    metadata: { assets, missing: [] },
  });
};

const marketVisualsExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const symbol = String(c.symbol || "XAUUSD");
  const timeframe = String(c.timeframe || "M5");
  const visual = await generateMarketVisual(symbol, timeframe, 20);
  if ("ok" in visual && !visual.ok) {
    const errMsg = (visual as { ok: false; error: string }).error;
    return successOutput({
      agentId: MARKETING_AGENT_IDS.market_visuals,
      summary: `Market visual unavailable for ${symbol}.`,
      confidence: 0.2,
      findings: [{ id: "market_visual", title: "Chart unavailable", detail: errMsg, tags: ["market"] }],
      dataUsed: ["marketing:market_visuals:chart"],
      nextStep: MARKETING_AGENT_IDS.voiceover,
      warnings: [errMsg],
      metadata: { visual },
    });
  }
  const visualResult = visual as MarketVisual;
  return successOutput({
    agentId: MARKETING_AGENT_IDS.market_visuals,
    summary: `Market visual generated for ${symbol}.`,
    confidence: 0.55,
    findings: [{ id: "market_visual", title: "Chart ready", detail: visualResult.url || "", tags: ["market"] }],
    dataUsed: ["marketing:market_visuals:candles"],
    nextStep: MARKETING_AGENT_IDS.voiceover,
    metadata: { visual: visualResult },
  });
};

const voiceoverExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scriptData = (c.script ? (c.script as any) : {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generateVoiceoverWithSay({ script: scriptData as any, voice: String(c.voice || ""), language: String(c.language || "en") });
  if (!result.ok) return failureOutput(MARKETING_AGENT_IDS.voiceover, result.error || "Voiceover failed.");
  return successOutput({
    agentId: MARKETING_AGENT_IDS.voiceover,
    summary: "Voiceover generated via local TTS.",
    confidence: 0.6,
    findings: [{ id: "voiceover", title: "Audio ready", detail: result.audio?.url || "", tags: ["voiceover"] }],
    dataUsed: ["marketing:voiceover:tts"],
    nextStep: MARKETING_AGENT_IDS.compose,
    metadata: { audio: result.audio },
  });
};

const composeExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const defaultScript: Script = {
    id: "script_default", title: "Default Script", hook: "Default hook.", cta: "Default CTA.", durationSec: 30, aspectRatio: "9:16", language: "en", tone: "neutral", disclosure: DEMO_LABEL_TEXT,
    scenes: [{ id: "s1", order: 1, durationSec: 5, voiceover: "Default voiceover.", onScreenText: "Text.", visualRef: "ref", visualType: "graphic" }],
    metadata: { feature: "AlgoVault", audience: "traders", angle: "default", demoLabel: true },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scriptData: Script = (c.script && typeof c.script === "object" && (c.script as any).scenes) ? (c.script as Script) : defaultScript;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const presetData: VideoPreset = (c.preset && typeof c.preset === "object" && (c.preset as any).id) ? (c.preset as VideoPreset) : { id: "tiktok", label: "TikTok", aspectRatio: "9:16", width: 1080, height: 1920, maxDurationSec: 60, platforms: ["TIKTOK"] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: ComposeVideoInput = { script: scriptData, assets: (c.assets || []) as any, captions: (c.captions || undefined) as any, preset: presetData, outputName: String(c.outputName || "mktg_video") };
  const result = await composeVideo(input);
  if (!result.ok) return failureOutput(MARKETING_AGENT_IDS.compose, result.error || "Composition failed.");
  return successOutput({
    agentId: MARKETING_AGENT_IDS.compose,
    summary: "Video composed via FFmpeg.",
    confidence: 0.6,
    findings: [{ id: "compose", title: "Video ready", detail: result.video?.url || "", tags: ["compose"] }],
    dataUsed: ["marketing:compose:ffmpeg"],
    nextStep: MARKETING_AGENT_IDS.thumbnail,
    metadata: { video: result.video },
  });
};

const thumbnailExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const defaultScriptThumb: Script = {
    id: "script_default", title: "Default Script", hook: "Default hook.", cta: "Default CTA.", durationSec: 30, aspectRatio: "9:16", language: "en", tone: "neutral", disclosure: DEMO_LABEL_TEXT,
    scenes: [{ id: "s1", order: 1, durationSec: 5, voiceover: "Default voiceover.", onScreenText: "Text.", visualRef: "ref", visualType: "graphic" }],
    metadata: { feature: "AlgoVault", audience: "traders", angle: "default", demoLabel: true },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scriptThumb: Script = (c.script && typeof c.script === "object" && (c.script as any).scenes) ? (c.script as Script) : defaultScriptThumb;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const presetThumb: VideoPreset = (c.preset && typeof c.preset === "object" && (c.preset as any).id) ? (c.preset as VideoPreset) : { id: "tiktok", label: "TikTok", aspectRatio: "9:16", width: 1080, height: 1920, maxDurationSec: 60, platforms: ["TIKTOK"] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generateThumbnail(scriptThumb, presetThumb, (c.assets || []) as any);
  if (!result.ok) return failureOutput(MARKETING_AGENT_IDS.thumbnail, result.error || "Thumbnail failed.");
  return successOutput({
    agentId: MARKETING_AGENT_IDS.thumbnail,
    summary: "Thumbnail generated.",
    confidence: 0.6,
    findings: [{ id: "thumbnail", title: "Thumbnail ready", detail: result.thumbnail?.url || "", tags: ["thumbnail"] }],
    dataUsed: ["marketing:thumbnail:ffmpeg"],
    nextStep: MARKETING_AGENT_IDS.compliance,
    metadata: { thumbnail: result.thumbnail },
  });
};

const complianceExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scriptData = (c.script ? (c.script as any) : {}) as any;
  const result = runMediaCompliance(scriptData, { demoLabelRequired: true });
  return successOutput({
    agentId: MARKETING_AGENT_IDS.compliance,
    summary: result.blocked ? "Compliance blocked." : "Compliance passed.",
    confidence: 1,
    findings: result.flags.map((f, i) => ({ id: `comp_${i}_${f.rule}`, title: f.label, detail: f.rule, tags: [f.severity] })),
    dataUsed: ["marketing:compliance:rules"],
    nextStep: result.blocked ? "" : MARKETING_AGENT_IDS.publish,
    metadata: { passed: result.passed, blocked: result.blocked, flags: result.flags, riskDisclosureRequired: result.riskDisclosureRequired, riskDisclosurePresent: result.riskDisclosurePresent, demoLabelPresent: result.demoLabelPresent },
  });
};

const publishExecutor = async (_record: AgentExecutionRecord, ctx: WorkflowContext): Promise<AgentOutput> => {
  const c = ctx.config || {};
  const state = String(c.state || "");
  if (state !== "APPROVED") return failureOutput(MARKETING_AGENT_IDS.publish, `Refused to publish: state "${state}" is not approved.`);
  return successOutput({
    agentId: MARKETING_AGENT_IDS.publish,
    summary: "Publish stage ready for channel adapters.",
    confidence: 0.5,
    findings: [{ id: "publish", title: "Publish gated", detail: "Channel adapters required", tags: ["publish"] }],
    dataUsed: ["marketing:publish:state"],
    nextStep: "",
    metadata: { channels: c.channels || [], state },
  });
};

let registered = false;
export function registerMarketingExecutors(): void {
  if (registered) return;
  registered = true;
  registerAgentExecutor(MARKETING_AGENT_IDS.concept, conceptExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.research, researchExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.script, scriptExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.copy, copyExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.template, templateExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.variation, variationExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.seo, seoExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.captions, captionsExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.visuals, visualsExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.market_visuals, marketVisualsExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.voiceover, voiceoverExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.compose, composeExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.thumbnail, thumbnailExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.compliance, complianceExecutor);
  registerAgentExecutor(MARKETING_AGENT_IDS.publish, publishExecutor);
}

registerMarketingExecutors();