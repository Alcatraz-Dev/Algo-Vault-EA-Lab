import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";

const CURRENCY_PAIRS: Record<string, string[]> = {
    EUR: ["EURUSD", "EURGBP", "EURJPY", "EURAUD", "EURCAD", "EURCHF", "EURNZD"],
    USD: ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"],
    GBP: ["GBPUSD", "EURGBP", "GBPJPY", "GBPAUD", "GBPCAD", "GBPCHF", "GBPNZD"],
    JPY: ["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "CHFJPY", "NZDJPY"],
    AUD: ["AUDUSD", "EURAUD", "GBPAUD", "AUDJPY", "AUDCAD", "AUDCHF", "AUDNZD"],
    CAD: ["USDCAD", "EURCAD", "GBPCAD", "AUDCAD", "CADJPY", "CADCHF", "CADNZD"],
    CHF: ["USDCHF", "EURCHF", "GBPCHF", "AUDCHF", "CADCHF", "CHFJPY", "NZDCHF"],
    NZD: ["NZDUSD", "EURNZD", "GBPNZD", "AUDNZD", "CADNZD", "NZDJPY", "NZDCHF"],
};

type OhlcBar = {
    close?: unknown;
    openTime?: string;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const prices: Record<string, { close: number; change: number }> = {};

        // Fetch prices for all unique pairs
        const allPairs = [...new Set(Object.values(CURRENCY_PAIRS).flat())];
        for (const pair of allPairs) {
            try {
                const res = await fetch(`https://biquote.io/api/${pair}/ohlc?interval=1d&limit=2`, { signal: AbortSignal.timeout(3000) });
                if (!res.ok) continue;
                const data = (await res.json()) as { bars?: OhlcBar[] };
                const bars = data.bars || [];
                if (bars.length === 0) continue;
                const sorted = bars.sort((a, b) => Date.parse(a.openTime || "") - Date.parse(b.openTime || ""));
                const latest = sorted[sorted.length - 1];
                const prev = sorted.length > 1 ? sorted[sorted.length - 2] : latest;
                const close = Number(latest.close);
                const prevClose = Number(prev.close);
                prices[pair] = {
                    close,
                    change: prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0,
                };
            } catch {}
        }

        // Calculate currency strength
        const strength: Record<string, { score: number; change: number; pairs: { pair: string; change: number }[] }> = {};

        for (const [currency, pairs] of Object.entries(CURRENCY_PAIRS)) {
            let totalScore = 0;
            let totalChange = 0;
            let count = 0;
            const pairData: { pair: string; change: number }[] = [];

            for (const pair of pairs) {
                const p = prices[pair];
                if (!p) continue;

                const isBase = pair.startsWith(currency);
                const normalizedChange = isBase ? p.change : -p.change;

                // Score: positive change for base = strength, negative for quote = strength
                const score = normalizedChange > 0.5 ? 3 : normalizedChange > 0.2 ? 2 : normalizedChange > 0 ? 1 : normalizedChange > -0.2 ? -1 : normalizedChange > -0.5 ? -2 : -3;
                totalScore += score;
                totalChange += normalizedChange;
                count++;
                pairData.push({ pair, change: Number(normalizedChange.toFixed(3)) });
            }

            strength[currency] = {
                score: count > 0 ? Number((totalScore / count).toFixed(2)) : 0,
                change: count > 0 ? Number((totalChange / count).toFixed(3)) : 0,
                pairs: pairData.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
            };
        }

        return NextResponse.json({
            success: true,
            currencies: Object.entries(strength)
                .map(([currency, data]) => ({ currency, ...data }))
                .sort((a, b) => b.score - a.score),
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error("Currency strength error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
