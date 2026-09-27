// AlgoVault Agent IDE — Policy Introspection API
//
// Read-only description of the agent's policy surface for the UI: mode
// capability matrix, structurally blocked permissions, tool declarations and
// mode limits. Contains no secrets and no run state; it is the data behind the
// "what is the agent allowed to do" panel.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { STRUCTURALLY_BLOCKED, MODE_PERMISSIONS } from "@/lib/agent/policies/permission-engine";
import { TOOL_DECLARATIONS } from "@/lib/agent/tools/registry";
import { AGENT_MODES, MODE_DESCRIPTIONS, defaultLimitsFor } from "@/lib/agent/core/types";
import { ALGOVAULT_PROFILE } from "@/lib/agent/context/project-profile";

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    return NextResponse.json({
        modes: AGENT_MODES.map((mode) => ({
            id: mode,
            description: MODE_DESCRIPTIONS[mode],
            permissions: MODE_PERMISSIONS[mode],
            limits: defaultLimitsFor(mode),
        })),
        structurallyBlocked: STRUCTURALLY_BLOCKED,
        tools: Object.entries(TOOL_DECLARATIONS).map(([id, decl]) => ({
            id,
            requires: decl.requires,
            requiresConfirmation: decl.requiresConfirmation,
            category: decl.category,
            mutating: decl.mutating,
        })),
        profile: ALGOVAULT_PROFILE,
    });
}
