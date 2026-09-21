import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, badRequest, notFound } from "@/lib/plugins/api-helpers";
import {
    getPluginRecord,
    getExtensionRecord,
    setInstallation,
    getInstallation,
    getExtensionInstallation,
    setExtensionInstallation,
    setRuntimeState,
    setPluginConfig,
    getPluginLicense,
    incrementCatalogCounter,
    writeAuditLog,
} from "@/lib/plugins/database";
import { defaultConfig } from "@/lib/plugins/runtime/engine";
import { PluginInstallation } from "@/lib/plugins/types";

export async function POST(request: NextRequest) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();

        const body = await request.json().catch(() => ({}));
        const pluginId = String(body.pluginId || "").trim();
        if (!pluginId) return badRequest("pluginId is required.");

        const plugin = await getPluginRecord(pluginId);
        if (!plugin) return notFound("Plugin not found in the catalog.");

        // ── Extensions ──────────────────────────────────────────────────────
        if (plugin.type === "extension") {
            const extension = await getExtensionRecord(pluginId);
            if (!extension) return notFound("Extension not found.");
            const existing = await getExtensionInstallation(uid, pluginId);
            if (existing) {
                return NextResponse.json({ success: true, alreadyInstalled: true, install: existing });
            }
            const now = Date.now();
            const install = {
                extensionId: pluginId,
                userId: uid,
                status: "installed" as const,
                installedVersion: extension.version || null,
                installedAt: now,
                updatedAt: now,
            };
            await setExtensionInstallation(uid, install);
            await incrementCatalogCounter(pluginId, "installs", 1);
            await writeAuditLog({ action: "extension.installed", actor: uid, pluginId, detail: { extensionType: (extension as { extensionType?: string }).extensionType || "" } });
            return NextResponse.json({ success: true, install });
        }

        // ── Plugin flow ──────────────────────────────────────────────────────
        const existing = await getInstallation(uid, pluginId);
        if (existing && existing.status !== "uninstalled") {
            return NextResponse.json({ success: true, alreadyInstalled: true, install: existing });
        }

        if (plugin.status !== "published") {
            return badRequest("This plugin is not available for installation.");
        }

        let licenseStatus: PluginInstallation["licenseStatus"] = "free";
        if (plugin.pricing.type !== "free") {
            const license = await getPluginLicense(uid, pluginId);
            const active = license?.status === "active" && (license.expiresAt === 0 || license.expiresAt > Date.now());
            if (!active) {
                return NextResponse.json(
                    { error: "This plugin requires a purchased license. Buy it first, then install.", paymentRequired: true, pluginId },
                    { status: 402 }
                );
            }
            licenseStatus = "active";
        }

        const now = Date.now();
        const installation: PluginInstallation = {
            pluginId,
            userId: uid,
            kind: "plugin",
            status: "installed",
            installedVersion: plugin.version || null,
            licenseStatus,
            notificationsEnabled: true,
            lastActivityAt: now,
            lastExecutionAt: null,
            nextRunAt: null,
            alertsGenerated: 0,
            executions: 0,
            failures: 0,
            installedAt: now,
            updatedAt: now,
        };
        await setInstallation(uid, installation);
        await setRuntimeState({
            userId: uid,
            pluginId,
            status: "paused",
            nextRunAt: null,
            lastRunAt: null,
            lastExecutionId: null,
            failures: 0,
            alertedToday: 0,
            lastAlertAt: null,
            updatedAt: now,
        });
        const config = defaultConfig(plugin, uid);
        await setPluginConfig(uid, config);
        await incrementCatalogCounter(pluginId, "installs", 1);
        await writeAuditLog({ action: "plugin.installed", actor: uid, pluginId, detail: { version: plugin.version } });

        return NextResponse.json({
            success: true,
            install: installation,
            defaultConfig: config,
            requiresConfiguration: true,
        });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";