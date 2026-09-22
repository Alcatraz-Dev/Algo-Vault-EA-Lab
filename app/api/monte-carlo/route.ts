import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { computeMetrics } from "@/lib/strategy-lab/metrics";
import { BacktestTrade, EquityPoint } from "@/lib/strategy-lab/types";
import type { AISignal } from "@/lib/ai-signals/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SimulationRow {
    finalR: number;
    maxDD: number;
    isNegative: boolean;
    maxLosingStreak: number;
}

interface MonteCarloSummary {
    tradeCount: number;
    avgR: number;
    stdR: number;
    totalR: number;
    numSimulations: number;
    simulations: SimulationRow[];
    confidenceIntervals?: Record<string, { maxDD?: number; finalReturn?: number }>;
    probabilityOfRuin?: number;
    expectedMaxDD?: number;
    worstSimulatedDD?: number;
    probabilityOfNegativePeriod?: number;
    losingStreakProbability?: number;
    medianFinalR?: number;
    bestCaseR?: number;
    worstCaseR?: number;
}

function seededRandom(seed: number) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json() as {
            trades?: BacktestTrade[];
            numSimulations?: number;
            confidenceLevels?: number[];
        };

        const trades = body.trades || [];
        const numSims = body.numSimulations || 10000;
        const confidenceLevels = body.confidenceLevels || [50, 90, 95, 99];

        if (trades.length < 10) {
            return NextResponse.json({
                error: "Need at least 10 trades for Monte Carlo analysis",
                tradeCount: trades.length,
            }, { status: 400 });
        }

        const initialBalance = trades[0]?.id ? 10000 : 10000;
        const rValues = trades.map((t) => t.profitR);
        const avgR = rValues.reduce((a, b) => a + b, 0) / rValues.length;
        const stdR = Math.sqrt(rValues.reduce((a, b) => a + Math.pow(b - avgR, 2), 0) / rValues.length);

        const summary: MonteCarloSummary = {
            tradeCount: trades.length,
            avgR,
            stdR,
            totalR: rValues.reduce((a, b) => a + b, 0),
            numSimulations: numSims,
            simulations: [],
        };

        for (let sim = 0; sim < numSims; sim++) {
            const seed = Date.now() + sim * 7919;
            let equity = initialBalance;
            let peak = equity;
            let maxDD = 0;
            let isNegative = false;
            let finalR = 0;
            let losingStreak = 0;
            let maxLosingStreak = 0;

            for (let i = 0; i < rValues.length; i++) {
                const idx = Math.floor(seededRandom(seed + i * 137) * rValues.length);
                const r = rValues[idx];
                equity += r * 100;
                finalR += r;
                peak = Math.max(peak, equity);
                const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
                maxDD = Math.max(maxDD, dd);
                if (equity <= 0) { isNegative = true; break; }
                if (r < 0) { losingStreak++; maxLosingStreak = Math.max(maxLosingStreak, losingStreak); }
                else { losingStreak = 0; }
            }

            summary.simulations.push({
                finalR: Math.round(finalR * 100) / 100,
                maxDD: Math.round(maxDD * 10) / 10,
                isNegative,
                maxLosingStreak,
            });
        }

        const sortedDDs = summary.simulations.map((s) => s.maxDD).sort((a, b) => a - b);
        const sortedFinals = summary.simulations.map((s) => s.finalR).sort((a, b) => a - b);
        const negatives = summary.simulations.filter((s) => s.isNegative).length;

        summary.confidenceIntervals = {};
        for (const cl of confidenceLevels) {
            const idx = Math.floor((100 - cl) / 100 * sortedDDs.length);
            summary.confidenceIntervals[`${cl}%`] = {
                maxDD: sortedDDs[Math.min(idx, sortedDDs.length - 1)],
                finalReturn: sortedFinals[Math.min(Math.floor(cl / 100 * sortedFinals.length), sortedFinals.length - 1)],
            };
        }

        summary.probabilityOfRuin = (negatives / numSims) * 100;
        summary.expectedMaxDD = sortedDDs[Math.floor(sortedDDs.length * 0.95)];
        summary.worstSimulatedDD = sortedDDs[sortedDDs.length - 1];
        summary.probabilityOfNegativePeriod = summary.probabilityOfRuin;
        summary.losingStreakProbability = summary.simulations.filter((s) => s.maxLosingStreak >= 5).length / numSims * 100;
        summary.medianFinalR = sortedFinals[Math.floor(sortedFinals.length / 2)];
        summary.bestCaseR = sortedFinals[sortedFinals.length - 1];
        summary.worstCaseR = sortedFinals[0];

        return NextResponse.json({
            success: true,
            monteCarlo: summary,
            note: "Simulations are statistical estimates, not guarantees of future performance.",
        }, { status: 200 });
    } catch (err: unknown) {
        console.error("[monte-carlo]", err);
        return NextResponse.json({ error: "Monte Carlo analysis failed" }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const signalSnap = await adminDatabase.ref("aiSignals").get();
        const signals: AISignal[] = [];
        if (signalSnap.exists()) {
            signalSnap.forEach((child) => {
                const s = child.val() as AISignal | null;
                if (s && s.id) signals.push(s);
            });
        }
        const completed = signals.filter((s) => s.result && s.result !== "PENDING").slice(-100);
        const trades: BacktestTrade[] = completed.map((s, i) => ({
            id: `mc_${i}`,
            ticket: i + 1,
            openBarIndex: 0,
            closeBarIndex: 0,
            openedAt: s.createdAt || Date.now(),
            closedAt: s.completedAt || Date.now(),
            symbol: s.symbol,
            direction: s.direction === "BUY" ? "BUY" : "SELL",
            volume: 0.1,
            entry: s.entry || 0,
            sl: s.stopLoss || 0,
            tp1: s.tp1 || 0,
            tp2: s.tp2 || 0,
            tp3: s.tp3 || 0,
            exit: s.currentPrice || s.entry || 0,
            exitReason: s.result === "WIN" ? "tp1" : s.result === "LOSS" ? "sl" : "end_of_data",
            profit: Number(s.resultR || 0) * 100,
            profitR: Number(s.resultR || 0),
            durationMs: (s.completedAt || Date.now()) - (s.createdAt || Date.now()),
            regime: s.marketRegime || "transitional",
            session: "unknown",
            spreadCost: 0,
            commission: 0,
            slippageCost: 0,
            pnlGross: Number(s.resultR || 0) * 100,
        }));

        return NextResponse.json({
            success: true,
            trades: trades.length,
            sampleTrades: trades.slice(0, 5),
        }, { status: 200 });
    } catch (err: unknown) {
        console.error("[monte-carlo GET]", err);
        return NextResponse.json({ error: "Failed to load trade data" }, { status: 500 });
    }
}
