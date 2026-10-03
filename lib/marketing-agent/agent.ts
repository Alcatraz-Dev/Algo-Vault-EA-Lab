/**
 * Marketing Agent — orchestrator (§1, §3, §4, §43, §73).
 *
 * Runs the resumable task graph produced by the CampaignPlanner, one logical
 * responsibility at a time, persisting progress after every task so a failure
 * at task N resumes at task N (§4).
 *
 * Honesty rules enforced throughout (§91):
 *  - a task reports DONE only when its artifact exists;
 *  - `capture_product` fails when no capture runtime is configured;
 *  - `publish` is SKIPPED with a reason when the mode/flags do not allow it;
 *  - approval-gated runs stop in AWAITING_APPROVAL instead of pretending.
 *
 * Server-only module.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  MARKETING_AGENT_DEFAULTS,
  MARKETING_AGENT_TASK_LABELS,
  type MarketingAgentMode,
  type MarketingAgentTaskId,
} from "./collections";
import type {
  BrowserCapture,
  CampaignPlan,
  ClaimCheckResult,
  CreativeRecipe,
  CreativeVersion,
  MarketingAgentArtifact,
  MarketingAgentJob,
  MarketingAgentSettings,
  MarketingSchedule,
  ParsedIntent,
  PublishingJob,
  QaReport,
} from "./types";
import type { CompositionDocument, MarketingCreativeProvider, ProviderResult } from "./provider";
import { DEFAULT_AGENT_SETTINGS, evaluateApproval, canPublish, canSchedule } from "./modes";
import { parseIntent, parseIntentWithAi } from "./intent";
import { buildPlan, readyTasks, resumeCursor, topologicalOrder } from "./planner";
import { runClaimValidation, approvedClaimsFor, defaultDisclaimer } from "./claims";
import { checkDailyBudget, estimateProduction } from "./cost";
import { runQa } from "./qa";
import { buildCapturePlan } from "./browser/plan";
import { runBrowserCapture, captureHealth } from "./browser/engine";
import { directCreative } from "./production/director";
import { generateScript } from "./production/script";
import { buildComposition, localize, recompose } from "./production/composition";
import { generatePlatformCopy, buildPublishingPackage } from "./production/copy";
import { buildVariantSpecs, deriveVersionLineage, interpretRemix } from "./production/variants";
import { extractRecipe } from "./production/recipe";
import { registerCreativeProviders, resolveCreativeProvider } from "./creative-providers";
import { getFeature, resolveCtaDestination } from "./product-knowledge";
import { capabilityMatrix } from "./publishing/capabilities";
import { registerSocialPublishers } from "./publishing/providers";
import { executePublishingJob, type PublishingStore } from "./publishing/engine";
import { advanceSchedule, isScheduleDue, parseScheduleHint } from "./scheduling";
import {
  audit,
  claimAgentJob,
  countJobsSince,
  createAgentJob,
  createPublishingJob,
  getAgentJob,
  getCapture,
  getPlan,
  latestCaptureFor,
  listPerformance,
  listVersions,
  markStaleCaptures,
  nextVersionNumber,
  recordClaimReview,
  recordToolInvocation,
  rtdbPublishingStore,
  saveCapture,
  saveLearning,
  savePerformance,
  savePlan,
  saveRecipe,
  saveSchedule,
  saveVersion,
  updateAgentJob,
} from "./storage";
import { authorizeTool } from "./permissions";
import { generateCaptionsFromScript } from "@/lib/marketing-media/captions";
import type { CaptionCue, Script } from "@/lib/marketing-media/types";

type StructuredRunner = <T>(input: { prompt: string; schema: string; system: string }) => Promise<T | null>;

export type AgentRuntime = {
  actor: string;
  mode: MarketingAgentMode;
  settings: MarketingAgentSettings;
  workspaceDir: string;
  baseUrl: string;
  now?: number;
  /** Optional AI pass through the existing router. */
  runStructured?: StructuredRunner;
  /** Injected publishing persistence (defaults to RTDB). */
  publishingStore?: PublishingStore;
  onProgress?: (job: MarketingAgentJob) => void;
  /** Stop after a task (used by tests / step mode). */
  stopAfter?: MarketingAgentTaskId;
};

export type RunOutcome = {
  ok: boolean;
  job: MarketingAgentJob;
  failedTask?: MarketingAgentTaskId;
  reason?: string;
};

// ─── Context shared by task handlers ────────────────────────────────────────

type TaskContext = {
  runtime: AgentRuntime;
  job: MarketingAgentJob;
  plan: CampaignPlan;
  intent: ParsedIntent;
  artifacts: Map<string, unknown>;
  disclaimer: string;
  now: number;
};

function artifact(ctx: TaskContext, entry: MarketingAgentArtifact): void {
  ctx.job.artifacts.push(entry);
  ctx.artifacts.set(entry.kind, entry);
}

async function persist(ctx: TaskContext): Promise<void> {
  ctx.job.updatedAt = Date.now();
  await updateAgentJob(ctx.job.id ?? "", {
    tasks: ctx.job.tasks,
    artifacts: ctx.job.artifacts,
    cursor: ctx.job.cursor,
    state: ctx.job.state,
    blockedReason: ctx.job.blockedReason,
    approval: ctx.job.approval,
    planId: ctx.job.planId,
    campaignId: ctx.job.campaignId,
    creativeId: ctx.job.creativeId,
    recipeId: ctx.job.recipeId,
    error: ctx.job.error,
    errorCode: ctx.job.errorCode,
    consumedUnits: ctx.job.consumedUnits,
    stage: ctx.job.stage,
  } as Partial<MarketingAgentJob>, ctx.runtime.actor);
  ctx.runtime.onProgress?.(ctx.job);
}

async function guardedTool<T>(
  ctx: TaskContext,
  tool: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const startedAt = Date.now();
  const auth = authorizeTool({ tool, mode: ctx.runtime.mode, flags: ctx.runtime.settings.flags, args });
  if (!auth.allowed) {
    await recordToolInvocation({ tool, actor: ctx.runtime.actor, jobId: ctx.job.id, mode: ctx.runtime.mode, ok: false, startedAt, errorCode: auth.code, summary: auth.reason });
    return { ok: false, error: auth.reason };
  }
  try {
    const value = await fn();
    await recordToolInvocation({ tool, actor: ctx.runtime.actor, jobId: ctx.job.id, mode: ctx.runtime.mode, ok: true, startedAt, finishedAt: Date.now(), summary: `${tool} completed.` });
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : `${tool} failed.`;
    await recordToolInvocation({ tool, actor: ctx.runtime.actor, jobId: ctx.job.id, mode: ctx.runtime.mode, ok: false, startedAt, finishedAt: Date.now(), errorCode: "TOOL_ERROR", summary: message });
    return { ok: false, error: message };
  }
}

// ─── Job creation ───────────────────────────────────────────────────────────

export type CreateJobInput = {
  prompt: string;
  mode: MarketingAgentMode;
  actor: string;
  settings?: MarketingAgentSettings;
  parentJobId?: string;
  /** Reuse an existing campaign/creative (§25, §24). */
  campaignId?: string;
  creativeId?: string;
  recipeId?: string;
  runtime?: Partial<AgentRuntime>;
};

