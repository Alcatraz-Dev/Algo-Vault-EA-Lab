/**
 * Growth Engine — content/channel fatigue detection using real event data.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "../constants";

export async function detectFatigueFromEvents(): Promise<{ fatigued: boolean; reason: string; metrics?: Record<string, number> }> {
    try {
        const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.events).get();
        const events = snap.exists() ? Object.values(snap.val() as Record<string, { type?: string }>) : [];
        const impressionEvents = events.filter((e: any) => e?.type === "impression").length;
        const clickEvents = events.filter((e: any) => e?.type === "click").length;
        const ctr = impressionEvents > 0 ? clickEvents / impressionEvents : 0;
        // Very low CTR could indicate fatigue (simplified heuristic)
        return {
            fatigued: ctr < 0.01 && impressionEvents > 20,
            reason: ctr < 0.01 && impressionEvents > 20 ? "Very low CTR relative to high impressions suggests fatigue" : "No significant fatigue signal",
            metrics: { impressions: impressionEvents, clicks: clickEvents, ctr: Math.round(ctr * 10000) / 10000 },
        };
    } catch {
        return { fatigued: false, reason: "Data unavailable", metrics: undefined };
    }
}
