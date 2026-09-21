import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, badRequest, unauthorized } from "@/lib/plugins/api-helpers";
import { listAllRecords, getDraft, writeAuditLog, incrementCatalogCounter } from "@/lib/plugins/database";
import { adminDatabase } from "@/lib/firebase-admin";
import { PluginRecord, PluginStatus } from "@/lib/plugins/types";
import { validateManifest } from "@/lib/plugins/manifest";
import { sanitizePermissionSet } from "@/lib/plugins/permissions";

export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();

        const records = await listAllRecords();
        const summary = {
            plugins: records.filter((r) => r.type === "plugin").length,
            extensions: records.filter((r) => r.type === "extension").length,
            published: records.filter((r) => r.status === "published").length,
            drafts: records.filter((r) => r.status === "draft" || r.status === "testing").length,
            totalInstalls: records.reduce((s, r) => s + (Number(r.installs) || 0), 0),
            totalActiveUsers: records.reduce((s, r) => s + (Number(r.activeUsers) || 0), 0),
        };

        const draftsSnap = await adminDatabase.ref("pluginDrafts").get();
        const pendingReviewsSnap = await adminDatabase.ref("pluginReviews").get();
        let pendingReviews = 0;
        pendingReviewsSnap.forEach((pluginSnap) => {
            pluginSnap.forEach((reviewSnap) => {
                const review = reviewSnap.val() as { status?: string };
                if (review?.status === "pending") pendingReviews += 1;
            });
        });

        return NextResponse.json({ success: true, records, summary, drafts: (draftsSnap.val() || {}) ? Object.values(draftsSnap.val() || {}) : [], pendingReviews });
    } catch (err) {
        return serverError(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();

        const body = await request.json().catch(() => ({}));

        // Publish a validated generated draft.
        if (body.fromDraft) {
            const draft = await getDraft(String(body.fromDraft));
            if (!draft) return badRequest("Draft not found.");
            if (draft.status === "rejected") return badRequest("This draft failed validation and cannot be published.");
            const spec = draft.spec as PluginRecord["manifest"] & Record<string, unknown>;
            if (!spec) return badRequest("Draft has no spec.");

            const manifest = spec.manifest || spec;
            const manifestCheck = validateManifest(manifest, draft.target === "extension" ? "extension" : "plugin");
            if (manifestCheck.errors.length > 0) {
                return badRequest(`Manifest validation failed: ${manifestCheck.errors.join(" ")}`);
            }

            const id = slugify(draft.name as string);
            const now = Date.now();
            const record: PluginRecord = {
                id,
                name: String(draft.name || ""),
                displayName: String(draft.displayName || ""),
                slug: id,
                version: manifestCheck.manifest!.version,
                description: String(draft.description || ""),
                type: draft.target === "extension" ? "extension" : "plugin",
                category: manifestCheck.manifest!.category,
                pricing: manifestCheck.manifest!.pricing,
                permissions: sanitizePermissionSet(manifestCheck.manifest!.permissions),
                manifest: manifestCheck.manifest!,
                capabilities: Array.isArray(spec.capabilities) ? spec.capabilities.map(String).slice(0, 20) : [],
                supportedMarkets: Array.isArray(spec.supportedMarkets) ? spec.supportedMarkets.map(String).slice(0, 10) : [],
                supportedNotifications: Array.isArray(spec.supportedNotifications) ? spec.supportedNotifications.map(String).slice(0, 8) : [],
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
                changelog: { [manifestCheck.manifest!.version]: "Generated in AI Plugin Studio." },
                ...(spec.configSchema && typeof spec.configSchema === "object" ? { configSchema: spec.configSchema } : {}),
            };

            const extensionType =
                draft.target === "extension"
                    ? pickExtensionType(spec.extensionType, body.extensionType)
                    : undefined;
            await adminDatabase.ref(`plugins/${id}`).set(extensionType ? { ...record, extensionType } : record);
            await adminDatabase.ref(`pluginDrafts/${draft.id}/status`).set("published");
            await writeAuditLog({ action: "plugin.created_from_draft", actor: admin.uid, pluginId: id, detail: { publishNow: body.publishNow === true } });
            return NextResponse.json({ success: true, record });
        }

        // Direct record creation (admin-authored).
        const record = body.record as PluginRecord;
        if (!record || !String(record.id || "").trim()) return badRequest("record.id is required.");
        const id = slugify(String(record.id));
        const manifestCheck = validateManifest(record.manifest, record.type);
        if (manifestCheck.errors.length > 0) {
            return badRequest(`Manifest validation failed: ${manifestCheck.errors.join(" ")}`);
        }
        // Never let a request set counters directly.
        const now = Date.now();
        const merged: PluginRecord = {
            ...record,
            id,
            slug: id,
            manifest: manifestCheck.manifest!,
            permissions: sanitizePermissionSet(record.permissions),
            status: (["published", "draft", "testing", "disabled"].includes(record.status) ? record.status : "draft") as PluginStatus,
            installs: 0,
            activeUsers: 0,
            rating: record.rating || { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, updatedAt: 0 },
            versionHistory: Array.isArray(record.versionHistory) ? record.versionHistory : [manifestCheck.manifest!.version],
            lastUpdated: now,
            createdAt: now,
            updatedAt: now,
        };
        await adminDatabase.ref(`plugins/${id}`).set(merged);
        await writeAuditLog({ action: "plugin.created", actor: admin.uid, pluginId: id, detail: { status: merged.status } });
        return NextResponse.json({ success: true, record: merged });
    } catch (err) {
        return serverError(err);
    }
}

function slugify(value: string): string {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64) || `plugin-${Date.now().toString(36)}`;
}

function pickExtensionType(specValue: unknown, bodyValue: unknown): string | undefined {
    const raw = String(specValue || bodyValue || "").trim().toLowerCase();
    const known = ["browser", "tradingview", "webhook", "discord", "telegram", "api"];
    return known.includes(raw) ? raw : "browser";
}

export const dynamic = "force-dynamic";