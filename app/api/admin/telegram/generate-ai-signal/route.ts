import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { generateAiMarketSignal } from "@/features/telegram-signals/generator/ai-signal-generator";
import { processIncomingTelegramMessage } from "@/features/telegram-signals/signals/signal-engine";

const SUPPORTED_SYMBOLS = [
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD",
    "US30", "NAS100", "SPX500", "BTCUSD", "ETHUSD",
];

export async function POST(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const { symbol, timeframe, style, notes, publish } = body;

        if (!symbol || typeof symbol !== "string" || !symbol.trim()) {
            return NextResponse.json(
                { error: "symbol parameter is required" },
                { status: 400 }
            );
        }

        const normalizedSymbol = symbol.trim().toUpperCase();

        const spec = getSymbolSpec(normalizedSymbol);
        if (!spec) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Unknown symbol: ${normalizedSymbol}. Supported symbols: ${SUPPORTED_SYMBOLS.join(", ")}`,
                    supportedSymbols: SUPPORTED_SYMBOLS,
                },
                { status: 400 }
            );
        }

        const siteNameSnap = await adminDatabase.ref("settings/siteName").once("value");
        const siteName = (siteNameSnap.val() || "AlgoVault").trim();
        const channelBrandName = `By ${siteName}`;

        const generatedSignal = await generateAiMarketSignal({
            symbol: normalizedSymbol,
            timeframe: timeframe || "H1",
            style: style || "INTRADAY",
            notes: notes || "",
        });

        let publishedSignal = null;
        if (publish) {
            if (generatedSignal.confidence <= 0) {
                return NextResponse.json({
                    success: false,
                    siteName,
                    channelBrandName,
                    generatedSignal,
                    publishedSignal: null,
                    published: false,
                    error: "Signal generation blocked — live market data unavailable or stale. Real-time market prices are required for AI signal generation.",
                }, { status: 422 });
            }

            const ingestResult = await processIncomingTelegramMessage({
                userId: "system",
                rawText: generatedSignal.rawText,
                sourceMetadata: {
                    sourceId: "ai_market_generator",
                    sourceType: "custom_webhook",
                    channelName: channelBrandName,
                },
                broadcast: true,
            });

            if (ingestResult.success && ingestResult.signal) {
                publishedSignal = ingestResult.signal;
            }
        }

        return NextResponse.json({
            success: true,
            siteName,
            channelBrandName,
            generatedSignal,
            publishedSignal,
            published: Boolean(publish && publishedSignal),
        });
    } catch (err: unknown) {
        console.error("[POST /api/admin/telegram/generate-ai-signal]", err);
        return NextResponse.json(
            { error: (err instanceof Error ? err.message : "Internal server error") || "Internal server error" },
            { status: 500 }
        );
    }
}
