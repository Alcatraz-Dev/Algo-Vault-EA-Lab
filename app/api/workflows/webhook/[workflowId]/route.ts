import { NextRequest } from "next/server";
import { authenticateWorkflow, deny, ok } from "../../_helpers";
import { getWorkflow, updateRun } from "@/lib/workflows/database";
import { isProUser } from "@/lib/ai-signals/access";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    if (workflow.status !== "active") return Response.json({ error: "Workflow not active." }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const secret = String(body.secret || "");
    if (!secret || secret !== workflow.webhookSecretHash) {
        return Response.json({ error: "Invalid webhook secret." }, { status: 401 });
    }

    // Create a queued run.
    const runId = `run_${Date.now().toString(36)}_${auth.uid.slice(-6)}_${Math.random().toString(36).slice(2, 8)}`;
    await updateRun(auth.uid, runId, {
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowVersion: workflow.version,
        userId: auth.uid,
        trigger: "webhook",
        status: "queued",
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
        testMode: false,
        triggerDetail: `webhook:${workflowId}`,
    });
    return ok({ runId, status: "queued" });
}