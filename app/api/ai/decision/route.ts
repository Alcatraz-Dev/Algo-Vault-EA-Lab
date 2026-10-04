import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { orchestrateDecision, isUnifiedIntelligenceEnabled, type MarketIntelligenceContext } from "@/lib/intelligence";
import { evaluateOrder, RiskLimits, AccountRiskState, OrderIntent } from "@/lib/risk/risk-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/decision
 * Runs the Decision Orchestrator over caller-supplied compact market context.
 *
 * The Risk Engine is invoked server-side through the canonical evaluateOrder —
 * the client can never mark risk as PASS. Without an orderIntent the decision
 * is informational (no risk stage).
 *
 * Body: { context: MarketIntelligenceContext, proposedDirection, orderIntent?, riskLimits?, accountState? }
 */
export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        let uid: string | null = null;
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            uid = decoded.uid;
        } catch {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        if (!uid || !isUnifiedIntelligenceEnabled()) {
            return NextResponse.json({ success: false, error: "UNAVAILABLE" }, { status: 404 });
        }

        const body = (await req.json().catch(() => null)) as
            | {
                  context?: MarketIntelligenceContext;
                  proposedDirection?: string;
                  orderIntent?: OrderIntent;
                  riskLimits?: RiskLimits;
                  accountState?: AccountRiskState;
              }
            | null;
        if (!body?.context || typeof body.context !== "object") {
            return NextResponse.json({ success: false, error: "INVALID_REQUEST", message: "context (MarketIntelligenceContext) is required." }, { status: 400 });
        }
        const ctx = body.context;
        if (ctx.schema !== "mic-1") {
            return NextResponse.json({ success: false, error: "UNSUPPORTED_CONTEXT_SCHEMA", message: `Expected mic-1, got ${ctx.schema ?? "none"}.` }, { status: 400 });
        }

        const rawDir = String(body.proposedDirection || "HOLD").toUpperCase();
        const proposedDirection = rawDir === "BUY" ? "BUY" : rawDir === "SELL" ? "SELL" : "HOLD";

        const decision = await orchestrateDecision({
            ctx,
            proposedDirection,
            userId: uid,
            executionAdjacent: Boolean(body.orderIntent),
            evaluateRisk: body.orderIntent
                ? () => evaluateOrder(body.orderIntent!, body.riskLimits ?? {}, body.accountState ?? {})
                : undefined,
        });

        return NextResponse.json({
            success: true,
            decision: {
                requestId: decision.requestId,
                direction: decision.direction,
                state: decision.state,
                confidence: decision.confidence,
                rationale: decision.rationale,
                factors: decision.factors,
                jev: decision.jev
                    ? { decision: decision.jev.decision, confidence: decision.jev.confidence, status: decision.jev.validationStatus, answers: decision.jev.answers }
                    : null,
                llm: decision.llm ?? null,
                risk: decision.risk ?? null,
                validationStatus: decision.validationStatus,
                versions: decision.versions,
                timestamp: decision.timestamp,
            },
        });
    } catch (err) {
        console.error("[api/ai/decision] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
