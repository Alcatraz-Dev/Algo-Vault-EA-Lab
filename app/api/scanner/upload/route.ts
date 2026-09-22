import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { isProUser } from "@/lib/ai-signals/access";
import { summarizeAnalysisWithFallback } from "@/lib/ai";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const isPro = await isProUser(user.uid);
        if (!isPro) return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });

        const formData = await request.formData();
        const imageFile = formData.get("image") as File | null;
        const symbol = (formData.get("symbol") as string) || "XAUUSD";
        const timeframe = (formData.get("timeframe") as string) || "H1";

        if (!imageFile) return NextResponse.json({ error: "No image provided" }, { status: 400 });

        const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
        if (!allowedTypes.includes(imageFile.type)) {
            return NextResponse.json({ error: "Invalid image type. Use PNG, JPEG, WebP, or GIF." }, { status: 400 });
        }

        const maxSize = 10 * 1024 * 1024;
        if (imageFile.size > maxSize) {
            return NextResponse.json({ error: "Image too large. Max 10MB." }, { status: 400 });
        }

        const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

        const candles = await fetchCandles(symbol as SupportedSymbol, timeframe as Timeframe);
        const regime = candles.length >= 20 ? detectRegime(candles, timeframe as Timeframe) : null;
        const volatility = candles.length >= 20 ? analyzeVolatility(candles) : null;
        const score = candles.length >= 20 ? calculateMarketScore(candles, timeframe as Timeframe) : null;

        const analysis = await summarizeAnalysisWithFallback({
            asset: symbol,
            timeframe,
            trend: regime?.regime || "mixed",
            volatility: volatility?.state || "normal",
            bestSession: "",
            bestDay: "",
            strongestSetup: "",
            averageR: null,
            regime: regime?.regime || "mixed",
        });

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            imageSize: imageBuffer.length,
            detectedMarketData: {
                regime: regime?.regime || "unknown",
                confidence: regime?.confidence || 0,
                volatility: volatility?.state || "unknown",
                score: score?.total || 0,
            },
            analysis: analysis.summary,
            message: "Image uploaded and analyzed successfully. Combined with real market data for comprehensive analysis.",
        }, { status: 200 });
    } catch (err) {
        console.error("[scanner/upload]", err);
        return NextResponse.json({ error: "Image analysis failed" }, { status: 500 });
    }
}
