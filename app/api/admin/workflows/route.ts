import { NextRequest } from "next/server";
import { authenticateWorkflow, deny, ok } from "../../workflows/_helpers";
import {
    getGlobalSettings,
    setGlobalSettings,
    listAllWorkflows,
    listAllRuns,
} from "@/lib/workflows/database";

export async function GET(request: NextRequest) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    if (!auth.isAdmin) return deny("Admin only.");
    const workflows = await listAllWorkflows();
    const runs = await listAllRuns(100);
    const settings = await getGlobalSettings();
    const settings2 = await settings;
    const statusBreakdown = {
        draft: workflows.filter((w) => w.status === "draft").length,
        active: workflows.filter((w) => w.status === "active").length,
        paused: workflows.filter((w) => w.status === "paused").length,
        disabled: workflows.filter((w) => w.status === "disabled").length,
        archived: workflows.filter((w) => w.status === "archived").length,
    };
    const recentFailures = runs.filter((r) => r.status === "failed" || r.status === "timeout" || r.status === "partial").slice(0, 10);
    return ok({
        killSwitch: settings2.killSwitchEnabled,
        killSwitchReason: settings2.killSwitchReason,
        workflowCount: workflows.length,
        runsTotal: runs.length,
        statusBreakdown,
        recentFailures: recentFailures.map((r) => ({
            id: r.id,
            workflowId: r.workflowId,
            workflowName: r.workflowName,
            status: r.status,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            error: r.error,
        })),
        settings: settings2,
    });
}

export async function PATCH(request: NextRequest) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    if (!auth.isAdmin) return deny("Admin only.");
    const body = await request.json().catch(() => ({}));
    const settings = await getGlobalSettings();
    if (body.killSwitch !== undefined) {
        settings.killSwitchEnabled = !!body.killSwitch;
        settings.killSwitchReason = body.reason ?? (body.killSwitch ? "Admin kill switch engaged." : undefined);
        await setGlobalSettings(settings);
    }
    if (body.resetLimits) {
        settings.defaultMaxRunsPerDay = body.resetLimits.maxRunsPerDay ?? 500;
        settings.defaultMaxConcurrency = body.resetLimits.maxConcurrency ?? 8;
        settings.aiBuilderEnabled = body.resetLimits.aiBuilderEnabled ?? true;
        await setGlobalSettings(settings);
    }
    return ok(settings);
}