import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError } from "@/lib/plugins/api-helpers";
import { listInstallations, getPluginRecord, getPluginConfig, getRuntimeState, listExecutions } from "@/lib/plugins/database";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();

        const installations = await listInstallations(uid);
        const agents = installations
            .filter((i) => i.kind === "plugin")
            .filter((i) => ["active", "paused"].includes(i.status));

        const rows = await Promise.all(
            agents.map(async (install) => {
                const plugin = await getPluginRecord(install.pluginId);
                const config = await getPluginConfig(uid, install.pluginId);
                const runtime = await getRuntimeState(uid, install.pluginId);
                const recent = await listExecutions(uid, install.pluginId, 5);
                const notifSnap = await adminDatabase.ref(`pluginNotifications/${uid}`).get();
                const alertCount = Object.values(notifSnap.val() || {}).filter(
                    (raw) => raw && typeof raw === "object" && (raw as { pluginId?: string }).pluginId === install.pluginId
                ).length;
                return { install, plugin, config, runtime, recent, alertCount };
            })
        );

        rows.sort((a, b) => {
            const aActive = a.install.status === "active" ? 1 : 0;
            const bActive = b.install.status === "active" ? 1 : 0;
            if (aActive !== bActive) return bActive - aActive;
            return Number(b.install.lastActivityAt || 0) - Number(a.install.lastActivityAt || 0);
        });

        return NextResponse.json({ success: true, agents: rows });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";