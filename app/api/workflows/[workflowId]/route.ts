import { NextRequest } from "next/server";
import {
    deleteWorkflow,
    getWorkflow,
    saveWorkflow,
    snapshotVersion,
    unscheduleWorkflow,
} from "@/lib/workflows/database";
import { getNodeDefinition } from "@/lib/workflows/node-registry";
import { validateWorkflow } from "@/lib/workflows/validate";
import { resolveEntitlement, workflowDenied } from "@/lib/workflows/limits";
import { isProUser } from "@/lib/ai-signals/access";
import { authenticateWorkflow, deny, ok } from "../_helpers";
import { safeId } from "@/lib/workflows/naming";

export async function GET(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const workflow = await getWorkflow(auth.uid, workflowId);
    if (!workflow) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    return ok(workflow);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request as NextRequest);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const existing = await getWorkflow(auth.uid, workflowId);
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();

    // Status transitions (server-truth): draft → active | paused | disabled | archived; active ↔ paused; disabled → active.
    const body = await request.json().catch(() => ({}));

    // Status transition requested?
    const allowed = new Map<string, string[]>([
        ["draft", ["active", "paused", "disabled", "archived"]],
        ["active", ["paused", "disabled", "archived"]],
        ["paused", ["active", "disabled", "archived"]],
        ["disabled", ["active", "archived"]],
        ["archived", ["draft", "disabled"]],
    ]);
    if (body.status && existing.status !== body.status && allowed.get(existing.status)?.includes(body.status)) {
        if (["active", "paused", "disabled", "archived"].includes(body.status)) {
            if (existing.status === "active" && body.status === "active") { /* re-activate */ }
            if (body.status === "active") {
                const ent = await resolveEntitlement(auth.uid, auth.isAdmin);
                if (!ent.allowed) return deny();
                if (!ent.limits.schedulesEnabled && body.schedule?.enabled) {
                    return Response.json({ error: "Schedules require Pro", hasPro: false, upgrade: true }, { status: 403 });
                }
            }
        }
        existing.status = body.status as "draft" | "active" | "paused" | "disabled" | "archived";
        if (body.status === "active" && existing.version === 1) {
            existing.version = 2;
            await snapshotVersion(existing);
        }
    }

    // Soft-edit (draft only): nodes/edges/settings/description/schedule/tags
    if (existing.status === "draft") {
        if (Array.isArray(body.nodes)) existing.nodes = body.nodes;
        if (Array.isArray(body.edges)) existing.edges = body.edges;
        if (body.settings && typeof body.settings === "object") existing.settings = { ...existing.settings, ...body.settings };
        if (typeof body.description === "string") existing.description = body.description.slice(0, 500);
        if (body.schedule && typeof body.schedule === "object") existing.schedule = body.schedule;
        if (Array.isArray(body.tags)) existing.tags = body.tags;
        if (typeof body.name === "string" && body.name.trim()) existing.name = body.name.trim();

        const nodes = existing.nodes ?? [];
        const known = nodes.every((n: { type: string }) => getNodeDefinition(n.type) !== undefined);
        if (!known || nodes.length === 0) return Response.json({ error: "Invalid nodes" }, { status: 400 });

        const ent = await resolveEntitlement(auth.uid, auth.isAdmin);
        const validation = validateWorkflow(
            { nodes, edges: existing.edges, settings: existing.settings, schedule: existing.schedule, name: existing.name },
            { analysis: ent.limits.executionEnabled, signal: true, execution: ent.limits.executionEnabled },
            { maxNodes: ent.limits.maxNodesPerWorkflow },
        );
        if (!validation.valid) return Response.json({ error: "Validation failed", details: validation }, { status: 400 });

        existing.requiredPermissions = ["analysis"];
        const { deriveRequiredPermissions } = await import("@/lib/workflows/validate");
        existing.requiredPermissions = deriveRequiredPermissions(nodes);
    }

    existing.updatedAt = Date.now();
    await saveWorkflow(existing);
    if (body.status && ["draft", "paused", "disabled", "archived"].includes(body.status)) {
        await unscheduleWorkflow(auth.uid, workflowId);
    }
    return ok(existing);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const { workflowId } = await params;
    const existing = await getWorkflow(auth.uid, workflowId);
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    await unscheduleWorkflow(auth.uid, workflowId);
    await deleteWorkflow(auth.uid, workflowId);
    return ok({ deleted: true });
}