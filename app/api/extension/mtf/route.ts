/**
 * /api/extension/mtf
 *
 * Multi-Timeframe Intelligence for the Pro extension.
 *
 * Computes state/structure/momentum/setup for a configurable MTF stack
 * derived from the user-supplied base timeframe (no hard-coded H4/H1/M15
 * relationship — we always expand to higher AND lower timeframes so the
 * stack adapts to whatever the trader is looking at).
 *
 * Each row is computed by reusing lib/analytics/{market-structure,
 * liquidity, indicators, market-score} against real candles. No values
 * are invented.
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

const ALL_TIMEFRAMES: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

const TIMEFRAME_MS: Record<Timeframe, number> = {
    M1: 60_000,
    M3: 3 * 60_000,
    M5: 5 * 60_000,
    M15: 15 * 60_000,
    M30: 30 * 60_000,
    H1: 60 * 60_000,
    H4: 4 * 60 * 60_000,
    D1: 24 * 60 * 60_000,
    W1: 7 * 24 * 60 * 60_000,
};

interface MTFRow {
    timeframe: string;
    role: "macro" | "structure" | "confirmation" | "entry" | "context";
    state: "BULLISH" | "BEARISH" | "NEUTRAL" | "RANGE" | "TRANSITION" | "UNKNOWN";
    structure?: "HH/HL" | "LH/LL" | "RANGE" | "BREAK" | "CHOCH" | "UNKNOWN";
    momentum?: "EXPANDING" | "CONTRACTING" | "STEADY" | "UNKNOWN";
    setup?: "FORMING" | "CONFIRMED" | "INVALIDATED" | "WAITING" | "UNKNOWN";
    conflicts?: string[];
    notes?: string[];
}

interface MTFResponse {
    symbol: string;
    baseTimeframe: string;
    rows: MTFRow[];
    fetchedAt: number;
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

function selectTimeframes(base: Timeframe): Timeframe[] {
    const baseMs = TIMEFRAME_MS[base];
    const higher = ALL_TIMEFRAMES.filter((tf) => TIMEFRAME_MS[tf] > baseMs).sort((a, b) => TIMEFRAME_MS[a] - TIMEFRAME_MS[b]);
    const lower = ALL_TIMEFRAMES.filter((tf) => TIMEFRAME_MS[tf] < baseMs).sort((a, b) => TIMEFRAME_MS[b] - TIMEFRAME_MS[a]);

    const result: Timeframe[] = [];
    // Pick up to 2 higher and 1 lower + base = up to 4 rows
    if (higher.length > 0) result.push(higher[higher.length - 1]); // immediate higher
    if (higher.length > 1) result.push(higher[higher.length - 2]); // 2nd higher (macro)
    result.push(base);
    if (lower.length > 0) result.push(lower[0]); // immediate lower (entry)
    return result;
}

function rowForTimeframe(tf: Timeframe, role: MTFRow["role"], candles: NonNullable<Awaited<ReturnType<typeof fetchCandles>>>): MTFRow {
    if (candles.length < 30) {
        return { timeframe: tf, role, state: "UNKNOWN", structure: "UNKNOWN", momentum: "UNKNOWN", setup: "UNKNOWN", notes: ["Insufficient candles"] };
    }
    const events = detectStructure(candles, tf);
    const bias = getOverallStructureBias(events);
    const liquidity = detectLiquidity(candles, tf);
    const last = candles[candles.length - 1].close;
    const rsi = computeSeriesIndicator("rsi", candles, [{ key: "length", value: 14 }]).value;
    const atr = computeSeriesIndicator("atr", candles, [{ key: "length", value: 14 }]).value;

    const conflicts: string[] = [];
    const notes: string[] = [];

    let state: MTFRow["state"] = "UNKNOWN";
    let structure: MTFRow["structure"] = "UNKNOWN";
    if (events.length > 0) {
        const bosCount = events.filter((e) => e.type === "BOS").length;
        const chochCount = events.filter((e) => e.type === "CHOCH").length;
        if (chochCount > 0 && bosCount > 0) {
            state = bias === "bullish" ? "BULLISH" : bias === "bearish" ? "BEARISH" : "TRANSITION";
            structure = chochCount > bosCount ? "CHOCH" : "BREAK";
        } else if (bosCount > 0) {
            state = bias === "bullish" ? "BULLISH" : bias === "bearish" ? "BEARISH" : "TRANSITION";
            structure = "BREAK";
        } else if (events.some((e) => e.type === "swing_high") && events.some((e) => e.type === "swing_low")) {
            state = "RANGE";
            structure = "RANGE";
        }
        notes.push(`${bosCount} BOS / ${chochCount} CHOCH on ${tf}`);
    }

    if (typeof rsi === "number") {
        if (rsi >= 70 || rsi <= 30) conflicts.push(`RSI ${rsi.toFixed(1)} on ${tf}`);
    }
    if (typeof atr === "number") {
        notes.push(`ATR ${atr.toFixed(atr < 1 ? 5 : 2)}`);
    }
    if (liquidity.sweeps.length > 0) {
        const lastSweep = liquidity.sweeps[liquidity.sweeps.length - 1];
        const sweepVal = lastSweep.sweepPrice ?? lastSweep.level ?? 0;
        notes.push(`Last sweep ${lastSweep.side} @ ${sweepVal.toFixed(2)}`);
    }

    let momentum: MTFRow["momentum"] = "UNKNOWN";
    if (typeof rsi === "number") {
        momentum = rsi >= 60 ? "EXPANDING" : rsi <= 40 ? "CONTRACTING" : "STEADY";
    }

    return {
        timeframe: tf,
        role,
        state,
        structure,
        momentum,
        setup: events.length > 0 ? "FORMING" : "WAITING",
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        notes,
    };
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

        const body = (await request.json().catch(() => ({}))) as { symbol?: string; baseTimeframe?: string };
        const symbolRaw = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
        const base = (typeof body.baseTimeframe === "string" ? body.baseTimeframe.trim() : "H1") as Timeframe;

        if (!symbolRaw || !SUPPORTED_SET.has(symbolRaw)) {
            return NextResponse.json({ error: "unsupported_symbol" }, { status: 400, headers: corsHeaders });
        }
        if (!ALL_TIMEFRAMES.includes(base)) {
            return NextResponse.json({ error: "unsupported_timeframe" }, { status: 400, headers: corsHeaders });
        }

        const stack = selectTimeframes(base);
        const roles: MTFRow["role"][] = ["macro", "structure", "confirmation", "entry"];
        const rows: MTFRow[] = [];

        for (let i = 0; i < stack.length; i++) {
            const tf = stack[i];
            const role = i < roles.length ? roles[i] : "context";
            try {
                const candles = await fetchCandles(symbolRaw as SupportedSymbol, tf);
                rows.push(rowForTimeframe(tf, role, candles));
            } catch {
                rows.push({ timeframe: tf, role, state: "UNKNOWN", notes: ["Failed to load candles"] });
            }
        }

        const response: MTFResponse = { symbol: symbolRaw, baseTimeframe: base, rows, fetchedAt: Date.now() };
        return NextResponse.json(response, { status: 200, headers: corsHeaders });
    } catch (err) {
        console.error("[POST /api/extension/mtf]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "server_error" },
            { status: 500, headers: corsHeaders }
        );
    }
}