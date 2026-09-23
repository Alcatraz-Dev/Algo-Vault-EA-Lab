/**
 * AlgoVault — Growth channel management API (admin).
 *
 * Channel configuration state is never stored in the database or exposed to
 * the frontend: it is derived from server environment variables by the real
 * channel adapters. This route exposes honest operations only:
 *  - test: re-evaluate the REAL adapter status for one/all channels
 *          (NOT_CONFIGURED when credentials are missing; never fake CONNECTED)
 *
 * There is deliberately no enable/disable here: the runtime adapters do not
 * implement a database-level switch, so such an action would lie. The UI
 * marks those actions unavailable instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { channelStatuses } from "@/lib/growth/channels/registry";
import { CHANNEL_TYPES, ChannelType } from "@/lib/growth/constants";

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { action?: string; type?: string };
    try {
        body = (await request.json()) as { action?: string; type?: string };
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body.action !== "test") {
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }

    let statuses = channelStatuses();
    if (body.type) {
        if (!(CHANNEL_TYPES as readonly string[]).includes(body.type as ChannelType)) {
            return NextResponse.json({ error: `Unknown channel: ${body.type}` }, { status: 400 });
        }
        statuses = statuses.filter((s) => s.type === body.type);
    }

    return NextResponse.json({ statuses, checkedAt: Date.now() });
}