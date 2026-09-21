import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

type LivePricePayload = {
    symbol: string;
    exchange?: string;
    price: number;
    bid?: number;
    ask?: number;
    spread?: number;
    timestamp: number;
    timeframe?: string;
    source: "tradingview-legend" | "tradingview-widget";
};

export async function POST(request: NextRequest) {
    try {
        const authorization = request.headers.get("authorization");
        if (!authorization?.startsWith("Bearer ")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const token = await adminAuth.verifyIdToken(authorization.slice(7).trim());
        const payload = await request.json() as LivePricePayload;

        if (!payload.symbol || typeof payload.price !== "number" || payload.price <= 0) {
            return NextResponse.json({ success: false, error: "Invalid payload: symbol and price are required" }, { status: 400 });
        }

        const symbol = payload.symbol.toUpperCase().trim();
        const exchange = payload.exchange?.toUpperCase().trim() || "TRADINGVIEW";
        const key = `${exchange}:${symbol}`;

        const priceData = {
            symbol,
            exchange,
            price: payload.price,
            bid: payload.bid ?? payload.price,
            ask: payload.ask ?? payload.price,
            spread: payload.spread ?? Math.max(0, (payload.ask ?? payload.price) - (payload.bid ?? payload.price)),
            timestamp: payload.timestamp || Date.now(),
            timeframe: payload.timeframe || "M1",
            source: payload.source || "tradingview-legend",
            receivedAt: Date.now(),
            userId: token.uid,
        };

        await adminDatabase.ref(`tradingview_live_prices/${key}`).set(priceData);

        return NextResponse.json({ success: true, key });
    } catch (error) {
        console.error("[POST /api/tradingview/live-price]", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal server error" },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    try {
        const symbol = new URL(request.url).searchParams.get("symbol")?.toUpperCase().trim();
        const exchange = new URL(request.url).searchParams.get("exchange")?.toUpperCase().trim() || "TRADINGVIEW";

        if (!symbol) {
            return NextResponse.json({ success: false, error: "symbol parameter is required" }, { status: 400 });
        }

        const key = `${exchange}:${symbol}`;
        const snapshot = await adminDatabase.ref(`tradingview_live_prices/${key}`).get();

        if (!snapshot.exists()) {
            return NextResponse.json({ success: false, error: "No live price data available", symbol, exchange }, { status: 404 });
        }

        const data = snapshot.val();
        const ageMs = Date.now() - (data.receivedAt || data.timestamp || 0);

        return NextResponse.json({
            success: true,
            data: {
                ...data,
                dataAgeMs: ageMs,
                isFresh: ageMs < 30000,
            },
        });
    } catch (error) {
        console.error("[GET /api/tradingview/live-price]", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal server error" },
            { status: 500 }
        );
    }
}