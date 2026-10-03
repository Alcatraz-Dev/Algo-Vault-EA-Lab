/**
 * Marketing Agent — CampaignPlanner (§4, §10, §40, §46).
 *
 * Turns a parsed intent into a concrete, resumable task graph plus the creative
 * parameters the downstream agents need. Every task declares its dependencies,
 * so a failure at task N resumes at task N instead of replaying 1…N-1.
 *
 * Pure module: no I/O.
 */

import {
  MARKETING_AGENT_TASKS,
  MARKETING_AGENT_TASK_LABELS,
  PLATFORM_ASPECT_RATIOS,
  type MarketingAgentTaskId,
  type MarketingApprovalPolicy,
  type MarketingLanguage,
  type MarketingPlatform,
} from "./collections";
import type { CampaignPlan, CampaignPlanTask, MarketingAgentSettings, ParsedIntent } from "./types";
import {
  getFeature,
  requiresTradingDisclaimer,
  resolveCtaDestination,
  selectFeaturesForFreeformPrompt,
} from "./product-knowledge";
import { estimateProduction, type ProductionEstimate } from "./cost";
import { parseScheduleHint, type ParsedSchedule } from "./scheduling";
import { DEFAULT_AGENT_SETTINGS } from "./modes";

const ASSISTED_TASK_ORDER: MarketingAgentTaskId[] = [
  "understand_request",
  "identify_product",
  "identify_audience",
  "identify_platforms",
  "determine_duration",
  "verify_product_facts",
  "build_capture_plan",
  "build_creative_brief",
  "write_script",
  "write_shot_list",
  "capture_product",
  "generate_assets",
  "compose_video",
  "add_audio",
  "add_captions",
  "add_motion",
  "apply_branding",
  "apply_disclaimer",
  "render_platforms",
  "run_qa",
  "generate_publishing_assets",
  "request_approval",
  "schedule",
  "publish",
  "verify_publication",
  "collect_performance",
  "generate_learning",
];

/** Hard dependencies that must hold regardless of the request shape. */
const TASK_DEPENDENCIES: Record<MarketingAgentTaskId, MarketingAgentTaskId[]> = {
  understand_request: [],
  identify_product: ["understand_request"],
  identify_audience: ["understand_request"],
  identify_platforms: ["understand_request"],
  determine_duration: ["understand_request"],
  verify_product_facts: ["identify_product"],
  build_capture_plan: ["identify_product", "verify_product_facts"],
  build_creative_brief: ["identify_audience", "identify_platforms", "determine_duration", "verify_product_facts"],
  write_script: ["build_creative_brief"],
  write_shot_list: ["write_script"],
  capture_product: ["build_capture_plan"],
  generate_assets: ["write_shot_list"],
  compose_video: ["write_shot_list", "generate_assets"],
  add_audio: ["compose_video"],
  add_captions: ["add_audio"],
  add_motion: ["compose_video"],
  apply_branding: ["compose_video"],
  apply_disclaimer: ["write_script", "verify_product_facts"],
  render_platforms: ["compose_video", "add_audio", "add_captions", "add_motion", "apply_branding", "apply_disclaimer"],
  run_qa: ["render_platforms"],
  generate_publishing_assets: ["run_qa"],
  request_approval: ["run_qa", "generate_publishing_assets"],
  schedule: ["request_approval"],
  publish: ["schedule"],
  verify_publication: ["publish"],
  collect_performance: ["verify_publication"],
  generate_learning: ["collect_performance"],
};

export type PlannerInput = {
  intent: ParsedIntent;
  settings?: MarketingAgentSettings;
  /** Reuse an existing campaign (§25) — never create a second one. */
  existingCampaignId?: string;
  existingCreativeId?: string;
  jobId: string;
  actor: string;
  now?: number;
  /** Set when the run resumes and the plan already exists. */
  plan?: CampaignPlan;
};

export type PlannerOutput = {
  plan: CampaignPlan;
  estimate: ProductionEstimate;
  schedule: ParsedSchedule;
  destinationUrl: string | null;
  disclaimerRequired: boolean;
  warnings: string[];
};

