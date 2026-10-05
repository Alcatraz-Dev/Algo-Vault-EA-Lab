import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { computeActivation, computeUserHealth } from "@/lib/product-analytics/activation";
import { isProductEventType, type ProductEventType } from "@/lib/product-analytics/events";
import { getUserEventTypes, getLastMeaningfulEventAt } from "@/lib/product-analytics/store";
import { MEANINGFUL_EVENTS } from "@/lib/product-analytics/retention";

/**
 * Personal product-progress endpoint.
 *
 * Returns the CALLER'S OWN activation summary so the product can show them
 * "here's what you've explored, here's what's next". It never exposes another
 * user's data and never returns cohort or benchmark information that could be
 * used to infer how a specific person trades.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let uid: string;
    try {
        const decoded = await adminAuth.verifyIdToken(header.slice(7));
        uid = decoded.uid;
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const rollups = await getUserEventTypes(uid);
        // Rebuild the event list from rollups, capping each type at 3 so the
        // score matches what the admin-side computation produces.
        const typeList: ProductEventType[] = [];
        for (const { type, count } of rollups) {
            if (!isProductEventType(type)) continue;
            for (let i = 0; i < Math.min(count, 3); i++) typeList.push(type);
        }

        const activation = computeActivation(typeList);
        const lastActiveAt = await getLastMeaningfulEventAt(uid);
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const eventsLast7d = rollups
            .filter((r) => MEANINGFUL_EVENTS.includes(r.type as ProductEventType) && r.lastAt >= sevenDaysAgo)
            .length;
        const activeDaysLast30d = new Set(
            rollups
                .filter((r) => MEANINGFUL_EVENTS.includes(r.type as ProductEventType) && r.lastAt >= Date.now() - 30 * 24 * 60 * 60 * 1000)
                .map((r) => new Date(r.lastAt).toISOString().slice(0, 10))
        ).size;

        const health = computeUserHealth({
            lastActiveAt,
            createdAt: Date.now(),
            activation,
            eventsLast7d,
            activeDaysLast30d,
        });

        return NextResponse.json(
            {
                score: activation.score,
                max: activation.max,
                percent: Math.round(activation.percent * 10) / 10,
                activated: activation.activated,
                workflowsTouched: activation.workflowsTouched,
                nextBestAction: activation.nextBestAction,
                health: { state: health.state, reason: health.reason },
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (err) {
        console.error("[analytics/activation] failed", err);
        return NextResponse.json({ error: "Failed to load your progress" }, { status: 500 });
    }
}
