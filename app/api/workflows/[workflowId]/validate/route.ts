import { NextRequest } from "next/server";
import {
    getWorkflow,
    saveWorkflow,
    listRuns,
    updateRun,
} from "@/lib/workflows/database";
import { getGlobalSettings } from "@/lib/workflows/database";
import { validateWorkflow } from "@/lib/workflows/validate";
import { resolveEntitlement, runsBudgetExhausted, collectUsage } from "@/lib/workflows/limits";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "../../_helpers";

export async function GET(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    const body = await request.json().catch(() => ({}));
    const validation = validateWorkflow(
        { nodes: workflow.nodes, edges: workflow.edges, settings: workflow.settings, schedule: workflow.schedule, name: workflow.name },
        { analysis: true, signal: true, execution: true },
        { maxNodes: 150 },
    );
    return ok({
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        requiredPermissions: workflow.requiredPermissions,
        nodeCount: workflow.nodes.length,
        edgeCount: workflow.edges.length,
        runHistory: await listRuns(auth.uid, 10),
    });
}

export async function POST(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request as NextRequest);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });

    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    const settings = await getGlobalSettings();
    if (settings.killSwitchEnabled && !auth.isAdmin) {
        return Response.json({ error: settings.killSwitchReason }, { status: 423 });
    }

    const body = await request.json().catch(() => ({}));
    const testMode = body.testMode === true;

    // Re-validate at execution time.
    const ent = await resolveEntitlement(auth.uid, auth.isAdmin);
    if (!ent.allowed) return deny();
    const usage = await collectUsage(ent);
    if (runsBudgetExhausted(ent, usage) && !testMode && !auth.isAdmin) {
        return Response.json({ error: "Daily run budget exhausted", hasPro: false, upgrade: true }, { status: 429 });
    }
    if (ent.limits.maxActiveWorkflows > 0) {
        const currentActive = (await listRuns(auth.uid, 5)).filter((r) => r.status === "running" || r.status === "queued").length;
        if (currentActive >= ent.limits.maxActiveWorkflows && !auth.isAdmin) {
            return Response.json({ error: "Concurrent run limit reached", hasPro: false, upgrade: true }, { status: 429 });
        }
    }

    const validation = validateWorkflow(
        { nodes: workflow.nodes, edges: workflow.edges, settings: workflow.settings, schedule: workflow.schedule, name: workflow.name },
        { analysis: true, signal: ent.limits.executionEnabled, execution: ent.limits.executionEnabled },
        { maxNodes: ent.limits.maxNodesPerWorkflow },
    );
    if (!validation.valid) {
        return Response.json({ error: "Workflow validation failed", details: validation }, { status: 422 });
    }

    void body;
    void testMode;
    void ent;
    void usage;

    return Response.json({ queued: true, note: "Use the run endpoint (POST /api/workflows/[id]/run) to execute." });
}