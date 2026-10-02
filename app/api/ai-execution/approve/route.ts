/**
 * AI Execution — explicit user approval / withdrawal.
 *
 * An approval-mode plan moves PENDING_APPROVAL → SUBMITTED only through this
 * route, which re-runs the FULL deterministic gate server-side before
 * submitting. A stale, expired, kill-switched or risk-failing plan is never
 * executed even if the UI showed an approve button a second earlier.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, runServerGate, submitApprovedPlan } from "@/lib/ai-execution/runtime";
import { getPlan, updatePlan, writeAudit } from "@/lib/ai-execution/database";

export async function POST(request: NextRequest) {
    const caller = await requireCaller(request);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const planId = typeof body.planId === "string" ? body.planId : "";
    const action = body.action === "withdraw" ? "withdraw" : "approve";
    if (!planId) return NextResponse.json({ error: "planId is required." }, { status: 400 });

    const plan = await getPlan(caller.uid, planId);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

    if (action === "withdraw") {
        if (plan.status !== "PENDING_APPROVAL") {
            return NextResponse.json({ error: `Plan status ${plan.status} cannot be withdrawn.` }, { status: 409 });
        }
        await updatePlan(caller.uid, planId, { status: "CANCELLED", rejectionReason: "WITHDRAWN_BY_USER" });
        await writeAudit({ userId: caller.uid, action: "APPROVAL_WITHDRAWN", planId, actor: caller.uid });
        return NextResponse.json({ success: true, status: "CANCELLED" });
    }

    // Approve + execute path: the deterministic gate is re-run NOW, server-side.
    if (plan.status !== "PENDING_APPROVAL" && plan.status !== "VALIDATING") {
        return NextResponse.json({ error: `Plan status ${plan.status} is not awaiting approval.` }, { status: 409 });
    }

    // Kill switch check happens inside runServerGate's policy stage via the
    // loaded context; an engaged switch forces REJECT before submission.
    const { result } = await runServerGate(plan, caller);
    if (result.decision === "REJECT") {
        await updatePlan(caller.uid, planId, {
            status: "REJECTED",
            rejectionStage: result.finalCode as never,
            rejectionReason: result.reason ?? result.finalCode,
        });
        await writeAudit({
            userId: caller.uid,
            action: "EXECUTION_REJECTED",
            planId,
            actor: caller.uid,
            reason: `${result.finalCode}: ${result.reason ?? ""}`,
            riskChecks: result.checks.map((c) => ({ stage: c.stage, passed: c.passed, code: c.code })),
        });
        return NextResponse.json({ error: `Execution refused: ${result.finalCode} — ${result.reason ?? ""}`, checks: result.checks }, { status: 403 });
    }

    await updatePlan(caller.uid, planId, { status: "APPROVED" });
    await writeAudit({
        userId: caller.uid,
        action: "APPROVAL_GRANTED",
        planId,
        actor: caller.uid,
        executionMode: plan.executionMode,
        evidenceIds: plan.evidence.map((e) => e.id),
        riskChecks: result.checks.map((c) => ({ stage: c.stage, passed: c.passed, code: c.code })),
    });

    const volume = result.orderVolume ?? 0.01;
    const submission = await submitApprovedPlan({ ...plan, executionMode: plan.executionMode }, caller, volume);
    if (!submission.ok) {
        return NextResponse.json({ error: submission.error ?? "Submission failed." }, { status: 502 });
    }

    return NextResponse.json({
        success: true,
        status: "SUBMITTED",
        clientOrderId: submission.clientOrderId,
        mt5Account: submission.mt5Account,
        note: "Order queued through the existing gateway path — the real MT5 ticket arrives via gateway confirmation.",
    });
}
