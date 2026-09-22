import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP } from "@/lib/analytics/vwap";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { summarizeAnalysisWithFallback } from "@/lib/ai";
import { parseAnalyticsParams } from "@/lib/market-data/validation";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";

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

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json() as {
            symbol?: string;
            timeframe?: string;
            from?: number;
            to?: number;
            type?: "daily" | "weekly" | "monthly";
        };

        const symbol = (body.symbol || "XAUUSD") as SupportedSymbol;
        const timeframe = (body.timeframe || "H1") as Timeframe;
        const type = body.type || "daily";

        const { from, to } = parseAnalyticsParams(request.nextUrl.searchParams);
        const candles = await fetchCandles(symbol, timeframe, { from: body.from || from, to: body.to || to });
        if (candles.length < 10) return NextResponse.json({ error: "Insufficient data" }, { status: 400 });

        const regime = detectRegime(candles, timeframe);
        const volatility = analyzeVolatility(candles);
        const volume = analyzeVolume(candles);
        const vwap = calculateVWAP(candles);
        const score = calculateMarketScore(candles, timeframe);

        const aiSummary = await summarizeAnalysisWithFallback({
            asset: symbol,
            timeframe,
            trend: regime.regime,
            volatility: volatility.state,
            bestSession: "",
            bestDay: "",
            strongestSetup: "",
            averageR: null,
            regime: regime.regime,
        });

        const tradesSnap = await adminDatabase.ref(`tradeJournal/${user.uid}`).get();
        const trades = tradesSnap.exists()
            ? (tradesSnap.val() as Record<string, TradeJournalEntry>)
            : {};
        const tradeList = Object.values(trades).filter((t) => t && t.result);

        const wins = tradeList.filter((t: TradeJournalEntry) => t.result === "WIN").length;
        const losses = tradeList.filter((t: TradeJournalEntry) => t.result === "LOSS").length;
        const winRate = tradeList.length > 0 ? ((wins / tradeList.length) * 100).toFixed(1) : "0";
        const totalPnl = tradeList.reduce((s: number, t: TradeJournalEntry) => s + Number(t.resultR || 0), 0);

        const report = {
            generatedAt: new Date().toISOString(),
            symbol,
            timeframe,
            reportType: type,
            marketAnalysis: {
                regime: regime.regime,
                confidence: regime.confidence,
                volatility: volatility.state,
                volume: volume.state,
                vwap: vwap || null,
                score: score.total,
            },
            tradeSummary: {
                totalTrades: tradeList.length,
                wins,
                losses,
                winRate: `${winRate}%`,
                totalPnl: totalPnl.toFixed(2),
            },
            aiReport: aiSummary.summary,
        };

        const reportRef = adminDatabase.ref(`reports/${user.uid}/${Date.now()}`);
        await reportRef.set(report);

        return NextResponse.json({ success: true, report, reportId: reportRef.key }, { status: 200 });
    } catch (err) {
        console.error("[report-generator]", err);
        return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const reportSnap = await adminDatabase.ref(`reports/${user.uid}`).get();
        const reports = reportSnap.exists() ? reportSnap.val() : {};
        const reportList = Object.entries(reports).map(([id, data]) => ({
            id,
            ...(data as Record<string, unknown>),
        }));

        return NextResponse.json({ success: true, reports: reportList }, { status: 200 });
    } catch (err) {
        console.error("[report-generator GET]", err);
        return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
    }
}
