import { NextRequest, NextResponse } from "next/server";

const BIQUOTE_BASE = "https://biquote.io/api";

type QuoteData = {
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    change: number;
    changePercent: number;
    timestamp: number;
};

type OhlcBar = {
    openTime?: string;
    close?: unknown;
};

export async function GET(request: NextRequest) {
    try {
        const symbolsParam = request.nextUrl.searchParams.get("symbols") || "XAUUSD,EURUSD,GBPUSD";
        const symbols = symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

        if (symbols.length === 0) {
            return NextResponse.json({ success: true, quotes: {} });
        }

        const quotes: Record<string, QuoteData> = {};

        const fetchPromises = symbols.map(async (symbol) => {
            try {
                const res = await fetch(`${BIQUOTE_BASE}/${symbol}/ohlc?interval=1h&limit=5`, {
                    next: { revalidate: 10 },
                });
                if (!res.ok) return;

                const data = (await res.json()) as { bars?: OhlcBar[] };
                const bars = data.bars || [];
                if (bars.length === 0) return;

                const sorted = bars.sort((a, b) => Date.parse(a.openTime || "") - Date.parse(b.openTime || ""));
                const lastBar = sorted[sorted.length - 1];
                const prevBar = sorted.length > 1 ? sorted[sorted.length - 2] : lastBar;

                const bid = Number(lastBar.close);
                const spread = bid >= 100 ? 0.20 : bid >= 1 ? 0.00020 : 0.00002;
                const ask = bid + spread;
                const change = bid - Number(prevBar.close);
                const changePercent = Number(prevBar.close) !== 0 ? (change / Number(prevBar.close)) * 100 : 0;

                quotes[symbol] = {
                    symbol,
                    bid: Number(bid.toFixed(bid >= 100 ? 2 : bid >= 1 ? 5 : 6)),
                    ask: Number(ask.toFixed(ask >= 100 ? 2 : ask >= 1 ? 5 : 6)),
                    spread: Number(spread.toFixed(spread >= 1 ? 2 : 6)),
                    change: Number(change.toFixed(5)),
                    changePercent: Number(changePercent.toFixed(3)),
                    timestamp: Date.parse(lastBar.openTime || ""),
                };
            } catch {}
        });

        await Promise.allSettled(fetchPromises);

        return NextResponse.json({
            success: true,
            quotes,
            count: Object.keys(quotes).length,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error("Watchlist API error:", err);
        return NextResponse.json({ error: "Failed to fetch watchlist" }, { status: 500 });
    }
}
