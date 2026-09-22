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
import type { AISignal } from "@/lib/ai-signals/types";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TransparencyRow {
    id: string;
    symbol: string;
    direction: string;
    confidence: number;
    winRate: number;
    result: string;
    resultR: number;
    marketRegime: string;
    aiModel: string;
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    timestamp: number | null;
    realTimeAnalysis: object | null;
    signalSource: string;
    provider: string;
    providerAvailable: boolean;
}

/** aiSignals records as stored by the ETF/transparency update path (may carry extra stats fields). */
interface TransparencySignalRecord extends AISignal {
    winRate?: number;
    entryPrice?: number;
    takeProfit?: number;
    aiModel?: string;
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const signalSnap = await adminDatabase.ref("aiSignals").get();
        const signals: TransparencySignalRecord[] = [];
        if (signalSnap.exists()) {
            signalSnap.forEach((child) => {
                const s = child.val() as TransparencySignalRecord | null;
                if (s && s.id) signals.push(s);
            });
        }

        const recentSignals = signals.slice(-30);
        const transparency: TransparencyRow[] = [];

        for (const signal of recentSignals) {
            let analysis: object | null = null;
            try {
                if (signal.symbol) {
                    const candles = await fetchCandles(signal.symbol as SupportedSymbol, (signal.timeframe || "H1") as Timeframe);
                    if (candles.length >= 20) {
                        const regime = detectRegime(candles, (signal.timeframe || "H1") as Timeframe);
                        const volatility = analyzeVolatility(candles);
                        const vwap = calculateVWAP(candles);
                        const structure = detectStructure(candles, (signal.timeframe || "H1") as Timeframe);
                        const score = calculateMarketScore(candles, (signal.timeframe || "H1") as Timeframe);
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
