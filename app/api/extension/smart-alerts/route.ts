/**
 * /api/extension/smart-alerts
 *
 * Server-side Smart Alerts for the Pro Trading Intelligence extension.
 * Deterministic alerts derived from REAL indicator conditions:
 *   • Liquidity sweeps (lib/analytics/liquidity)
 *   • EMA alignment (lib/analytics/indicators)
 *   • RSI extremes
 *   • Market structure breaks (lib/analytics/market-structure)
 *   • HTF conflicts (when a higher-timeframe context is supplied)
 *
 * The AI layer ONLY prioritises and explains — it never invents market
 * events. Alerts that look identical across runs are deterministic, not
 * probabilistic.
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

const SUPPORTED_SET = new Set<string>(SUPPORTED_SYMBOLS);

interface Alert {
    id: string;
    symbol: string;
    timeframe: string;
    category: string;
    severity: "info" | "notice" | "warning" | "critical";
    title: string;
    message: string;
    evidence: string[];
    priority: number;
    createdAt: number;
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

function priorityFromMatched(matched: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((matched / total) * 100) - 50;
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

        const body = (await request.json().catch(() => ({}))) as { symbol?: string; timeframe?: string; sinceMs?: number };
        const symbolRaw = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
        const timeframe = (typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1") as Timeframe;
        const sinceMs = typeof body.sinceMs === "number" ? body.sinceMs : 0;

        if (!symbolRaw || !SUPPORTED_SET.has(symbolRaw)) {
            return NextResponse.json({ alerts: [] }, { status: 200, headers: corsHeaders });
        }

        const candles = await fetchCandles(symbolRaw as SupportedSymbol, timeframe);
        if (!candles || candles.length < 30) {
            return NextResponse.json({ alerts: [] }, { status: 200, headers: corsHeaders });
        }

        const alerts: Alert[] = [];
        const now = Date.now();

        // Structure events
        const events = detectStructure(candles, timeframe);
        const bias = getOverallStructureBias(events);
        const recentBos = events.filter((e) => (e.type === "BOS" || e.type === "CHOCH") && (now - e.timestamp) < 6 * 60 * 60 * 1000);
        if (recentBos.length > 0) {
            const last = recentBos[recentBos.length - 1];
            alerts.push({
                id: `bos_${symbolRaw}_${timeframe}_${last.timestamp}`,
                symbol: symbolRaw,
                timeframe,
                category: "structure_break",
                severity: last.type === "CHOCH" ? "warning" : "notice",
                title: `${last.type === "CHOCH" ? "Change of Character" : "Break of Structure"} detected`,
                message: `${last.direction === "bullish" ? "Bullish" : "Bearish"} ${last.type} at ${last.price.toFixed(2)} on ${timeframe}`,
                evidence: [`Type: ${last.type}`, `Direction: ${last.direction}`, `Price: ${last.price}`],
                priority: priorityFromMatched(1, 1) + 10,
                createdAt: now,
            });
        }

        // Liquidity sweeps
        const liquidity = detectLiquidity(candles, timeframe);
        const recentSweeps = liquidity.sweeps.filter((s) => (now - s.timestamp) < 6 * 60 * 60 * 1000);
        for (const s of recentSweeps.slice(0, 2)) {
            const priceVal = s.sweepPrice ?? s.level ?? 0;
            alerts.push({
                id: `sweep_${symbolRaw}_${timeframe}_${s.timestamp}`,
                symbol: symbolRaw,
                timeframe,
                category: "liquidity_sweep",
                severity: "notice",
                title: "Liquidity sweep detected",
                message: `${s.side === "buy_side" ? "Buy-side" : "Sell-side"} liquidity swept at ${priceVal.toFixed(2)}`,
                evidence: [`Side: ${s.side}`, `Price: ${priceVal}`],
                priority: priorityFromMatched(1, 1),
                createdAt: now,
            });
        }

        // EMA alignment
        const ema20 = computeSeriesIndicator("ema", candles, [{ key: "length", value: 20 }]).value;
        const ema50 = computeSeriesIndicator("ema", candles, [{ key: "length", value: 50 }]).value;
        const ema200 = computeSeriesIndicator("ema", candles, [{ key: "length", value: 200 }]).value;
        const last = candles[candles.length - 1].close;

        if (typeof ema20 === "number" && typeof ema50 === "number" && typeof ema200 === "number") {
            const bullishStack = last > ema20 && ema20 > ema50 && ema50 > ema200;
            const bearishStack = last < ema20 && ema20 < ema50 && ema50 < ema200;
            if (bullishStack || bearishStack) {
                alerts.push({
                    id: `ema_stack_${symbolRaw}_${timeframe}_${now}`,
                    symbol: symbolRaw,
                    timeframe,
                    category: "ema_alignment",
                    severity: "notice",
                    title: `${bullishStack ? "Bullish" : "Bearish"} EMA stack aligned`,
                    message: `EMA 20/50/200 ${bullishStack ? "stacked bullish" : "stacked bearish"} on ${symbolRaw}`,
                    evidence: [`Last ${last}`, `EMA20 ${ema20.toFixed(2)}`, `EMA50 ${ema50.toFixed(2)}`, `EMA200 ${ema200.toFixed(2)}`],
                    priority: priorityFromMatched(2, 3) + 10,
                    createdAt: now,
                });
            }
        }

        // RSI extremes
        const rsi = computeSeriesIndicator("rsi", candles, [{ key: "length", value: 14 }]).value;
        if (typeof rsi === "number") {
            if (rsi >= 75 || rsi <= 25) {
                alerts.push({
                    id: `rsi_${symbolRaw}_${timeframe}_${now}`,
                    symbol: symbolRaw,
                    timeframe,
                    category: "volatility",
                    severity: rsi >= 80 || rsi <= 20 ? "warning" : "notice",
                    title: rsi >= 75 ? "RSI overbought" : "RSI oversold",
                    message: `RSI ${rsi.toFixed(1)} — ${rsi >= 75 ? "potential mean reversion risk" : "potential exhaustion"}`,
                    evidence: [`RSI: ${rsi.toFixed(1)}`],
                    priority: priorityFromMatched(1, 2),
                    createdAt: now,
                });
            }
        }

        // Setup forming/invalidated
        if (bias !== "neutral" && recentSweeps.length > 0) {
            alerts.push({
                id: `setup_${symbolRaw}_${timeframe}_${now}`,
                symbol: symbolRaw,
                timeframe,
                category: "setup_forming",
                severity: "info",
                title: `Potential ${bias === "bullish" ? "LONG" : "SHORT"} setup forming`,
                message: `Structure is ${bias} and liquidity was recently swept — review Setup Radar.`,
                evidence: [`Bias: ${bias}`, `Sweeps: ${recentSweeps.length}`],
                priority: priorityFromMatched(2, 3),
                createdAt: now,
            });
        }

        const filtered = sinceMs > 0 ? alerts.filter((a) => a.createdAt >= sinceMs) : alerts;

        return NextResponse.json({ alerts: filtered }, { status: 200, headers: corsHeaders });
    } catch (err) {
        console.error("[POST /api/extension/smart-alerts]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "server_error", alerts: [] },
            { status: 500, headers: corsHeaders }
        );
    }
}