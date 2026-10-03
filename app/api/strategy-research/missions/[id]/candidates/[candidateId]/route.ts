import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getBacktest } from "@/lib/strategy-lab/storage";
import { buildCandidateLineage } from "@/lib/strategy-research/knowledge";
import { getCandidate, getMission, listEvents, listKnowledgeEdges } from "@/lib/strategy-research/storage";

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

// Auth: owner-scoped bearer token. Returns the full research record:
// specification, evidence references, metrics, warnings, robustness report,
// lineage, KG edges and (optionally) the persisted backtest trades.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; candidateId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const { id, candidateId } = await params;
        const mission = await getMission(uid, id);
        if (!mission || mission.uid !== uid) {
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }
        const candidate = await getCandidate(uid, id, candidateId);
        if (!candidate) {
            return NextResponse.json({ error: "Candidate not found" }, { status: 404, headers: corsHeaders });
        }

        const lineage = buildCandidateLineage(mission, candidate);
        const edges = await listKnowledgeEdges(uid, id);
        const candidateEdges = edges.filter(
            (e) =>
                e.from.id === candidate.id ||
                e.to.id === candidate.id ||
                e.from.id === candidate.hypothesis.id ||
                e.to.id === candidate.hypothesis.id
        );

        // Full trade-level evidence is optional (?trades=1) — kept server-side
        // paginated by the engine's own storage, never duplicated.
        let backtest: unknown = null;
        const backtestId = candidate.evaluation?.backtest?.backtestId;
        if (request.nextUrl.searchParams.get("trades") === "1" && backtestId) {
            backtest = await getBacktest(uid, backtestId);
        }

        const events = await listEvents(uid, id, 300);
        const candidateEvents = events.filter(
            (e) => e.message.includes(candidate.id) || e.message.includes(candidate.hypothesis.id)
        );

        return NextResponse.json(
            {
                mission: {
                    id: mission.id,
                    name: mission.name,
                    spec: mission.spec,
                    status: mission.status,
                    currentStage: mission.currentStage,
                    lineageNote: mission.lineageNote,
                },
                candidate,
                lineage,
                knowledgeEdges: candidateEdges,
                events: candidateEvents,
                backtest,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/candidate GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load candidate" },
            { status: 500, headers: corsHeaders }
        );
    }
}
