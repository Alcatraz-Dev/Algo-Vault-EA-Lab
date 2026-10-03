import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAllMissions, listCandidates, listEvents } from "@/lib/strategy-research/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

// Auth: requireAdmin (server-side role check) — operational diagnostics only,
// no secrets, no execution controls, execution-disabled status is read-only.
export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) {
            return NextResponse.json({ error: "Admin access required" }, { status: 403, headers: corsHeaders });
        }

        const missions = await listAllMissions(100);

        const statusCounts: Record<string, number> = {};
        const failStates: Record<string, number> = {};
        let aiRequests = 0;
        let backtests = 0;
        let hypotheses = 0;
        let leaseHeld = 0;

        for (const mission of missions) {
            statusCounts[mission.status] = (statusCounts[mission.status] ?? 0) + 1;
            if (mission.failState) failStates[mission.failState] = (failStates[mission.failState] ?? 0) + 1;
            aiRequests += mission.budgetUsed?.aiRequests ?? 0;
            backtests += mission.budgetUsed?.backtests ?? 0;
            hypotheses += mission.budgetUsed?.hypotheses ?? 0;
            if (mission.lease && Date.now() - (mission.lease.lockedAt ?? 0) < 5 * 60_000) leaseHeld += 1;
        }

        // Failed missions: pull their tail events so operators see root causes.
        const failed = missions.filter((m) => m.status === "failed").slice(0, 10);
        const failureDetails: Array<Record<string, unknown>> = [];
        let candidateTotal = 0;
        let rejectedTotal = 0;
        let survivorTotal = 0;
        let dataQualityFailures = 0;

        for (const mission of missions) {
            if (mission.dataQuality && !mission.dataQuality.sufficient) dataQualityFailures += 1;
            if (failed.includes(mission)) {
                const events = await listEvents(mission.uid, mission.id, 50);
                failureDetails.push({
                    missionId: mission.id,
                    uid: mission.uid,
                    stage: mission.currentStage,
                    failState: mission.failState ?? null,
                    error: mission.error ?? null,
                    tail: events.slice(-5).map((e) => ({ at: e.at, level: e.level, code: e.code ?? null, message: e.message })),
                });
            }
            if (mission.status === "completed") {
                const candidates = await listCandidates(mission.uid, mission.id);
                candidateTotal += candidates.length;
                rejectedTotal += candidates.filter((c) => c.rejectedReason !== null).length;
                survivorTotal += candidates.filter((c) => ["incubated", "forward_testing"].includes(c.lifecycle)).length;
            }
        }

        return NextResponse.json(
            {
                generatedAt: Date.now(),
                executionEnabled: false, // the research engine never executes — always false
                queue: {
                    active: (statusCounts.running ?? 0),
                    paused: (statusCounts.paused ?? 0) + (statusCounts.draft ?? 0),
                    completed: statusCounts.completed ?? 0,
                    failed: statusCounts.failed ?? 0,
                    cancelled: statusCounts.cancelled ?? 0,
                    leasesHeld: leaseHeld,
                },
                totals: {
                    missions: missions.length,
                    aiRequests,
                    backtests,
                    hypotheses,
                    candidates: candidateTotal,
                    rejected: rejectedTotal,
                    survivors: survivorTotal,
                    dataQualityFailures,
                },
                failStates,
                failureDetails,
                recentMissions: missions.slice(0, 25).map((m) => ({
                    id: m.id,
                    uid: m.uid,
                    name: m.name,
                    status: m.status,
                    stage: m.currentStage,
                    failState: m.failState ?? null,
                    markets: m.spec.markets,
                    createdAt: m.createdAt,
                    updatedAt: m.updatedAt,
                    budgetUsed: m.budgetUsed ?? null,
                })),
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/diagnostics GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Diagnostics failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
