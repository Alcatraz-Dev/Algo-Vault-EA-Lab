import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../../_shared";
import { getAttemptState, runGuardianAI, ArenaError } from "@/lib/performance-arena/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token. Deterministic insights are computed from metrics —
// always available, no AI required.
export async function GET(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;
        const state = await getAttemptState(auth.uid, attemptId);
        return arenaJson({ insights: state.guardian, metrics: state.metrics, requirements: state.requirements });
    } catch (error) {
        return arenaError(error, "Failed to load Guardian insights.");
    }
}

// Auth: bearer token. Optional AI pass through the canonical AI Router.
// Costs 1 AI credit, charged ONLY on a successful analysis; failure is
// fail-closed (503, no charge). AI output is commentary — it never alters
// challenge accounting, rules or settlement.
export async function POST(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;
        const analysis = await runGuardianAI(auth.uid, attemptId);
        return arenaJson({ analysis });
    } catch (error) {
        if (error instanceof ArenaError && error.code === "AI_CREDITS_REQUIRED") {
            return arenaJson({ error: error.message, code: error.code }, 402);
        }
        if (error instanceof ArenaError && error.code === "AI_UNAVAILABLE") {
            return arenaJson({ error: error.message, code: error.code }, 503);
        }
        return arenaError(error, "Guardian AI failed.");
    }
}
