/**
 * AI Execution — TradePlan generation endpoint.
 *
 * Accepts a DETERMINISTIC trade shape (from an existing signal / qualifying
 * setup / terminal selection) plus evidence references the SERVER gathers from
 * market truth. The AI interpretation pass goes through the canonical router.
 * The generated plan is schema-validated and stored as DRAFT/VALIDATING —
 * nothing is executed here.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/ai-execution/runtime";
import { getExecutionPolicy, savePlan } from "@/lib/ai-execution/database";
import { generateTradePlan } from "@/lib/ai-execution/generator";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import { clampAutomationPolicy, observedEvidence } from "@/lib/ai-execution/types";

export async function POST(request: NextRequest) {
    const caller = await requireCaller(request);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const instrument = String(body.instrument ?? "").toUpperCase().replace("/", "");
    const direction = body.direction === "SELL" ? "SELL" : "BUY";
    const entry = Number(body.entry);
    const stopLoss = Number(body.stopLoss);
    const takeProfit = Number(body.takeProfit);
    const riskPercent = Number(body.riskPercent) > 0 ? Number(body.riskPercent) : 1;
    const timeframe = String(body.timeframe ?? "M5");
    const setupId = typeof body.setupId === "string" ? body.setupId : undefined;
    const signalId = typeof body.signalId === "string" ? body.signalId : undefined;
    const executionMode = body.executionMode === "AUTOMATION" ? "AUTOMATION" : body.executionMode === "APPROVAL" ? "APPROVAL" : "ANALYSIS";

    if (!/^[A-Z0-9]{3,12}$/.test(instrument)) {
        return NextResponse.json({ error: "A valid instrument is required." }, { status: 400 });
    }
    if (!(entry > 0) || !(stopLoss > 0)) {
        return NextResponse.json({ error: "Positive entry and stopLoss are required." }, { status: 400 });
    }
    if (direction === "BUY" && stopLoss >= entry) {
        return NextResponse.json({ error: "BUY requires stopLoss below entry." }, { status: 400 });
    }
    if (direction === "SELL" && stopLoss <= entry) {
        return NextResponse.json({ error: "SELL requires stopLoss above entry." }, { status: 400 });
    }
    if (!(takeProfit > 0)) {
        return NextResponse.json({ error: "A positive takeProfit is required." }, { status: 400 });
    }

    // Deterministic evidence gathered server-side from canonical market truth.
    const truth = await getMarketTruth(instrument, timeframe as never).catch(() => null);
    const evidence = [];
    if (truth?.snapshot) {
        evidence.push(
            observedEvidence(
                `quote-${Date.now()}`,
                truth.snapshot.provider === "tradingview" ? "market-data.tradingview-live" : "market-data.biquote-ohlc",
                `Live ${instrument} quote`,
                truth.snapshot.currentPrice,
                truth.snapshot.timestamp,
            ),
        );
        evidence.push(
            observedEvidence(
                `freshness-${Date.now()}`,
                "market-data.biquote-ohlc",
                "Data freshness",
                truth.freshness.status,
                truth.snapshot.timestamp,
            ),
        );
    } else {
        evidence.push({
            id: `quote-${Date.now()}`,
            evidenceClass: "UNAVAILABLE" as const,
            sourceId: "market-data.biquote-ohlc" as const,
            label: `Live ${instrument} quote`,
            observedAt: null,
            reason: "Market truth unavailable for this instrument/timeframe.",
        });
    }

    const policy = await getExecutionPolicy(caller.uid);
    const generated = await generateTradePlan(
        {
            uid: caller.uid,
            instrument,
            direction,
            timeframe,
            entry,
            stopLoss,
            takeProfits: [{ index: 1, price: takeProfit }],
            riskPercent,
            executionMode,
            setupId,
            signalId,
            evidence,
            marketRegime: truth?.snapshot?.regime ?? "UNCERTAIN",
        },
        clampAutomationPolicy(policy.automation),
    );

    if (!generated.plan) {
        return NextResponse.json({ error: generated.error ?? "Plan generation failed." }, { status: 400 });
    }

    await savePlan(generated.plan);
    return NextResponse.json({
        success: true,
        plan: generated.plan,
        aiUsed: generated.aiUsed,
        note: "Plan stored — it executes only through the deterministic gate in the configured execution mode.",
    });
}
