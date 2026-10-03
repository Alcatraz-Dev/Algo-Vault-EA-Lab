/** Marketing Agent — status, capabilities and subsystem health (§65, §84, §89). */

import { NextRequest } from "next/server";
import { jsonOk, loadSettings, requireAdmin } from "./_runtime";
import { runtimeStatus } from "@/lib/marketing-agent/agent";
import { MARKETING_AGENT_TOOLS, MARKETING_AGENT_TOOL_MODES } from "@/lib/marketing-agent/collections";
import { MARKETING_TOOL_SCHEMAS } from "@/lib/marketing-agent/permissions";
import { listCapabilities } from "@/lib/marketing-agent/publishing/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonOk({ error: "Admin required" }, 403);

  const settings = await loadSettings();
  const { health, platforms } = await runtimeStatus(settings);

  return jsonOk({
    settings,
    health,
    platforms,
    capabilities: listCapabilities(),
    tools: MARKETING_AGENT_TOOLS.map((id) => ({
      id,
      description: MARKETING_TOOL_SCHEMAS[id].description,
      requiredArgs: MARKETING_TOOL_SCHEMAS[id].requiredArgs,
      optionalArgs: MARKETING_TOOL_SCHEMAS[id].optionalArgs,
      modes: MARKETING_AGENT_TOOL_MODES[id],
      enabled: settings.enabled && settings.flags.marketingAgentEnabled !== false,
    })),
    languages: settings.allowedLanguages,
    requestedBy: admin.uid,
  });
}
