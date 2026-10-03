/**
 * Marketing Agent — tool permissions (§47, §48, §49).
 *
 * Every agent capability is a declared tool with a schema, an authorization
 * decision, a timeout and an audit record. There is no path from a user prompt
 * to an arbitrary shell command, an arbitrary URL, or an unrelated admin page.
 *
 * Pure module: authorization decisions only; the audit *write* happens in
 * `storage.recordToolInvocation` so this file stays testable without Firebase.
 */

import { MARKETING_AGENT_TOOLS, MARKETING_AGENT_TOOL_MODES, type MarketingAgentToolId } from "./collections";
import type { MarketingAgentMode } from "./collections";

export type ToolAuthorization =
  | { allowed: true }
  | { allowed: false; code: "UNKNOWN_TOOL" | "MODE_NOT_PERMITTED" | "FLAG_DISABLED" | "INVALID_INPUT"; reason: string };

export type ToolInvocation = {
  tool: MarketingAgentToolId;
  actor: string;
  mode: MarketingAgentMode;
  jobId?: string;
  /** Validated, allow-listed arguments (never a raw script). */
  args: Record<string, unknown>;
  startedAt: number;
  finishedAt?: number;
  ok?: boolean;
  errorCode?: string;
  /** Non-sensitive result summary. Never tokens, keys or personal data. */
  summary?: string;
  externalPlatform?: string;
  externalId?: string;
};

/**
 * URL guard for `marketing.openProductPage` (§49).
 * Only same-site relative routes may be opened by the capture agent, and only
 * routes that the product knowledge base declares.
 */
