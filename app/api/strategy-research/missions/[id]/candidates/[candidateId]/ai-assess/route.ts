import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getMission, getCandidate } from "@/lib/strategy-research/storage";
import { runResearchAssessment } from "@/lib/intelligence/research-bridge";
import { isStrategyResearchIntelligenceEnabled } from "@/lib/intelligence/flags";
import { checkAccess } from "@/lib/strategy-lab/license";
import type { ResearchCandidateSnapshot } from "@/lib/intelligence/research-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * Build the compact deterministic snapshot from persisted storage — NEVER from
 * client input. The AI only ever sees these numbers and can only interpret
 * them; it cannot alter the candidate, its score or its lifecycle.
 */
function snapshotOf(candidate: NonNullable<Awaited<ReturnType<typeof getCandidate>>>): ResearchCandidateSnapshot {
    const ev = candidate.evaluation;
    const mc = ev?.monteCarlo?.summary ?? null;
    const wf = ev?.validation?.outcome.walkForward ?? null;
    const oos = ev?.validation?.outcome ?? null;
    return {
        id: candidate.id,
        name: candidate.strategy?.name ?? candidate.id,
        market: candidate.hypothesis.market,
        timeframe: candidate.strategy?.timeframes?.setup ?? "",
        direction: candidate.hypothesis.direction,
        concepts: candidate.hypothesis.concepts.slice(0, 8),
        lifecycle: candidate.lifecycle,
        rejectedReason: candidate.rejectedReason,
        backtest: ev?.backtest
            ? {
                  totalTrades: ev.backtest.metrics.totalTrades,
                  winRatePct: Number(ev.backtest.metrics.winRate.toFixed(1)),
                  profitFactor: Number(ev.backtest.metrics.profitFactor.toFixed(2)),
                  maxDrawdownPct: Number(ev.backtest.metrics.maxDrawdownPct.toFixed(1)),
                  expectancyR: Number(ev.backtest.metrics.expectancyR.toFixed(2)),
              }
            : null,
        oos: oos
            ? {
                  verdict: oos.verdict,
                  degradationPct: Number((oos.degradation.overall * 100).toFixed(1)),
                  stable: oos.walkForward.stable,
              }
            : null,
        walkForward: wf
            ? { windows: wf.windows.length, stable: wf.stable, stabilityScore: wf.stabilityScore }
            : null,
        monteCarlo: mc
            ? {
                  simulations: mc.simulations,
                  profitProbabilityPct: mc.profitProbability !== null ? Number((mc.profitProbability * 100).toFixed(1)) : null,
                  drawdownP95Pct: mc.drawdownP95 !== null ? Number((mc.drawdownP95 * 100).toFixed(1)) : null,
              }
            : null,
        score: candidate.score
            ? { total: candidate.score.total, verdict: candidate.score.verdict, factors: candidate.score.factors }
            : null,
        warnings: candidate.warnings.slice(0, 6).map((w) => `${w.severity}: ${w.message}`.slice(0, 160)),
    };
}

// Auth: owner bearer + Pro/Strategy-Lab entitlement re-checked server-side.
// AI_UNAVAILABLE is returned honestly when no provider can serve.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; candidateId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;
        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json({ error: access.reason ?? "Access denied" }, { status: 403, headers: corsHeaders });
        }
        if (!isStrategyResearchIntelligenceEnabled()) {
            return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404, headers: corsHeaders });
        }

        const { id, candidateId } = await params;
        const mission = await getMission(uid, id);
        if (!mission || mission.uid !== uid) {
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }
        const candidate = await getCandidate(uid, id, candidateId);
        if (!candidate) {
            return NextResponse.json({ error: "Candidate not found" }, { status: 404, headers: corsHeaders });
        }

        const assessment = await runResearchAssessment(snapshotOf(candidate), { userId: uid });
        if (assessment.validationStatus === "AI_UNAVAILABLE") {
            return NextResponse.json(
                { error: "AI_UNAVAILABLE", message: assessment.reason ?? "No AI provider available.", assessment },
                { status: 503, headers: corsHeaders },
            );
        }
        return NextResponse.json({ assessment }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-research/ai-assess]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Assessment failed" },
            { status: 500, headers: corsHeaders },
        );
    }
}