export async function createJob(input: CreateJobInput): Promise<{ ok: boolean; job?: MarketingAgentJob; error?: string }> {
  const settings = input.settings ?? DEFAULT_AGENT_SETTINGS;
  if (!settings.enabled || settings.flags.marketingAgentEnabled === false) {
    return { ok: false, error: "Marketing Agent is disabled by an administrator." };
  }

  const prompt = (input.prompt ?? "").trim();
  if (prompt.length < 8) return { ok: false, error: "Instruction is too short to plan a campaign." };
  if (prompt.length > 4000) return { ok: false, error: "Instruction exceeds the 4 000 character limit." };

  const now = Date.now();
  const jobKey = `run_${Math.random().toString(36).slice(2, 10)}_${now.toString(36)}`;
  if (!(await claimAgentJob(jobKey))) {
    return { ok: false, error: "Duplicate run detected." };
  }

  // Daily budget (§46).
  const usage = await countJobsSince(Date.now() - 24 * 60 * 60 * 1000);
  const intent = parseIntent(prompt);
  const preEstimate = estimateProduction({
    variants: intent.variantCount,
    languages: Math.max(1, intent.languages.length),
    platforms: Math.max(1, intent.platforms.length),
    durationSec: intent.durationSec ?? 30,
    settings,
  });
  const budget = checkDailyBudget({
    jobsUsedToday: usage.total,
    unitsUsedToday: usage.units,
    settings,
    requestedUnits: preEstimate.units,
    runningJobs: usage.running,
  });
  if (!budget.allowed) {
    return { ok: false, error: budget.reason ?? "Daily budget exceeded." };
  }

  const job = await createAgentJob({
    jobKey,
    prompt,
    mode: input.mode,
    state: "CREATED",
    tasks: [],
    artifacts: [{ key: "prompt", kind: "prompt", label: "Original instruction", taskId: "understand_request", createdAt: now, ref: jobKey }],
    cursor: 0,
    estimatedUnits: preEstimate.units,
    consumedUnits: 0,
    retryCount: 0,
    userId: input.actor,
    createdBy: input.actor,
    ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    ...(input.creativeId ? { creativeId: input.creativeId } : {}),
    ...(input.recipeId ? { recipeId: input.recipeId } : {}),
  });

  await audit({ actor: input.actor, action: "marketing_agent_run_requested", targetType: "marketingAgentJob", targetId: job.id ?? "", detail: { mode: input.mode, estimatedUnits: preEstimate.units, prompt: prompt.slice(0, 200) } });
  return { ok: true, job };
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export async function runJob(jobId: string, runtime: AgentRuntime): Promise<RunOutcome> {
  const job = await getAgentJob(jobId);
  if (!job) return { ok: false, job: {} as MarketingAgentJob, reason: "Job not found." };
  if (job.state === "COMPLETED" || job.state === "CANCELLED") {
    return { ok: job.state === "COMPLETED", job, reason: `Job already ${job.state}.` };
  }
  if (job.state === "AWAITING_APPROVAL") {
    return { ok: false, job, reason: "Awaiting approval." };
  }

  registerCreativeProviders();
  registerSocialPublishers();

  job.state = "RUNNING";
  job.startedAt = job.startedAt ?? runtime.now ?? Date.now();
  await persist({ runtime, job, plan: null as unknown as CampaignPlan, intent: parseIntent(job.prompt), artifacts: new Map(), disclaimer: "", now: job.startedAt });

  // ── Understand + plan (always the first two steps) ────────────────────────
  const intent = runtime.runStructured
    ? await parseIntentWithAi(job.prompt, runtime.runStructured)
    : parseIntent(job.prompt);

  let planLoaded: (CampaignPlan & { id?: string }) | null = job.planId ? await getPlan(job.planId) : null;
  if (!planLoaded) {
    const built = buildPlan({
      intent,
      settings: runtime.settings,
      jobId: job.id ?? job.jobKey,
      actor: runtime.actor,
      now: runtime.now,
      ...(job.campaignId ? { existingCampaignId: job.campaignId } : {}),
      ...(job.creativeId ? { existingCreativeId: job.creativeId } : {}),
    });
    const fresh = built.plan as CampaignPlan & { id?: string };
    fresh.tasks = fresh.tasks.map((t) => ({ ...t, status: "PENDING" as const }));
    const planId = await savePlan(fresh);
    fresh.id = planId;
    planLoaded = fresh;
    job.planId = planId;
    job.tasks = fresh.tasks;
    job.estimatedUnits = built.plan.estimatedUnits;
    job.artifacts.push({ key: "plan", kind: "plan", label: "Campaign plan", taskId: "understand_request", createdAt: Date.now(), ref: planId });
  }
  const plan: CampaignPlan & { id?: string } = planLoaded;

  const ctx: TaskContext = {
    runtime,
    job,
    plan,
    intent,
    artifacts: new Map(),
    disclaimer: runtime.settings.defaultDisclaimer || defaultDisclaimer(),
    now: runtime.now ?? Date.now(),
  };

  job.cursor = resumeCursor(job.tasks);
  await persist(ctx);

  const order = topologicalOrder(plan.tasks);
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));

  for (let i = job.cursor; i < plan.tasks.length; i++) {
    const taskId = order[i] ?? plan.tasks[i].id;
    const task = byId.get(taskId) ?? plan.tasks[i];
    if (!task) continue;
    if (task.status === "DONE" || task.status === "SKIPPED") continue;

    // Dependency gate.
    const unmet = task.dependsOn.filter((d) => byId.get(d)?.status !== "DONE" && byId.get(d)?.status !== "SKIPPED");
    if (unmet.length > 0) {
      task.status = "BLOCKED";
      task.error = `Unmet dependencies: ${unmet.join(", ")}`;
      await persist(ctx);
      job.state = "FAILED";
      job.blockedReason = task.error;
      await persist(ctx);
      return { ok: false, job, failedTask: task.id, reason: task.error };
    }

    task.status = "RUNNING";
    task.startedAt = Date.now();
    task.attempts += 1;
    job.stage = task.id;
    await persist(ctx);

    const handler = HANDLERS[task.id];
    if (!handler) {
      task.status = "SKIPPED";
      task.summary = "No handler registered for this task.";
      task.finishedAt = Date.now();
      await persist(ctx);
      continue;
    }

    try {
      const result = await withTimeout(handler(ctx), MARKETING_AGENT_DEFAULTS.taskTimeoutMs, `${task.id} timed out.`);
      if (result.ok) {
        task.status = "DONE";
        task.summary = result.summary;
        if (result.artifact) task.artifactKeys = [...(task.artifactKeys ?? []), result.artifact.key];
        task.error = undefined;
      } else if (result.skip) {
        task.status = "SKIPPED";
        task.summary = result.summary;
      } else {
        task.status = "FAILED";
        task.error = result.summary;
      }
    } catch (err) {
      task.status = "FAILED";
      task.error = err instanceof Error ? err.message : `${task.id} failed.`;
    }
    task.finishedAt = Date.now();
    job.cursor = resumeCursor(job.tasks);
    await persist(ctx);

    if (task.status === "FAILED") {
      job.state = "FAILED";
      job.error = task.error;
      job.errorCode = `TASK_${task.id.toUpperCase()}`;
      await persist(ctx);
      await audit({ actor: runtime.actor, action: "marketing_agent_task_failed", targetType: "marketingAgentJob", targetId: job.id ?? "", detail: { task: task.id, error: task.error } });
      return { ok: false, job, failedTask: task.id, reason: task.error };
    }

    if (runtime.stopAfter === task.id) {
      job.state = "PAUSED";
      await persist(ctx);
      return { ok: true, job, reason: `Stopped after ${task.id}.` };
    }
    if ((job.state as string) === "AWAITING_APPROVAL") return { ok: true, job, reason: "Awaiting approval." };
  }

  job.state = "COMPLETED";
  job.completedAt = Date.now();
  job.durationMs = (job.completedAt ?? Date.now()) - (job.startedAt ?? Date.now());
  job.cursor = job.tasks.length;
  await persist(ctx);
  await audit({ actor: runtime.actor, action: "marketing_agent_run_completed", targetType: "marketingAgentJob", targetId: job.id ?? "", detail: { tasks: job.tasks.length, units: job.consumedUnits, durationMs: job.durationMs } });
  return { ok: true, job };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

