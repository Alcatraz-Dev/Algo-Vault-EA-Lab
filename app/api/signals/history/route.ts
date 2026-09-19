import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal } from "@/lib/ai-signals/types";
import { isProUser } from "@/lib/ai-signals/access";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const symbolFilter = searchParams.get("symbol")?.toUpperCase();
        const tierFilter = searchParams.get("tier");
        const timeframeFilter = searchParams.get("timeframe");
        const directionFilter = searchParams.get("direction");
        const resultFilter = searchParams.get("result");
        const statusFilter = searchParams.get("status");
        const from = Number(searchParams.get("from")) || 0;
        const to = Number(searchParams.get("to")) || Date.now();
        const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);

        const snap = await adminDatabase.ref("aiSignals").get();
        let signals: AISignal[] = [];
        snap.forEach((child) => {
            signals.push(child.val() as AISignal);
        });

        // Server-side tier enforcement: PRO signals are only visible to
        // active Pro/Enterprise users, regardless of query params.
        const isPro = await isProUser(user.uid);
        signals = signals.filter((s) => s.tier !== "PRO" || isPro);

        if (tierFilter && tierFilter !== "all") signals = signals.filter((s) => s.tier === tierFilter);
        if (symbolFilter) signals = signals.filter((s) => s.symbol.toUpperCase().includes(symbolFilter));
        if (timeframeFilter) signals = signals.filter((s) => s.timeframe === timeframeFilter);
        if (directionFilter) signals = signals.filter((s) => s.direction === directionFilter);
        if (resultFilter) signals = signals.filter((s) => s.result === resultFilter);
        if (statusFilter) signals = signals.filter((s) => s.status === statusFilter);
        signals = signals.filter((s) => Number(s.createdAt) >= from && Number(s.createdAt) <= to);

        signals.sort((a, b) => b.createdAt - a.createdAt);
        const page = signals.slice(0, limit);

        return NextResponse.json({
            success: true,
            signals: page,
            total: signals.length,
            hasMore: signals.length > limit,
        });
    } catch (err) {
        console.error("Signals history GET error:", err);
        return NextResponse.json({ error: "Failed to load signal history" }, { status: 500 });
    }
}