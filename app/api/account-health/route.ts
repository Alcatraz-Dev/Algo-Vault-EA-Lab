// Self-service account health.
//
// Returns the health of the CALLER's own trading account and nothing else —
// the uid is taken from the verified token, never from a query parameter, so
// there is no way to ask this endpoint about somebody else's account. For the
// operator view of an arbitrary account, see `/api/admin/account-health`.
//
// ── No raw data crosses this boundary ──────────────────────────────────────────
// The response carries aggregate verdicts and a per-position summary. Position
// entries are reduced to symbol/side/size/P&L/risk, which the account owner can
// already see, and no journal, prompt, credential or counterparty detail is
// included.

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { buildAccountHealthReport } from "@/lib/account-health/report";
import { loadAccountHealthFacts } from "@/lib/account-health/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const facts = await loadAccountHealthFacts(user.uid);
        const health = buildAccountHealthReport(facts);

        return NextResponse.json({ success: true, health }, { status: 200 });
    } catch (err: unknown) {
        console.error("[account-health]", err);
        return NextResponse.json({ error: "Account health check failed" }, { status: 500 });
    }
}
