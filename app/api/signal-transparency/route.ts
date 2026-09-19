import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getAIProvider, summarizeAnalysisWithFallback } from "@/lib/ai";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { calculateVWAP } from "@/lib/analytics/vwap";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { detectStructure } from "@/lib/analytics/market-structure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const signalSnap = await adminDatabase.ref("aiSignals").get();
        let signals: any[] = [];
        if (signalSnap.exists()) {
            signalSnap.forEach((child) => { const s = child.val(); if (s && s.id) signals.push(s); });
        }

        const recentSignals = signals.slice(-30);
        const transparency: any[] = [];

        for (const signal of recentSignals) {
            let analysis = null;
            try {
                if (signal.symbol) {
                    const candles = await fetchCandles(signal.symbol as any, (signal.timeframe as any) || "H1");
                    if (candles.length >= 20) {
                        const regime = detectRegime(candles, (signal.timeframe as any) || "H1");
                        const volatility = analyzeVolatility(candles);
                        const vwap = calculateVWAP(candles);
                        const structure = detectStructure(candles, (signal.timeframe as any) || "H1");
                        const score = calculateMarketScore(candles, (signal.timeframe as any) || "H1");
                        analysis = { regime, volatility, vwap, structure, score };
                    }
                }
            } catch {}

            const transparencyData = {
                id: signal.id,
                symbol: signal.symbol || "N/A",
                direction: signal.direction || "N/A",
                confidence: signal.confidence || 0,
                winRate: signal.winRate || 0,
                result: signal.result || "pending",
                resultR: signal.resultR || 0,
                marketRegime: signal.marketRegime || "unknown",
                aiModel: signal.aiModel || getAIProvider().id,
                entryPrice: signal.entryPrice || null,
                stopLoss: signal.stopLoss || null,
                takeProfit: signal.takeProfit || null,
                timestamp: signal.createdAt || null,
                realTimeAnalysis: analysis,
                signalSource: "algo-signals",
                provider: getAIProvider().id,
                providerAvailable: Boolean(getAIProvider().isAvailable()),
            };
            transparency.push(transparencyData);
        }

        return NextResponse.json({ success: true, signals: transparency }, { status: 200 });
    } catch (err) {
        console.error("[signal-transparency]", err);
        return NextResponse.json({ error: "Signal transparency failed" }, { status: 500 });
    }
}
