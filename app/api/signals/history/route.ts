import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal } from "@/lib/ai-signals/types";
import { isProUser } from "@/lib/ai-signals/access";

const VALID_PERIODS = ["today", "week", "month", "last7", "last30", "last90", "all"] as const;
type HistoryPeriod = (typeof VALID_PERIODS)[number];

function periodStart(period: HistoryPeriod, now: number) {
    switch (period) {
        case "today": {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            return start.getTime();
        }
        case "week": {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            const day = start.getDay();
            const diff = day === 0 ? 6 : day - 1;
            start.setDate(start.getDate() - diff);
            return start.getTime();
        }
        case "month": {
            const start = new Date(now);
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            return start.getTime();
        }
        case "last7":
            return now - 7 * 86400000;
        case "last30":
            return now - 30 * 86400000;
        case "last90":
            return now - 90 * 86400000;
        case "all":
            return 0;
    }
}

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
        const periodValue = searchParams.get("period") || "all";
        if (!VALID_PERIODS.includes(periodValue as HistoryPeriod)) {
            return NextResponse.json({ error: "Invalid period" }, { status: 400 });
        }
        const period = periodValue as HistoryPeriod;
        const fromParam = searchParams.get("from");
        const toParam = searchParams.get("to");
        const now = Date.now();
        const from = fromParam !== null && Number.isFinite(Number(fromParam))
            ? Number(fromParam)
            : periodStart(period, now);
        const to = toParam !== null && Number.isFinite(Number(toParam))
            ? Number(toParam)
            : now;
        const requestedLimit = Number(searchParams.get("limit"));
        const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 1000);

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