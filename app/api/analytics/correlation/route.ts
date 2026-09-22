import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";

const SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "US30", "NAS100"];

type OhlcBar = {
    close?: unknown;
    openTime?: string;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const ohlcvData: Record<string, number[]> = {};

        for (const symbol of SYMBOLS) {
            try {
                const res = await fetch(`https://biquote.io/api/${symbol}/ohlc?interval=1d&limit=30`);
                if (res.ok) {
                    const data = (await res.json()) as { bars?: OhlcBar[] };
                    const bars = data.bars || [];
                    ohlcvData[symbol] = bars.map((b) => Number(b.close));
                }
            } catch {}
        }

        const matrix: Record<string, Record<string, number>> = {};

        for (const sym1 of SYMBOLS) {
            matrix[sym1] = {};
            for (const sym2 of SYMBOLS) {
                if (sym1 === sym2) {
                    matrix[sym1][sym2] = 1;
                    continue;
                }

                const data1 = ohlcvData[sym1] || [];
                const data2 = ohlcvData[sym2] || [];

                if (data1.length < 5 || data2.length < 5) {
                    matrix[sym1][sym2] = 0;
                    continue;
                }

                const returns1 = data1.slice(1).map((v, i) => (v - data1[i]) / data1[i]);
                const returns2 = data2.slice(1).map((v, i) => (v - data2[i]) / data2[i]);
                const len = Math.min(returns1.length, returns2.length);
                const r1 = returns1.slice(0, len);
                const r2 = returns2.slice(0, len);

                const mean1 = r1.reduce((a, b) => a + b, 0) / len;
                const mean2 = r2.reduce((a, b) => a + b, 0) / len;

                let cov = 0, std1 = 0, std2 = 0;
                for (let i = 0; i < len; i++) {
                    cov += (r1[i] - mean1) * (r2[i] - mean2);
                    std1 += (r1[i] - mean1) ** 2;
                    std2 += (r2[i] - mean2) ** 2;
                }

                const denom = Math.sqrt(std1 * std2);
                matrix[sym1][sym2] = denom > 0 ? Number((cov / denom).toFixed(4)) : 0;
            }
        }

        return NextResponse.json({ success: true, symbols: SYMBOLS, matrix });
    } catch (err) {
        console.error("Correlation matrix error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
