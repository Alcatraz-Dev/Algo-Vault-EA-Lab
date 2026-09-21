import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, notFound } from "@/lib/plugins/api-helpers";
import {
    getPluginRecord,
    getInstallation,
    updateInstallation,
    removeInstallation,
    removePluginConfig,
    setRuntimeState,
    incrementCatalogCounter,
    writeAuditLog,
} from "@/lib/plugins/database";
import { removePluginLicense } from "@/lib/plugins/licensing";

export async function POST(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { pluginId } = await context.params;

        const plugin = await getPluginRecord(pluginId);
        if (!plugin) return notFound("Plugin not found.");

        const install = await getInstallation(uid, pluginId);
        if (!install || install.status === "uninstalled") {
            return NextResponse.json({ success: true, alreadyUninstalled: true });
        }

        const body = await request.json().catch(() => ({}));

        // Stop scheduling immediately.
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
            updatedAt: Date.now(),
        });

        if (install.status === "active") {
            await incrementCatalogCounter(pluginId, "activeUsers", -1);
        }

        // Keep a tombstone for audit while removing live config & runtime refs.
        await updateInstallation(uid, pluginId, {
            status: "uninstalled",
            lastActivityAt: Date.now(),
            nextRunAt: null,
        });

        if (body.purge === true) {
            await removeInstallation(uid, pluginId);
            await removePluginConfig(uid, pluginId);
            if (plugin.pricing.type !== "free") {
                await removePluginLicense(uid, pluginId);
            }
        }

        await writeAuditLog({
            action: "plugin.uninstalled",
            actor: uid,
            pluginId,
            detail: { purge: body.purge === true, from: install.status },
        });

        return NextResponse.json({ success: true });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";