import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A trade journal entry stored under tradeJournal/{uid}. */
interface TradeJournalEntry {
    id?: string;
    result?: string;
    resultR?: number | string;
    createdAt?: number | string;
    signalId?: string;
}

function computeMetrics(trades: TradeJournalEntry[]) {
    const netProfit = trades.reduce((s: number, t: TradeJournalEntry) => s + Number(t.resultR || 0), 0);
    const wins = trades.filter((t: TradeJournalEntry) => t.result === "WIN").length;
    const losses = trades.filter((t: TradeJournalEntry) => t.result === "LOSS").length;
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = losses > 0 ? wins / losses : wins > 0 ? Infinity : 0;
    const expectancy = totalTrades > 0 ? netProfit / totalTrades : 0;
    const avgReturn = totalTrades > 0 ? netProfit / totalTrades : 0;
    const maxDrawdownPct = 0;
    const sharpeLike = 0;
    return {
        totalTrades,
        wins,
        losses,
        winRate: Number(winRate.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
        expectancy: Number(expectancy.toFixed(2)),
        avgReturn: Number(avgReturn.toFixed(2)),
        maxDrawdownPct,
        sharpeLike: Number(sharpeLike.toFixed(3)),
    };
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const tradeSnap = await adminDatabase.ref(`tradeJournal/${user.uid}`).get();
        const trades = tradeSnap.exists()
            ? (tradeSnap.val() as Record<string, TradeJournalEntry>)
            : {};
        const tradeList = Object.values(trades).filter((t) => t && t.result);

        const metrics = computeMetrics(tradeList);

        const signalSnap = await adminDatabase.ref("aiSignals").get();
        const signals: Array<{ id?: string }> = [];
        if (signalSnap.exists()) {
            signalSnap.forEach((child) => { const s = child.val(); if (s && s.id) signals.push(s); });
        }

        const verifiedPerformance = {
            verifiedAt: new Date().toISOString(),
            tradingDays: new Set(tradeList.map((t: TradeJournalEntry) => { const d = new Date(t.createdAt || Date.now()); return d.toDateString(); })).size,
            ...metrics,
            totalTrades: tradeList.length,
            signalCorrelation: {
                totalSignals: signals.length,
                signalsWithTrades: tradeList.filter((t: TradeJournalEntry) => t.signalId).length,
                correlation: tradeList.filter((t: TradeJournalEntry) => t.signalId).length > 0 ? "correlated" : "uncorrelated",
            },
            consistency: {
                weeklyTrades: Math.round(tradeList.length / Math.max(1, new Set(tradeList.map((t: TradeJournalEntry) => new Date(t.createdAt || Date.now()).toISOString().slice(0, 7))).size)),
                avgTradesPerWeek: tradeList.length / Math.max(1, 4),
                bestWeek: 0,
                worstWeek: 0,
            },
            riskMetrics: {
                maxDrawdown: metrics.maxDrawdownPct,
                maxDrawdownPct: metrics.maxDrawdownPct,
                profitFactor: metrics.profitFactor,
                expectancy: metrics.expectancy,
                sharpeRatio: metrics.sharpeLike,
            },
        };

        return NextResponse.json({ success: true, verifiedPerformance }, { status: 200 });
    } catch (err) {
        console.error("[verified-performance]", err);
        return NextResponse.json({ error: "Failed to compute verified performance" }, { status: 500 });
    }
}
