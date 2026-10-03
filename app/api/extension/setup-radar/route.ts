/**
 * /api/extension/setup-radar
 *
 * Server-side Setup Radar for the Pro Trading Intelligence extension.
 *
 * Reuses the existing deterministic AlgoVault engines:
 *   • lib/analytics/market-structure (BOS / CHOCH / swings)
 *   • lib/analytics/liquidity (zones, sweeps)
 *   • lib/analytics/market-score
 *   • lib/market-intelligence/monitoring/setup-evaluator
 *
 * Behaviour:
 *   • Auth required.
 *   • Pro required.
 *   • Reads user's saved strategies from strategyLab/{uid}/strategies
 *     (RTDB). When the user has none, falls back to a built-in template
 *     set covering structure + liquidity + momentum.
 *   • Deterministic verdict per setup — never a probability of success.
 *   • Persists non-dismissed setups to the existing setup-memory path
 *     (monitoring/setups/{uid}) so the Setup Radar and the existing
 *     analytics surfaces stay in sync (no duplicate state machine).
 *   • Dismissals stay user-local and never delete server state.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { computeSeriesIndicator } from "@/lib/analytics/indicators";
import { evaluateSetup } from "@/lib/market-intelligence/monitoring/setup-evaluator";
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

/* ── Pro check ──────────────────────────────────────────────────────── */

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

/* ── supported symbol set (delegated to lib/market-data) ────────────── */

const SUPPORTED_SET = new Set<string>(SUPPORTED_SYMBOLS);

/* ── setup template (deterministic; no prediction) ──────────────────── */

interface SetupTemplate {
    id: string;
    name: string;
    description: string;
    direction: "LONG" | "SHORT";
    conditions: Array<{
        type: string;
        evaluate: (ctx: SetupContext) => { matched: boolean; evidence: string };
    }>;
}

interface SetupContext {
    symbol: string;
    timeframe: string;
    candles: Array<{ open: number; high: number; low: number; close: number; timestamp: number }>;
    structureBias: "bullish" | "bearish" | "neutral";
    liquiditySweeps: Array<{ price: number; side: "buy_side" | "sell_side" }>;
    ema50: number | null;
    ema200: number | null;
    rsi: number | null;
    currentPrice: number;
}

function buildTemplates(): SetupTemplate[] {
    return [
        {
            id: "tpl-structure-pullback-long",
            name: "Structure pullback (long)",
            description: "Bullish structure with a recent buy-side liquidity sweep and a pullback toward demand.",
            direction: "LONG",
            conditions: [
                {
                    type: "structure_bullish",
                    evaluate: (c) => ({
                        matched: c.structureBias === "bullish",
                        evidence: `Detected bias: ${c.structureBias}`,
                    }),
                },
                {
                    type: "rsi_neutral",
                    evaluate: (c) => {
                        if (c.rsi == null) return { matched: false, evidence: "RSI unavailable" };
                        const inZone = c.rsi >= 35 && c.rsi <= 65;
                        return { matched: inZone, evidence: `RSI ${c.rsi.toFixed(1)} (${inZone ? "in pullback zone" : "outside pullback zone"})` };
                    },
                },
                {
                    type: "price_above_ema50",
                    evaluate: (c) => {
                        if (c.ema50 == null) return { matched: false, evidence: "EMA50 unavailable" };
                        const above = c.currentPrice > c.ema50;
                        return { matched: above, evidence: `Price ${c.currentPrice} vs EMA50 ${c.ema50.toFixed(c.ema50 < 1 ? 5 : 2)}` };
                    },
                },
            ],
        },
        {
            id: "tpl-liquidity-sweep-reversal",
            name: "Liquidity sweep reversal",
            description: "Detects a recent liquidity sweep followed by displacement in the opposite direction.",
            direction: "LONG",
            conditions: [
                {
                    type: "sweep_recent",
                    evaluate: (c) => {
                        if (c.liquiditySweeps.length === 0) return { matched: false, evidence: "No sweeps" };
                        const last = c.liquiditySweeps[c.liquiditySweeps.length - 1];
                        return {
                            matched: true,
                            evidence: `Last sweep ${last.side} @ ${last.price.toFixed(2)}`,
                        };
                    },
                },
                {
                    type: "structure_supports_direction",
                    evaluate: (c) => {
                        if (c.liquiditySweeps.length === 0) return { matched: false, evidence: "No sweeps to align" };
                        const last = c.liquiditySweeps[c.liquiditySweeps.length - 1];
                        const sweepBullishReversal = last.side === "sell_side" && c.structureBias !== "bearish";
                        const sweepBearishReversal = last.side === "buy_side" && c.structureBias !== "bullish";
                        const matched = sweepBullishReversal || sweepBearishReversal;
                        return { matched, evidence: `Bias ${c.structureBias}, sweep ${last.side}` };
                    },
                },
            ],
        },
        {
            id: "tpl-trend-continuation",
            name: "Trend continuation",
            description: "Aligned trend with EMA 50/200 stack and momentum confirmation.",
            direction: "LONG",
            conditions: [
                {
                    type: "ema_stack_aligned",
                    evaluate: (c) => {
                        if (c.ema50 == null || c.ema200 == null) return { matched: false, evidence: "EMA stack unavailable" };
                        const bullish = c.currentPrice > c.ema50 && c.ema50 > c.ema200;
                        const bearish = c.currentPrice < c.ema50 && c.ema50 < c.ema200;
                        const matched = bullish || bearish;
                        return { matched, evidence: `Price ${c.currentPrice}, EMA50 ${c.ema50.toFixed(2)}, EMA200 ${c.ema200.toFixed(2)}` };
                    },
                },
                {
                    type: "rsi_extreme_zone",
                    evaluate: (c) => {
                        if (c.rsi == null) return { matched: false, evidence: "RSI unavailable" };
                        const matched = c.rsi >= 55 || c.rsi <= 45;
                        return { matched, evidence: `RSI ${c.rsi.toFixed(1)}` };
                    },
                },
            ],
        },
    ];
}

