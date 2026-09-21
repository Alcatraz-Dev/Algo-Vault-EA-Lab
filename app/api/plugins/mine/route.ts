import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError } from "@/lib/plugins/api-helpers";
import { listInstallations, getPluginRecord, getPluginConfig, getRuntimeState, listPluginLicenses, getExtensionInstallation } from "@/lib/plugins/database";
import { listUserLicenses } from "@/lib/plugins/licensing";
import { refreshExpiredLicenses } from "@/lib/plugins/licensing";
import { PluginInstallation, PluginRecord, PluginConfig, PluginRuntimeState, PluginLicenseRecord } from "@/lib/plugins/types";

export async function GET(request: NextRequest) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();

        const installations = await listInstallations(uid);
        const licenses = await refreshExpiredLicenses(uid);

        const rows = await Promise.all(
            installations.map(async (install) => {
                const plugin = await getPluginRecord(install.pluginId);
                const config = await getPluginConfig(uid, install.pluginId);
                const runtime = await getRuntimeState(uid, install.pluginId);
                const license = licenses.find((l) => l.pluginId === install.pluginId) || null;
                return {
                    installation: install,
                    plugin,
                    config,
                    runtime,
                    license,
                };
            })
        );

        return NextResponse.json({
            success: true,
            installations,
            licenses,
            rows,
        });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";