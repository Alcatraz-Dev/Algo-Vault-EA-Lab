import { AgentExecutionRecord, AgentOutput, EvidenceStrength, WorkflowContext, WorkflowFinalOutput } from "../types";
import { addEvidence, clamp, firstSnapshot, round, successOutput } from "./shared";

/**
 * Synthesis Agent (spec § "Synthesis Agent").
 *
 * Produces the final structured intelligence. It receives every prior agent
 * output, the critic's verdict and the verification result, then:
 *   1. summarizes the situation,
 *   2. distinguishes facts from inference,
 *   3. includes uncertainty,
 *   4. identifies conflicts,
 *   5. produces a structured final output,
 *   6. decides whether a notification is warranted.
 *
 * It does NOT blindly follow previous agents: critic + verification findings
 * can degrade the conclusion and suppress the notification.
 */

export async function synthesizer(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const outputs = context.agentOutputs;
    const criticOut = outputs["critic"];
    const verifyOut = outputs["verification"];
    const riskOut = outputs["risk-analyst"];
    const strategyOut = outputs["strategy-matcher"];
    const contextOut = outputs["market-context"];
    const scoutOut = outputs["market-scout"];

    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const allUsed = addEvidence(evidence, dataUsed, {
        dataUsed: `outputs:${Object.keys(outputs).join(",")}`,
        note: "full pipeline output set for final synthesis",
    });

    const facts: string[] = [];
    const inferences: string[] = [];
    const uncertainty: string[] = [];
    const conflicts: string[] = [];

    const snap = firstSnapshot(context);
    const regime = String(contextOut?.metadata?.regime || snap?.snap?.regime?.regime || "unknown");
    const volatility = String(contextOut?.metadata?.volatility || snap?.snap?.volatility?.state || "normal");
    const session = String(contextOut?.metadata?.session || snap?.snap?.session?.current || "unknown");
    const structureCount = Number(contextOut?.metadata?.structureCount) || 0;

    // Facts: everything measured.
    if (snap) facts.push(`${snap.symbol}: measured regime ${regime}, ${volatility} volatility, ${structureCount} structure event(s), ${session} session.`);
    const tradeCount = Array.isArray(context.history?.trades) ? context.history.trades.length : 0;
    if (tradeCount > 0) facts.push(`${tradeCount} recorded trade(s) in the historical fingerprint library.`);
    const risk = context.risk || { drawdownPercent: 0, exposureRatio: 0, positionCount: 0, correlatedExposure: 0 };
    facts.push(`Current position count ${risk.positionCount}, exposure ${round(risk.exposureRatio * 100)}%, correlated cluster ${risk.correlatedExposure}.`);

    // Inference: similarity.
    const similar = Number(strategyOut?.metadata?.similarCount) || 0;
    if (similar > 0) {
        inferences.push(`Current conditions resemble ${similar} recorded setup(s) from the same session context.`);
    } else {
        uncertainty.push("No historical similarity could be established.");
    }
    if (scoutOut && Number(scoutOut.metadata?.candidateCount) > 0) {
        inferences.push("Scout flagged candidate conditions on the monitored instruments.");
    }

    // Conflicts.
    if (criticOut?.metadata?.majorConflict === true) {
        conflicts.push("The critic found a major contradiction in the analysis.");
    }
    const riskFlags: string[] = Array.isArray(riskOut?.metadata?.riskFlags) ? (riskOut.metadata.riskFlags as string[]) : [];
    if (riskFlags.length > 0) {
        conflicts.push(`Risk flags raised: ${riskFlags.join(", ")}.`);
    }
    if (verifyOut && verifyOut.metadata?.passed === false) {
        conflicts.push("Verification failed — result cannot be presented as high-confidence.");
    }

    // Evidence strength.
    let evidenceStrength: EvidenceStrength = "moderate";
    const criticAdj = Number(criticOut?.metadata?.confidenceAdjustment) || 0;
    const verifyOk = verifyOut?.metadata?.passed === true;
    const sampleWeak = tradeCount > 0 && tradeCount < 15;
    const stale = Array.isArray(criticOut?.metadata?.riskFlags) && (criticOut.metadata.riskFlags as string[]).includes("stale_market_data");
    if (criticOut?.metadata?.majorConflict === true || !verifyOk) {
        evidenceStrength = "conflicting";
    } else if (stale) {
        evidenceStrength = "limited";
    } else if (sampleWeak) {
        evidenceStrength = "limited";
    } else if (similar >= 5 && tradeCount >= 15 && riskFlags.length === 0) {
        evidenceStrength = "strong";
    } else if (tradeCount === 0 && similar === 0) {
        evidenceStrength = "insufficient";
    }

    if (riskFlags.length > 0) uncertainty.push("Breached risk limits reduce the actionability of the analysis.");
    if (criticAdj <= -0.3) uncertainty.push("The critic materially reduced confidence.");

    // Notification decision — synthesis does not blindly follow prior stages.
    const majorConflict = criticOut?.metadata?.majorConflict === true;
    const verified = verifyOk !== false;
    const hasActionableContext = Boolean(snap);
    const warranted = hasActionableContext && verified && !majorConflict && riskFlags.length < 2;
    const reason = !hasActionableContext
        ? "No market snapshot available — nothing actionable."
        : !verified
            ? "Verification failed — no notification."
            : majorConflict
                ? "Critic reported a major conflict — no notification."
                : riskFlags.length >= 2
                    ? "Multiple risk limits breached — notify as low-confidence information only."
                    : `Conditions are worth reviewing (evidence: ${evidenceStrength}).`;

    const titleParts = [snap?.symbol || "Market"];
    const title = `🧠 AlgoVault Intelligence — ${titleParts[0]} ${snap?.snap?.timeframe || ""}`.trim();
    const message = [
        `Context: ${regime} regime · ${volatility} volatility · ${structureCount} structure event(s) · ${session} session.`,
        `Similarity: ${similar > 0 ? `${similar} recorded setup(s) match` : "no historical match"}.`,
        `Risk: exposure ${round(risk.exposureRatio * 100)}% · positions ${risk.positionCount} · correlated ${risk.correlatedExposure}.`,
        `Critic: ${criticOut && criticOut.findings.find((f) => f.id === "critic_verdict")?.title || "no verdict"}.`,
        `Conclusion: ${reason}`,
    ].join("\n");

    const finalOutput: WorkflowFinalOutput = {
        workflowId: record.workflowId,
        executionId: record.executionId,
        status: "success",
        title,
        summary: reason,
        context: {
            symbols: Object.keys(context.market || {}),
            regime,
            volatility,
            structure: structureCount > 0 ? `${structureCount} event(s)` : undefined,
            session,
        },
        evidenceStrength,
        facts,
        inferences,
        uncertainty,
        conflicts,
        critic: {
            majorConflict,
            criticism: (criticOut?.metadata?.criticism as string[]) || [],
            contradictoryEvidence: (criticOut?.metadata?.contradictoryEvidence as string[]) || [],
            missingEvidence: (criticOut?.metadata?.missingEvidence as string[]) || [],
            riskFlags: (criticOut?.metadata?.riskFlags as string[]) || [],
            confidenceAdjustment: Number(criticOut?.metadata?.confidenceAdjustment) || 0,
        },
        risk: {
            drawdownPercent: round(risk.drawdownPercent),
            exposureRatio: round(risk.exposureRatio),
            positionCount: risk.positionCount,
            correlatedExposure: risk.correlatedExposure,
            flags: riskFlags,
        },
        notify: {
            warranted,
            reason,
            severity: majorConflict || riskFlags.length >= 2 ? "low" : evidenceStrength === "strong" ? "high" : "medium",
            title,
            message,
        },
    };

    const findings: AgentOutput["findings"] = [
        {
            id: "synthesis_verdict",
            title: `Evidence: ${evidenceStrength}`,
            detail: `${verified ? "Verification passed" : "Verification flagged issues"} · critic ${majorConflict ? "found a major conflict" : "no major conflict"} · ${facts.length} fact(s), ${inferences.length} inference(s), ${uncertainty.length} uncertainty note(s).`,
            evidence: [allUsed],
        },
        {
            id: "synthesis_notification",
            title: "Notification decision",
            detail: `Warranted: ${warranted ? "yes" : "no"} — ${reason}`,
            evidence: [allUsed],
        },
    ];

    const confidence = clamp(
        0.5 +
            (evidenceStrength === "strong" ? 0.25 : evidenceStrength === "moderate" ? 0.1 : evidenceStrength === "limited" ? -0.1 : evidenceStrength === "conflicting" ? -0.3 : -0.2) +
            (criticAdj || 0),
        0,
        1
    );

    return successOutput({
        agentId: record.agentId,
        summary: `Final synthesis complete — evidence ${evidenceStrength}, notification ${warranted ? "warranted" : "not warranted"}.`,
        confidence,
        findings,
        evidence,
        warnings: conflicts,
        dataUsed,
        nextStep: "notify",
        aiEnhanced: false,
        metadata: { finalOutput },
    });
}