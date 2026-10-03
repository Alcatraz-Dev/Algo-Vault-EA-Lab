import { NextRequest } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { buildMonitoringSnapshot } from "@/lib/ai-trading-teams/monitoring";
import {
    deleteAdminTemplate,
    listAdminTemplates,
    saveAdminTemplate,
} from "@/lib/ai-trading-teams/database";
import { BUILTIN_TEAM_TEMPLATES } from "@/lib/ai-trading-teams/templates";
import { validateTeamConfig, validateAgentIdList } from "@/lib/ai-trading-teams/validation";
import type { TeamTemplate } from "@/lib/ai-trading-teams/types";

/**
 * GET /api/admin/ai-trading-teams
 * Monitoring snapshot: active/completed/failed runs, latency, agent usage,
 * error rates, event counts, recent failures. Admin-only.
 *
 * Provider usage / token cost comes from the EXISTING AI usage system — this
 * endpoint deliberately does not duplicate that accounting.
 */
export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });

    const view = new URL(request.url).searchParams.get("view") ?? "monitoring";
    try {
        if (view === "templates") {
            const adminTemplates = await listAdminTemplates();
            return Response.json({ templates: [...BUILTIN_TEAM_TEMPLATES, ...adminTemplates] });
        }
        const snapshot = await buildMonitoringSnapshot();
        return Response.json(snapshot);
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to build monitoring snapshot.") }, { status: 500 });
    }
}

/** POST /api/admin/ai-trading-teams — publish an official team template. */
export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });

    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const name = String(body.name ?? "").trim().slice(0, 80);
        if (name.length < 3) return Response.json({ error: "Template name is too short." }, { status: 400 });

        const configValidation = validateTeamConfig(body.config);
        if (!configValidation.valid) {
            return Response.json({ error: "Invalid template config.", details: configValidation.errors }, { status: 400 });
        }
        const agentsValidation = validateAgentIdList(body.agentIds);
        if (!agentsValidation.valid) {
            return Response.json({ error: "Invalid template agents.", details: agentsValidation.errors }, { status: 400 });
        }

        const id = String(body.id ?? `tpl_${Date.now().toString(36)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
        const template: TeamTemplate = {
            id,
            name,
            description: String(body.description ?? "").slice(0, 600),
            scope: "admin",
            config: configValidation.value as TeamTemplate["config"],
            agentIds: agentsValidation.value as string[],
            tags: Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 8) : [],
            createdBy: admin.uid,
            createdAt: Date.now(),
        };
        await saveAdminTemplate(template);
        return Response.json({ template }, { status: 201 });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to publish template.") }, { status: 500 });
    }
}

/** DELETE /api/admin/ai-trading-teams?templateId=… — remove an admin template. */
export async function DELETE(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });
    const templateId = request.nextUrl.searchParams.get("templateId") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(templateId)) {
        return Response.json({ error: "Invalid template id." }, { status: 400 });
    }
    try {
        const deleted = await deleteAdminTemplate(templateId);
        if (!deleted) return Response.json({ error: "Template not found." }, { status: 404 });
        return Response.json({ deleted: true });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to delete template.") }, { status: 500 });
    }
}
