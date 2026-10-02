/**
 * AI Execution — policy API.
 *
 * GET  → returns the server-clamped policy (the client view never contains
 *        anything the server wouldn't enforce itself).
 * POST → updates mode/automation config. Transitioning into AUTOMATION
 *        requires `confirm: true` AND an explicit `acknowledgeRisk` string —
 *        automation is NEVER enabled implicitly. The policy is re-clamped
 *        server-side against the hard ceilings on every write.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/ai-execution/runtime";
import { getExecutionPolicy, saveExecutionPolicy, writeAudit } from "@/lib/ai-execution/database";
import { clampAutomationPolicy } from "@/lib/ai-execution/types";

export async function GET(request: NextRequest) {
    const caller = await requireCaller(request);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const policy = await getExecutionPolicy(caller.uid);
    return NextResponse.json({ success: true, policy });
}

export async function POST(request: NextRequest) {
    const caller = await requireCaller(request);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const mode = body.executionMode;
    if (!["ANALYSIS", "APPROVAL", "AUTOMATION"].includes(mode)) {
        return NextResponse.json({ error: "executionMode must be ANALYSIS, APPROVAL or AUTOMATION." }, { status: 400 });
    }

    const enableAutomation = mode === "AUTOMATION";
    if (enableAutomation && body.confirm !== true) {
        return NextResponse.json(
            { error: "Enabling AUTOMATION requires confirm: true — automation is never enabled implicitly." },
            { status: 400 },
        );
    }
    if (enableAutomation && typeof body.acknowledgeRisk !== "string") {
        return NextResponse.json(
            { error: "Enabling AUTOMATION requires acknowledging the risk statement (acknowledgeRisk)." },
            { status: 400 },
        );
    }

    const automationInput = body.automation && typeof body.automation === "object" ? body.automation : undefined;
    const automation = automationInput ? clampAutomationPolicy(automationInput) : undefined;

    const saved = await saveExecutionPolicy(
        caller.uid,
        { executionMode: mode, enabled: enableAutomation ? body.enabled !== false : false, automation },
        caller.uid,
    );

    await writeAudit({
        userId: caller.uid,
        action: enableAutomation ? "AUTOMATION_ENABLED" : mode === "APPROVAL" ? "POLICY_UPDATED" : "AUTOMATION_DISABLED",
        actor: caller.uid,
        executionMode: saved.executionMode,
        reason: enableAutomation ? String(body.acknowledgeRisk).slice(0, 300) : undefined,
    });

    return NextResponse.json({ success: true, policy: saved });
}
