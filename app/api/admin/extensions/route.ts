import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, badRequest, unauthorized } from "@/lib/plugins/api-helpers";
import { listAllRecords, getDraft, writeAuditLog, stripUndefined } from "@/lib/plugins/database";
import { adminDatabase } from "@/lib/firebase-admin";
import { PluginRecord, PluginStatus, PluginExtensionType } from "@/lib/plugins/types";
import { validateManifest } from "@/lib/plugins/manifest";
import { sanitizePermissionSet } from "@/lib/plugins/permissions";
import { isSupportedExtensionType } from "@/lib/plugins/ai-generator";

export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const records = (await listAllRecords()).filter((r) => r.type === "extension");
        return NextResponse.json({ success: true, extensions: records });
    } catch (err) {
        return serverError(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();

        const body = await request.json().catch(() => ({}));

        if (body.fromDraft) {
            const draft = await getDraft(String(body.fromDraft));
            if (!draft) return badRequest("Draft not found.");
            const spec = draft.spec as Record<string, unknown>;
            const manifest = spec.manifest || spec;
            const manifestCheck = validateManifest(manifest, "extension");
            if (manifestCheck.errors.length > 0) {
                return badRequest(`Manifest validation failed: ${manifestCheck.errors.join(" ")}`);
            }
            const id = String(draft.name || `ext-${Date.now().toString(36)}`).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
            const now = Date.now();

            // Resolve the connection type: the generated spec wins, then the request body, then a safe default.
            const specExtType = String(((spec.extensionType as string) || "")).trim().toLowerCase();
            const bodyExtType = String(body.extensionType || "").trim().toLowerCase();
            const rawExtType = specExtType || bodyExtType;
            const extensionType: PluginExtensionType = isSupportedExtensionType(rawExtType) ? rawExtType : "browser";

            const record: PluginRecord = {
                id,
                name: id,
                displayName: String(draft.displayName || ""),
                slug: id,
                version: manifestCheck.manifest!.version,
                description: String(draft.description || ""),
                type: "extension",
                category: manifestCheck.manifest!.category,
                pricing: manifestCheck.manifest!.pricing,
                permissions: sanitizePermissionSet(manifestCheck.manifest!.permissions),
                manifest: manifestCheck.manifest!,
                capabilities: Array.isArray(spec.capabilities) ? spec.capabilities.map(String).slice(0, 20) : [],
                supportedMarkets: Array.isArray(spec.supportedMarkets) ? spec.supportedMarkets.map(String).slice(0, 10) : [],
                supportedNotifications: Array.isArray(spec.supportedNotifications) ? spec.supportedNotifications.map(String).slice(0, 6) : [],
                creator: { uid: admin.uid, name: body.creatorName || "AlgoVault Admin", kind: "admin" },
                isAIGenerated: true,
                status: (body.publishNow === true ? "published" : "draft") as PluginStatus,
                installs: 0,
                activeUsers: 0,
                rating: { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, updatedAt: 0 },
                versionHistory: [manifestCheck.manifest!.version],
                lastUpdated: now,
                createdAt: now,
                updatedAt: now,
                documentation: String(spec.documentation || ""),
                changelog: [{ version: manifestCheck.manifest!.version, note: "Generated in AI Plugin Studio." }],
                ...(spec.configSchema && typeof spec.configSchema === "object" ? { configSchema: spec.configSchema } : {}),
            } as PluginRecord & { extensionType?: string; configSchema?: Record<string, unknown> };

            await adminDatabase.ref(`plugins/${id}`).set(stripUndefined({ ...record, extensionType }));
            await adminDatabase.ref(`pluginDrafts/${draft.id}/status`).set("published");
            await writeAuditLog({ action: "extension.created_from_draft", actor: admin.uid, pluginId: id });
            return NextResponse.json({ success: true, extension: { ...record, extensionType } });
        }

        return badRequest("Provide fromDraft to publish a generated extension draft.");
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";