/**
 * AI Execution — list plans, positions, reviews, policy state for the caller.
 * Server-authorized via `authenticate` (Bearer idToken). Fail-closed everywhere.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/ai-execution/runtime";
import {
    getExecutionPolicy,
    getKillSwitch,
    listPlans,
    listPositionReviews,
    listAudit,
} from "@/lib/ai-execution/database";
import { expireStalePlans } from "@/lib/ai-execution/lifecycle";
import { resolveConnectedAccount } from "@/lib/ai-execution/runtime";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    const caller = await requireCaller(request);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        await expireStalePlans(caller.uid);

        const [policy, killSwitch, plans, reviews, audit, accountKey] = await Promise.all([
            getExecutionPolicy(caller.uid),
            getKillSwitch(),
            listPlans(caller.uid, 100),
            listPositionReviews(caller.uid, undefined, 50),
            listAudit(caller.uid, 100),
            resolveConnectedAccount(caller.uid),
        ]);

        // Live positions come from the EXISTING gateway path records.
        let positions: Array<Record<string, unknown>> = [];
        if (accountKey) {
            const snap = await adminDatabase.ref(`trading_positions/${caller.uid}/${accountKey}`).get();
            const val = (snap.val() || {}) as Record<string, Record<string, unknown>>;
            positions = Object.entries(val).map(([ticket, p]) => ({ ticket, ...p }));
        }

        return NextResponse.json({
            success: true,
            policy,
            killSwitch,
            plans,
            reviews,
            audit,
            account: { connected: Boolean(accountKey), key: accountKey ?? null },
            positions,
        });
    } catch (err) {
        console.error("[ai-execution GET]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load AI execution state." }, { status: 500 });
    }
}
