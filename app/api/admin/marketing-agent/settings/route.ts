/** Marketing Agent — admin settings and feature flags (§89, §90). */

import { NextRequest } from "next/server";
import { jsonError, jsonOk, loadSettings, requireAdmin, saveSettings } from "../_runtime";
import { MARKETING_AGENT_FLAGS, MARKETING_AGENT_MODES, MARKETING_APPROVAL_POLICIES, MARKETING_PLATFORMS, MARKETING_LANGUAGES } from "@/lib/marketing-agent/collections";
import { audit } from "@/lib/marketing-agent/storage";
import type { MarketingAgentSettings } from "@/lib/marketing-agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const settings = await loadSettings();
  return jsonOk({
    settings,
    schema: {
      modes: MARKETING_AGENT_MODES,
      approvalPolicies: MARKETING_APPROVAL_POLICIES,
      flags: MARKETING_AGENT_FLAGS,
      platforms: MARKETING_PLATFORMS,
      languages: MARKETING_LANGUAGES,
    },
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const body = (await req.json().catch(() => ({}))) as Partial<MarketingAgentSettings>;
  const current = await loadSettings();

  // Only known keys are ever written; unknown keys are dropped.
  const next: MarketingAgentSettings = {
    ...current,
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(body.mode && (MARKETING_AGENT_MODES as readonly string[]).includes(body.mode) ? { mode: body.mode } : {}),
    ...(body.approvalPolicy && (MARKETING_APPROVAL_POLICIES as readonly string[]).includes(body.approvalPolicy) ? { approvalPolicy: body.approvalPolicy } : {}),
    ...(Array.isArray(body.allowedPlatforms) ? { allowedPlatforms: body.allowedPlatforms.filter((p) => (MARKETING_PLATFORMS as readonly string[]).includes(p)) } : {}),
    ...(Array.isArray(body.allowedLanguages) ? { allowedLanguages: body.allowedLanguages.filter((l) => (MARKETING_LANGUAGES as readonly string[]).includes(l)) } : {}),
    ...(typeof body.maxDailyJobs === "number" ? { maxDailyJobs: clamp(body.maxDailyJobs, 1, 500) } : {}),
    ...(typeof body.maxProductionUnits === "number" ? { maxProductionUnits: clamp(body.maxProductionUnits, 1, 500) } : {}),
    ...(typeof body.maxVariants === "number" ? { maxVariants: clamp(body.maxVariants, 1, 25) } : {}),
    ...(typeof body.maxRenderDurationSec === "number" ? { maxRenderDurationSec: clamp(body.maxRenderDurationSec, 10, 600) } : {}),
    ...(typeof body.costLimitUnitsPerDay === "number" ? { costLimitUnitsPerDay: clamp(body.costLimitUnitsPerDay, 1, 5000) } : {}),
    ...(body.claimPolicy === "STRICT" || body.claimPolicy === "STANDARD" ? { claimPolicy: body.claimPolicy } : {}),
    ...(typeof body.defaultDisclaimer === "string" && body.defaultDisclaimer.length < 2000 ? { defaultDisclaimer: body.defaultDisclaimer } : {}),
    ...(typeof body.defaultTimezone === "string" ? { defaultTimezone: body.defaultTimezone } : {}),
    ...(body.flags && typeof body.flags === "object"
      ? {
          flags: Object.fromEntries(
            MARKETING_AGENT_FLAGS.filter((f) => typeof body.flags?.[f] === "boolean").map((f) => [f, Boolean(body.flags?.[f])])
          ),
        }
      : {}),
    updatedAt: Date.now(),
    updatedBy: admin.uid,
  };

  // AUTONOMOUS mode can only be selected when the autonomous flag is on.
  if (next.mode === "AUTONOMOUS" && next.flags.marketingAgentAutonomousEnabled !== true) {
    return jsonError("Enable the autonomous flag before selecting AUTONOMOUS mode.", 422);
  }

  await saveSettings(next, admin.uid);
  await audit({
    actor: admin.uid,
    action: "marketing_agent_settings_updated",
    targetType: "marketingAgentSettings",
    targetId: "",
    detail: { mode: next.mode, enabled: next.enabled, flags: next.flags, approvalPolicy: next.approvalPolicy },
  });
  return jsonOk({ settings: next });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
