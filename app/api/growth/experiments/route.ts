import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS, EXPERIMENT_MIN_SAMPLE_SIZE, EXPERIMENT_MIN_UPLIFT_PCT } from "@/lib/growth/constants";
import { Experiment, GrowthEvent } from "@/lib/growth/types";

export async function getExperiments(adminToken: string) {
    try {
        const decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const [expSnap, eventsSnap] = await Promise.all([
        adminDatabase.ref(GROWTH_COLLECTIONS.experiments).get(),
        adminDatabase.ref(GROWTH_COLLECTIONS.events).get(),
    ]);

    if (!expSnap.exists()) return [];

    const experiments = expSnap.val() as Record<string, Experiment>;
    const events = eventsSnap.exists() ? (eventsSnap.val() as Record<string, GrowthEvent>) : {};

    const results: Record<string, { impressionsA: number; impressionsB: number; conversionsA: number; conversionsB: number }> = {};
    for (const ev of Object.values(events)) {
        const variant = ev.metadata?.variant as string | undefined;
        const expId = ev.metadata?.experimentId as string | undefined;
        if (!expId || !variant) continue;
        const r = (results[expId] ||= { impressionsA: 0, impressionsB: 0, conversionsA: 0, conversionsB: 0 });
        if (variant === "A") {
            r.impressionsA++;
            if (ev.type === "conversion" || ev.type === "signup") r.conversionsA++;
        } else if (variant === "B") {
            r.impressionsB++;
            if (ev.type === "conversion" || ev.type === "signup") r.conversionsB++;
        }
    }

    return Object.entries(experiments).map(([id, val]) => {
        const r = results[id] || { impressionsA: 0, impressionsB: 0, conversionsA: 0, conversionsB: 0 };
        const existingResults = val.results;
        const computedResults = computeWinner(r);
        return {
            id,
            ...val,
            results: existingResults || computedResults,
            _computed: r,
        };
    });
}

function computeWinner(r: {
    impressionsA: number;
    impressionsB: number;
    conversionsA: number;
    conversionsB: number;
}): { impressionsA: number; impressionsB: number; conversionsA: number; conversionsB: number; winner: "A" | "B" | "INCONCLUSIVE" } {
    const aImp = r.impressionsA;
    const bImp = r.impressionsB;
    const aConv = r.conversionsA;
    const bConv = r.conversionsB;

    const aRate = aImp > 0 ? aConv / aImp : 0;
    const bRate = bImp > 0 ? bConv / bImp : 0;

    if (aImp < EXPERIMENT_MIN_SAMPLE_SIZE || bImp < EXPERIMENT_MIN_SAMPLE_SIZE) {
        return { ...r, winner: "INCONCLUSIVE" };
    }

    if (aRate === 0 && bRate === 0) return { ...r, winner: "INCONCLUSIVE" };

    const relUplift = aRate > 0 ? (bRate - aRate) / aRate : Infinity;

    if (Math.abs(relUplift) < EXPERIMENT_MIN_UPLIFT_PCT / 100) {
        return { ...r, winner: "INCONCLUSIVE" };
    }

    return { ...r, winner: bRate > aRate ? "B" : "A" };
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getExperiments(token);
    if (!Array.isArray(result)) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
