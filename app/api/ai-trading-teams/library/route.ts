import { NextRequest } from "next/server";
import { flagDisabled, ok, readEntitlement, unauthorized } from "../_helpers";
import { featureFlagSnapshot, isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { listAgentLibrary } from "@/lib/ai-trading-teams/agents";
import { BUILTIN_TEAM_TEMPLATES } from "@/lib/ai-trading-teams/templates";
import { listAdminTemplates } from "@/lib/ai-trading-teams/database";

/**
 * GET /api/ai-trading-teams/library
 *
 * Returns the agent library, templates, feature flags and entitlement so the
 * UI can render a full preview for free users while gating real executions
 * server-side. Free users receive the same definitions (they are not secret)
 * but `canRun` is false.
 */
export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const entitlement = await readEntitlement(request);
    // The library itself is not gated: non-Pro users must be able to see the
    // feature preview (spec §27). `canRun` is what actually gates execution.
    const uid = entitlement.uid || "anonymous";

    try {
        const [agents, adminTemplates] = await Promise.all([
            entitlement.uid ? listAgentLibrary(entitlement.uid) : Promise.resolve([]),
            listAdminTemplates().catch(() => []),
        ]);

        return ok({
            agents,
            templates: [...BUILTIN_TEAM_TEMPLATES, ...adminTemplates],
            flags: featureFlagSnapshot(),
            entitlement: {
                isAuthenticated: Boolean(entitlement.uid),
                isPro: entitlement.isPro,
                canRun: entitlement.isPro && featureFlagSnapshot().aiTeamsEnabled,
                canCreateCustomAgents: entitlement.isPro && featureFlagSnapshot().customAgentsEnabled,
                isAdmin: entitlement.isAdmin,
            },
            uid,
        });
    } catch (err) {
        console.error("[ai-trading-teams] library failed:", err);
        return unauthorized("Failed to load library.");
    }
}