/** Select the task subset applicable to this request (§4). */
export function selectTasks(intent: ParsedIntent): { tasks: MarketingAgentTaskId[]; skipped: MarketingAgentTaskId[] } {
  const include = new Set<MarketingAgentTaskId>([
    "understand_request",
    "identify_product",
    "identify_audience",
    "identify_platforms",
    "determine_duration",
    "verify_product_facts",
    "build_creative_brief",
    "write_script",
    "write_shot_list",
    "generate_assets",
    "compose_video",
    "add_audio",
    "add_captions",
    "add_motion",
    "apply_branding",
    "apply_disclaimer",
    "render_platforms",
    "run_qa",
    "generate_publishing_assets",
    "request_approval",
  ]);

  if (intent.wantsBrowserDemo) {
    include.add("build_capture_plan");
    include.add("capture_product");
  }

  const downstream: MarketingAgentTaskId[] = [];
  if (intent.wantsSchedule || intent.wantsPublish) downstream.push("schedule");
  if (intent.wantsPublish) downstream.push("publish", "verify_publication", "collect_performance", "generate_learning");
  if (intent.command === "ANALYZE" || intent.command === "REFRESH") downstream.push("collect_performance", "generate_learning");
  downstream.forEach((t) => include.add(t));

  // Order matters: dependencies must appear before dependants.
  const tasks = ASSISTED_TASK_ORDER.filter((t) => include.has(t));
  const skipped = MARKETING_AGENT_TASKS.filter((t) => !include.has(t));
  return { tasks, skipped };
}

export function buildPlan(input: PlannerInput): PlannerOutput {
  const now = input.now ?? Date.now();
  const settings = input.settings ?? DEFAULT_AGENT_SETTINGS;
  const intent = input.intent;
  const warnings: string[] = [];

  // ── Products (§74 freeform: choose from the approved catalogue) ───────────
  let products = intent.products;
  const freeform =
    products.length === 0 ||
    (products.length === 1 && products[0] === "platform-overview" && /\b(choose|yourself|strongest|best features|explore)\b/i.test(intent.prompt));
  if (freeform) {
    products = selectFeaturesForFreeformPrompt(intent.prompt, 3).map((f) => f.key);
    if (products.length > 0) warnings.push("Selected features from the approved product catalogue.");
  }

  // ── Platforms ─────────────────────────────────────────────────────────────
  let platforms = intent.platforms.filter((p) => settings.allowedPlatforms.includes(p));
  if (intent.platforms.length > 0 && platforms.length === 0) {
    warnings.push("Requested platforms are not enabled — falling back to allowed defaults.");
  }
  if (platforms.length === 0) platforms = settings.allowedPlatforms.slice(0, 3);

  // ── Languages ─────────────────────────────────────────────────────────────
  let languages = intent.languages.filter((l) => settings.allowedLanguages.includes(l));
  if (intent.languages.length > 0 && languages.length === 0) {
    warnings.push("Requested languages are not enabled — falling back to English.");
  }
  if (languages.length === 0) languages = ["en"] as MarketingLanguage[];

  // ── Duration ──────────────────────────────────────────────────────────────
  const durationSec = Math.max(10, Math.min(intent.durationSec ?? 30, settings.maxRenderDurationSec));

  // ── Tone / style ──────────────────────────────────────────────────────────
  const tone = intent.remix?.tone ?? intent.tone ?? inferTone(intent);
  const toneDirection = intent.tone && intent.remix?.tone ? `Make it more ${intent.remix.tone}.` : null;

  // ── Template (data-driven, §68) ───────────────────────────────────────────
  const templateId = chooseTemplate(intent);

  // ── Task graph ────────────────────────────────────────────────────────────
  const { tasks: selected, skipped } = selectTasks(intent);
  const tasks: CampaignPlanTask[] = selected.map((id) => ({
    id,
    label: MARKETING_AGENT_TASK_LABELS[id],
    dependsOn: TASK_DEPENDENCIES[id].filter((d) => selected.includes(d)),
    status: "PENDING",
    attempts: 0,
  }));

  // Prune dependencies that point at excluded tasks.
  for (const t of tasks) t.dependsOn = t.dependsOn.filter((d) => selected.includes(d));

  const taskIndex: Record<string, number> = {};
  tasks.forEach((t, i) => (taskIndex[t.id] = i));

  // ── Approval policy (§40) ─────────────────────────────────────────────────
  const tradingContent = requiresTradingDisclaimer(products) || /\b(trad|signal|profit|market|forex|cfd)\w*/i.test(intent.prompt);
  const approvalPolicy: MarketingApprovalPolicy = tradingContent
    ? "REQUIRED_FOR_TRADING_CLAIMS"
    : intent.referencePrompt
      ? "AUTO_APPROVE_TEMPLATE"
      : settings.approvalPolicy;

  const requiresApproval = approvalPolicy !== "AUTO_APPROVE_ALL";

  // ── Production workload (§46) ─────────────────────────────────────────────
  const estimate = estimateProduction({
    videos: 1,
    variants: intent.remix?.count ?? intent.variantCount,
    languages: languages.length,
    platforms: platforms.length,
    durationSec,
    settings,
  });
  if (estimate.blocked) warnings.push(estimate.blockedReason ?? "Production workload blocked.");
  estimate.warnings.forEach((w) => warnings.push(w));

  // ── Schedule (§26) ────────────────────────────────────────────────────────
  const schedule = parseScheduleHint(intent.scheduleHint, {
    timezone: settings.defaultTimezone,
    now,
    platform: platforms[0],
  });

  // ── Destination (§35) ─────────────────────────────────────────────────────
  const destinationUrl = resolveCtaDestination(products);

  const disclaimerRequired = requiresTradingDisclaimer(products);

  const plan: CampaignPlan = {
    jobId: input.jobId,
    campaignId: input.existingCampaignId,
    title: deriveTitle(intent, products),
    objective: intent.objective ?? "AWARENESS",
    audience: intent.audience ?? "Traders evaluating AlgoVault",
    products,
    platforms,
    languages,
    durationSec,
    aspectRatios: Array.from(new Set(platforms.map((p) => PLATFORM_ASPECT_RATIOS[p]))),
    tone,
    style: intent.style ?? "product-demo",
    toneDirection,
    templateId,
    tasks,
    taskIndex,
    skipped,
    requiresBrowserCapture: intent.wantsBrowserDemo,
    requiresApproval,
    approvalPolicy,
    estimatedUnits: estimate.units,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor,
  };

  return { plan, estimate, schedule, destinationUrl, disclaimerRequired, warnings };
}

