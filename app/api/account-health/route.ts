import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { calculateVWAP } from "@/lib/analytics/vwap";
import { computeMetrics } from "@/lib/strategy-lab/metrics";
import { BacktestTrade } from "@/lib/strategy-lab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const uid = user.uid;

        const accountSnap = await adminDatabase.ref(`trading_accounts/${uid}`).get();
        const accounts = accountSnap.exists() ? accountSnap.val() : {};

        const positionSnap = await adminDatabase.ref(`trading_positions/${uid}`).get();
        const positions = positionSnap.exists() ? positionSnap.val() : {};

        const balanceSnap = await adminDatabase.ref(`users/${uid}/balance`).get();
        const balance = balanceSnap.exists() ? Number(balanceSnap.val()) : 0;

        const equitySnap = await adminDatabase.ref(`users/${uid}/equity`).get();
        const equity = equitySnap.exists() ? Number(equitySnap.val()) : balance;

        const drawdownSnap = await adminDatabase.ref(`users/${uid}/maxDrawdown`).get();
        const maxDrawdown = drawdownSnap.exists() ? Number(drawdownSnap.val()) : 0;

        const marginSnap = await adminDatabase.ref(`trading_accounts/${uid}/default/marginLevel`).get();
        const marginLevel = marginSnap.exists() ? Number(marginSnap.val()) : 0;

        const tradeSnap = await adminDatabase.ref(`tradeJournal/${uid}`).get();
        const trades = tradeSnap.exists() ? Object.values(tradeSnap.val()) : [];

        const signalSnap = await adminDatabase.ref("aiSignals").get();
        const signals: any[] = [];
        if (signalSnap.exists()) {
            signalSnap.forEach((child) => {
                const s = child.val();
                if (s && s.id) signals.push(s);
            });
        }
        const recentSignals = signals.filter((s) => s.createdAt > Date.now() - 30 * 86400000).slice(-50);

        const totalPositions = Object.keys(positions).length;
        let totalFloatingPnl = 0;
        let positionsAtRisk = 0;

        const positionList = Object.values(positions).map((p: any) => {
            const profit = Number(p.profit || 0);
            totalFloatingPnl += profit;
            const risk = Math.abs(Number(p.currentPrice || 0) - Number(p.sl || 0)) * Number(p.volume || 0);
            if (risk > balance * 0.05) positionsAtRisk++;
            return {
                symbol: p.symbol,
                type: p.type,
                volume: p.volume,
                profit,
                risk: Math.round(risk * 100) / 100,
            };
        });

        const floatingPnlPct = balance > 0 ? (totalFloatingPnl / balance) * 100 : 0;
        const drawdownPct = balance > 0 ? ((balance - equity) / balance) * 100 : 0;
        const marginUtilization = balance > 0 ? (Number(accounts.default?.margin || 0) / balance) * 100 : 0;

        const score = Math.max(0, Math.min(100,
            Math.round(
                100
                - Math.min(drawdownPct * 2, 30)
                - Math.min(marginUtilization * 0.5, 20)
                - Math.min(positionsAtRisk * 5, 15)
                - Math.max(0, totalPositions > 10 ? 10 : 0)
                + (totalFloatingPnl >= 0 ? 10 : 0)
                + (recentSignals.filter((s) => s.result === "WIN").length / Math.max(recentSignals.length, 1)) * 15
            )
        ));

        let riskLevel = "LOW";
        if (score < 50) riskLevel = "HIGH";
        else if (score < 70) riskLevel = "MODERATE";

        let drawdownStatus = "SAFE";
        if (drawdownPct > 15) drawdownStatus = "DANGER";
        else if (drawdownPct > 8) drawdownStatus = "WARNING";

        let marginStatus = "SAFE";
        if (marginLevel < 200) marginStatus = "DANGER";
        else if (marginLevel < 500) marginStatus = "WARNING";

        let exposureStatus = "MODERATE";
        if (totalPositions > 8) exposureStatus = "HIGH";
        else if (totalPositions > 5) exposureStatus = "MODERATE";
        else exposureStatus = "LOW";

        const recentWinRate = recentSignals.length > 0
            ? (recentSignals.filter((s) => s.result === "WIN").length / recentSignals.length * 100).toFixed(1)
            : "0";

        return NextResponse.json({
            success: true,
            health: {
                score,
                riskLevel,
                drawdownStatus,
                marginStatus,
                exposureStatus,
                metrics: {
                    balance,
                    equity,
                    floatingPnl: Math.round(totalFloatingPnl * 100) / 100,
                    floatingPnlPct: Math.round(floatingPnlPct * 10) / 10,
                    drawdown: Math.round(drawdownPct * 10) / 10,
                    maxDrawdown,
                    marginLevel,
                    marginUtilization: Math.round(marginUtilization * 10) / 10,
                    totalPositions,
                    positionsAtRisk,
                    openRisk: positionList.reduce((s: number, p: any) => s + p.risk, 0),
                },
                trading: {
                    totalSignals: recentSignals.length,
                    winRate: recentWinRate,
                    averageR: recentSignals.length > 0
                        ? (recentSignals.reduce((s, sig) => s + Number(sig.resultR || 0), 0) / recentSignals.length).toFixed(2)
                        : "0",
                },
                breakdown: {
                    drawdown: Math.round(Math.min(drawdownPct * 2, 30)),
                    margin: Math.round(Math.min(marginUtilization * 0.5, 20)),
                    exposure: Math.round(Math.min(positionsAtRisk * 5, 15) + Math.max(0, totalPositions > 10 ? 10 : 0)),
                    pnl: totalFloatingPnl >= 0 ? 10 : 0,
                    signalQuality: Math.round((recentSignals.filter((s) => s.result === "WIN").length / Math.max(recentSignals.length, 1)) * 15),
                },
            },
        }, { status: 200 });
    } catch (err: unknown) {
        console.error("[account-health]", err);
        return NextResponse.json({ error: "Account health check failed" }, { status: 500 });
    }
}
