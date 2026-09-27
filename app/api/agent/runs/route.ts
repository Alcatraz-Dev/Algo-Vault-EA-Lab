// AlgoVault Agent IDE — Run History API
//
// Returns sanitized run records for the authenticated admin. Records contain
// only operational metadata — never file contents, command output, or secrets
// (enforced by the persistence sanitizer in lib/agent/core/rtdb-store.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAgentRuns } from "@/lib/agent/core/rtdb-store";

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    try {
        const runs = await listAgentRuns(admin.uid, 25);
        return NextResponse.json({ runs });
    } catch {
        return NextResponse.json({ error: "Failed to load run history." }, { status: 500 });
    }
}