function inferTone(intent: ParsedIntent): string {
  if (intent.tone) return intent.tone;
  if (intent.command === "TRANSLATE") return "professional";
  return "professional";
}

function chooseTemplate(intent: ParsedIntent): string {
  const prompt = intent.prompt.toLowerCase();
  if (/\b(how to|walkthrough|tutorial|step by step)\b/.test(prompt)) return "HOW_IT_WORKS";
  if (/\b(announce|new|launch|just added)\b/.test(prompt)) return "FEATURE_SPOTLIGHT";
  if (/\b(compare|versus|vs|better than)\b/.test(prompt)) return "COMPARISON";
  if (/\bmyth|misconception|truth\b/.test(prompt)) return "MYTH_VS_FACT";
  if (/\b(pro|upgrade|premium|plan)\b/.test(prompt)) return "CTA_DRIVE";
  if (/\b(risk|warning|careful|before you)\b/.test(prompt)) return "RISK_FIRST";
  if (/\b(use case|scenario|story|day in)\b/.test(prompt)) return "USE_CASE";
  if (/\b(workflow|lifecycle|end to end|process)\b/.test(prompt)) return "LIFECYCLE";
  if (/\b(context|news|session|today)\b/.test(prompt)) return "MARKET_CONTEXT";
  return "HOOK_EDU";
}

function deriveTitle(intent: ParsedIntent, products: string[]): string {
  const names = products.map((p) => getFeature(p)?.name ?? p).slice(0, 2);
  const platform = intent.platforms[0] ?? "";
  const suffix = platform ? ` · ${platform.replace("_", " ")}` : "";
  return `${names.join(" + ") || "AlgoVault"} campaign${suffix}`;
}

/** Topological order for the graph (used by the runner and by tests). */
export function topologicalOrder(tasks: CampaignPlanTask[]): MarketingAgentTaskId[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const out: MarketingAgentTaskId[] = [];

  const visit = (id: MarketingAgentTaskId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // cycle guard — the registry is acyclic by construction
    visiting.add(id);
    const task = byId.get(id);
    if (task) task.dependsOn.forEach((d) => visit(d));
    visiting.delete(id);
    visited.add(id);
    out.push(id);
  };

  tasks.forEach((t) => visit(t.id));
  return out;
}

/** Ready-to-run tasks: all dependencies DONE, not yet started. */
export function readyTasks(tasks: CampaignPlanTask[]): CampaignPlanTask[] {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  return tasks.filter(
    (t) =>
      t.status === "PENDING" && t.dependsOn.every((d) => status.get(d) === "DONE" || status.get(d) === "SKIPPED")
  );
}

/** First non-terminal index — the resume cursor (§4). */
export function resumeCursor(tasks: CampaignPlanTask[]): number {
  const idx = tasks.findIndex((t) => t.status === "PENDING" || t.status === "RUNNING" || t.status === "BLOCKED" || t.status === "FAILED");
  return idx < 0 ? tasks.length : idx;
}
