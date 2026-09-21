import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/plugins/api-helpers";
import { getPluginRecord } from "@/lib/plugins/database";
import { adminDatabase } from "@/lib/firebase-admin";
import { PluginRecord } from "@/lib/plugins/types";

/**
 * Compares published plugins side by side. Returns catalog metadata plus
 * real adoption metrics from the catalog records (installs, activeUsers,
 * rating) — no fabricated performance numbers.
 */
export async function GET(request: NextRequest) {
    try {
        const ids = (new URL(request.url).searchParams.get("ids") || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 5);

        if (ids.length === 0) {
            return NextResponse.json({ success: true, items: [] });
        }

        const items = await Promise.all(
            ids.map(async (id) => {
                const plugin = await getPluginRecord(id);
                if (!plugin || plugin.type !== "plugin" || plugin.status !== "published") return null;
                return plugin;
            })
        );

        const plugins = items.filter((p): p is PluginRecord => p !== null);

        return NextResponse.json({
            success: true,
            items: plugins,
            note: "Metrics are real catalog aggregates (installs, active users, ratings). No projected returns are shown.",
        });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";