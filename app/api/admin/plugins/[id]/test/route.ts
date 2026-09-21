import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, notFound, unauthorized, badRequest } from "@/lib/plugins/api-helpers";
import { getPluginRecord, writeAuditLog } from "@/lib/plugins/database";
import { executePlugin } from "@/lib/plugins/runtime/engine";
import { adminDatabase } from "@/lib/firebase-admin";
import { defaultConfig } from "@/lib/plugins/runtime/engine";

/**
 * Admin sandbox test — executes a plugin in test mode with a synthetic,
 * non-destructive configuration. Test mode skips alert delivery and uses a
 * scratch execution path, so running real tests never notifies users.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const { id } = await context.params;

        const plugin = await getPluginRecord(id);
        if (!plugin) return notFound("Plugin not found.");

        const body = await request.json().catch(() => ({}));
        const symbols = Array.isArray(body.symbols)
            ? body.symbols.map(String).slice(0, 5)
            : ["EURUSD"];
        const config = {
            ...defaultConfig(plugin, `sandbox_${admin.uid}`),
            symbols,
            timeframes: ["M5"],
            notificationChannels: [],
            paused: true,
        };

        const result = await executePlugin({
            userId: `sandbox_${admin.uid}`,
            plugin,
            trigger: "test",
            config,
            testOnly: true,
        });

        await writeAuditLog({
            action: "plugin.sandbox.tested",
            actor: admin.uid,
            pluginId: id,
            detail: { status: result.execution.status, symbols },
        });

        return NextResponse.json({
            success: true,
            execution: result.execution,
        });
    } catch (err) {
        return serverError(err, "Sandbox test failed.");
    }
}

export const dynamic = "force-dynamic";