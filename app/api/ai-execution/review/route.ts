/**
 * AI Execution — position review endpoint.
 *
 * Runs an AI monitoring pass over an OPEN plan's position. The review verdict
 * is INTERPRETATION ONLY: the response never executes anything. Any protective
 * action the user accepts goes through the existing trade-management queue
 * (trading_order_requests), which is already the platform's authorized
 * modification path and is separately risk-audited by trade-management.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, resolveConnectedAccount } from "@/lib/ai-execution/runtime";
import { getPlan, savePositionReview, writeAudit } from "@/lib/ai-execution/database";
import { reviewOpenPosition } from "@/lib/ai-execution/generator";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import { adminDatabase } from "@/lib/firebase-admin";
import { observedEvidence } from "@/lib/ai-execution/types";

export async function POST(request: NextRequest) {
    const caller = await requireCaller(request);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return NextResponse.json({ error: "planId is required." }, { status: 400 });

    const plan = await getPlan(caller.uid, planId);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    if (!["OPEN", "MONITORING", "SUBMITTED"].includes(plan.status)) {
        return NextResponse.json({ error: `Plan status ${plan.status} has no position to review.` }, { status: 409 });
    }

    // Fresh deterministic evidence for the review (quote + position state).
    const truth = await getMarketTruth(plan.instrument, plan.timeframe as never).catch(() => null);
    const evidence = [];
    if (truth?.snapshot) {
        evidence.push(
            observedEvidence(
                `review-quote-${Date.now()}`,
                truth.snapshot.provider === "tradingview" ? "market-data.tradingview-live" : "market-data.biquote-ohlc",
                `Live ${plan.instrument} quote`,
                truth.snapshot.currentPrice,
                truth.snapshot.timestamp,
            ),
        );
    }

    const accountKey = await resolveConnectedAccount(caller.uid);
    let openSince = plan.execution?.submittedAt ?? plan.generatedAt;
    if (accountKey && plan.execution?.clientOrderId) {
        const snap = await adminDatabase.ref(`trading_positions/${caller.uid}/${accountKey}/${plan.execution.clientOrderId}`).get();
        if (snap.exists()) {
            const pos = snap.val() as { openedAt?: number };
            if (Number(pos.openedAt) > 0) openSince = Number(pos.openedAt);
        }
    }

    const { review, error } = await reviewOpenPosition({
        uid: caller.uid,
        plan,
        currentPrice: truth?.snapshot?.currentPrice ?? null,
        evidence,
        openSince,
    });

    if (!review) return NextResponse.json({ error: error ?? "Review failed." }, { status: 500 });

    await savePositionReview(review);
    await writeAudit({
        userId: caller.uid,
        action: "AI_REVIEW_RECORDED",
        planId,
        actor: review.model ? "ai:ai-router" : "system",
        reason: review.verdict,
        evidenceIds: review.evidence.map((e) => e.id),
    });

    return NextResponse.json({
        success: true,
        review,
        note: "Review is interpretation only. Protective actions must be applied through Smart Management (existing authorized modification path).",
    });
}
