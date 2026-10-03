/**
 * Marketing Agent — BrowserCapturePlan builder & validator (§6, §8).
 *
 * The plan is generated BEFORE any recording and must be executable and
 * reproducible. Validation is strict: a plan that names an unknown action, an
 * unapproved route, an unsafe region or an unbounded wait is rejected rather
 * than "best-effort" executed.
 *
 * Pure module: no I/O.
 */

import { MARKETING_AGENT_DEFAULTS, type MarketingAgentTaskId } from "../collections";
import type { BrowserCapturePlan, CaptureStep } from "../types";
import { getFeature, resolveDemoRoute } from "../product-knowledge";
import { isAllowedProductRoute } from "../permissions";

const ALLOWED_ACTIONS: CaptureStep["action"][] = ["open", "navigate", "click", "scroll", "select", "search", "switch_tab", "wait", "capture"];

/**
 * Regions that must never appear in a capture (§52). These selectors are
 * applied on top of anything the plan declares.
 */
export const DEFAULT_SENSITIVE_SELECTORS: { selector: string; reason: string }[] = [
  { selector: "[data-sensitive]", reason: "Marked sensitive by the product." },
  { selector: "input[type=password]", reason: "Password field." },
  { selector: "[data-account-balance]", reason: "Account balance." },
  { selector: "[data-email]", reason: "User email address." },
  { selector: "[data-private]", reason: "Private customer data." },
  { selector: "[data-notification-private]", reason: "Private notification." },
];

export type BuildCapturePlanInput = {
  productKeys: string[];
  objective: string;
  /** Extra focus areas mentioned in the prompt (e.g. "confidence", "details"). */
  focus?: string[];
  jobId?: string;
  version?: number;
};

export type BuildCapturePlanResult =
  | { ok: true; plan: BrowserCapturePlan; route: string; product: string }
  | { ok: false; error: string; code: "NO_ROUTE" | "ROUTE_NOT_ALLOWED" };

/**
 * Build a deterministic capture plan for a product feature (§8).
 * Steps mirror the documented workflow for the feature — they are authored in
 * `product-knowledge.ts`, never invented at runtime.
 */
