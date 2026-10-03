import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../_shared";
import { joinChallenge, getAttemptState, ArenaError } from "@/lib/performance-arena/service";
import { isArenaEnabled } from "@/lib/performance-arena/flags";
import * as store from "@/lib/performance-arena/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token, owner-scoped listing.
export async function GET(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const attempts = await store.listAttempts(auth.uid, 50);
        const states = await Promise.all(
            attempts.slice(0, 10).map(async (attempt) => {
                try {
                    const state = await getAttemptState(auth.uid, attempt.id);
                    return {
                        attempt: state.attempt,
                        metrics: state.metrics,
                        requirements: state.requirements,
                    };
                } catch {
                    return { attempt, metrics: null, requirements: [] };
                }
            })
        );
        return arenaJson({ attempts: states, total: attempts.length });
    } catch (error) {
        return arenaError(error, "Failed to load attempts.");
    }
}

// Auth: bearer token. Join is server-authoritative: definition validity,
// access entitlement (Pro / free / points), active-attempt limits, virtual
// account creation and analytics all happen here — the client sends only the
// definition id it wants to join.
export async function POST(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        if (!isArenaEnabled()) {
            return arenaJson({ error: "Performance Arena is currently disabled.", code: "ARENA_DISABLED" }, 503);
        }
        const body = (await request.json().catch(() => null)) as { definitionId?: unknown } | null;
        if (!body || typeof body.definitionId !== "string" || !body.definitionId) {
            return arenaJson({ error: "definitionId is required.", code: "INVALID_BODY" }, 400);
        }
        const attempt = await joinChallenge(auth.uid, body.definitionId);
        const state = await getAttemptState(auth.uid, attempt.id);
        return arenaJson({ attempt: state.attempt, metrics: state.metrics }, 201);
    } catch (error) {
        if (error instanceof ArenaError && error.code === "ALREADY_ACTIVE") {
            return arenaJson({ error: error.message, code: error.code }, 409);
        }
        return arenaError(error, "Failed to join the challenge.");
    }
}
