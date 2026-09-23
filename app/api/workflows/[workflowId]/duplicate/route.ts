import { NextRequest } from "next/server";
import { getWorkflow, saveWorkflow } from "@/lib/workflows/database";
import { resolveEntitlement } from "@/lib/workflows/limits";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "../../_helpers";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    // Deep clone to a new draft.
    const { safeId } = await import("@/lib/workflows/naming");
    const clone = {
        ...workflow,
        id: safeId("wf"),
        name: `${workflow.name} (copy)`,
        status: "draft" as const,
        version: 1,
        nodes: workflow.nodes.map((n) => ({ ...n, id: `${n.id}_copy`, config: { ...n.config } })),
        edges: workflow.edges.map((e) => ({ ...e, id: `${e.id}_copy`, source: `${e.source}_copy`, target: `${e.target}_copy` })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: auth.uid,
        lastRunAt: undefined,
        lastRunStatus: undefined,
        versionHistory: undefined,
        sourceMarketplaceId: undefined,
    } as typeof workflow;
    await saveWorkflow(clone);
    return ok({ workflow: clone });
}