export function buildCapturePlan(input: BuildCapturePlanInput): BuildCapturePlanResult {
  const resolved = resolveDemoRoute(input.productKeys);
  if (!resolved) return { ok: false, error: "No approved product route for this request.", code: "NO_ROUTE" };

  const feature = getFeature(resolved.product);
  if (!feature) return { ok: false, error: "Unknown product.", code: "NO_ROUTE" };

  const allowedRoutes = feature.routes;
  if (!isAllowedProductRoute(resolved.route, allowedRoutes)) {
    return { ok: false, error: `Route ${resolved.route} is not an approved product route.`, code: "ROUTE_NOT_ALLOWED" };
  }

  const focus = (input.focus ?? []).filter(Boolean).slice(0, 6);
  const steps: CaptureStep[] = [];
  let order = 1;

  steps.push({
    order: order++,
    action: "open",
    target: resolved.route,
    durationMs: 1500,
    waitFor: "network-idle",
    captures: "none",
    notes: "Open the real AlgoVault product route in the controlled marketing browser session.",
  });

  steps.push({
    order: order++,
    action: "capture",
    target: "page",
    durationMs: 800,
    captures: "screenshot",
    highlights: [{ kind: "zoom", label: feature.name }],
    notes: "Establishing shot of the real product page.",
  });

  // Primary workflow walk (authored per feature in product knowledge).
  for (const area of focus.length ? focus : feature.benefits.slice(0, 2)) {
    steps.push({
      order: order++,
      action: "click",
      target: `[data-marketing-focus="${slug(area)}"]`,
      durationMs: 900,
      waitFor: "settle",
      captures: "none",
      highlights: [{ kind: "click_ripple" }, { kind: "spotlight", label: area }],
      notes: `Guide the viewer to: ${area}`,
    });
    steps.push({
      order: order++,
      action: "capture",
      target: "viewport",
      durationMs: 700,
      captures: "screenshot",
      highlights: [{ kind: "bounding_box" }, { kind: "callout", label: area }],
      notes: `Highlight ${area}.`,
    });
  }

  // Show how a user can act, then return to the overview (§8 example 6–8).
  steps.push({
    order: order++,
    action: "scroll",
    target: "down",
    value: "600",
    durationMs: 700,
    captures: "video_segment",
    highlights: [{ kind: "dim", label: "Unrelated UI" }],
    notes: "Reveal the surrounding context without dwelling on unrelated UI.",
  });

  steps.push({
    order: order++,
    action: "capture",
    target: "viewport",
    durationMs: 900,
    captures: "video_segment",
    highlights: [{ kind: "animated_arrow", label: "Next step" }],
    notes: "Show how the user can act on the information.",
  });

  steps.push({
    order: order++,
    action: "navigate",
    target: resolved.route,
    durationMs: 900,
    waitFor: "network-idle",
    captures: "screenshot",
    highlights: [{ kind: "section_highlight", label: feature.name }],
    notes: "Return to the overview for a clean closing frame.",
  });

  if (steps.length > MARKETING_AGENT_DEFAULTS.maxCaptureSteps) {
    steps.length = MARKETING_AGENT_DEFAULTS.maxCaptureSteps;
    // Re-sequence after trimming.
    steps.forEach((s, i) => (s.order = i + 1));
  }

  const sensitiveRegions = [
    ...DEFAULT_SENSITIVE_SELECTORS,
    ...(focus.includes("account") ? [{ selector: "[data-account]", reason: "Account area." }] : []),
  ];

  const plan: BrowserCapturePlan = {
    targetPage: feature.name,
    route: resolved.route,
    objective: input.objective || `Demonstrate ${feature.name} in the real AlgoVault interface.`,
    steps,
    requiredState: ["app-ready", "auth-or-public-route-resolved"],
    elementsToHighlight: focus.length ? focus : feature.benefits.slice(0, 3),
    sectionsToCapture: steps.filter((s) => s.captures && s.captures !== "none").map((s) => `${s.action}:${s.target ?? ""}`),
    sensitiveRegions,
    timing: { stepDelayMs: 350, settleMs: 900, totalBudgetMs: 90_000 },
    fallback:
      "If the route is unreachable, requires an interactive login challenge, or renders an error boundary, " +
      "STOP and report CAPTURE_UNAVAILABLE. Do not fabricate screenshots.",
    fingerprint: fingerprintFor(resolved.route, steps),
    version: input.version ?? 1,
  };

  return { ok: true, plan, route: resolved.route, product: resolved.product };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Stable hash of route + step shape; drives staleness detection (§70). */
export function fingerprintFor(route: string, steps: CaptureStep[]): string {
  const shape = steps.map((s) => `${s.action}:${s.target ?? ""}:${s.captures ?? ""}`).join("|");
  const input = `${route}::${shape}`;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `fp_${h1.toString(16).padStart(8, "0")}_${steps.length}`;
}

export type PlanValidation = { ok: boolean; errors: string[] };

/** Executable/reproducible plan validation (§8). */
export function validateCapturePlan(plan: BrowserCapturePlan, allowedRoutes: string[]): PlanValidation {
  const errors: string[] = [];

  if (!plan.route || !isAllowedProductRoute(plan.route, allowedRoutes)) {
    errors.push(`Route "${plan.route}" is not an approved product route.`);
  }
  if (!plan.steps?.length) errors.push("Plan has no steps.");
  if (plan.steps && plan.steps.length > MARKETING_AGENT_DEFAULTS.maxCaptureSteps) {
    errors.push(`Plan exceeds the ${MARKETING_AGENT_DEFAULTS.maxCaptureSteps}-step budget.`);
  }
  if (!plan.objective?.trim()) errors.push("Plan has no objective.");
  if (!plan.fallback?.trim()) errors.push("Plan has no fallback behaviour.");
  if (!plan.fingerprint) errors.push("Plan has no fingerprint — staleness cannot be tracked.");

  const seenOrders = new Set<number>();
  for (const step of plan.steps ?? []) {
    const label = `step ${step.order}`;
    if (!(ALLOWED_ACTIONS as string[]).includes(step.action)) errors.push(`${label}: unknown action "${step.action}".`);
    if (seenOrders.has(step.order)) errors.push(`${label}: duplicate order.`);
    seenOrders.add(step.order);
    if (!Number.isFinite(step.durationMs) || step.durationMs < 0 || step.durationMs > 30_000) {
      errors.push(`${label}: durationMs must be between 0 and 30000.`);
    }
    if ((step.action === "click" || step.action === "select" || step.action === "scroll") && !step.target) {
      errors.push(`${label}: action "${step.action}" requires a target.`);
    }
    if (step.action === "open" || step.action === "navigate") {
      if (!step.target || !isAllowedProductRoute(step.target, allowedRoutes)) {
        errors.push(`${label}: navigation target "${step.target}" is not approved.`);
      }
    }
    // No free-form scripting, ever (§47).
    const target = String(step.target ?? "");
    if (/\b(eval|function\s*\(|javascript:|data:text\/html)\b/i.test(target)) {
      errors.push(`${label}: target contains executable content.`);
    }
    if (step.mask?.some((m) => !m.reason)) errors.push(`${label}: masked region requires a reason.`);
  }

  if (plan.timing.totalBudgetMs > 10 * 60_000) errors.push("Capture budget exceeds 10 minutes.");
  if (plan.sensitiveRegions.some((r) => !r.reason)) errors.push("Every sensitive region must declare a reason.");

  return { ok: errors.length === 0, errors };
}
