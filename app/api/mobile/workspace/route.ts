/**
 * GET  /api/mobile/workspace — read the caller's synced workspace.
 * PUT  /api/mobile/workspace — merge-and-stamp a workspace write.
 * DELETE /api/mobile/workspace — reset to defaults on every device.
 *
 * This is the only write path for `deviceWorkspace/$uid`. The RTDB rule denies
 * client writes there on purpose: a client that could bump `revision` itself could
 * forge ordering and defeat the deterministic conflict resolution in
 * `lib/mobile/sync.ts`.
 *
 * Authorization: a verified Firebase ID token, and the uid is taken from the
 * token — never from the body — so a client cannot write another user's
 * workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errMessage } from "@/lib/admin-auth";
import { emptyWorkspaceState, type SyncEnvelope, type WorkspaceState } from "@/lib/mobile/contracts";
import { readWorkspace, validateDevice, writeWorkspace } from "@/lib/mobile/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Writes are cheap but not free; a tight ceiling stops a runaway sync loop. */
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
        const envelope = await readWorkspace(user.uid);
        return NextResponse.json({ success: true, workspace: envelope }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        console.error("[mobile/workspace] GET failed:", errMessage(err));
        return NextResponse.json({ error: "Failed to read workspace" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const now = Date.now();
        if (rateLimited(user.uid, now)) {
            return NextResponse.json({ error: "Too many workspace writes" }, { status: 429 });
        }

        const body = (await request.json()) as {
            data?: unknown;
            device?: unknown;
            /** The revision the client believes it started from, for conflict reporting. */
            baseRevision?: number;
        };

        const device = validateDevice(body.device);
        if (!device.ok) {
            return NextResponse.json({ error: "Invalid device identity", issues: device.issues }, { status: 400 });
        }

        const current = await readWorkspace(user.uid);
        const basedOnStaleRevision = typeof body.baseRevision === "number" && body.baseRevision < current.revision;

        // A client that is knowingly behind does not need a rejection — it needs
        // the current record so it can merge. Returning the server state alongside
        // a 409 lets the client finish the job in one round trip instead of
        // guessing, and tells it the write was refused rather than silently lost.
        if (basedOnStaleRevision) {
            return NextResponse.json(
                { success: false, error: "Stale base revision", workspace: current, retry: true },
                { status: 409 },
            );
        }

        const result = await writeWorkspace(user.uid, body.data, device.value, now);
        if (!result.ok) {
            const status = result.issues ? 400 : 409;
            return NextResponse.json({ error: result.error, issues: result.issues, retry: !result.issues }, { status });
        }

        return NextResponse.json({
            success: true,
            workspace: result.envelope satisfies SyncEnvelope<WorkspaceState>,
            created: result.created,
        });
    } catch (err) {
        console.error("[mobile/workspace] PUT failed:", errMessage(err));
        return NextResponse.json({ error: "Failed to save workspace" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const now = Date.now();
        const device = validateDevice((await request.json().catch(() => ({})))?.device);
        if (!device.ok) {
            return NextResponse.json({ error: "Invalid device identity", issues: device.issues }, { status: 400 });
        }

        // A real write, so every other device observes a revision bump and
        // re-syncs to defaults instead of each keeping stale local state.
        const result = await writeWorkspace(user.uid, emptyWorkspaceState(), device.value, now);
        if (!result.ok) {
            return NextResponse.json({ error: result.error, issues: result.issues }, { status: 409 });
        }
        return NextResponse.json({ success: true, workspace: result.envelope });
    } catch (err) {
        console.error("[mobile/workspace] DELETE failed:", errMessage(err));
        return NextResponse.json({ error: "Failed to reset workspace" }, { status: 500 });
    }
}
