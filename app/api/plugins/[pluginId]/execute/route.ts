import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, badRequest, notFound } from "@/lib/plugins/api-helpers";
import { getPluginRecord, getInstallation, updateInstallation } from "@/lib/plugins/database";
import { executePlugin } from "@/lib/plugins/runtime/engine";
import { adminDatabase } from "@/lib/firebase-admin";

export async function POST(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { pluginId } = await context.params;

        const plugin = await getPluginRecord(pluginId);
        if (!plugin) return notFound("Plugin not found.");
        if (plugin.type !== "plugin") return badRequest("Extensions do not execute in the runtime.");

        const install = await getInstallation(uid, pluginId);
        if (!install || install.status === "uninstalled") return notFound("Plugin is not installed.");

        const body = await request.json().catch(() => ({}));
        const test = body.test === true;

        // Admin-only sandbox test mode.
        let testOnly = false;
        if (test) {
            const userSnap = await adminDatabase.ref(`users/${uid}`).get();
            if (userSnap.exists() && userSnap.val()?.role === "admin") {
                testOnly = true;
            } else {
                return unauthorized();
            }
        }

        const result = await executePlugin({
            userId: uid,
            plugin,
            trigger: testOnly ? "test" : "manual",
            testOnly,
        });

        // Only manual runs mutate the execution counters on the installation.
        if (!testOnly) {
            await updateInstallation(uid, pluginId, {
                executions: (install.executions || 0) + 1,
                failures: result.execution.status === "failed" ? (install.failures || 0) + 1 : install.failures || 0,
                lastExecutionAt: result.execution.finishedAt,
                lastActivityAt: result.execution.finishedAt,
                status: result.execution.status === "failed" ? install.status : install.status,
            });
        }

        return NextResponse.json({
            success: true,
            execution: result.execution,
            alertDeliveries: result.alertDeliveries,
            testOnly,
        });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";