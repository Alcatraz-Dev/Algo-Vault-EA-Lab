import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, badRequest, notFound } from "@/lib/plugins/api-helpers";
import { getPluginRecord, getInstallation, getPluginConfig, updateInstallation, setRuntimeState, incrementCatalogCounter, writeAuditLog, getRuntimeState } from "@/lib/plugins/database";
import { checkPluginLicense } from "@/lib/plugins/licensing";
import { computeNextRunAt } from "@/lib/plugins/runtime/scheduler";

const ACTIONS = ["activate", "pause", "resume", "disable"] as const;
type StateAction = (typeof ACTIONS)[number];

export async function POST(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { pluginId } = await context.params;

        const plugin = await getPluginRecord(pluginId);
        if (!plugin) return notFound("Plugin not found.");
        if (plugin.type !== "plugin") return badRequest("Extensions use /api/extensions.");

        const install = await getInstallation(uid, pluginId);
        if (!install || install.status === "uninstalled") return notFound("Plugin is not installed.");

        const body = await request.json().catch(() => ({}));
        const action = String(body.action || "").trim() as StateAction;
        if (!(ACTIONS as readonly string[]).includes(action)) return badRequest(`action must be one of: ${ACTIONS.join(", ")}`);

        const now = Date.now();

        // Activating / resuming requires a configured plugin and a valid license.
        if (action === "activate" || action === "resume") {
            const config = await getPluginConfig(uid, pluginId);
            if (!config) return badRequest("Configure the plugin before activating it.");
            if (plugin.manifest?.runtime?.interval !== "manual" && (config.symbols || []).length === 0) {
                return badRequest("Select at least one symbol before activating.");
            }
            const license = await checkPluginLicense(uid, plugin);
            if (!license.valid) {
                return NextResponse.json({ error: license.reason || "License is not valid.", licenseRequired: true }, { status: 402 });
            }
        }

        const willBeActive = action === "activate" || action === "resume";
        const prevStatus = install.status;

        await updateInstallation(uid, pluginId, {
            status: willBeActive ? "active" : action === "disable" ? "disabled" : "paused",
            lastActivityAt: now,
        });

        if (willBeActive) {
            const config = await getPluginConfig(uid, pluginId);
            const intervalVal = config?.interval || plugin.manifest?.runtime?.interval || "manual";
            const prevState = await getRuntimeState(uid, pluginId);
            await setRuntimeState({
                userId: uid,
                pluginId,
                status: "scheduled",
                nextRunAt: computeNextRunAt(intervalVal, now, prevState ? { lastRunAt: prevState.lastRunAt } : undefined),
                lastRunAt: prevState?.lastRunAt || null,
                lastExecutionId: prevState?.lastExecutionId || null,
                failures: prevState?.failures || 0,
                alertedToday: prevState?.alertedToday || 0,
                lastAlertAt: prevState?.lastAlertAt || null,
                updatedAt: now,
            });
        } else {
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
        }

        if (willBeActive && prevStatus !== "active") {
            await incrementCatalogCounter(pluginId, "activeUsers", 1);
        } else if (!willBeActive && (prevStatus === "active")) {
            await incrementCatalogCounter(pluginId, "activeUsers", -1);
        }

        await writeAuditLog({ action: `plugin.${action}`, actor: uid, pluginId, detail: { from: prevStatus } });

        return NextResponse.json({
            success: true,
            status: willBeActive ? "active" : action === "disable" ? "disabled" : "paused",
        });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";