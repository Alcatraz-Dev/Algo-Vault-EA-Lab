/**
 * AI Execution — kill switch API.
 *
 * GET   → any authenticated user may read the state (it gates their own
 *         execution path).
 * POST  → ADMIN ONLY (verified server-side via requireAdmin). Engage/release
 *         writes an audit event through the admin's own audit path.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { requireCaller } from "@/lib/ai-execution/runtime";
import { getKillSwitch, setKillSwitch, invalidateKillSwitchCache, writeAudit } from "@/lib/ai-execution/database";

export async function GET(request: NextRequest) {
    const caller = await requireCaller(request);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const state = await getKillSwitch();
    return NextResponse.json({ success: true, killSwitch: state });
}

export async function POST(request: NextRequest) {
    // Server-side admin verification — UI hiding is not authorization.
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin authorization required." }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const engage = body.engaged === true;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : undefined;

    await setKillSwitch(engage, `admin:${admin.uid}`, reason);
    invalidateKillSwitchCache();
    await writeAudit({
        userId: admin.uid,
        action: engage ? "KILL_SWITCH_ENGAGED" : "KILL_SWITCH_RELEASED",
        actor: `admin:${admin.uid}`,
        reason: reason ?? (engage ? "Kill switch engaged." : "Kill switch released."),
    });

    return NextResponse.json({ success: true, killSwitch: await getKillSwitch() });
}
