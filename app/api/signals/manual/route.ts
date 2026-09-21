import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import {
    AISignal,
    SignalDirection,
    SignalStrength,
    getStrengthLabelForScore,
} from "@/lib/ai-signals/types";
import { recordSignalEvent, indexSignalByDate } from "@/lib/ai-signals/events";

export const runtime = "nodejs";

const VALID_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const VALID_STYLES = ["scalp", "intraday", "swing", "position"];

class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

/**
 * POST /api/signals/manual
 *
 * Creates a MANUAL signal with the caller's own direction / entry / SL / TP
 * definition and persists it into the canonical aiSignals collection so every
 * downstream consumer (monitor, auto-update, execute, completion tracking,
 * stats) treats it exactly like any other signal.
 *
 * This is the real backend for the extension / UI "Create Signal" form. It is
 * NOT the generator (`/api/ai-signals`) which ignores caller-defined levels.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const symbol = String(body.symbol || "").trim().toUpperCase();
        const direction = String(body.direction || "").trim().toUpperCase() as SignalDirection;
        const entry = Number(body.entry);
        const stopLoss = Number(body.stopLoss);
        const tp1 = body.takeProfit1 !== undefined && body.takeProfit1 !== "" ? Number(body.takeProfit1) : 0;
        const tp2 = body.takeProfit2 !== undefined && body.takeProfit2 !== "" ? Number(body.takeProfit2) : 0;
        const tp3 = body.takeProfit3 !== undefined && body.takeProfit3 !== "" ? Number(body.takeProfit3) : 0;
        const timeframe = String(body.timeframe || "H1").toUpperCase();
        const style = String(body.style || "swing");
        const notes = String(body.notes || "");

        // ── Validation ────────────────────────────────────────────────────────
        if (!symbol) throw new ApiError("symbol is required.", 400);
        if (!(SUPPORTED_SYMBOLS as readonly string[]).includes(symbol)) {
            throw new ApiError(`Unsupported symbol. Supported: ${SUPPORTED_SYMBOLS.join(", ")}`, 400);
        }
        if (direction !== "BUY" && direction !== "SELL") {
            throw new ApiError("direction must be BUY or SELL.", 400);
        }
        if (!(entry > 0)) throw new ApiError("entry must be greater than 0.", 400);
        if (!(stopLoss > 0)) throw new ApiError("stopLoss must be greater than 0.", 400);
        if (entry === stopLoss) throw new ApiError("entry and stopLoss cannot be equal.", 400);

        // Directional sanity: SL must be on the correct side of entry.
        if (direction === "BUY" && stopLoss >= entry) {
            throw new ApiError("For a BUY signal stopLoss must be below the entry price.", 400);
        }
        if (direction === "SELL" && stopLoss <= entry) {
            throw new ApiError("For a SELL signal stopLoss must be above the entry price.", 400);
        }

        // Take profits must also sit on the correct side and be ordered.
        const tps = [tp1, tp2, tp3].filter((tp) => tp > 0);
        for (const tp of tps) {
            if (direction === "BUY" && tp <= entry) {
                throw new ApiError("For a BUY signal take-profit targets must be above the entry price.", 400);
            }
            if (direction === "SELL" && tp >= entry) {
                throw new ApiError("For a SELL signal take-profit targets must be below the entry price.", 400);
            }
        }
        for (let i = 1; i < tps.length; i += 1) {
            const ok = direction === "BUY" ? tps[i] > tps[i - 1] : tps[i] < tps[i - 1];
            if (!ok) {
                throw new ApiError("Take-profit targets must be ordered.", 400);
            }
        }

        if (!VALID_TIMEFRAMES.includes(timeframe)) {
            throw new ApiError(`timeframe must be one of: ${VALID_TIMEFRAMES.join(", ")}.`, 400);
        }
        if (!VALID_STYLES.includes(style)) {
            throw new ApiError(`style must be one of: ${VALID_STYLES.join(", ")}.`, 400);
        }

        // ── Build the canonical AISignal record ──────────────────────────────
        const now = Date.now();
        const riskDistance = Math.abs(entry - stopLoss);
        const riskReward = tps.length > 0
            ? Number(((Math.abs(tps[0] - entry)) / riskDistance).toFixed(2))
            : 0;
        const confidence = 70; // manual signal; strength derived from R:R
        const strength: SignalStrength = riskReward >= 2
            ? "GOOD"
            : riskReward >= 1.5
            ? "MODERATE"
            : getStrengthLabelForScore(confidence).label as SignalStrength;

        const id = `sig_manual_${symbol.toLowerCase()}_${now}`;

        const signal: AISignal = {
            id,
            symbol,
            direction,
            timeframe,
            category: symbol.startsWith("X") ? "gold"
                : ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOGEUSD", "BNBUSD", "LTCUSD", "DOTUSD"].includes(symbol)
                ? "crypto"
                : ["US30", "NAS100", "SPX500", "SPY", "QQQ", "DXY"].includes(symbol)
                ? "indices"
                : ["AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "COIN"].includes(symbol)
                ? "stocks"
                : "forex",
            tier: "FREE",
            entry,
            stopLoss,
            ...(tp1 > 0 ? { tp1 } : {}),
            ...(tp2 > 0 ? { tp2 } : {}),
            ...(tp3 > 0 ? { tp3 } : {}),
            confidence,
            strength,
            marketRegime: "UNCERTAIN",
            riskReward,
            riskRewardTp2: tp2 > 0 ? Number((Math.abs(tp2 - entry) / riskDistance).toFixed(2)) : undefined,
            riskRewardTp3: tp3 > 0 ? Number((Math.abs(tp3 - entry) / riskDistance).toFixed(2)) : undefined,
            status: "READY",
            result: "PENDING",
            resultR: 0,
            profitPoints: 0,
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            analysis: {
                trend: direction === "BUY" ? "bullish" : "bearish",
                structure: "manual",
                regime: "manual",
            },
            confidenceBreakdown: {
                trendAlignment: { score: 0, max: 100, detail: "" },
                marketStructure: { score: 0, max: 100, detail: "" },
                liquidity: { score: 0, max: 100, detail: "" },
                momentum: { score: 0, max: 100, detail: "" },
                volume: { score: 0, max: 100, detail: "" },
                orderFlow: { score: 0, max: 100, detail: "" },
                entryConfirmation: { score: 0, max: 100, detail: "" },
                total: confidence,
            },
            reasoning: notes
                ? `${notes} [${style}]`
                : `Manually defined ${direction} ${symbol} setup (${style}).`,
            currentPrice: entry,
            distanceToEntry: 0,
            distanceToSL: riskDistance,
            createdAt: now,
            updatedAt: now,
            expiresAt: now + 24 * 3600 * 1000,
            engineVersion: "manual",
            strategyVersion: "manual",
            analysisVersion: "manual",
            generatedBy: "Manual (User)",
            lastCheckedAt: now,
            followCount: 0,
            tradeCount: 0,
            createdFor: user.uid,
            suggestedRiskPercent: 1,
            pipValue: 0,
            contractSize: 0,
            typicalSpread: 0,
            digits: 0,
            sourceType: "MANUAL",
            sourceId: "extension",
            generationPrice: entry,
            timeline: [
                {
                    id: `evt_${now}_CREATED`,
                    timestamp: now,
                    type: "SIGNAL_CREATED",
                    message: "Manual signal created",
                    metadata: { symbol, timeframe, direction, user: user.uid, source: "manual" },
                },
            ],
        };

        await adminDatabase.ref(`aiSignals/${signal.id}`).set(signal);
        await recordSignalEvent(signal, "CREATED", entry, { symbol, timeframe, tier: "FREE", source: "manual" });
        await indexSignalByDate(signal);

        // Maintenance-free reverse follower index (additive), same as the
        // generator so the signal is followable from the moment it is created.
        await adminDatabase.ref(`signalFollowers/${signal.id}/${user.uid}`).set(true);

        return NextResponse.json({ success: true, signal, created: true }, { status: 201 });
    } catch (error) {
        if (error instanceof ApiError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Manual signal creation error:", error);
        return NextResponse.json({ error: "Failed to create signal." }, { status: 500 });
    }
}