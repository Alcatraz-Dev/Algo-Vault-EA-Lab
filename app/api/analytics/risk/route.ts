import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type RiskMetrics = {
    accountBalance: number;
    accountEquity: number;
    marginUsed: number;
    marginFree: number;
    marginLevel: number;
    floatingPnl: number;
    drawdown: number;
    maxDrawdown: number;
    riskPerPosition: { symbol: string; risk: number; type: string; volume: number }[];
    totalRiskExposure: number;
    marginUtilization: number;
    freeMarginPercent: number;
    marginCallDistance: number;
    positionsAtRisk: number;
    totalPositions: number;
    hedgedPositions: number;
    unhedgedExposure: number;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const accountId = request.nextUrl.searchParams.get("accountId");
        if (!accountId) {
            return NextResponse.json({ error: "accountId required" }, { status: 400 });
        }

        const accountRef = adminDatabase.ref(`trading_accounts/${user.uid}/${accountId}`);
        const accountSnap = await accountRef.get();

        if (!accountSnap.exists()) {
            return NextResponse.json({ error: "Account not found" }, { status: 404 });
        }

        const acc = accountSnap.val() as Record<string, unknown>;
        const balance = Number(acc.balance || 0);
        const equity = Number(acc.equity || 0);
        const marginUsed = Number(acc.margin || 0);
        const marginFree = Number(acc.freeMargin || 0);
        const marginLevel = Number(acc.marginLevel || 0);
        const floatingPnl = equity - balance;
        const drawdown = balance > 0 ? ((balance - equity) / balance) * 100 : 0;
        const marginUtilization = balance > 0 ? (marginUsed / balance) * 100 : 0;
        const freeMarginPercent = balance > 0 ? (marginFree / balance) * 100 : 0;
        const marginCallDistance = marginLevel > 0 ? Math.max(0, marginLevel - 100) : 0;

        const positionsRef = adminDatabase.ref(`trading_positions/${user.uid}/${accountId}`);
        const posSnap = await positionsRef.get();

        const riskPerPosition: RiskMetrics["riskPerPosition"] = [];
        let totalRiskExposure = 0;
        let totalPositions = 0;
        let positionsAtRisk = 0;
        let hedgedPositions = 0;
        let buyVolume = 0;
        let sellVolume = 0;

        if (posSnap.exists()) {
            const positions = posSnap.val();
            for (const [, pos] of Object.entries(positions)) {
                const p = pos as Record<string, unknown>;
                const symbol = String(p.symbol || "");
                const type = String(p.type || "");
                const volume = Number(p.volume || 0);
                const sl = Number(p.sl || 0);
                const currentPrice = Number(p.currentPrice || 0);
                const openPrice = Number(p.openPrice || 0);
                const profit = Number(p.profit || 0);

                let risk = 0;
                if (sl > 0 && currentPrice > 0) {
                    risk = Math.abs(currentPrice - sl) * volume * 100;
                } else if (openPrice > 0 && currentPrice > 0) {
                    risk = Math.abs(openPrice - currentPrice) * volume * 100;
                }

                totalRiskExposure += risk;
                totalPositions++;

                if (type === "BUY") buyVolume += volume;
                else sellVolume += volume;

                if (risk > balance * 0.05) positionsAtRisk++;

                riskPerPosition.push({ symbol, risk: Number(risk.toFixed(2)), type, volume });
            }
        }

        const unhedgedExposure = Math.abs(buyVolume - sellVolume);
        if (buyVolume > 0 && sellVolume > 0) hedgedPositions = Math.min(buyVolume, sellVolume) * 2;

        return NextResponse.json({
            success: true,
            risk: {
                accountBalance: balance,
                accountEquity: equity,
                marginUsed,
                marginFree,
                marginLevel,
                floatingPnl: Number(floatingPnl.toFixed(2)),
                drawdown: Number(drawdown.toFixed(2)),
                maxDrawdown: Number(drawdown.toFixed(2)),
                riskPerPosition: riskPerPosition.sort((a, b) => b.risk - a.risk),
                totalRiskExposure: Number(totalRiskExposure.toFixed(2)),
                marginUtilization: Number(marginUtilization.toFixed(2)),
                freeMarginPercent: Number(freeMarginPercent.toFixed(2)),
                marginCallDistance: Number(marginCallDistance.toFixed(2)),
                positionsAtRisk,
                totalPositions,
                hedgedPositions: Number(hedgedPositions.toFixed(2)),
                unhedgedExposure: Number(unhedgedExposure.toFixed(2)),
            },
        });
    } catch (err) {
        console.error("Risk API error:", err);
        return NextResponse.json({ error: "Failed to calculate risk" }, { status: 500 });
    }
}