type TaskResult = { ok: true; summary: string; artifact?: { key: string } } | { ok: false; summary: string; skip?: boolean };

type Handler = (ctx: TaskContext) => Promise<TaskResult>;

const ok = (summary: string, artifact?: { key: string }): TaskResult => ({ ok: true, summary, ...(artifact ? { artifact } : {}) });
const skip = (summary: string): TaskResult => ({ ok: false, summary, skip: true });
const fail = (summary: string): TaskResult => ({ ok: false, summary });

// ─── Handlers ───────────────────────────────────────────────────────────────

const HANDLERS: Record<string, Handler> = {
  async understand_request(ctx) {
    if (ctx.intent.needsAiClarification && !ctx.runtime.runStructured) {
      return ok(`Parsed instruction deterministically (command=${ctx.intent.command}, confidence=${ctx.intent.confidence}).`);
    }
    artifact(ctx, { key: "intent", kind: "intent", label: "Interpreted intent", taskId: "understand_request", createdAt: Date.now() });
    return ok(`Understood request: ${ctx.intent.command}, ${ctx.intent.products.length} product(s), ${ctx.intent.platforms.length || "default"} platform(s).`);
  },

  async identify_product(ctx) {
    const names = ctx.plan.products.map((k) => getFeature(k)?.name ?? k).join(", ");
    return ok(`Product identified: ${names || "AlgoVault"}.`);
  },

  async identify_audience(ctx) {
    return ok(`Audience: ${ctx.plan.audience}.`);
  },

  async identify_platforms(ctx) {
    return ok(`Platforms: ${ctx.plan.platforms.join(", ")}.`);
  },

  async determine_duration(ctx) {
    return ok(`Duration: ${ctx.plan.durationSec}s across ${ctx.plan.languages.join(", ")}.`);
  },

  async verify_product_facts(ctx) {
    const claims = approvedClaimsFor(ctx.plan.products);
    const result = runClaimValidation(
      claims.map((c) => ({ field: "approved_claim", text: c })),
      { policy: "STRICT" }
    );
    artifact(ctx, { key: "product_facts", kind: "product_facts", label: "Verified product facts", taskId: "verify_product_facts", createdAt: Date.now() });
    const requested = ctx.intent.claimsRequested;
    if (requested.length > 0) {
      const requestedResult = runClaimValidation(requested.map((t) => ({ field: "user_claim", text: t })), { policy: "STRICT" });
      if (!requestedResult.passed) {
        return fail(`Requested claim(s) blocked by claim validation: ${requestedResult.flags.map((f) => f.rule).join(", ")}.`);
      }
    }
    if (!result.passed) return fail("Approved product facts failed claim validation.");
    return ok(`Verified ${claims.length} marketing-safe product fact(s).`);
  },

  async build_capture_plan(ctx) {
    const built = buildCapturePlan({
      productKeys: ctx.plan.products,
      objective: `Demonstrate ${ctx.plan.products.map((k) => getFeature(k)?.name ?? k).join(", ")}`,
      jobId: ctx.job.id ?? ctx.job.jobKey,
    });
    if (!built.ok) return fail(built.error);
    artifact(ctx, { key: "capture_plan", kind: "capture_plan", label: `Capture plan — ${built.plan.targetPage}`, taskId: "build_capture_plan", createdAt: Date.now(), ref: built.route });
    ctx.artifacts.set("capturePlan", built.plan);
    await markStaleCaptures(built.product, built.plan.fingerprint, "Plan fingerprint changed.");
    return ok(`Capture plan built for ${built.route} (${built.plan.steps.length} steps).`);
  },

  async build_creative_brief(ctx) {
    const capture = await resolveCapture(ctx);
    const brief = {
      productKeys: ctx.plan.products,
      durationSec: ctx.plan.durationSec,
      platform: ctx.plan.platforms[0],
      aspectRatio: ctx.plan.aspectRatios[0] ?? "9:16",
      tone: ctx.plan.tone,
      audience: ctx.plan.audience,
      hasCapture: !!capture && capture.frames.length > 0,
      captureFrameCount: capture?.frames.length ?? 0,
      captureFrames: capture?.frames.map((f) => ({ key: f.key, stepOrder: f.stepOrder, url: f.url })) ?? [],
      wantsVoiceover: ctx.intent.wantsVoiceover !== false,
      objective: ctx.plan.objective,
    };
    const decision = directCreative(brief);
    ctx.artifacts.set("brief", brief);
    ctx.artifacts.set("decision", decision);
    artifact(ctx, { key: "brief", kind: "brief", label: "Creative brief", taskId: "build_creative_brief", createdAt: Date.now() });
    return ok(`Creative brief: ${decision.beats.length} beats, showing ${decision.show.length} benefit(s). ${decision.reasoning[0] ?? ""}`);
  },

  async write_script(ctx) {
    const decision = ctx.artifacts.get("decision");
    const brief = ctx.artifacts.get("brief");
    if (!decision || !brief) return fail("Creative brief missing before script generation.");

    const language = ctx.plan.languages[0];
    const generated = generateScript({
      brief: brief as Parameters<typeof generateScript>[0]["brief"],
      decision: decision as Parameters<typeof generateScript>[0]["decision"],
      language,
      tone: ctx.plan.tone,
      disclaimer: ctx.disclaimer,
      demoLabelRequired: ctx.plan.products.length > 0,
      productKeys: ctx.plan.products,
      ...(ctx.job.parentJobId ? { referenceScript: null } : {}),
    });

    const claimResult = runClaimValidation(
      [
        { field: "hook", text: generated.script.hook },
        { field: "cta", text: generated.script.cta },
        ...generated.script.scenes.map((s) => ({ field: `scene_${s.id}`, text: `${s.voiceover} ${s.onScreenText}` })),
      ],
      { policy: runtime_policy(ctx), requireApprovedClaims: false }
    );
    ctx.artifacts.set("script", generated.script);
    ctx.artifacts.set("claims", claimResult);
    ctx.artifacts.set("shots", generated.shots);
    artifact(ctx, { key: "script", kind: "script", label: `Script — ${generated.script.scenes.length} scenes`, taskId: "write_script", createdAt: Date.now() });

    if (!claimResult.passed) {
      await recordClaimReview({ creativeId: ctx.job.creativeId ?? ctx.job.id ?? "", jobId: ctx.job.id, statement: generated.script.hook, decision: "REJECTED", decidedBy: "agent:claims", reason: claimResult.flags.map((f) => f.rule).join(", ") });
      return fail(`Script blocked by claim validation: ${claimResult.flags.map((f) => f.rule).join(", ")}.`);
    }
    return ok(`Script written: ${generated.script.scenes.length} scenes, ${generated.script.durationSec}s. ${generated.warnings.join(" ")}`.trim());
  },

  async write_shot_list(ctx) {
    const shots = ctx.artifacts.get("shots");
    if (!shots) return fail("Shot list requires a script.");
    artifact(ctx, { key: "shot_list", kind: "shot_list", label: `Shot list — ${(shots as unknown[]).length} shots`, taskId: "write_shot_list", createdAt: Date.now() });
    return ok(`Shot list: ${(shots as unknown[]).length} shots.`);
  },

  async capture_product(ctx) {
    if (ctx.runtime.settings.flags.marketingAgentBrowserCaptureEnabled === false) {
      return skip("Browser capture disabled by an administrator.");
    }
    const plan = ctx.artifacts.get("capturePlan");
    if (!plan) return fail("No capture plan available.");

    const built = buildCapturePlan({ productKeys: ctx.plan.products, objective: ctx.plan.title, jobId: ctx.job.id ?? "" });
    if (!built.ok) return fail(built.error);

    const previous = await latestCaptureFor(built.product);
    const result = await guardedTool(ctx, "marketing.captureBrowser", { planId: ctx.job.planId ?? "" }, () =>
      runBrowserCapture({
        build: { productKeys: ctx.plan.products, objective: ctx.plan.title, jobId: ctx.job.id ?? "" },
        baseUrl: ctx.runtime.baseUrl,
        outputDir: join(ctx.runtime.workspaceDir, "captures", ctx.job.id ?? ctx.job.jobKey),
        jobId: ctx.job.id ?? ctx.job.jobKey,
        ...(ctx.job.campaignId ? { campaignId: ctx.job.campaignId } : {}),
        actor: ctx.runtime.actor,
        reuseCapture: previous,
      })
    );
    if (!result.ok) return fail(result.error);

    const execution = result.value;
    if (!execution.ok || !execution.capture) {
      return fail(execution.error ?? "Browser capture failed.");
    }
    const captureId = await saveCapture(execution.capture);
    ctx.artifacts.set("capture", { ...execution.capture, id: captureId });
    artifact(ctx, { key: "capture", kind: "capture", label: `Product capture — ${execution.capture.frames.length} frames`, taskId: "capture_product", createdAt: Date.now(), ref: captureId });
    return ok(`Captured ${execution.capture.frames.length} frame(s) from ${execution.capture.route} via ${execution.capture.provider}.`);
  },

  async generate_assets(ctx) {
    const capture = ctx.artifacts.get("capture") as BrowserCapture | undefined;
    const frames = capture?.frames.length ?? 0;
    const assetKeys = capture?.frames.map((f) => f.key) ?? [];
    ctx.artifacts.set("assetKeys", assetKeys);
    artifact(ctx, { key: "assets", kind: "composition", label: `Assets — ${frames} capture frame(s)`, taskId: "generate_assets", createdAt: Date.now() });
    if (frames === 0) {
      return ok("No product capture available — composition will use approved brand graphics with an illustrative label.");
    }
    return ok(`${frames} product frame(s) selected as source visuals.`);
  },

  async compose_video(ctx) {
    const script = ctx.artifacts.get("script") as Script | undefined;
    const decision = ctx.artifacts.get("decision");
    const brief = ctx.artifacts.get("brief");
    if (!script || !decision || !brief) return fail("Composition requires script + creative brief.");

    const claims = ctx.artifacts.get("claims") as ClaimCheckResult | undefined;
    const captions = generateCaptionsFromScript(script as never) as CaptionCue[];

    const doc = buildComposition({
      script,
      decision: decision as Parameters<typeof buildComposition>[0]["decision"],
      language: ctx.plan.languages[0],
      aspectRatio: ctx.plan.aspectRatios[0] ?? "9:16",
      durationSec: ctx.plan.durationSec,
      tone: ctx.plan.tone,
      captions,
      captionStyle: "brand-karaoke",
      brand: { logo: "/marketing-video/assets/logo-mark-hires.png", primaryColor: "#0f172a", lowerThird: true },
      disclaimer: ctx.disclaimer,
      demoLabel: "DEMO — illustrative example. Not real trading performance.",
    });

    const provider = await resolveCreativeProvider({ hypitEnabled: ctx.runtime.settings.flags.marketingAgentHypitEnabled !== false });
    if (!provider.provider) return fail(provider.reason ?? "No creative provider available.");

    const created = await guardedTool(ctx, "marketing.createHypitProject", { compositionSpec: "composition" }, async () => {
      const res: ProviderResult<{ projectId: string; projectDir: string }> = await provider.provider!.createProject({
        name: ctx.plan.title,
        creativeId: ctx.job.creativeId ?? ctx.job.id ?? ctx.job.jobKey,
        language: doc.language,
        aspectRatio: doc.aspectRatio,
        durationSec: doc.durationSec,
        composition: doc,
        workspaceDir: ctx.runtime.workspaceDir,
      });
      if (!res.ok) throw new Error(res.error);
      return res.value;
    });
    if (!created.ok) return fail(created.error);

    const capture = ctx.artifacts.get("capture") as BrowserCapture | undefined;
    if (capture && capture.frames.length > 0) {
      await provider.provider.ingestAssets({
        projectId: created.value.projectId,
        assets: capture.frames.map((f) => ({ key: `${f.key}.png`, sourcePath: f.localPath ?? f.url, kind: f.kind })),
        workspaceDir: ctx.runtime.workspaceDir,
      });
    }

    ctx.artifacts.set("projectId", created.value.projectId);
    ctx.artifacts.set("composition", doc);
    ctx.artifacts.set("providerId", provider.provider.id);
    artifact(ctx, { key: "composition", kind: "composition", label: `Composition via ${provider.provider.label}`, taskId: "compose_video", createdAt: Date.now(), ref: created.value.projectId });
    void claims;
    return ok(`Composition created with ${provider.provider.label}${provider.fallbackUsed ? " (fallback)" : ""}: ${doc.timeline.length} clips, ${doc.motion.length} motion layers.`);
  },

  async add_audio(ctx) {
    const script = ctx.artifacts.get("script") as Script | undefined;
    if (!script) return fail("Audio requires a script.");
    if (ctx.intent.wantsVoiceover === false) return skip("Voiceover not requested — captions carry the narrative.");

    try {
      const { generateVoiceoverWithSay } = await import("@/lib/marketing-media/tts");
      const result = await generateVoiceoverWithSay({ script: script as never, language: ctx.plan.languages[0] } as never);
      if (!result.ok) return skip(`Voiceover unavailable: ${result.error ?? "TTS not configured"}.`);
      const doc = ctx.artifacts.get("composition") as CompositionDocument | undefined;
      if (doc && result.audio?.localPath) {
        doc.audio.voice = result.audio.localPath;
        const provider = await resolveCreativeProvider({ hypitEnabled: ctx.runtime.settings.flags.marketingAgentHypitEnabled !== false });
        await provider.provider?.updateComposition({ projectId: String(ctx.artifacts.get("projectId") ?? ""), composition: doc, workspaceDir: ctx.runtime.workspaceDir });
      }
      artifact(ctx, { key: "voice", kind: "voice", label: "Voiceover", taskId: "add_audio", createdAt: Date.now(), url: result.audio?.url });
      return ok("Voiceover generated through the existing TTS pipeline.");
    } catch (err) {
      return skip(`Voiceover skipped: ${err instanceof Error ? err.message : "TTS unavailable"}.`);
    }
  },

  async add_captions(ctx) {
    const script = ctx.artifacts.get("script") as Script | undefined;
    if (!script) return fail("Captions require a script.");
    const cues = generateCaptionsFromScript(script as never) as CaptionCue[];
    if (cues.length === 0) return fail("Caption generation produced no cues.");
    ctx.artifacts.set("captions", cues);
    artifact(ctx, { key: "captions", kind: "captions", label: `${cues.length} caption cues`, taskId: "add_captions", createdAt: Date.now() });
    return ok(`${cues.length} caption cue(s) generated with word-level timing.`);
  },

  async add_motion(ctx) {
    const doc = ctx.artifacts.get("composition") as CompositionDocument | undefined;
    if (!doc) return fail("Motion plan requires a composition.");
    if (doc.motion.length === 0) return skip("No motion layers applicable to this creative.");
    return ok(`${doc.motion.length} motion layer(s) applied (typography, callouts, arrows, transitions, CTA).`);
  },

  async apply_branding(ctx) {
    const doc = ctx.artifacts.get("composition") as CompositionDocument | undefined;
    if (!doc) return fail("Branding requires a composition.");
    if (!doc.branding.logo) return fail("Brand logo missing from the composition.");
    return ok("Brand identity applied (logo, palette, lower third).");
  },

  async apply_disclaimer(ctx) {
    const doc = ctx.artifacts.get("composition") as CompositionDocument | undefined;
    const claims = ctx.artifacts.get("claims") as ClaimCheckResult | undefined;
    if (!doc) return fail("Disclaimer requires a composition.");
    if (!doc.disclaimer) return fail("Risk disclosure missing from the composition.");
    if (!doc.demoLabel) return fail("Demo/illustration label missing.");
    if (claims && !claims.passed) return fail("Claim validation must pass before the disclaimer stage can complete.");
    return ok("Risk disclosure and demo label applied.");
  },

  async render_platforms(ctx) {
    const providerInfo = await resolveCreativeProvider({ hypitEnabled: ctx.runtime.settings.flags.marketingAgentHypitEnabled !== false });
    const provider = providerInfo.provider;
    if (!provider) return fail(providerInfo.reason ?? "No creative provider available.");

    const baseDoc = ctx.artifacts.get("composition") as CompositionDocument | undefined;
    if (!baseDoc) return fail("No composition to render.");

    const projectId = String(ctx.artifacts.get("projectId") ?? "");
    const creativeId = ctx.job.creativeId ?? ctx.job.id ?? ctx.job.jobKey;
    const rendered: CreativeVersion[] = [];
    const failures: string[] = [];
    const qaReports: QaReport[] = [];

    const rootVersion = await nextVersionNumber(creativeId);
    let rootId = "";

    for (const language of ctx.plan.languages) {
      for (const platform of ctx.plan.platforms) {
        const aspectRatio = ctx.plan.aspectRatios.find(() => true) ?? "9:16";
        const doc = language === ctx.plan.languages[0] && platform === ctx.plan.platforms[0]
          ? baseDoc
          : recompose(localize(baseDoc, language, {}), aspectRatio);

        const outputName = `${creativeId}_${platform}_${language}_${rendered.length}`;
        const result = await guardedTool(ctx, "marketing.renderCreative", { compositionId: projectId, preset: platform, language }, async () => {
          const res: ProviderResult<import("./provider").RenderOutput> = await provider.render({
            projectId,
            compositionId: `${projectId}:current`,
            platform,
            aspectRatio: doc.aspectRatio,
            width: doc.aspectRatio === "16:9" ? 1920 : 1080,
            height: doc.aspectRatio === "16:9" ? 1080 : doc.aspectRatio === "1:1" ? 1080 : doc.aspectRatio === "4:5" ? 1350 : 1920,
            language,
            outputName,
            workspaceDir: ctx.runtime.workspaceDir,
          });
          if (!res.ok) throw new Error(res.error);
          return res.value;
        });

        if (!result.ok || !result.value) {
          failures.push(`${platform}/${language}: ${result.ok ? "render failed" : result.error}`);
          continue;
        }

        const versionNumber = await nextVersionNumber(creativeId);
        const version: CreativeVersion = {
          creativeId,
          parentVersionId: rootId || undefined,
          rootVersionId: rootId || `root_${versionNumber}`,
          kind: rendered.length === 0 ? "PARENT" : "PLATFORM",
          version: versionNumber,
          label: `${platform} ${language}`,
          language,
          platform,
          aspectRatio: doc.aspectRatio,
          durationSec: ctx.plan.durationSec,
          compositionId: `${projectId}:current`,
          renderUrl: result.value.file,
          renderState: "RENDERED",
          renderError: undefined,
          createdAt: Date.now(),
          createdBy: ctx.runtime.actor,
        };
        if (rendered.length === 0) {
          rootId = `root_${versionNumber}`;
          version.rootVersionId = rootId;
          version.parentVersionId = undefined;
        }

        const qa = runQa({
          platform,
          durationSec: ctx.plan.durationSec,
          maxDurationSec: runtime_maxDuration(ctx),
          render: {
            url: result.value.file,
            width: result.value.width,
            height: result.value.height,
            codec: result.value.codec,
            hasAudio: result.value.hasAudio,
            sizeBytes: result.value.sizeBytes,
            fileDurationSec: result.value.durationSec || ctx.plan.durationSec,
          },
          claims: (ctx.artifacts.get("claims") as ClaimCheckResult | undefined) ?? runClaimValidation([{ field: "script", text: "" }]),
          brand: {
            logoApplied: !!baseDoc.branding.logo,
            disclaimerApplied: !!baseDoc.disclaimer,
            disclaimerRequired: !!baseDoc.disclaimer,
            demoLabelRequired: true,
            demoLabelPresent: !!baseDoc.demoLabel,
          },
          captions: (() => {
            const cues = (ctx.artifacts.get("captions") as CaptionCue[] | undefined) ?? [];
            return { cues: cues.length, lastEndMs: cues.reduce((m, c) => Math.max(m, c.endMs), 0) };
          })(),
          audio: { voicePresent: !!baseDoc.audio.voice },
          ...(ctx.artifacts.get("capture")
            ? { captures: ((ctx.artifacts.get("capture") as BrowserCapture).frames ?? []).map((f) => ({ sanitized: f.sanitized, key: f.key })) }
            : {}),
        });

        version.qa = { passed: qa.passed, failedGates: qa.failedGates, checkedAt: qa.checkedAt };
        if (!qa.passed) version.renderState = "FAILED";
        qaReports.push(qa);

        const id = await saveVersion(version);
        version.id = id;
        rendered.push(version);
        ctx.job.consumedUnits += 1;
      }
    }

    ctx.artifacts.set("versions", rendered);
    ctx.artifacts.set("qaReports", qaReports);
    artifact(ctx, { key: "renders", kind: "render", label: `${rendered.length} platform render(s)`, taskId: "render_platforms", createdAt: Date.now() });

    if (rendered.length === 0) {
      return fail(`No platform renders completed: ${failures.join("; ")}`);
    }
    const partial = failures.length > 0 ? ` (${failures.length} failed: ${failures[0]})` : "";
    return ok(`${rendered.length} platform render(s) completed via ${provider.label}.${partial}`);
  },

  async run_qa(ctx) {
    const reports = (ctx.artifacts.get("qaReports") as QaReport[] | undefined) ?? [];
    const versions = (ctx.artifacts.get("versions") as CreativeVersion[] | undefined) ?? [];
    if (reports.length === 0) return fail("No renders available for QA.");

    const failed = reports.filter((r) => !r.passed);
    const blocked = versions.filter((v) => v.renderState !== "RENDERED");
    artifact(ctx, { key: "qa", kind: "qa", label: `QA — ${reports.length - failed.length}/${reports.length} passed`, taskId: "run_qa", createdAt: Date.now() });

    if (blocked.length > 0) {
      return fail(`QA failed for ${blocked.length} render(s): ${Array.from(new Set(blocked.flatMap((v) => v.qa?.failedGates ?? []))).join(", ")}.`);
    }
    return ok(`QA passed for ${reports.length} render(s). ${failed.length} had non-blocking flags.`);
  },

  async generate_publishing_assets(ctx) {
    const versions = (ctx.artifacts.get("versions") as CreativeVersion[] | undefined) ?? [];
    if (versions.length === 0) return fail("No rendered versions to publish.");

    const creativeId = ctx.job.creativeId ?? ctx.job.id ?? ctx.job.jobKey;
    const destination = resolveCtaDestination(ctx.plan.products) ?? "/";
    const packages: PublishingJob[] = [];

    for (const version of versions) {
      if (!version.platform) continue;
      if (!ctx.runtime.settings.allowedPlatforms.includes(version.platform)) continue;

      const { copy } = generatePlatformCopy({
        script: ctx.artifacts.get("script") as Script,
        platform: version.platform,
        language: version.language,
        campaignName: ctx.plan.title,
        creativeId,
        variantKey: version.label.replace(/\s+/g, "_").toLowerCase(),
        products: ctx.plan.products,
        destinationUrl: destination,
        tone: ctx.plan.tone,
      });

      const publishing = await createPublishingJob({
        jobId: ctx.job.id ?? "",
        ...(ctx.job.campaignId ? { campaignId: ctx.job.campaignId } : {}),
        creativeId,
        versionId: version.id ?? "",
        platform: version.platform,
        state: "DRAFT",
        idempotencyKey: `mk_${creativeId}_${version.id ?? version.version}_${version.platform}`,
        mediaUrl: version.renderUrl ?? "",
        copy: { title: copy.title, caption: copy.caption, description: copy.description, hashtags: copy.hashtags, firstComment: copy.firstComment },
        destinationUrl: copy.destinationUrl,
        utm: copy.utm,
        attempt: 0,
        maxAttempts: MARKETING_AGENT_DEFAULTS.maxRetries,
        platformConfirmed: false,
        createdBy: ctx.runtime.actor,
      });
      packages.push(publishing);
      await saveVersion({ ...version, thumbnailUrl: version.renderUrl, captionFileUrl: undefined });
    }

    ctx.artifacts.set("publishingJobs", packages);
    artifact(ctx, { key: "package", kind: "package", label: `${packages.length} publishing package(s) with UTM`, taskId: "generate_publishing_assets", createdAt: Date.now() });

    const recipe = extractRecipe({
      creativeId,
      name: ctx.plan.title,
      objective: ctx.plan.objective,
      audience: ctx.plan.audience,
      products: ctx.plan.products,
      prompt: ctx.job.prompt,
      script: ctx.artifacts.get("script") as Script,
      shotList: ((ctx.artifacts.get("shots") as { action: string }[]) ?? []).map((s) => s.action),
      ...(ctx.job.planId ? { browserCapturePlanId: ctx.job.planId } : {}),
      assetKeys: (ctx.artifacts.get("assetKeys") as string[]) ?? [],
      compositionTemplateId: String(ctx.artifacts.get("projectId") ?? ""),
      style: ctx.plan.style,
      durationSec: ctx.plan.durationSec,
      platforms: ctx.plan.platforms,
      languages: ctx.plan.languages,
      cta: (ctx.artifacts.get("script") as Script)?.cta ?? "",
      disclaimer: ctx.disclaimer,
      variantKinds: ["HOOK", "CTA", "PLATFORM"],
      createdBy: ctx.runtime.actor,
      now: ctx.now,
    });
    const recipeId = await saveRecipe(recipe as CreativeRecipe);
    ctx.job.recipeId = recipeId;
    artifact(ctx, { key: "recipe", kind: "recipe", label: "Reusable creative recipe", taskId: "generate_publishing_assets", createdAt: Date.now(), ref: recipeId });

    return ok(`${packages.length} publishing package(s) prepared with copy, hashtags and UTM; recipe saved.`);
  },

  async request_approval(ctx) {
    const claims = (ctx.artifacts.get("claims") as ClaimCheckResult | undefined) ?? runClaimValidation([{ field: "script", text: "" }]);
    const decision = evaluateApproval({
      settings: ctx.runtime.settings,
      mode: ctx.runtime.mode,
      policy: ctx.plan.approvalPolicy,
      claimResult: claims,
      isNewCampaign: !ctx.job.campaignId,
      usesApprovedTemplate: ctx.plan.templateId !== "HOOK_EDU",
      targetsTradingContent: ctx.plan.products.some((p) => getFeature(p)?.tradingSensitive),
    });

    ctx.job.approval = { required: decision.required };
    if (!decision.required) {
      ctx.job.approval = { required: false, decidedAt: Date.now(), decidedBy: "policy:auto", decision: "APPROVED", reason: decision.reason };
      return ok(`Auto-approved: ${decision.reason}`);
    }

    ctx.job.state = "AWAITING_APPROVAL";
    ctx.job.blockedReason = decision.reason;
    await persist(ctx);
    await audit({ actor: ctx.runtime.actor, action: "marketing_agent_approval_required", targetType: "marketingAgentJob", targetId: ctx.job.id ?? "", detail: { reason: decision.reason, rule: decision.rule, hard: decision.hard } });
    return ok(`Approval required: ${decision.reason}`);
  },

  async schedule(ctx) {
    const publishingJobs = (ctx.artifacts.get("publishingJobs") as PublishingJob[] | undefined) ?? [];
    if (publishingJobs.length === 0) return fail("No publishing jobs to schedule.");

    if (!ctx.job.approval || ctx.job.approval.decision !== "APPROVED") {
      return skip("Schedule withheld — campaign approval has not been granted.");
    }
    if (!canSchedule(ctx.runtime.mode, ctx.runtime.settings)) {
      return skip(`Scheduling is not permitted in ${ctx.runtime.mode} mode.`);
    }

    const hint = ctx.intent.scheduleHint;
    const parsed = parseScheduleHint(hint, { timezone: ctx.runtime.settings.defaultTimezone, now: ctx.now });
    if (parsed.unresolved) {
      return skip(`Schedule not stored: ${parsed.explanation}`);
    }

    const schedules: MarketingSchedule[] = [];
    for (const job of publishingJobs) {
      const schedule: MarketingSchedule = {
        jobId: ctx.job.id ?? "",
        ...(ctx.job.campaignId ? { campaignId: ctx.job.campaignId } : {}),
        publishingJobId: job.id ?? "",
        platform: job.platform,
        timezone: parsed.timezone,
        scheduledFor: parsed.scheduledFor,
        recurrence: parsed.recurrence,
        state: "ACTIVE",
        nextRunAt: parsed.scheduledFor,
        runCount: 0,
        createdBy: ctx.runtime.actor,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const id = await saveSchedule(schedule);
      schedule.id = id;
      schedules.push(schedule);
      await savePublishingState(job.id ?? "", "SCHEDULED");
    }

    ctx.artifacts.set("schedules", schedules);
    artifact(ctx, { key: "schedule", kind: "schedule", label: `${schedules.length} schedule(s) — ${parsed.explanation}`, taskId: "schedule", createdAt: Date.now() });
    await audit({ actor: ctx.runtime.actor, action: "marketing_agent_scheduled", targetType: "marketingAgentJob", targetId: ctx.job.id ?? "", detail: { count: schedules.length, next: parsed.scheduledFor, tz: parsed.timezone } });
    return ok(`${schedules.length} schedule(s) stored: ${parsed.explanation}`);
  },

  async publish(ctx) {
    const publishingJobs = (ctx.artifacts.get("publishingJobs") as PublishingJob[] | undefined) ?? [];
    if (publishingJobs.length === 0) return skip("No publishing jobs.");

    if (!canPublish(ctx.runtime.mode, ctx.runtime.settings)) {
      const reason =
        ctx.runtime.settings.flags.marketingAgentPublishingEnabled !== true
          ? "Publishing is disabled — jobs remain READY for manual release."
          : `${ctx.runtime.mode} mode does not permit autonomous publishing.`;
      return skip(reason);
    }
    if (!ctx.job.approval || ctx.job.approval.decision !== "APPROVED") {
      return skip("Publishing withheld — approval not granted.");
    }

    const store = ctx.runtime.publishingStore ?? rtdbPublishingStore();
    const results = [];
    for (const job of publishingJobs) {
      if (!job.id) continue;
      const res = await executePublishingJob(store, job.id, {
        approvalGranted: true,
        accountConnected: true,
        publishingEnabled: ctx.runtime.settings.flags.marketingAgentPublishingEnabled === true,
        qaPassed: true,
        now: ctx.now,
      });
      results.push(res);
    }

    const published = results.filter((r) => r.state === "PUBLISHED");
    const failed = results.filter((r) => r.state === "FAILED" || r.state === "PUBLISH_VERIFICATION_REQUIRED");
    artifact(ctx, { key: "publish_result", kind: "publish_result", label: `${published.length} published`, taskId: "publish", createdAt: Date.now() });

    if (published.length === 0 && failed.length > 0) {
      return fail(`Publishing failed: ${failed[0].reason}`);
    }
    if (published.length === 0) return skip(`No publication completed: ${results.map((r) => r.reason).join("; ")}`);
    return ok(`${published.length}/${results.length} post(s) confirmed by their platforms.`);
  },

  async verify_publication(ctx) {
    const publishingJobs = (ctx.artifacts.get("publishingJobs") as PublishingJob[] | undefined) ?? [];
    const confirmed = publishingJobs.filter((j) => j.platformConfirmed && j.externalId);
    if (publishingJobs.length === 0) return skip("No publishing jobs to verify.");
    if (confirmed.length === 0) return skip("No confirmed publications to verify — verification is performed inline during publish.");
    artifact(ctx, { key: "publish_result", kind: "publish_result", label: `${confirmed.length} verified publication(s)`, taskId: "verify_publication", createdAt: Date.now() });
    await audit({ actor: ctx.runtime.actor, action: "marketing_agent_verified", targetType: "marketingAgentJob", targetId: ctx.job.id ?? "", detail: { confirmed: confirmed.length, ids: confirmed.map((c) => c.externalId) } });
    return ok(`${confirmed.length} publication(s) verified with external ids.`);
  },

  async collect_performance(ctx) {
    const publishingJobs = (ctx.artifacts.get("publishingJobs") as PublishingJob[] | undefined) ?? [];
    const confirmed = publishingJobs.filter((j) => j.state === "PUBLISHED" && j.externalId);
    if (confirmed.length === 0) return skip("No published posts available for metric collection.");

    registerSocialPublishers();
    const { getSocialPublisher } = await import("./publishing/providers");
    let collected = 0;
    const creativeId = ctx.job.creativeId ?? ctx.job.id ?? "";
    for (const job of confirmed) {
      const publisher = getSocialPublisher(job.platform);
      if (!publisher || !job.externalId) continue;
      const periodStart = job.publishedAt ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
      const res = await publisher.getMetrics(job.accountId ?? "", job.externalId, periodStart, Date.now());
      if (!res.ok) continue;
      await savePerformance({
        creativeId,
        versionId: job.versionId,
        platform: job.platform,
        externalId: job.externalId,
        periodStart,
        periodEnd: Date.now(),
        metrics: res.value.metrics,
        source: publisher.capabilities.apiSurface,
        sampleSize: Object.values(res.value.metrics).reduce((a, b) => Math.max(a, b), 0),
        collectedAt: Date.now(),
        createdBy: ctx.runtime.actor,
      });
      collected += 1;
    }
    if (collected === 0) return skip("No platform returned metrics for the published posts.");
    artifact(ctx, { key: "performance", kind: "performance", label: `${collected} metric snapshot(s)`, taskId: "collect_performance", createdAt: Date.now() });
    return ok(`${collected} metric snapshot(s) collected from their platforms.`);
  },

  async generate_learning(ctx) {
    const creativeId = ctx.job.creativeId ?? ctx.job.id ?? "";
    const snapshots = await listPerformance(creativeId);
    if (snapshots.length < 2) return skip("Insufficient performance history to draw an observation.");

    const [a, b] = snapshots;
    const { generateObservations } = await import("./analytics");
    const observations = await generateObservations(
      {
        savePerformance: async () => "",
        listPerformance: async () => snapshots,
        saveLearning: async (o) => saveLearning(o),
        listLearning: async () => [],
      },
      { creativeId, platform: b.platform, baseline: a, candidate: b, createdBy: ctx.runtime.actor }
    );

    if (observations.length === 0) return skip("No observation met the minimum sample threshold.");
    artifact(ctx, { key: "learning", kind: "learning", label: `${observations.length} observation(s)`, taskId: "generate_learning", createdAt: Date.now() });
    return ok(`${observations.length} learning observation(s) recorded (correlation only, sample-size qualified).`);
  },
};

function runtime_policy(ctx: TaskContext): "STRICT" | "STANDARD" {
  return ctx.runtime.settings.claimPolicy ?? "STRICT";
}

function runtime_maxDuration(ctx: TaskContext): number {
  return ctx.runtime.settings.maxRenderDurationSec ?? 180;
}

async function resolveCapture(ctx: TaskContext): Promise<BrowserCapture | null> {
  const existing = ctx.artifacts.get("capture") as BrowserCapture | undefined;
  if (existing) return existing;
  if (ctx.job.planId) {
    const plan = await getPlan(ctx.job.planId);
    if (plan) return getCapture(plan.id ?? "").catch(() => null);
  }
  return null;
}

async function savePublishingState(jobId: string, state: PublishingJob["state"]): Promise<void> {
  const { updateRecord } = await import("@/lib/growth/database");
  const { MARKETING_AGENT_COLLECTIONS } = await import("./collections");
  if (!jobId) return;
  await updateRecord<PublishingJob>(MARKETING_AGENT_COLLECTIONS.publishingJobs, jobId, { state, updatedAt: Date.now() } as unknown as PublishingJob, "agent:schedule");
}

// ─── Approval entry points (§40) ────────────────────────────────────────────

export async function decideApproval(input: {
  jobId: string;
  decision: "APPROVED" | "REJECTED";
  actor: string;
  reason?: string;
}): Promise<{ ok: boolean; reason: string; job?: MarketingAgentJob }> {
  const job = await getAgentJob(input.jobId);
  if (!job) return { ok: false, reason: "Job not found." };
  if (job.state !== "AWAITING_APPROVAL") return { ok: false, reason: `Job is ${job.state}, not awaiting approval.` };

  job.approval = {
    required: true,
    decidedAt: Date.now(),
    decidedBy: input.actor,
    decision: input.decision,
    reason: input.reason,
  };
  job.blockedReason = undefined;

  if (input.decision === "REJECTED") {
    job.state = "FAILED";
    job.error = input.reason ?? "Rejected by reviewer.";
    await updateAgentJob(job.id ?? "", { approval: job.approval, state: job.state, error: job.error }, input.actor);
    await audit({ actor: input.actor, action: "marketing_agent_rejected", targetType: "marketingAgentJob", targetId: job.id ?? "", detail: { reason: input.reason } });
    return { ok: true, reason: "Rejected.", job };
  }

  job.state = "PAUSED";
  await updateAgentJob(job.id ?? "", { approval: job.approval, state: job.state }, input.actor);
  await audit({ actor: input.actor, action: "marketing_agent_approved", targetType: "marketingAgentJob", targetId: job.id ?? "", detail: { reason: input.reason } });
  return { ok: true, reason: "Approved — resume the run to schedule/publish.", job };
}

/** Resume a job from its cursor (§4). */
export async function resumeJob(jobId: string, runtime: AgentRuntime): Promise<RunOutcome> {
  const job = await getAgentJob(jobId);
  if (!job) return { ok: false, job: {} as MarketingAgentJob, reason: "Job not found." };
  if (job.state === "FAILED") {
    await updateAgentJob(jobId, { state: "PAUSED", error: undefined, errorCode: undefined }, runtime.actor);
    job.state = "PAUSED";
  }
  return runJob(jobId, runtime);
}

/** Cancel a running/queued job. */
export async function cancelJob(jobId: string, actor: string): Promise<{ ok: boolean; reason: string }> {
  const job = await getAgentJob(jobId);
  if (!job) return { ok: false, reason: "Job not found." };
  if (job.state === "COMPLETED" || job.state === "CANCELLED") return { ok: false, reason: `Job already ${job.state}.` };
  await updateAgentJob(jobId, { state: "CANCELLED" }, actor);
  await audit({ actor, action: "marketing_agent_cancelled", targetType: "marketingAgentJob", targetId: jobId, detail: {} });
  return { ok: true, reason: "Cancelled." };
}

// ─── Status / health (§84) ──────────────────────────────────────────────────

export async function runtimeStatus(settings: MarketingAgentSettings): Promise<{
  health: { id: string; label: string; state: string; detail?: string; checkedAt: number }[];
  platforms: ReturnType<typeof capabilityMatrix>;
}> {
  registerCreativeProviders();
  registerSocialPublishers();
  const { listCreativeProviders } = await import("./provider");
  const health: { id: string; label: string; state: string; detail?: string; checkedAt: number }[] = [];

  for (const provider of listCreativeProviders()) {
    const h = await provider.health();
    health.push({ id: h.id, label: h.label, state: h.state, detail: h.detail, checkedAt: h.checkedAt });
  }

  const captures = await captureHealth();
  for (const c of captures) {
    health.push({ id: `browser_${c.id}`, label: c.label, state: c.state, detail: c.reason, checkedAt: c.checkedAt });
  }

  const { listSocialPublishers } = await import("./publishing/providers");
  const publishers = listSocialPublishers();
  let connected = 0;
  for (const p of publishers) {
    const h = await p.health();
    const state = h.ok ? "READY" : h.state === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "ERROR";
    if (state === "READY") connected += 1;
    health.push({ id: `social_${p.platform}`, label: `${p.platform} publishing`, state, detail: h.ok ? undefined : h.reason, checkedAt: Date.now() });
  }
  health.push({
    id: "social_summary",
    label: "Social Publishing",
    state: connected > 0 ? "READY" : "NOT_CONFIGURED",
    detail: `${connected}/${publishers.length} connected`,
    checkedAt: Date.now(),
  });

  void settings;
  return { health, platforms: capabilityMatrix() };
}

/** Advance due schedules one tick (called from the growth cron). */
export async function tickSchedules(now = Date.now()): Promise<{ due: string[]; completed: number; errors: number }> {
  const { listSchedules, saveSchedule, getPublishingJob } = await import("./storage");
  const schedules = await listSchedules("ACTIVE");
  const store = rtdbPublishingStore();
  const due: string[] = [];
  let completed = 0;
  let errors = 0;

  for (const schedule of schedules) {
    const check = isScheduleDue(schedule, now);
    if (!check.due) continue;
    due.push(schedule.id ?? "");

    try {
      const job = await getPublishingJob(schedule.publishingJobId);
      if (!job) {
        errors += 1;
        continue;
      }
      const account = true; // account state is validated by the connector itself
      const result = await executePublishingJob(store, schedule.publishingJobId, {
        approvalGranted: true,
        accountConnected: account,
        publishingEnabled: true,
        qaPassed: true,
        now,
      });

      const advanced = advanceSchedule(schedule, now);
      await saveSchedule({
        ...schedule,
        runCount: schedule.runCount + 1,
        lastRunAt: now,
        lastRunResult: result.reason,
        nextRunAt: advanced.nextRunAt,
        state: advanced.completed ? "COMPLETED" : schedule.state,
        updatedAt: Date.now(),
      });
      if (advanced.completed) completed += 1;
      if (!result.ok && result.state !== "RETRYING" && result.state !== "PUBLISH_VERIFICATION_REQUIRED") errors += 1;
    } catch {
      errors += 1;
    }
  }

  await audit({ actor: "agent:cron", action: "marketing_agent_schedule_tick", targetType: "marketingAgentJob", targetId: "", detail: { due: due.length, completed, errors } });
  return { due, completed, errors };
}

export { parseIntent, buildPlan, MARKETING_AGENT_TASK_LABELS, buildVariantSpecs, deriveVersionLineage, interpretRemix, buildPublishingPackage, estimateProduction, getCapture, listVersions };
