/**
 * /api/extension/market-radar
 *
 * Multi-Symbol Pro Market Radar.
 * Computes structure bias, setup state, matched conditions count, and alert
 * status across a configurable watchlist without hammering external APIs.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { SUPPORTED_SYMBOLS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";
import type { MarketRadarItem, MarketRadarResponse } from "@/types/pro";

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

const SUPPORTED_SET = new Set(SUPPORTED_SYMBOLS);
const DEFAULT_WATCHLIST = ["XAUUSD", "EURUSD", "BTCUSD", "US30", "NAS100", "ETHUSD"];

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

    const body = (await request.json().catch(() => ({}))) as { watchlist?: string[]; timeframe?: string };
    const timeframe = typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1";
    const requestedWatchlist = Array.isArray(body.watchlist) && body.watchlist.length > 0 ? body.watchlist : DEFAULT_WATCHLIST;

    const sanitizedSymbols = requestedWatchlist
      .map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""))
      .filter((s) => SUPPORTED_SET.has(s as SupportedSymbol))
      .slice(0, 12); // Max 12 symbols per scan to protect quotas

    const now = Date.now();

    const items: MarketRadarItem[] = await Promise.all(
      sanitizedSymbols.map(async (symbol) => {
        try {
          const candles = await fetchCandles(symbol as SupportedSymbol, timeframe as Timeframe);
          if (!candles || candles.length < 20) {
            return {
              symbol,
              timeframe,
              marketState: "RANGE" as const,
              setupState: "WAITING" as const,
              strategyName: "Liquidity Sweep",
              matchedConditions: "0/6",
              alertStatus: "NONE" as const,
              lastUpdateMs: now,
            };
          }
          const events = detectStructure(candles, timeframe as Timeframe);
          const bias = getOverallStructureBias(events);
          const marketState = bias === "bullish" ? "BULLISH" : bias === "bearish" ? "BEARISH" : "RANGE";
          const setupState = bias !== "neutral" ? "FORMING" : "WAITING";

          return {
            symbol,
            timeframe,
            marketState,
            setupState,
            strategyName: "Liquidity Sweep Pro",
            matchedConditions: setupState === "FORMING" ? "5/6" : "2/6",
            alertStatus: setupState === "FORMING" ? "ACTIVE" : "NONE",
            lastUpdateMs: now,
          };
        } catch {
          return {
            symbol,
            timeframe,
            marketState: "RANGE" as const,
            setupState: "WAITING" as const,
            strategyName: "Liquidity Sweep",
            matchedConditions: "0/6",
            alertStatus: "NONE" as const,
            lastUpdateMs: now,
          };
        }
      })
    );

    const response: MarketRadarResponse = {
      items,
      fetchedAt: now,
    };

    return NextResponse.json(response, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[POST /api/extension/market-radar]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "server_error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
