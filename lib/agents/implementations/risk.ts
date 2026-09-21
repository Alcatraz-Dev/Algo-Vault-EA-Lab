import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "../types";
import { addEvidence, clamp, round, successOutput } from "./shared";

/**
 * Risk Analyst Agent.
 *
 * Factual, data-driven assessment of account exposure, position
 * concentration, correlated exposure and drawdown context against the
 * user's configured limits. It reports measured numbers — it never
 * requests actions.
 */

export async function riskAnalyst(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const risk = context.risk || { drawdownPercent: 0, exposureRatio: 0, positionCount: 0, correlatedExposure: 0, symbols: [] };
    const config = (context.config || {}) as Record<string, unknown>;
    const limits = ((config.riskLimits || {}) as Record<string, unknown>) || {};

    const drawdownLimit = Number(limits.maxDrawdownPercent) || 0;
    const exposureLimit = Number(limits.maxExposurePercent) || 0;
    const positionLimit = Number(limits.maxPositionCount) || 0;
    const correlateLimit = Number(limits.maxCorrelatedCluster) || 0;
    const maxDailyLoss = Number(limits.maxDailyLossPercent) || 0;

    const findings: AgentOutput["findings"] = [];
    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const warnings: string[] = [];
    const riskFlags: string[] = [];

    const used = "risk:computed";
    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: used,
        note: `drawdown ${round(risk.drawdownPercent)}% · exposure ${round(risk.exposureRatio * 100)}% · positions ${risk.positionCount} · correlated ${risk.correlatedExposure}`,
    });

    findings.push({
        id: "risk_profile",
        title: "Risk context",
        detail: `Estimated drawdown ${round(risk.drawdownPercent)}% · exposure ${round(risk.exposureRatio * 100)}% · ${risk.positionCount} open position(s) · correlated instruments ${risk.correlatedExposure}.`,
        evidence: [evId],
    });

    if (drawdownLimit > 0 && risk.drawdownPercent >= drawdownLimit) {
        riskFlags.push(`drawdown`);
        warnings.push(`Drawdown ${round(risk.drawdownPercent)}% reached the configured limit of ${drawdownLimit}%.`);
    }
    if (exposureLimit > 0 && risk.exposureRatio * 100 >= exposureLimit) {
        riskFlags.push("exposure");
        warnings.push(`Exposure ${round(risk.exposureRatio * 100)}% reached the configured limit of ${exposureLimit}%.`);
    }
    if (positionLimit > 0 && risk.positionCount >= positionLimit) {
        riskFlags.push("position_count");
        warnings.push(`Position count ${risk.positionCount} reached the configured limit of ${positionLimit}.`);
    }
    if (correlateLimit > 0 && risk.correlatedExposure >= correlateLimit) {
        riskFlags.push("correlated");
        warnings.push(`Correlated exposure cluster of ${risk.correlatedExposure} instruments reached the configured limit of ${correlateLimit}.`);
    }
    if (maxDailyLoss > 0) {
        const day = new Date().getUTCDate();
        findings.push({
            id: "risk_daily_window",
            title: "Daily limit window",
            detail: `Daily loss limit ${maxDailyLoss}% is enforced by the account layer; today's trades are not aggregated here.`,
            evidence: [evId],
        });
    }

    const severity =
        warnings.length === 0
            ? "low"
            : warnings.length === 1
                ? "medium"
                : "high";

    return successOutput({
        agentId: record.agentId,
        summary:
            warnings.length === 0
                ? `Risk context nominal — ${risk.positionCount} position(s), exposure ${round(risk.exposureRatio * 100)}%, no configured limit exceeded.`
                : `${warnings.length} configured risk limit(s) breached: ${riskFlags.join(", ")}.`,
        confidence: clamp(1 - Math.min(0.4, warnings.length * 0.15), 0, 1),
        findings,
        evidence,
        warnings,
        dataUsed,
        nextStep: "critic",
        metadata: {
            drawdownPercent: round(risk.drawdownPercent),
            exposurePercent: round(risk.exposureRatio * 100),
            positionCount: risk.positionCount,
            correlatedExposure: risk.correlatedExposure,
            riskFlags,
            severity,
        },
    });
}