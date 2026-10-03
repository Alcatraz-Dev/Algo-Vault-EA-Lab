/**
 * Marketing Agent — modes & approval policy (§39, §40, §60).
 *
 * Pure module: no I/O. The API layer and the task graph both consult
 * `evaluateApproval` before any scheduling/publishing task is allowed to run.
 */

import {
  MARKETING_AGENT_MODES,
  type MarketingAgentMode,
  type MarketingApprovalPolicy,
} from "./collections";
import type { ClaimCheckResult, MarketingAgentSettings } from "./types";

export type ApprovalDecision = {
  required: boolean;
  reason: string;
  /** Rule that produced the decision — auditable (§62). */
  rule: "MODE" | "POLICY" | "CLAIM" | "NEW_CAMPAIGN" | "TEMPLATE" | "DISABLED";
  /** True when no human may override (hard compliance gate). */
  hard: boolean;
};

export const DEFAULT_AGENT_SETTINGS: MarketingAgentSettings = {
  enabled: true,
  mode: "ASSISTED",
  flags: {
    marketingAgentEnabled: true,
    marketingAgentAutonomousEnabled: false,
    marketingAgentBrowserCaptureEnabled: true,
    marketingAgentHypitEnabled: true,
    marketingAgentPublishingEnabled: false,
  },
  approvalPolicy: "REQUIRED_FOR_TRADING_CLAIMS",
  allowedPlatforms: ["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS", "INSTAGRAM_FEED", "YOUTUBE", "FACEBOOK", "LINKEDIN", "X"],
  allowedLanguages: ["en", "fr", "ar"],
  maxDailyJobs: 40,
  maxProductionUnits: 48,
  maxVariants: 10,
  maxRenderDurationSec: 180,
  costLimitUnitsPerDay: 240,
  claimPolicy: "STRICT",
  defaultDisclaimer:
    "Risk disclosure: Trading CFDs, forex, and other leveraged instruments carries a high level of risk and may not be suitable for all investors. Past performance is not indicative of future results. Never risk more than you can afford to lose. This content is for informational purposes only and does not constitute financial advice.",
  defaultTimezone: "UTC",
  updatedAt: 0,
  updatedBy: "system",
};

export function isKnownMode(value: unknown): value is MarketingAgentMode {
  return typeof value === "string" && (MARKETING_AGENT_MODES as readonly string[]).includes(value);
}

/**
 * Should this job stop for a human before scheduling/publishing?
 *
 * Order matters: hard compliance blocks always win, then mode, then the
 * campaign's approval policy.
 */
export function evaluateApproval(input: {
  settings: MarketingAgentSettings;
  mode: MarketingAgentMode;
  policy: MarketingApprovalPolicy;
  claimResult?: ClaimCheckResult;
  isNewCampaign: boolean;
  /** True when the creative uses an approved template + approved claims. */
  usesApprovedTemplate?: boolean;
  targetsTradingContent?: boolean;
}): ApprovalDecision {
  const { settings, mode, policy, claimResult, isNewCampaign } = input;

  if (!settings.enabled || settings.flags.marketingAgentEnabled === false) {
    return { required: true, reason: "Marketing Agent is disabled by an administrator.", rule: "DISABLED", hard: true };
  }

  // Hard gate: a blocked claim always requires a human, in every mode.
  if (claimResult && claimResult.blocked) {
    return {
      required: true,
      reason: `Claim validation blocked ${claimResult.flags.filter((f) => f.severity === "high").length} statement(s).`,
      rule: "CLAIM",
      hard: true,
    };
  }

  if (mode === "MANUAL") {
    return { required: true, reason: "Manual mode: the agent never publishes on its own.", rule: "MODE", hard: false };
  }

  if (mode === "AUTONOMOUS" && settings.flags.marketingAgentAutonomousEnabled !== true) {
    return {
      required: true,
      reason: "Autonomous mode is not enabled in admin settings.",
      rule: "MODE",
      hard: true,
    };
  }

  switch (policy) {
    case "ALWAYS_REQUIRED":
      return { required: true, reason: "Campaign policy requires approval.", rule: "POLICY", hard: false };
    case "REQUIRED_FOR_TRADING_CLAIMS":
      if (input.targetsTradingContent) {
        return { required: true, reason: "Trading-related content requires approval.", rule: "POLICY", hard: false };
      }
      return { required: false, reason: "Non-trading informational demo is auto-eligible.", rule: "POLICY", hard: false };
    case "REQUIRED_FOR_NEW_CAMPAIGN":
      return isNewCampaign
        ? { required: true, reason: "New campaign requires approval.", rule: "NEW_CAMPAIGN", hard: false }
        : { required: false, reason: "Existing campaign reuses prior approval.", rule: "POLICY", hard: false };
    case "AUTO_APPROVE_TEMPLATE":
      return input.usesApprovedTemplate && !claimResult?.blocked
        ? { required: false, reason: "Approved template with approved claims.", rule: "TEMPLATE", hard: false }
        : { required: true, reason: "Template/claims not fully approved.", rule: "TEMPLATE", hard: false };
    case "AUTO_APPROVE_ALL":
      return mode === "AUTONOMOUS"
        ? { required: false, reason: "Autonomous mode with auto-approval policy.", rule: "POLICY", hard: false }
        : { required: true, reason: "Autonomous mode not active.", rule: "POLICY", hard: false };
    default:
      return { required: true, reason: "Unknown approval policy — failing closed.", rule: "POLICY", hard: true };
  }
}

/**
 * Whether the agent may schedule (§39/§48). Scheduling is allowed in ASSISTED
 * and AUTONOMOUS; MANUAL stops at READY.
 */
export function canSchedule(mode: MarketingAgentMode, settings: MarketingAgentSettings): boolean {
  if (settings.flags.marketingAgentPublishingEnabled !== true && mode !== "MANUAL") {
    // Scheduling without the publishing flag still stores the intent but the
    // job stops at SCHEDULED and reports NOT_CONFIGURED to the operator.
    return true;
  }
  return mode === "ASSISTED" || mode === "AUTONOMOUS";
}

/** Whether the agent may publish without a human pressing the button (§39). */
export function canPublish(mode: MarketingAgentMode, settings: MarketingAgentSettings): boolean {
  if (settings.flags.marketingAgentPublishingEnabled !== true) return false;
  return mode === "AUTONOMOUS" && settings.flags.marketingAgentAutonomousEnabled === true;
}

/**
 * Guard rails applied even in AUTONOMOUS mode (§39). Returns blocking reasons.
 */
export function autonomousGuardrails(input: {
  settings: MarketingAgentSettings;
  platform: string;
  dailyUnitsUsed: number;
  requestedUnits: number;
  claimResult?: ClaimCheckResult;
}): string[] {
  const reasons: string[] = [];
  if (!input.settings.allowedPlatforms.includes(input.platform as never)) {
    reasons.push(`Platform ${input.platform} is not in the allowed platform list.`);
  }
  if (input.dailyUnitsUsed + input.requestedUnits > input.settings.costLimitUnitsPerDay) {
    reasons.push("Daily production unit budget would be exceeded.");
  }
  if (input.claimResult?.blocked) reasons.push("Claim validation blocked.");
  return reasons;
}

export function modeLabel(mode: MarketingAgentMode): string {
  return mode === "MANUAL" ? "Manual" : mode === "ASSISTED" ? "Assisted" : "Autonomous";
}
