/**
 * Growth Engine — feedback mechanism linking analytics to optimization.
 *
 * Reads real analytics output from the Phase 2 pipeline and feeds it
 * back into the growth loop. Never invents metrics.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "../constants";

export async function collectFeedback(): Promise<{ events?: number; revenueEntries?: number; analyticsAvailable: boolean; unavailableSources: string[] }> {
    const unavailable: string[] = [];
    const result: { events?: number; revenueEntries?: number; analyticsAvailable: boolean; unavailableSources: string[] } = {
        analyticsAvailable: false,
        unavailableSources: unavailable,
    };

    try {
        const eventsSnap = await adminDatabase.ref(GROWTH_COLLECTIONS.events).get();
        result.events = eventsSnap.exists() ? Object.keys(eventsSnap.val() || {}).length : 0;
        result.analyticsAvailable = true;
    } catch {
        unavailable.push(GROWTH_COLLECTIONS.events);
    }

    try {
        const revSnap = await adminDatabase.ref(GROWTH_COLLECTIONS.revenue).get();
        result.revenueEntries = revSnap.exists() ? Object.keys(revSnap.val() || {}).length : 0;
    } catch {
        unavailable.push(GROWTH_COLLECTIONS.revenue);
    }

    return result;
}
