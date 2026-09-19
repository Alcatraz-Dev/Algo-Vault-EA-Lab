import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";

const SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "US30", "NAS100", "AUDUSD", "USDCAD"];

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const results: Record<string, { bid: number; ask: number; spread: number; spreadPips: number; change24h: number; high24h: number; low24h: number }> = {};

        for (const symbol of SYMBOLS) {
            try {
                const res = await fetch(`https://biquote.io/api/${symbol}/ohlc?interval=1d&limit=2`);
                if (!res.ok) continue;
                const data = await res.json();
                const bars = data.bars || [];
                if (bars.length === 0) continue;

                const sorted = bars.sort((a: any, b: any) => Date.parse(a.openTime) - Date.parse(b.openTime));
                const latest = sorted[sorted.length - 1];
                const prev = sorted.length > 1 ? sorted[sorted.length - 2] : latest;

                const close = Number(latest.close);
                const open = Number(latest.open);
                const high = Number(latest.high);
                const low = Number(latest.low);
                const prevClose = Number(prev.close);

                const spread = Math.abs(close - open) * 0.1;
                const pipSize = symbol === "USDJPY" || symbol === "XAUUSD" ? 0.01 : 0.0001;
                const spreadPips = spread / pipSize;
                const change24h = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;

                results[symbol] = {
                    bid: Number(close.toFixed(symbol.includes("JPY") || symbol === "XAUUSD" ? 3 : symbol.includes("BTC") || symbol.includes("ETH") ? 2 : 5)),
                    ask: Number((close + spread).toFixed(symbol.includes("JPY") || symbol === "XAUUSD" ? 3 : symbol.includes("BTC") || symbol.includes("ETH") ? 2 : 5)),
                    spread: Number(spread.toFixed(5)),
                    spreadPips: Number(spreadPips.toFixed(1)),
                    change24h: Number(change24h.toFixed(2)),
                    high24h: high,
                    low24h: low,
                };
            } catch {}
        }

        return NextResponse.json({ success: true, spreads: results, timestamp: Date.now() });
    } catch (err) {
        console.error("Spread monitor error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
