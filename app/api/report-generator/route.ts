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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

        const symbol = body.symbol || "XAUUSD";
        const timeframe = (body.timeframe as any) || "H1";
        const type = body.type || "daily";

        const { from, to } = parseAnalyticsParams(request.nextUrl.searchParams);
        const candles = await fetchCandles(symbol as any, timeframe as any, { from: body.from || from, to: body.to || to });
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
        const trades = tradesSnap.exists() ? tradesSnap.val() : {};
        const tradeList = Object.values(trades).filter((t: any) => t && t.result);

        const wins = tradeList.filter((t: any) => t.result === "WIN").length;
        const losses = tradeList.filter((t: any) => t.result === "LOSS").length;
        const winRate = tradeList.length > 0 ? ((wins / tradeList.length) * 100).toFixed(1) : "0";
        const totalPnl = tradeList.reduce((s: number, t: any) => s + Number(t.resultR || 0), 0);

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
        const reportList = Object.entries(reports).map(([id, data]: [string, any]) => ({ id, ...data }));

        return NextResponse.json({ success: true, reports: reportList }, { status: 200 });
    } catch (err) {
        console.error("[report-generator GET]", err);
        return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
    }
}
