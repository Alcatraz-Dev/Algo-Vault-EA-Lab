import { NextRequest, NextResponse } from "next/server";
import { arenaAuth, arenaJson, arenaOPTIONS, arenaError } from "../../../_shared";
import { getAttemptState, ArenaError } from "@/lib/performance-arena/service";
import { runChallengeReview, buildChallengeReviewInput } from "@/lib/intelligence/challenge-bridge";
import { isChallengeReviewEnabled } from "@/lib/intelligence/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
    return arenaOPTIONS();
}

/**
 * GET /api/performance-arena/attempts/[attemptId]/ai-review
 *
 * AI Challenge Review over the Performance Arena's DETERMINISTIC state.
 * The Arena remains fully authoritative: rules, accounting and settlement are
 * computed by lib/performance-arena and are never read from, or written by,
 * this route. The AI narrative is advisory commentary only.
 *
 * GET  → deterministic facts only (works with every provider disabled)
 * POST → adds the AI narrative when AI_CHALLENGE_REVIEW is enabled
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;
        const state = await getAttemptState(auth.uid, attemptId);
        return arenaJson({
            attemptId,
            status: state.attempt.status,
            metrics: state.metrics,
            requirements: state.requirements,
            guardianInsights: state.guardian,
        });
    } catch (error) {
        return arenaError(error, "Failed to load challenge review facts.");
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;
        if (!isChallengeReviewEnabled()) {
            return arenaJson({ error: "FEATURE_DISABLED" }, 404);
        }

        // Deterministic state comes from the Arena service itself — never from
        // client input. The AI sees only this server-computed telemetry.
        const state = await getAttemptState(auth.uid, attemptId);
        const input = buildChallengeReviewInput({
            attempt: { id: state.attempt.id, definitionKey: state.attempt.definitionKey, status: state.attempt.status },
            metrics: state.metrics as unknown as Record<string, unknown>,
            guardian: state.guardian as unknown as Array<{ id: string; title?: string; severity?: string; message?: string }>,
            requirements: state.requirements as unknown as Array<{ id?: string; label: string; current: number; target: number; met?: boolean }>,
            recentEvents: state.recentEvents as unknown as Array<{ type?: string; severity?: string }>,
        });

        const review = await runChallengeReview(input, { userId: auth.uid });
        if (review.validationStatus === "AI_UNAVAILABLE") {
            // Deterministic facts are still returned so the UI degrades safely.
            return arenaJson({ error: "AI_UNAVAILABLE", message: review.reason ?? "No AI provider available.", review }, 503);
        }
        return arenaJson({ review });
    } catch (error) {
        if (error instanceof ArenaError) return arenaError(error, "Challenge review failed.");
        return arenaError(error, "Challenge review failed.");
    }
}
