import { NextRequest } from "next/server";
import {
    listWorkflows,
    saveWorkflow,
    getWorkflow,
    snapshotVersion,
    getGlobalSettings,
    scheduleForWorkflow,
    unscheduleWorkflow,
} from "@/lib/workflows/database";
import { getNodeDefinition } from "@/lib/workflows/node-registry";
import { validateWorkflow } from "@/lib/workflows/validate";
import { resolveEntitlement, collectUsage, runsBudgetExhausted, workflowDenied } from "@/lib/workflows/limits";
import { isKillSwitchOn } from "@/lib/workflows/limits";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "./_helpers";
import { WorkflowAutomation, WorkflowNode, WorkflowEdge } from "@/lib/workflows/types";
import { safeId } from "@/lib/workflows/naming";

export async function GET(request: NextRequest) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) {
        if (auth.error?.includes("admin") || auth.error?.includes("token")) {
            // Fallback: try isProUser via admin token if provided differently? No — just require bearer.
        }
        return deny("Authentication required.");
    }
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    const workflows = await listWorkflows(auth.uid);
    return ok(workflows);
}

export async function POST(request: Request) {
    const auth = await authenticateWorkflow(request as NextRequest);
    if (!auth.uid) return deny("Authentication required.");
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    const settings = await getGlobalSettings();
    if (settings.killSwitchEnabled && !auth.isAdmin) {
        return Response.json({ error: settings.killSwitchReason, hasPro: false, upgrade: false }, { status: 423 });
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    let nodes: WorkflowNode[] = Array.isArray(body.nodes) ? body.nodes : [];
    let edges: WorkflowEdge[] = Array.isArray(body.edges) ? body.edges : [];

    if (!name) return Response.json({ error: "name required" }, { status: 400 });

    // Pro tier entitlement + limits
    const ent = await resolveEntitlement(auth.uid, auth.isAdmin);
    const usage = await collectUsage(ent);
    if (!ent.allowed) return deny();
    if (usage.atLimitFor.includes("workflows")) return Response.json({ error: "Workflow limit reached", upgrade: true, hasPro: false }, { status: 403 });
    if (usage.atLimitFor.includes("active_workflows") && !auth.isAdmin) return Response.json({ error: "Active workflow limit reached", upgrade: true, hasPro: false }, { status: 403 });

    // Seed default starter trigger node if creating a blank workflow
    if (nodes.length === 0) {
        nodes = [
            {
                id: "trigger_1",
                type: "trigger.manual",
                label: "Manual Trigger",
                position: { x: 250, y: 150 },
                config: { label: "Start" },
            },
        ];
    }

    // Validate
    const known = nodes.every((n) => getNodeDefinition(n.type) !== undefined);
    if (!known || nodes.length === 0) return Response.json({ error: "Invalid nodes", upgrade: true, hasPro: false }, { status: 400 });
    const validation = validateWorkflow(
        { nodes, edges, settings: body.settings ?? {}, schedule: body.schedule, name },
        { analysis: ent.limits.executionEnabled, signal: true, execution: ent.limits.executionEnabled },
        { maxNodes: ent.limits.maxNodesPerWorkflow },
    );
    if (!validation.valid) return Response.json({ error: "Validation failed", details: validation }, { status: 400 });

    const now = Date.now();
    const workflow: WorkflowAutomation = {
        id: safeId("wf"),
        userId: auth.uid,
        name,
        description: String(body.description || "").slice(0, 500),
        status: "draft",
        visibility: "private",
        version: 1,
        nodes,
        edges,
        requiredPermissions: [],
        schedule: body.schedule && body.schedule.enabled ? { enabled: true, cron: body.schedule.cron } : undefined,
        settings: body.settings ?? { timeoutMs: 120_000, maxConcurrency: 4, notifyOnCompletion: false },
        tags: body.tags,
        createdAt: now,
        updatedAt: now,
        createdBy: auth.uid,
    };
    // Derive required permissions server-side.
    const registry = await import("@/lib/workflows/node-registry");
    workflow.requiredPermissions = (await import("@/lib/workflows/validate")).deriveRequiredPermissions(nodes);

    await saveWorkflow(workflow);
    await snapshotVersion(workflow);

    if (workflow.schedule?.enabled) {
        await scheduleForWorkflow(auth.uid, workflow.id, workflow.schedule.cron);
    }

    return Response.json(workflow, { status: 201 });
}