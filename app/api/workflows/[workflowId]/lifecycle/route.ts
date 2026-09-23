import { NextRequest } from "next/server";
import { authenticateWorkflow, deny, ok } from "../../_helpers";
import {
    getWorkflow,
    saveWorkflow,
    getVersion,
    unscheduleWorkflow,
} from "@/lib/workflows/database";
import { resolveEntitlement } from "@/lib/workflows/limits";
import { isProUser } from "@/lib/ai-signals/access";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    const body = await request.json().catch(() => ({}));
    const action = body.action;

    const allowed = new Map<string, Set<string>>([
        ["activate", new Set(["draft", "paused", "disabled"])],
        ["pause", new Set(["active"])],
        ["disable", new Set(["active", "paused"])],
        ["archive", new Set(["active", "paused", "disabled", "draft"])],
        ["rollback", new Set(["active", "paused", "disabled", "archived"])],
    ]);
    if (!allowed.has(action) || !allowed.get(action)?.has(workflow.status)) {
        return Response.json({ error: `Cannot ${action} workflow in status ${workflow.status}` }, { status: 409 });
    }

    const ent = await resolveEntitlement(auth.uid, auth.isAdmin);

    switch (action) {
        case "activate": {
            if (!ent.limits.schedulesEnabled && workflow.schedule?.enabled && !auth.isAdmin) {
                return Response.json({ error: "Schedules require Pro", hasPro: false, upgrade: true }, { status: 403 });
            }
            workflow.status = "active";
            workflow.version += 1;
            await saveWorkflow(workflow);
            if (workflow.schedule?.enabled) {
                const { scheduleForWorkflow } = await import("@/lib/workflows/scheduler");
                await scheduleForWorkflow(auth.uid, workflow.id, workflow.schedule.cron);
            }
            return ok({ status: "active", version: workflow.version });
        }
        case "pause": {
            workflow.status = "paused";
            await saveWorkflow(workflow);
            await unscheduleWorkflow(auth.uid, workflowId);
            return ok({ status: "paused" });
        }
        case "disable": {
            workflow.status = "disabled";
            await saveWorkflow(workflow);
            await unscheduleWorkflow(auth.uid, workflowId);
            return ok({ status: "disabled" });
        }
        case "archive": {
            workflow.status = "archived";
            await saveWorkflow(workflow);
            await unscheduleWorkflow(auth.uid, workflowId);
            return ok({ status: "archived" });
        }
        case "rollback": {
            const version = body.version;
            if (typeof version !== "number") return Response.json({ error: "version required" }, { status: 400 });
            const older = await getVersion(auth.uid, workflowId, version);
            if (!older) return Response.json({ error: "version not found" }, { status: 404 });
            older.status = "active";
            older.version = workflow.version + 1;
            older.updatedAt = Date.now();
            await saveWorkflow(older);
            await unscheduleWorkflow(auth.uid, workflowId);
            return ok({ status: "active", version: older.version });
        }
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
}