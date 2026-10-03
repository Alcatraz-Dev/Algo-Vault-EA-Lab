import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAnalytics, listDefinitions, listAllAttempts } from "@/lib/performance-arena/store";
import { listResultsAll } from "@/lib/performance-arena/admin-reads";
import { arenaFlagSnapshot } from "@/lib/performance-arena/flags";
import { pctOf } from "@/lib/performance-arena/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json" };

// Auth: requireAdmin. Aggregate, non-identifying product analytics: starts,
// completions, pass rate, failure reasons, durations, drawdown/PnL averages,
// reward issuance. Deliberately avoids "win rate" marketing framing — pass
// rate is reported with its denominator and reason breakdown.
export async function GET(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });

        const [daily, definitions, attempts, results] = await Promise.all([
            listAnalytics(60),
            listDefinitions(),
            listAllAttempts(500),
            listResultsAll(500),
        ]);

        const settled = results.filter((r) => r.status === "PASSED" || r.status === "FAILED" || r.status === "EXPIRED");
        const passed = results.filter((r) => r.status === "PASSED");

        const reasonCounts: Record<string, number> = {};
        for (const result of results) {
            reasonCounts[result.reasonCode] = (reasonCounts[result.reasonCode] ?? 0) + 1;
        }

        const durations = settled.map((r) => Math.max(0, r.settledAt - (attempts.find((a) => a.id === r.attemptId)?.startedAt ?? r.settledAt)));
        const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

        const avgDrawdown =
            settled.length > 0 ? Math.round((settled.reduce((sum, r) => sum + r.maxDrawdownPct, 0) / settled.length) * 100) / 100 : 0;
        const avgReturn =
            settled.length > 0 ? Math.round((settled.reduce((sum, r) => sum + r.totalReturnPct, 0) / settled.length) * 100) / 100 : 0;

        const totals = daily.reduce(
            (acc, day) => ({
                challengeStarts: acc.challengeStarts + day.challengeStarts,
                challengeCompletions: acc.challengeCompletions + day.challengeCompletions,
                passes: acc.passes + day.passes,
                failures: acc.failures + day.failures,
                expiries: acc.expiries + day.expiries,
                cancellations: acc.cancellations + day.cancellations,
                rewardsGranted: acc.rewardsGranted + day.rewardsGranted,
                pointsIssued: acc.pointsIssued + day.pointsIssued,
                aiGuardianRuns: acc.aiGuardianRuns + day.aiGuardianRuns,
            }),
            { challengeStarts: 0, challengeCompletions: 0, passes: 0, failures: 0, expiries: 0, cancellations: 0, rewardsGranted: 0, pointsIssued: 0, aiGuardianRuns: 0 }
        );

        return NextResponse.json(
            {
                flags: arenaFlagSnapshot(),
                definitions: definitions.map((d) => ({ id: d.id, name: d.name, enabled: d.enabled, status: d.status, access: d.access.model })),
                totals: {
                    ...totals,
                    passRatePct: settled.length > 0 ? pctOf(settled.length, passed.length) : 0,
                    settledCount: settled.length,
                    avgDurationMs,
                    avgDrawdownPct: avgDrawdown,
                    avgReturnPct: avgReturn,
                },
                failureReasons: reasonCounts,
                daily,
                generatedAt: Date.now(),
            },
            { headers }
        );
    } catch (error) {
        console.error("[admin/performance-arena/analytics GET]", error);
        return NextResponse.json({ error: "Failed to load analytics" }, { status: 500, headers });
    }
}
