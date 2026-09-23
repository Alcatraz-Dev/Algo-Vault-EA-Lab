import { NextRequest } from "next/server";
import {
    getWorkflow,
    createRun,
    updateRun,
    executeWorkflow,
    cancelRun,
    getRun,
    listRuns,
} from "@/lib/workflows/database";
import { getGlobalSettings } from "@/lib/workflows/database";
import { resolveEntitlement, workflowDenied } from "@/lib/workflows/limits";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "../../_helpers";
import { isKillSwitchOn } from "@/lib/workflows/limits";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });

    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    const body = await request.json().catch(() => ({}));
    const testMode = body.testMode === true;

    const settings = await getGlobalSettings();
    if (settings.killSwitchEnabled && !auth.isAdmin) {
        return Response.json({ error: settings.killSwitchReason, killSwitchHit: true }, { status: 423 });
    }

    const trigger = body.trigger || "manual";
    const runId = `run_${Date.now().toString(36)}_${auth.uid.slice(-6)}_${Math.random().toString(36).slice(2, 8)}`;

    const ent = await resolveEntitlement(auth.uid, auth.isAdmin);
    if (!ent.allowed) return deny();
    if (testMode && !ent.limits.schedulesEnabled && !auth.isAdmin) {
        // test mode is allowed in Pro tier (default in limits) — admin bypass
    }

    const run = {
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowVersion: workflow.version,
        userId: auth.uid,
        trigger,
        status: "queued" as const,
        startedAt: Date.now(),
        finishedAt: null,
        durationMs: null,
        nodesTotal: workflow.nodes.filter((n) => n.enabled !== false).length,
        nodesCompleted: 0,
        nodesFailed: 0,
        nodesSkipped: 0,
        executedNodes: [],
        failedNodes: [],
        skippedNodes: [],
        testMode,
        triggerDetail: body.triggerDetail,
    };
    await createRun(run);

    try {
        const outcome = await executeWorkflow({
            uid: auth.uid,
            isAdmin: auth.isAdmin,
            workflow,
            trigger,
            triggerDetail: body.triggerDetail,
            testMode,
            inputs: body.inputs,
            runId,
            permitted: {
                analysis: true,
                signal: ent.limits.executionEnabled,
                execution: ent.limits.executionEnabled,
            },
        });

        // Promote queued → completed status.
        const finalRun = outcome.run;
        await updateRun(auth.uid, runId, {
            status: finalRun.status,
            finishedAt: finalRun.finishedAt,
            durationMs: finalRun.durationMs,
            nodesCompleted: finalRun.nodesCompleted,
            nodesFailed: finalRun.nodesFailed,
            nodesSkipped: finalRun.nodesSkipped,
            executedNodes: finalRun.executedNodes,
            failedNodes: finalRun.failedNodes,
            skippedNodes: finalRun.skippedNodes,
            error: finalRun.error,
        });

        return ok({ run: finalRun });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await updateRun(auth.uid, runId, {
            status: "failed",
            finishedAt: Date.now(),
            error: message,
            durationMs: Date.now() - run.startedAt,
        });
        return Response.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    // Cancel a pending/running run (body.runId required).
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const body = await request.json().catch(() => ({}));
    const runId: string = body.runId;
    if (!runId) return Response.json({ error: "runId required" }, { status: 400 });
    const cancelled = await cancelRun(auth.uid, runId);
    if (!cancelled) return Response.json({ error: "Could not cancel (not running)" }, { status: 409 });
    return ok({ cancelled: true });
}