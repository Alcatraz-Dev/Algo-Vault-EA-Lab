/**
 * /api/extension/evidence-score
 *
 * Deterministic Evidence Score Breakdown for the AlgoVault Pro Terminal.
 * Calculates condition alignment across 5 primary evidence categories:
 *   • STRUCTURE (0..10)
 *   • LIQUIDITY (0..10)
 *   • MOMENTUM (0..10)
 *   • HTF ALIGNMENT (0..10)
 *   • VOLATILITY (0..10)
 *
 * CRITICAL STANDARD:
 * This represents evidence and condition alignment.
 * It is NEVER described as a win probability, profit probability, or guarantee.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { computeSeriesIndicator } from "@/lib/analytics/indicators";
import { SUPPORTED_SYMBOLS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

async function isPro(uid: string): Promise<boolean> {
  try {
    const roleSnap = await adminDatabase.ref(`users/${uid}/role`).get();
    if (roleSnap.exists() && roleSnap.val() === "admin") return true;
    const subSnap = await adminDatabase.ref(`users/${uid}/subscription`).get();
    if (!subSnap.exists()) return false;
    const sub = subSnap.val();
    const active = sub?.status === "active" || sub?.status === "trialing" || sub?.active === true;
    const eligible = !sub?.plan || ["pro", "elite", "enterprise", "vip"].includes(String(sub.plan).toLowerCase());
    return Boolean(active && eligible);
  } catch {
    return false;
  }
}

const SUPPORTED_SET = new Set<string>(SUPPORTED_SYMBOLS);

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: corsHeaders });
    }
    const uid = decoded.uid;

    if (!(await isPro(uid))) {
      return NextResponse.json({ error: "pro_required" }, { status: 403, headers: corsHeaders });
    }

    const body = (await request.json().catch(() => ({}))) as { symbol?: string; timeframe?: string };
    const symbol = (typeof body.symbol === "string" ? body.symbol.trim() : "").toUpperCase();
    const timeframe = typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1";

    if (!symbol || !SUPPORTED_SET.has(symbol)) {
      return NextResponse.json(
        { error: "unsupported_symbol", message: "Symbol not supported for deterministic evidence score." },
        { status: 400, headers: corsHeaders }
      );
    }

    const candles = await fetchCandles(symbol as SupportedSymbol, timeframe as Timeframe);
    if (!candles || candles.length < 30) {
      return NextResponse.json(
        { error: "insufficient_data", message: "Insufficient historical bars to compute evidence score." },
        { status: 400, headers: corsHeaders }
      );
    }

    const events = detectStructure(candles, timeframe as Timeframe);
    const bias = getOverallStructureBias(events);
    const liquidity = detectLiquidity(candles, timeframe as Timeframe);
    const rsi = computeSeriesIndicator("rsi", candles, [{ key: "length", value: 14 }]).value;
    const ema50 = computeSeriesIndicator("ema", candles, [{ key: "length", value: 50 }]).value;
    const ema200 = computeSeriesIndicator("ema", candles, [{ key: "length", value: 200 }]).value;
    const atr = computeSeriesIndicator("atr", candles, [{ key: "length", value: 14 }]).value;

    // STRUCTURE (0..10)
    let structureScore = 5;
    let structureLabel = "Neutral consolidation";
    if (bias === "bullish") {
      structureScore = 8;
      structureLabel = "Bullish structure aligned";
    } else if (bias === "bearish") {
      structureScore = 8;
      structureLabel = "Bearish structure aligned";
    }
    if (events.length >= 3) structureScore = Math.min(10, structureScore + 1);

    // LIQUIDITY (0..10)
    let liquidityScore = 4;
    let liquidityLabel = "No recent sweep pool";
    if (liquidity.sweeps && liquidity.sweeps.length > 0) {
      liquidityScore = 9;
      liquidityLabel = `${liquidity.sweeps.length} sweep(s) observed`;
    } else if (liquidity.levels && liquidity.levels.length > 0) {
      liquidityScore = 6;
      liquidityLabel = `${liquidity.levels.length} active liquidity pool(s)`;
    }

    // MOMENTUM (0..10)
    let momentumScore = 5;
    let momentumLabel = "Neutral momentum";
    if (typeof rsi === "number") {
      if (rsi >= 45 && rsi <= 65) {
        momentumScore = 8;
        momentumLabel = `Healthy expansion (${rsi.toFixed(1)})`;
      } else if (rsi > 70) {
        momentumScore = 5;
        momentumLabel = `Overbought (${rsi.toFixed(1)})`;
      } else if (rsi < 30) {
        momentumScore = 5;
        momentumLabel = `Oversold (${rsi.toFixed(1)})`;
      } else {
        momentumScore = 6;
        momentumLabel = `RSI (${rsi.toFixed(1)})`;
      }
    }

    // HTF ALIGNMENT (0..10)
    let htfScore = 5;
    let htfLabel = "Neutral EMA stack";
    if (typeof ema50 === "number" && typeof ema200 === "number") {
      if (bias === "bullish" && ema50 > ema200) {
        htfScore = 9;
        htfLabel = "Aligned (EMA 50 > 200)";
      } else if (bias === "bearish" && ema50 < ema200) {
        htfScore = 9;
        htfLabel = "Aligned (EMA 50 < 200)";
      } else if (ema50 !== ema200) {
        htfScore = 6;
        htfLabel = "Partial divergence with HTF EMA";
      }
    }

    // VOLATILITY (0..10)
    let volatilityScore = 7;
    let volatilityLabel = "Moderate expansion";
    if (typeof atr === "number" && atr > 0) {
      const lastBar = candles[candles.length - 1];
      const barRange = lastBar.high - lastBar.low;
      if (barRange > atr * 1.8) {
        volatilityScore = 5;
        volatilityLabel = "Elevated volatility spike";
      } else if (barRange < atr * 0.4) {
        volatilityScore = 4;
        volatilityLabel = "Low volatility compression";
      } else {
        volatilityScore = 8;
        volatilityLabel = "Optimal regime";
      }
    }

    const categories = [
      { name: "STRUCTURE" as const, score: structureScore, maxScore: 10, label: structureLabel },
      { name: "LIQUIDITY" as const, score: liquidityScore, maxScore: 10, label: liquidityLabel },
      { name: "MOMENTUM" as const, score: momentumScore, maxScore: 10, label: momentumLabel },
      { name: "HTF ALIGNMENT" as const, score: htfScore, maxScore: 10, label: htfLabel },
      { name: "VOLATILITY" as const, score: volatilityScore, maxScore: 10, label: volatilityLabel },
    ];

    return NextResponse.json(
      {
        categories,
        disclaimer: "Evidence visualization summarizes currently detected conditions. It is not a prediction.",
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("[POST /api/extension/evidence-score]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "server_error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
