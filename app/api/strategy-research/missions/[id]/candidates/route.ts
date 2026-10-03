import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getMission, listCandidates } from "@/lib/strategy-research/storage";

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

/** Lightweight projection: list views must not ship full evaluations. */
function toSummary(candidate: Awaited<ReturnType<typeof listCandidates>>[number]) {
    const m = candidate.evaluation?.backtest?.metrics ?? null;
    const v = candidate.evaluation?.validation?.outcome ?? null;
    const mc = candidate.evaluation?.monteCarlo?.summary ?? null;
    return {
        id: candidate.id,
        missionId: candidate.missionId,
        name: candidate.strategy?.name ?? candidate.hypothesis.rationale.slice(0, 60) ?? "Candidate",
        market: candidate.hypothesis.market,
        timeframe: candidate.strategy?.timeframes.setup ?? candidate.hypothesis.timeframes[0],
        direction: candidate.hypothesis.direction,
        source: candidate.hypothesis.source,
        lifecycle: candidate.lifecycle,
        rejectedReason: candidate.rejectedReason,
        rejectedNotes: candidate.rejectedNotes.slice(0, 4),
        score: candidate.score,
        linkedTo: candidate.linkedTo,
        warnings: (candidate.warnings ?? []).map((w) => ({ type: w.type, severity: w.severity, message: w.message })),
        robustness: candidate.robustnessReport
            ? { status: candidate.robustnessReport.status, warnings: candidate.robustnessReport.warnings.length }
            : null,
        backtest: m
            ? {
                  totalTrades: m.totalTrades,
                  winRate: m.winRate,
                  profitFactor: m.profitFactor,
                  netProfit: m.netProfit,
                  maxDrawdownPct: m.maxDrawdownPct,
                  returnPct: m.returnPct,
              }
            : null,
        outOfSample: v
            ? { verdict: v.verdict, degradation: v.degradation.overall, trades: v.outOfSample.metrics.totalTrades }
            : null,
        walkForward: v
            ? {
                  enabled: v.walkForward.enabled,
                  windows: v.walkForward.windows.length,
                  stable: v.walkForward.stable,
                  stabilityScore: v.walkForward.stabilityScore,
              }
            : null,
        monteCarlo: mc
            ? { simulations: mc.simulations, profitProbability: mc.profitProbability, drawdownP95: mc.drawdownP95 }
            : null,
        incubationStrategyId: candidate.incubationStrategyId,
        forwardTestId: candidate.forwardTestId,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
    };
}

// Auth: owner-scoped bearer token; cursor pagination (offset/limit) so large
// missions never flood the browser.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const { id } = await params;
        const mission = await getMission(uid, id);
        if (!mission || mission.uid !== uid) {
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }

        const offset = Math.max(0, Math.floor(Number(request.nextUrl.searchParams.get("offset")) || 0));
        const limit = Math.min(50, Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get("limit")) || 20)));
        const lifecycle = request.nextUrl.searchParams.get("lifecycle");

        let all = await listCandidates(uid, id);
        if (lifecycle) all = all.filter((c) => c.lifecycle === lifecycle);

        const page = all.slice(offset, offset + limit).map(toSummary);

        return NextResponse.json(
            { candidates: page, total: all.length, offset, limit },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/candidates GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to list candidates" },
            { status: 500, headers: corsHeaders }
        );
    }
}
