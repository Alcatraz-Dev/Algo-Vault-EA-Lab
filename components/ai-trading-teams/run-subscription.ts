"use client";

/**
 * Realtime subscription to a team run on Firebase RTDB.
 * The orchestrator patches `aiTeamRuns/{uid}/{runId}` as agents progress, so
 * the workspace renders live agent states without polling or blocking UI.
 */

import { onValue, ref, type Unsubscribe } from "firebase/database";
import { database } from "@/lib/firebase";
import type { TeamRun } from "@/lib/ai-trading-teams/types";

export function subscribeToRun(
    uid: string,
    runId: string,
    onUpdate: (run: TeamRun | null) => void,
): Unsubscribe {
    const path = `aiTeamRuns/${uid}/${runId}`;
    return onValue(
        ref(database, path),
        (snapshot) => {
            const value = snapshot.val();
            onUpdate((value ?? null) as TeamRun | null);
        },
        (error) => {
            console.warn("[ai-trading-teams] run subscription error:", error?.message);
        },
    );
}