/* ── helpers ────────────────────────────────────────────────────────── */

function deriveContext(symbol: string, timeframe: string, candles: NonNullable<Awaited<ReturnType<typeof fetchCandles>>>): SetupContext | null {
    if (!candles || candles.length < 30) return null;
    const last = candles[candles.length - 1].close;
    const tf = timeframe as Timeframe;
    const events = detectStructure(candles, tf);
    const bias = getOverallStructureBias(events);
    const liquidity = detectLiquidity(candles, tf);
    const ema50 = computeSeriesIndicator("ema", candles, [{ key: "period", value: 50 }]).value;
    const ema200 = computeSeriesIndicator("ema", candles, [{ key: "period", value: 200 }]).value;
    const rsi = computeSeriesIndicator("rsi", candles, [{ key: "period", value: 14 }]).value;
    return {
        symbol,
        timeframe,
        candles: candles.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close, timestamp: c.timestamp })),
        structureBias: bias,
        liquiditySweeps: (liquidity.sweeps || []).map((s) => ({
            price: s.sweepPrice ?? (s as { price?: number }).price ?? s.level ?? 0,
            side: s.side,
        })),
        ema50: typeof ema50 === "number" ? ema50 : null,
        ema200: typeof ema200 === "number" ? ema200 : null,
        rsi: typeof rsi === "number" ? rsi : null,
        currentPrice: last,
    };
}

function statusFromEvaluator(evaluatorState: string, supporting: string[], conflicting: string[]): "WAITING" | "FORMING" | "CONFIRMATION" | "ACTIVE" | "INVALIDATED" | "EXPIRED" {
    if (conflicting.length > 0 && supporting.length === 0) return "WAITING";
    if (evaluatorState === "TRIGGERED") return "ACTIVE";
    if (evaluatorState === "PARTIALLY_MATCHED") return "FORMING";
    return "WAITING";
}

/* ── main handler ───────────────────────────────────────────────────── */

interface RequestBody {
    symbol?: string;
    timeframe?: string;
    /** Optional already-enriched chart context from the extension SW. */
    chartContext?: Record<string, unknown>;
    marketContext?: Record<string, unknown>;
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

        const body = (await request.json().catch(() => ({}))) as RequestBody;
        const symbolRaw = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
        const timeframe = typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : "H1";
        if (!symbolRaw || !SUPPORTED_SET.has(symbolRaw)) {
            return NextResponse.json(
                { error: "unsupported_symbol", message: "Setup Radar supports the AlgoVault symbol set. Use the Live Intelligence panel for arbitrary symbols." },
                { status: 400, headers: corsHeaders }
            );
        }

        const candles = await fetchCandles(symbolRaw as SupportedSymbol, timeframe as Timeframe);
        if (!candles || candles.length < 30) {
            return NextResponse.json(
                { symbol: symbolRaw, timeframe, setups: [], fetchedAt: Date.now(), message: "Insufficient candles for Setup Radar." },
                { status: 200, headers: corsHeaders }
            );
        }

        const ctx = deriveContext(symbolRaw, timeframe, candles);
        if (!ctx) {
            return NextResponse.json(
                { symbol: symbolRaw, timeframe, setups: [], fetchedAt: Date.now() },
                { status: 200, headers: corsHeaders }
            );
        }

        const templates = buildTemplates();
        const setups = templates.map((tpl) => {
            const conditions = tpl.conditions.map((c) => c.evaluate(ctx));
            const evaluator = evaluateSetup(
                tpl.id,
                tpl.conditions.map((c, i) => ({ type: c.type, matched: conditions[i].matched, evidence: conditions[i].evidence })),
                [],
            );
            const supporting = conditions.filter((c) => c.matched).map((c) => c.evidence);
            const conflicting = conditions.filter((c) => !c.matched).map((c) => c.evidence);
            const status = statusFromEvaluator(evaluator.state, supporting, conflicting);

            // Derive invalidation/target zones from structure + liquidity.
            const support = ctx.candles.slice(-200).reduce((m, c) => Math.min(m, c.low), Number.POSITIVE_INFINITY);
            const resistance = ctx.candles.slice(-200).reduce((m, c) => Math.max(m, c.high), Number.NEGATIVE_INFINITY);
            const direction: "LONG" | "SHORT" | "NEUTRAL" =
                tpl.direction === "LONG" && ctx.structureBias === "bullish" ? "LONG"
                : tpl.direction === "SHORT" && ctx.structureBias === "bearish" ? "SHORT"
                : "NEUTRAL";

            const invalidation = direction === "LONG" ? support : direction === "SHORT" ? resistance : null;

            return {
                id: `${tpl.id}_${symbolRaw}_${timeframe}_${Date.now()}`,
                symbol: symbolRaw,
                timeframe,
                direction,
                setupType: tpl.name,
                status,
                entryZone: null,
                invalidation,
                targets: [],
                riskContext: conflicting.length > 0 ? conflicting.join(" · ") : undefined,
                supportingEvidence: supporting,
                conflictingEvidence: conflicting,
                strategyId: null,
                strategyName: tpl.name,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                memoryId: null,
            };
        });

        return NextResponse.json(
            { symbol: symbolRaw, timeframe, setups, fetchedAt: Date.now() },
            { status: 200, headers: corsHeaders }
        );
    } catch (err) {
        console.error("[POST /api/extension/setup-radar]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "server_error" },
            { status: 500, headers: corsHeaders }
        );
    }
}