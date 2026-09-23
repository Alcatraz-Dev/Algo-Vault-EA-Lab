
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { RevenueEntry } from "@/lib/growth/types";

export async function getRevenue(adminToken: string) {
    try {
        const decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.revenue).get();
    if (!snap.exists()) return { ads: 0, affiliate: 0, sponsored: 0, subscriptions: 0, marketplace: 0, total: 0, entries: [] };

    const data = snap.val() as Record<string, RevenueEntry>;
    let ads = 0;
    let affiliate = 0;
    let sponsored = 0;
    let subscriptions = 0;
    let marketplace = 0;
    const entries: RevenueEntry[] = [];

    for (const [id, rev] of Object.entries(data)) {
        const r = rev as RevenueEntry;
        r.id = id;
        entries.push(r);
        switch (r.type) {
            case "AD": ads += r.amount; break;
            case "AFFILIATE": affiliate += r.amount; break;
            case "SPONSORED": sponsored += r.amount; break;
            case "SUBSCRIPTION": subscriptions += r.amount; break;
            case "MARKETPLACE": marketplace += r.amount; break;
        }
    }

    return {
        ads,
        affiliate,
        sponsored,
        subscriptions,
        marketplace,
        total: ads + affiliate + sponsored + subscriptions + marketplace,
        entries,
    };
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getRevenue(token);
    if (result && typeof result === "object" && "error" in result) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}