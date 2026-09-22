import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, badRequest, notFound, unauthorized } from "@/lib/plugins/api-helpers";
import { getPluginRecord, writeAuditLog, deletePluginCatalogRecord, normalizeChangelog } from "@/lib/plugins/database";
import { adminDatabase } from "@/lib/firebase-admin";
import { PluginRecord, PluginStatus } from "@/lib/plugins/types";
import { validateManifest, isSemver } from "@/lib/plugins/manifest";
import { sanitizePermissionSet } from "@/lib/plugins/permissions";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const { id } = await context.params;

        const record = await getPluginRecord(id);
        if (!record) return notFound("Plugin not found.");
        const pluginId = record.id;

        const auditSnap = await adminDatabase.ref("pluginAuditLogs").orderByChild("pluginId").equalTo(pluginId).limitToLast(50).get();
        const audit: Record<string, unknown>[] = [];
        auditSnap.forEach((child) => {
            audit.push({ id: child.key, ...(child.val() as Record<string, unknown>) });
        });
        audit.sort((a, b) => Number((b as { createdAt?: number }).createdAt || 0) - Number((a as { createdAt?: number }).createdAt || 0));

        return NextResponse.json({ success: true, record, audit });
    } catch (err) {
        return serverError(err);
    }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const { id } = await context.params;

        const existing = await getPluginRecord(id);
        if (!existing) return notFound("Plugin not found.");
        const pluginId = existing.id;

        const body = await request.json().catch(() => ({}));
        const now = Date.now();

        // Full-lifecycle status transitions.
        if (body.status && typeof body.status === "string") {
            const next = body.status as PluginStatus;
            const allowed: PluginStatus[] = ["draft", "testing", "published", "disabled", "pending_review"];
            if (!allowed.includes(next)) return badRequest(`Invalid status: ${next}`);
            const prev = existing.status;
            await adminDatabase.ref(`plugins/${pluginId}/status`).set(next);
            await adminDatabase.ref(`plugins/${pluginId}/updatedAt`).set(now);
            await writeAuditLog({ action: `plugin.status.${prev}->${next}`, actor: admin.uid, pluginId, detail: { prev, next } });

            if (next === "published" && prev !== "published") {
                await adminDatabase.ref(`plugins/${pluginId}/lastUpdated`).set(now);
            }
            return NextResponse.json({ success: true, status: next });
        }

        // Version bump with changelog.
        if (body.action === "version") {
            const version = String(body.version || "").trim();
            if (!isSemver(version)) return badRequest("version must be a semantic version like 1.1.0.");
            if (existing.versionHistory.includes(version)) return badRequest(`Version ${version} already exists in history.`);
            const changelog = String(body.changelog || "").trim().slice(0, 2000) || `Released ${version}.`;
            const history = [...(existing.versionHistory || []), version];
            await adminDatabase.ref(`plugins/${pluginId}`).update({
                version,
                manifest: { ...existing.manifest, version },
                versionHistory: history.slice(-20),
                changelog: [...normalizeChangelog(existing.changelog), { version, note: changelog }].slice(-20),
                lastUpdated: now,
                updatedAt: now,
            });
            await writeAuditLog({ action: "plugin.version.bumped", actor: admin.uid, pluginId, detail: { version } });
            const updated = await getPluginRecord(pluginId);
            return NextResponse.json({ success: true, record: updated });
        }

        // Metadata edits (validated against the manifest contract).
        const patch: Partial<PluginRecord> = {};
        if (typeof body.displayName === "string") patch.displayName = body.displayName.trim().slice(0, 80);
        if (typeof body.description === "string") patch.description = body.description.trim().slice(0, 2000);
        if (typeof body.documentation === "string") patch.documentation = body.documentation;
        if (body.pricing && typeof body.pricing === "object") {
            const p = body.pricing as { type?: string; price?: number; currency?: string; intervalMonths?: number };
            const pricingType = ["free", "one_time", "subscription"].includes(p.type || "") ? (p.type as PluginRecord["pricing"]["type"]) : existing.pricing.type;
            patch.pricing = {
                type: pricingType,
                price: Math.max(0, Number(p.price) || 0),
                currency: String(p.currency || existing.pricing.currency || "usd").toLowerCase(),
                ...(pricingType === "subscription" ? { intervalMonths: Math.max(1, Math.min(12, Number(p.intervalMonths) || 1)) } : {}),
            };
        }
        if (body.permissions && typeof body.permissions === "object") {
            patch.permissions = sanitizePermissionSet(body.permissions);
        }
        if (body.capabilities && Array.isArray(body.capabilities)) {
            patch.capabilities = body.capabilities.map(String).slice(0, 20);
        }
        if (body.supportedMarkets && Array.isArray(body.supportedMarkets)) {
            patch.supportedMarkets = body.supportedMarkets.map(String).slice(0, 10);
        }

        if (Object.keys(patch).length === 0) return badRequest("No editable fields provided.");

        // Re-validate the manifest of the patched record to keep the contract intact.
        const mergedManifest = {
            ...existing.manifest,
            pricing: patch.pricing || existing.manifest.pricing,
            permissions: patch.permissions || existing.manifest.permissions,
        };
        const manifestCheck = validateManifest(mergedManifest, existing.type);
        if (manifestCheck.errors.length > 0) {
            return badRequest(`Manifest invalid after edit: ${manifestCheck.errors.join(" ")}`);
        }
        patch.manifest = manifestCheck.manifest!;
        patch.updatedAt = now;

        await adminDatabase.ref(`plugins/${pluginId}`).update(patch as Record<string, unknown>);
        await writeAuditLog({ action: "plugin.updated", actor: admin.uid, pluginId, detail: { fields: Object.keys(patch) } });

        const updated = await getPluginRecord(pluginId);
        return NextResponse.json({ success: true, record: updated });
    } catch (err) {
        return serverError(err);
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const { id } = await context.params;

        const existing = await getPluginRecord(id);
        if (!existing) return notFound("Plugin not found.");
        const pluginId = existing.id;

        await writeAuditLog({
            action: "plugin.deleted",
            actor: admin.uid,
            pluginId,
            detail: { version: existing.version, status: existing.status, type: existing.type },
        });
        await deletePluginCatalogRecord(pluginId);

        return NextResponse.json({ success: true });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";