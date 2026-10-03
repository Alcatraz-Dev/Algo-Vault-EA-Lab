import { NextRequest } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { isAgentFactoryEnabled } from "@/lib/ai-trading-teams/flags";
import {
    deleteAdminAgent,
    getAdminAgent,
    getAgentVersion,
    listAgentVersions,
    nextVersion,
    saveAdminAgent,
    recordTeamEvent,
} from "@/lib/ai-trading-teams/database";
import { validateAgentDefinition } from "@/lib/ai-trading-teams/validation";
import { getBuiltinTeamAgent } from "@/lib/ai-trading-teams/agent-library";

function agentIdFrom(request: NextRequest): string {
    return request.nextUrl.searchParams.get("agentId") ?? new URL(request.url).pathname.split("/").filter(Boolean).slice(-1)[0] ?? "";
}

/**
 * GET /api/admin/ai-agents/{agentId}
 * Agent detail + full version history (for rollback).
 */
export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });

    const agentId = agentIdFrom(request);
    try {
        const adminAgent = await getAdminAgent(agentId);
        const builtin = getBuiltinTeamAgent(agentId);
        const agent = adminAgent ?? builtin ?? null;
        if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });
        const versions = await listAgentVersions(agentId);
        return Response.json({ agent, versions, source: adminAgent ? "admin" : "builtin" });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to load agent.") }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/ai-agents/{agentId}
 *
 * Body variants:
 *   { status: "active" | "disabled" | "testing" }   → enable/disable/test
 *   { ...definition }                               → edit + version bump + snapshot
 *   { action: "rollback", version: "1.0.0" }        → restore a previous version
 *   { action: "clone", id?: string }                → clone into a new agent id
 */
export async function PATCH(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });
    if (!isAgentFactoryEnabled()) {
        return Response.json({ error: "Admin AI Agent Factory is disabled by feature flag." }, { status: 423 });
    }

    const agentId = agentIdFrom(request);
    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const existing = (await getAdminAgent(agentId)) ?? getBuiltinTeamAgent(agentId);
        if (!existing) return Response.json({ error: "Agent not found." }, { status: 404 });

        // 1) Simple status transitions (no version bump for enable/disable).
        if (body.status !== undefined && Object.keys(body).length === 1) {
            if (!["active", "disabled", "testing", "draft"].includes(String(body.status))) {
                return Response.json({ error: "Invalid status." }, { status: 400 });
            }
            const updated = { ...existing, status: String(body.status) as typeof existing.status, updatedAt: Date.now() };
            await saveAdminAgent(updated);
            return Response.json({ agent: updated });
        }

        // 2) Rollback to a previous version snapshot.
        if (body.action === "rollback") {
            const targetVersion = String(body.version ?? "");
            const snapshot = await getAgentVersion(agentId, targetVersion);
            if (!snapshot) return Response.json({ error: "Version snapshot not found." }, { status: 404 });
            const restored = {
                ...snapshot,
                id: agentId,
                // Never roll back into a different version label — the rollback
                // itself is recorded as a new patch version of the restored config.
                version: nextVersion(existing.version),
                updatedAt: Date.now(),
            };
            await saveAdminAgent(restored);
            return Response.json({ agent: restored, restoredFrom: targetVersion });
        }

        // 3) Clone into a new agent.
        if (body.action === "clone") {
            const validation = validateAgentDefinition(
                {
                    ...existing,
                    ...(typeof body.name === "string" ? { name: body.name } : {}),
                    ...(typeof body.id === "string" ? { id: body.id } : {}),
                    id: typeof body.id === "string" && body.id ? body.id : `${agentId}-copy`,
                    version: "1.0.0",
                    builtin: false,
                },
                { custom: false },
            );
            if (!validation.valid || !validation.value) {
                return Response.json({ error: "Invalid clone.", details: validation.errors }, { status: 400 });
            }
            const clone = {
                ...(validation.value as import("@/lib/ai-trading-teams/types").TeamAgentDefinition),
                createdAt: Date.now(),
                createdBy: admin.uid,
                updatedAt: Date.now(),
            };
            await saveAdminAgent(clone);
            return Response.json({ agent: clone }, { status: 201 });
        }

        // 4) Edit → validate, bump patch version, snapshot previous state.
        const merged = { ...existing, ...body, id: agentId, version: nextVersion(existing.version) };
        const validation = validateAgentDefinition(merged, { custom: false });
        if (!validation.valid || !validation.value) {
            return Response.json({ error: "Invalid agent definition", details: validation.errors }, { status: 400 });
        }
        const updated = {
            ...(validation.value as import("@/lib/ai-trading-teams/types").TeamAgentDefinition),
            builtin: false,
            createdAt: existing.createdAt ?? Date.now(),
            createdBy: existing.createdBy,
            updatedAt: Date.now(),
        };
        await saveAdminAgent(updated);
        await recordTeamEvent({ type: "agent_created", userId: admin.uid, agentId, meta: { version: updated.version, action: "edit" } });
        return Response.json({ agent: updated });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to update agent.") }, { status: 500 });
    }
}

/** DELETE /api/admin/ai-agents/{agentId} — removes the admin override. */
export async function DELETE(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });
    if (!isAgentFactoryEnabled()) {
        return Response.json({ error: "Admin AI Agent Factory is disabled by feature flag." }, { status: 423 });
    }
    const agentId = agentIdFrom(request);
    try {
        const deleted = await deleteAdminAgent(agentId);
        if (!deleted) return Response.json({ error: "Agent not found." }, { status: 404 });
        return Response.json({ deleted: true });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to delete agent.") }, { status: 500 });
    }
}
