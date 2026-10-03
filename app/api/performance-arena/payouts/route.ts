import { NextRequest } from "next/server";
import { arenaAuth, arenaJson, arenaOPTIONS } from "../_shared";
import { requestCashReward } from "@/lib/performance-arena/payout";
import { isCashRewardsEnabled } from "@/lib/performance-arena/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token.
//
// ⚠ CASH REWARDS ENDPOINT — FAIL-CLOSED BY DESIGN.
//
// This route exists so the future cash-reward architecture has a real,
// tested server-side gate. `requestCashReward` consults ONLY the server env
// flag CASH_REWARDS_ENABLED (default false). Nothing in this body — no flag,
// no eligibility object, no forged state — can enable a payout. With the flag
// off (production) every request is rejected with CASH_REWARDS_DISABLED; with
// the flag on it still rejects because no payout provider is registered.
//
// There is deliberately no GET (nothing to read), no admin counterpart, and
// no database key that influences the outcome.
export async function POST(request: NextRequest) {
    const auth = await arenaAuth(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { amountCents?: unknown; attemptId?: unknown };
    const amountCents = Number(body.amountCents);
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";

    const outcome = await requestCashReward({
        userId: auth.uid,
        attemptId,
        amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    });

    if (!outcome.ok) {
        const status = outcome.code === "CASH_REWARDS_DISABLED" ? 403 : 501;
        return arenaJson({ error: outcome.message, code: outcome.code, cashRewardsEnabled: isCashRewardsEnabled() }, status);
    }

    // Unreachable today (no provider is ever registered).
    return arenaJson({ error: "Not implemented.", code: "NOT_IMPLEMENTED" }, 501);
}