export function isAllowedProductRoute(route: string, allowedRoutes: string[]): boolean {
  if (!route || typeof route !== "string") return false;
  if (/\s/.test(route)) return false;
  if (!route.startsWith("/")) return false;
  if (route.startsWith("//")) return false;
  if (/[?#]/.test(route)) return false;
  if (route.includes("..")) return false;
  if (/^\/(api|admin)\b/.test(route)) return false;
  return allowedRoutes.some((r) => route === r || route.startsWith(`${r}/`));
}

/** Reject anything that smells like an attempt to escape the tool boundary. */
export function containsInjectionAttempt(text: string): boolean {
  const patterns = [
    /ignore\s+(all\s+)?(previous|prior|above|instructions)/i,
    /\bdisregard\s+(the\s+)?(system|rules|policy)/i,
    /\byou\s+are\s+now\b/i,
    /\b(act|execute|run)\s+(this|the following)\s+(shell|command|script)/i,
    /rm\s+-rf|\/etc\/passwd|\/etc\/shadow/i,
    /\b(curl|wget|nc|bash|sh|powershell)\s+-/i,
    /(api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+/i,
    /\bprint\s+(the\s+)?(env|environment|secrets|credentials)\b/i,
    /<\s*script|javascript:/i,
  ];
  return patterns.some((re) => re.test(text));
}

export function authorizeTool(input: {
  tool: string;
  mode: MarketingAgentMode;
  flags?: Record<string, boolean>;
  args?: Record<string, unknown>;
}): ToolAuthorization {
  const tool = input.tool as MarketingAgentToolId;
  if (!(MARKETING_AGENT_TOOLS as readonly string[]).includes(tool)) {
    return { allowed: false, code: "UNKNOWN_TOOL", reason: `Tool "${input.tool}" is not in the marketing allowlist.` };
  }

  const permittedModes = MARKETING_AGENT_TOOL_MODES[tool];
  if (!permittedModes.includes(input.mode)) {
    return {
      allowed: false,
      code: "MODE_NOT_PERMITTED",
      reason: `Tool "${tool}" is not permitted in ${input.mode} mode.`,
    };
  }

  if (tool === "marketing.captureBrowser" && input.flags?.marketingAgentBrowserCaptureEnabled === false) {
    return { allowed: false, code: "FLAG_DISABLED", reason: "Browser capture is disabled." };
  }
  if (tool === "marketing.createHypitProject" && input.flags?.marketingAgentHypitEnabled === false) {
    return { allowed: false, code: "FLAG_DISABLED", reason: "Hypit production is disabled." };
  }
  if ((tool === "marketing.publish" || tool === "marketing.schedule") && input.flags?.marketingAgentPublishingEnabled === false) {
    return { allowed: false, code: "FLAG_DISABLED", reason: "Publishing is disabled." };
  }

  const args = input.args ?? {};
  if (tool === "marketing.openProductPage") {
    const route = String(args.route ?? "");
    const allowed = Array.isArray(args.allowedRoutes) ? (args.allowedRoutes as string[]) : [];
    if (!isAllowedProductRoute(route, allowed)) {
      return { allowed: false, code: "INVALID_INPUT", reason: `Route "${route}" is not an approved product route.` };
    }
  }
  if (typeof args.prompt === "string" && containsInjectionAttempt(args.prompt)) {
    return { allowed: false, code: "INVALID_INPUT", reason: "Instruction contains a blocked injection pattern." };
  }

  return { allowed: true };
}

/** Schema descriptors surfaced in the admin UI (§48). */
export const MARKETING_TOOL_SCHEMAS: Record<MarketingAgentToolId, { description: string; requiredArgs: string[]; optionalArgs: string[] }> = {
  "marketing.searchProduct": { description: "Resolve a product/feature from the approved knowledge base.", requiredArgs: ["query"], optionalArgs: [] },
  "marketing.openProductPage": { description: "Open an approved product route in the controlled capture browser.", requiredArgs: ["route"], optionalArgs: ["allowedRoutes"] },
  "marketing.captureBrowser": { description: "Execute a validated BrowserCapturePlan and store frames.", requiredArgs: ["planId"], optionalArgs: ["captureId"] },
  "marketing.generateScript": { description: "Generate a duration-fitted script and shot list.", requiredArgs: ["briefId"], optionalArgs: ["language", "tone"] },
  "marketing.generateAssets": { description: "Generate or select B-roll / graphic assets.", requiredArgs: ["scriptId"], optionalArgs: ["style"] },
  "marketing.createHypitProject": { description: "Create an editable Hypit composition project.", requiredArgs: ["compositionSpec"], optionalArgs: ["recipeId"] },
  "marketing.renderCreative": { description: "Render a Hypit composition to a platform preset.", requiredArgs: ["compositionId"], optionalArgs: ["preset", "language"] },
  "marketing.generateVariants": { description: "Generate hook/CTA/opening variants with lineage.", requiredArgs: ["creativeId"], optionalArgs: ["kinds", "count"] },
  "marketing.runQualityCheck": { description: "Run the eight QA gates and return a report.", requiredArgs: ["versionId"], optionalArgs: [] },
  "marketing.preparePublication": { description: "Build copy, hashtags, thumbnail and UTM package.", requiredArgs: ["versionId"], optionalArgs: ["platform"] },
  "marketing.schedule": { description: "Store a schedule in the existing scheduler surface.", requiredArgs: ["publishingJobId", "scheduledFor", "timezone"], optionalArgs: ["recurrence"] },
  "marketing.publish": { description: "Publish an approved job through a configured connector.", requiredArgs: ["publishingJobId"], optionalArgs: [] },
  "marketing.verifyPublication": { description: "Verify a platform confirmation and store external ids.", requiredArgs: ["publishingJobId"], optionalArgs: [] },
  "marketing.getAnalytics": { description: "Collect metrics actually reported by the platform.", requiredArgs: ["creativeId"], optionalArgs: ["periodStart", "periodEnd"] },
  "marketing.generateInsights": { description: "Produce non-causal performance observations.", requiredArgs: ["creativeId"], optionalArgs: [] },
};

export const MARKETING_AGENT_TOOL_LIST = MARKETING_AGENT_TOOLS;
