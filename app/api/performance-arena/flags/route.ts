import { NextResponse } from "next/server";
import { arenaCorsHeaders } from "../_shared";
import { arenaFlagSnapshot, isArenaEnabled } from "@/lib/performance-arena/flags";
import { ARENA_DISCLAIMERS } from "@/lib/performance-arena/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth: optional — flags only tell the UI which surfaces to render; every
// mutation route re-checks entitlement server-side regardless of these values.
export async function GET() {
    const snapshot = arenaFlagSnapshot();
    return NextResponse.json(
        {
            ...snapshot,
            // The client is told the server truth, but there is deliberately
            // NO input anywhere that can change cashRewardsEnabled.
            cashRewardsNotice: isArenaEnabled() ? ARENA_DISCLAIMERS.rewards : null,
            disclaimers: [ARENA_DISCLAIMERS.simulated, ARENA_DISCLAIMERS.noGuarantees, ARENA_DISCLAIMERS.aiInformational, ARENA_DISCLAIMERS.challengeScope],
        },
        { headers: { ...arenaCorsHeaders, "Cache-Control": "no-store" } }
    );
}
