import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError } from "@/lib/plugins/api-helpers";
import { adminDatabase } from "@/lib/firebase-admin";
import { listExecutions } from "@/lib/plugins/database";

export async function GET(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { pluginId } = await context.params;

        const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 30)));

        const executions = await listExecutions(uid, pluginId, limit);

        const logsSnap = await adminDatabase.ref(`pluginLogs/${uid}/${pluginId}`).orderByChild("createdAt").limitToLast(200).get();
        const logs: Record<string, unknown>[] = [];
        logsSnap.forEach((child) => {
            logs.push({ id: child.key, ...(child.val() as Record<string, unknown>) });
        });
        logs.sort((a, b) => Number((b as { createdAt?: number }).createdAt || 0) - Number((a as { createdAt?: number }).createdAt || 0));

        const notifsSnap = await adminDatabase.ref(`pluginNotifications/${uid}`).get();
        const notifsData = (notifsSnap.val() || {}) as Record<string, Record<string, unknown>>;
        const notifications = Object.entries(notifsData)
            .map(([id, raw]) => ({ id, ...(raw as Record<string, unknown>) }))
            .filter((n) => (n as Record<string, unknown>).pluginId === pluginId)
            .sort((a, b) => Number((b as Record<string, unknown>).timestamp || 0) - Number((a as Record<string, unknown>).timestamp || 0))
            .slice(0, 50);

        return NextResponse.json({ success: true, executions, logs, notifications });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";