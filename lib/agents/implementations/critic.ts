import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "../types";
import { addEvidence, clamp, round, successOutput } from "./shared";

/**
 * Critic Agent — REQUIRED orchestration component (spec § "Critic Agent").
 *
 * The critic actively challenges the analysis produced so far:
 *   - What could make this conclusion wrong?
 *   - What evidence is missing?
 *   - Are there contradictory signals?
 *   - Is the data stale?
 *   - Is there bias in the sample?
 *   - Are we overfitting historical patterns?
 *   - Is the conclusion stronger than the evidence?
 *
 * It produces criticism, contradictoryEvidence, missingEvidence, riskFlags
 * and a confidenceAdjustment. If `majorConflict` is true, downstream
 * workflow rules (and the notification agent) treat the result as
 * low-confidence / non-blocking.
 */

export async function criticAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const outputs = context.agentOutputs || {};
    const prior = Object.values(outputs).filter(
        (o) => o && o.agentId !== record.agentId && o.status === "success"
    );

    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const criticism: string[] = [];
    const contradictory: string[] = [];
    const missing: string[] = [];
    const riskFlags: string[] = [];

    const baselineConfidence = 0.7;
    let confidenceAdjustment = 0;

    const priorEvId = addEvidence(evidence, dataUsed, {
        dataUsed: `outputs:${prior.map((o) => o.agentId).join(",")}`,
        note: `challenging ${prior.length} prior agent output(s)`,
    });

    // 1. Sample-size bias.
    const tradeCount = Array.isArray(context.history?.trades)
        ? context.history.trades.length
        : 0;
    const strategyOut = outputs["strategy-matcher"];
    const similarity = Number(strategyOut?.metadata?.similarCount) || 0;
    if (tradeCount > 0 && tradeCount < 15) {
        criticism.push(`Only ${tradeCount} recorded trade(s) — historical claims rest on a small sample that may overfit.`);
        missing.push("more recorded trades before historical claims are treated as strong evidence.");
    }
    if (similarity > 0 && similarity < 5) {
        criticism.push(`Similarity is based on only ${similarity} historical trade(s) — that is weak evidence of a recurring setup.`);
        missing.push("a larger matching cohort to support the similarity claim.");
    }

    // 2. Contradictory signals.
    const scouted = outputs["market-scout"];
    const contextOut = outputs["market-context"];
    const volatilityOut = outputs["volatility-agent"];
    const structureOut = outputs["structure-agent"];

    if (scouted && structureOut) {
        const candidateCount = Number(scouted.metadata?.candidateCount) || 0;
        const alignedCount = Number(structureOut.metadata?.alignedCount) || 0;
        if (candidateCount > 0 && alignedCount === 0) {
            contradictory.push("Scout flags candidates while the structure agent found no aligned structure.");
            riskFlags.push("contradiction_scout_vs_structure");
        }
    }
    if (contextOut && volatilityOut && volatilityOut.warnings.length > 0) {
        const volState = String(contextOut.metadata?.volatility || "");
        if (volState !== "high" && volState !== "extreme") {
            contradictory.push("Volatility warnings exist but the context agent labelled volatility as normal.");
        }
    }

    // 3. Data freshness / staleness.
    const snap = Object.values(context.market || {})[0] as Record<string, any> | undefined;
    const ts = snap ? Number(snap.timestamp || snap.updatedAt || 0) : 0;
    if (ts > 0) {
        const ageMs = Date.now() - ts;
        if (ageMs > 15 * 60_000) {
            criticism.push(`Market snapshot is ${Math.round(ageMs / 60_000)} minutes old — analysis may be stale.`);
            riskFlags.push("stale_market_data");
            confidenceAdjustment -= 0.2;
        } else if (ageMs > 5 * 60_000) {
            criticism.push(`Market snapshot is ${Math.round(ageMs / 60_000)} minutes old.`);
            confidenceAdjustment -= 0.05;
        }
    } else if (Object.keys(context.market || {}).length === 0) {
        missing.push("live market data entirely — findings rest on history/news only.");
        riskFlags.push("no_live_market_data");
        confidenceAdjustment -= 0.25;
    }

    // 4. Conclusion stronger than evidence?
    const matchedBy = prior.filter(
        (o) => o.confidence >= 0.8 || Number(o.metadata?.matchRatio || 0) >= 0.6
    ).length;
    if (matchedBy > 0 && tradeCount < 20) {
        criticism.push("High-confidence flags were derived from a small recorded sample — the conclusion is stronger than the evidence.");
        confidenceAdjustment -= 0.1;
    }

    // 5. Evidence freshness of history.
    const trades = (context.history?.trades || []) as { closedAt?: number }[];
    if (trades.length > 0) {
        const last = trades[trades.length - 1]?.closedAt || 0;
        if (last > 0 && Date.now() - last > 30 * 86_400_000) {
            criticism.push("The most recent recorded trade is over a month old — the setup library reflects outdated behaviour.");
            riskFlags.push("stale_history");
            confidenceAdjustment -= 0.15;
        }
    }

    // 6. News overstatement.
    const newsOut = outputs["news-agent"];
    if (newsOut && (newsOut.warnings.length > 0 && Number(newsOut.metadata?.highImpactCount || 0) > 2)) {
        criticism.push("Multiple high-impact events are pending — near-event volatility can invalidate regime/structure readings.");
        confidenceAdjustment -= 0.1;
    }

    const majorConflict = contradictory.length >= 1 || confidenceAdjustment <= -0.3;
    confidenceAdjustment = clamp(confidenceAdjustment, -0.5, 0.15);
    const adjusted = clamp(baselineConfidence + confidenceAdjustment, 0, 1);

    const findings: AgentOutput["findings"] = [
        {
            id: "critic_verdict",
            title: majorConflict ? "Major conflict detected" : "No major conflict",
            detail: majorConflict
                ? `${criticism.length} criticism point(s) and ${contradictory.length} contradictory signal(s). Result must be treated as low-confidence.`
                : `No major contradiction found. ${criticism.length} minor criticism point(s) remain.`,
            evidence: [priorEvId],
        },
    ];
    if (contradictory.length > 0) {
        findings.push({
            id: "critic_contradictions",
            title: "Contradictory signals",
            detail: contradictory.join(" · "),
            evidence: [priorEvId],
        });
    }
    if (criticism.length > 0) {
        findings.push({
            id: "critic_criticism",
            title: "Criticism",
            detail: criticism.join(" · "),
            evidence: [priorEvId],
        });
    }

    return successOutput({
        agentId: record.agentId,
        summary: `Critic reviewed ${prior.length} prior output(s): ${contradictory.length} contradiction(s), ${criticism.length} criticism point(s), confidence adjusted ${confidenceAdjustment >= 0 ? "+" : ""}${round(confidenceAdjustment * 100)}% → ${round(adjusted * 100)}%.`,
        confidence: adjusted,
        findings,
        evidence,
        warnings: [...criticism, ...contradictory],
        dataUsed,
        nextStep: "verification",
        metadata: {
            majorConflict,
            criticism,
            contradictoryEvidence: contradictory,
            missingEvidence: missing,
            riskFlags,
            confidenceAdjustment: round(confidenceAdjustment, 3),
        },
    });
}