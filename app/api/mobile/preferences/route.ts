/**
 * GET /api/mobile/preferences — read the caller's synced preferences.
 * PUT /api/mobile/preferences — merge-and-stamp a preferences write.
 *
 * Preferences are stored separately from the workspace so a newly-installed phone
 * can render in the right theme and language *before* the (larger) workspace
 * record resolves. They are the same user state the web app already has; this
 * route is the only place they are written.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errMessage } from "@/lib/admin-auth";
import { readPreferences, validateDevice, writePreferences } from "@/lib/mobile/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRITE_RATE_LIMIT = 120;
const WRITE_WINDOW_MS = 60_000;
const writeBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(uid: string, now: number): boolean {
    const entry = writeBuckets.get(uid);
    if (!entry || entry.resetAt <= now) {
        writeBuckets.set(uid, { count: 1, resetAt: now + WRITE_WINDOW_MS });
        if (writeBuckets.size > 5_000) {
            for (const [key, value] of writeBuckets) if (value.resetAt <= now) writeBuckets.delete(key);
        }
        return false;
    }
    entry.count += 1;
    return entry.count > WRITE_RATE_LIMIT;
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const preferences = await readPreferences(user.uid);
        return NextResponse.json({ success: true, preferences }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        console.error("[mobile/preferences] GET failed:", errMessage(err));
        return NextResponse.json({ error: "Failed to read preferences" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const now = Date.now();
        if (rateLimited(user.uid, now)) {
            return NextResponse.json({ error: "Too many preference writes" }, { status: 429 });
        }

        const body = (await request.json()) as { data?: unknown; device?: unknown; baseRevision?: number };

        const device = validateDevice(body.device);
        if (!device.ok) {
            return NextResponse.json({ error: "Invalid device identity", issues: device.issues }, { status: 400 });
        }

        const current = await readPreferences(user.uid);
        if (typeof body.baseRevision === "number" && body.baseRevision < current.revision) {
            return NextResponse.json(
                { success: false, error: "Stale base revision", preferences: current, retry: true },
                { status: 409 },
            );
        }

        const result = await writePreferences(user.uid, body.data, device.value, now);
        if (!result.ok) {
            return NextResponse.json(
                { error: result.error, issues: result.issues, retry: !result.issues },
                { status: result.issues ? 400 : 409 },
            );
        }

        return NextResponse.json({ success: true, preferences: result.envelope, created: result.created });
    } catch (err) {
        console.error("[mobile/preferences] PUT failed:", errMessage(err));
        return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
    }
}
