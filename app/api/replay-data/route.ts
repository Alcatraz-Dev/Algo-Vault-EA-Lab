import { NextRequest, NextResponse } from "next/server";
import { fetchCandles } from "@/lib/market-data/normalizer";
import type { Timeframe, SupportedSymbol } from "@/lib/market-data/types";

const VALID_TIMEFRAMES: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];
const VALID_SYMBOLS: SupportedSymbol[] = [
  "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD",
  "US30", "NAS100", "SPX500", "BTCUSD", "ETHUSD",
];

export async function GET(request: NextRequest) {
  try {
    const symbol = (request.nextUrl.searchParams.get("symbol") || "XAUUSD") as SupportedSymbol;
    const timeframe = (request.nextUrl.searchParams.get("timeframe") || "H1") as Timeframe;
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "500"), 2000);
    const from = request.nextUrl.searchParams.get("from") ? Number(request.nextUrl.searchParams.get("from")) : undefined;
    const to = request.nextUrl.searchParams.get("to") ? Number(request.nextUrl.searchParams.get("to")) : undefined;

    if (!VALID_SYMBOLS.includes(symbol)) {
      return NextResponse.json({ error: `Invalid symbol. Supported: ${VALID_SYMBOLS.join(", ")}` }, { status: 400 });
    }
    if (!VALID_TIMEFRAMES.includes(timeframe)) {
      return NextResponse.json({ error: `Invalid timeframe. Supported: ${VALID_TIMEFRAMES.join(", ")}` }, { status: 400 });
    }

    const candles = await fetchCandles(symbol, timeframe, { from, to });

    // Limit to requested count
    const limited = candles.slice(-limit);

    return NextResponse.json({
      success: true,
      symbol,
      timeframe,
      count: limited.length,
      candles: limited,
    });
  } catch (err) {
    console.error("Replay data error:", err);
    return NextResponse.json({ error: "Failed to fetch replay data" }, { status: 500 });
  }
}
