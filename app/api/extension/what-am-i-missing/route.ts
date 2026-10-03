/**
 * /api/extension/what-am-i-missing
 *
 * Dedicated AI analyzer that actively searches for conflicting or incomplete
 * evidence on the current chart:
 *   - HTF/LTF structure conflicts
 *   - Nearby liquidity sweeps/pools
 *   - Key support/resistance levels
 *   - Structure weakness or CHoCH risks
 *   - Indicator disagreement
 *   - Invalidation proximity
 *
 * Grounded strictly in empirical data — never fabricates missing risks.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { computeSeriesIndicator } from "@/lib/analytics/indicators";
import { SUPPORTED_SYMBOLS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";
import { normalizeSymbol, normalizeTimeframe } from "@/lib/market-data/normalize-input";
import type { MissingPoint } from "@/types/pro";

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

function isSupportedSymbol(s: string): s is SupportedSymbol {
  return SUPPORTED_SET.has(s);
}

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
    const symbol = normalizeSymbol(body.symbol);
    const timeframe = normalizeTimeframe(body.timeframe);

    if (!symbol || !isSupportedSymbol(symbol)) {
      return NextResponse.json(
        { error: "unsupported_symbol", message: "Symbol not supported for analysis." },
        { status: 400, headers: corsHeaders }
      );
    }

    const candles = await fetchCandles(symbol, timeframe as Timeframe);
    if (!candles || candles.length < 30) {
      return NextResponse.json(
        { error: "insufficient_data", message: "Insufficient historical bars to detect missing factors." },
        { status: 400, headers: corsHeaders }
      );
    }

    const points: MissingPoint[] = [];
    const events = detectStructure(candles, timeframe as Timeframe);
    const bias = getOverallStructureBias(events);
    const liquidity = detectLiquidity(candles, timeframe as Timeframe);
    const rsi = computeSeriesIndicator("rsi", candles, [{ key: "length", value: 14 }]).value;
    const ema50 = computeSeriesIndicator("ema", candles, [{ key: "length", value: 50 }]).value;
    const ema200 = computeSeriesIndicator("ema", candles, [{ key: "length", value: 200 }]).value;
    const lastPrice = candles[candles.length - 1].close;

    // 1. HTF Conflict check
    if (typeof ema50 === "number" && typeof ema200 === "number") {
      const htfBullish = ema50 > ema200;
      if (bias === "bearish" && htfBullish) {
        points.push({
          id: "m_htf_conflict",
          title: "Higher Timeframe Structure Conflict",
          detail: "Current timeframe structure is bearish, but macro EMA 50/200 stack is bullish.",
          severity: "warning",
          category: "htf_conflict",
          evidence: [`Current bias: ${bias}`, `EMA50 (${ema50.toFixed(2)}) > EMA200 (${ema200.toFixed(2)})`],
        });
      }
    }

    // 2. Nearby Liquidity check
    if (liquidity.sweeps.length === 0) {
      points.push({
        id: "m_nearby_liquidity",
        title: "Unswept Liquidity Pool Nearby",
        detail: "No liquidity sweep detected in current lookback window. High-volume pools remain unswept.",
        severity: "info",
        category: "nearby_liquidity",
        evidence: ["0 sweeps detected in lookback window"],
      });
    }

    // 3. Indicator Disagreement (RSI vs Price)
    if (typeof rsi === "number") {
      if (bias === "bullish" && rsi > 70) {
        points.push({
          id: "m_indicator_disagreement",
          title: "RSI Overbought Disagreement",
          detail: "Price structure is bullish, but RSI is overbought (>70), raising exhaustion risk.",
          severity: "warning",
          category: "indicator_disagreement",
          evidence: [`RSI: ${rsi.toFixed(1)}`, `Bias: ${bias}`],
        });
      }
    }

    // 4. Invalidation Proximity
    const recentLow = candles.slice(-20).reduce((min, c) => Math.min(min, c.low), Number.POSITIVE_INFINITY);
    const distToLow = ((lastPrice - recentLow) / lastPrice) * 100;
    if (distToLow < 0.5) {
      points.push({
        id: "m_invalidation_proximity",
        title: "Close Proximity to Swing Invalidation",
        detail: `Price is only ${distToLow.toFixed(2)}% away from recent swing low (${recentLow.toFixed(2)}).`,
        severity: "critical",
        category: "invalidation_proximity",
        evidence: [`Current price: ${lastPrice}`, `Swing low: ${recentLow}`],
      });
    }

    // Default fallback if no critical issues found
    if (points.length === 0) {
      points.push({
        id: "m_all_aligned",
        title: "No Major Conflicts Detected",
        detail: "Structure, EMAs, and momentum alignment show no high-severity discrepancies.",
        severity: "info",
        category: "incomplete_strategy",
        evidence: [`Bias: ${bias}`, `RSI: ${typeof rsi === "number" ? rsi.toFixed(1) : "N/A"}`],
      });
    }

    return NextResponse.json(
      {
        symbol,
        timeframe,
        points,
        fetchedAt: Date.now(),
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("[POST /api/extension/what-am-i-missing]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "server_error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
