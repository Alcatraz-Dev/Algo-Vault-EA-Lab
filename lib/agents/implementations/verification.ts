import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "../types";
import { addEvidence, clamp, round, successOutput } from "./shared";

/**
 * Verification Agent (spec § "Verification Agent").
 *
 * Checks the pipeline result for data consistency, schema validity, stale
 * data, missing fields, conflicting agent outputs and unsupported claims.
 * If verification fails, the executor must NOT present the result as
 * high-confidence.
 */

const REQUIRED_OUTPUT_FIELDS: (keyof AgentOutput)[] = [
    "agentId",
    "status",
    "confidence",
    "summary",
    "findings",
    "evidence",
    "dataUsed",
];

const UNSUPPORTED_PATTERNS = [
    /\bguaranteed\b/i,
    /\bbuy now\b/i,
    /\bsell now\b/i,
    /100%\s*(win|profit|success)/i,
    /\brisk[- ]?free\b/i,
];

export async function verificationAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const outputs = context.agentOutputs || {};
    const prior = Object.values(outputs).filter((o) => o && o.status === "success");

    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const problems: string[] = [];
    const warnings: string[] = [];

    const priorEvId = addEvidence(evidence, dataUsed, {
        dataUsed: `outputs:${prior.map((o) => o.agentId).join(",")}`,
        note: "schema + consistency verification of prior outputs",
    });

    // 1. Schema validity: every prior output has the required contract fields.
    for (const out of prior) {
        for (const field of REQUIRED_OUTPUT_FIELDS) {
            if (out[field] === undefined || out[field] === null) {
                problems.push(`${out.agentId} is missing contract field "${field}".`);
            }
        }
        if (typeof out.confidence !== "number" || out.confidence < 0 || out.confidence > 1) {
            problems.push(`${out.agentId} has an out-of-range confidence.`);
        }
    }

    // 2. Evidence integrity: findings reference evidence ids that exist.
    for (const out of prior) {
        for (const finding of out.findings || []) {
            for (const ref of finding.evidence || []) {
                const exists = (out.evidence || []).some((e) => e.id === ref);
                if (!exists) {
                    problems.push(`${out.agentId} finding "${finding.title}" references missing evidence ${ref}.`);
                }
            }
        }
    }

    // 3. Data consistency: evidence entries reference real dataUsed entries.
    for (const out of prior) {
        for (const ev of out.evidence || []) {
            if (!out.dataUsed.includes(ev.dataUsed)) {
                problems.push(`${out.agentId} evidence ${ev.id} reads "${ev.dataUsed}" which is not in its declared dataUsed list.`);
            }
        }
    }

    // 4. Stale market data.
    const marketEntries = Object.entries(context.market || {});
    const snap = marketEntries[0]?.[1] as Record<string, any> | undefined;
    const ts = snap ? Number(snap.timestamp || snap.updatedAt || 0) : 0;
    const ageMs = ts > 0 ? Date.now() - ts : -1;
    if (marketEntries.length > 0 && ageMs >= 0 && ageMs > 15 * 60_000) {
        warnings.push(`Market data is ${Math.round(ageMs / 60_000)} minutes old.`);
    } else if (marketEntries.length === 0) {
        warnings.push("No live market data was present for verification.");
    }

    // 5. Unsupported claims (no guaranteed outcomes).
    for (const out of prior) {
        const text = `${out.summary} ${(out.findings || []).map((f) => f.detail).join(" ")}`;
        if (UNSUPPORTED_PATTERNS.some((re) => re.test(text))) {
            problems.push(`${out.agentId} contains an unsupported outcome claim.`);
        }
    }

    // 6. Conflicting outputs (critic metadata).
    const criticOut = outputs["critic"];
    if (criticOut?.metadata?.majorConflict === true) {
        warnings.push("Critic reported a major conflict — result must stay low-confidence.");
    }

    const passed = problems.length === 0;
    const confidence = clamp(
        passed ? 0.9 - Math.min(0.3, warnings.length * 0.1) : 0.35,
        0,
        1
    );

    const findings: AgentOutput["findings"] = [
        {
            id: "verification_verdict",
            title: passed ? "Verification passed" : "Verification failed",
            detail: passed
                ? `${prior.length} output(s) passed schema, evidence-integrity and claim checks. ${warnings.length} warning(s) logged.`
                : `${problems.length} problem(s) found: ${problems.slice(0, 5).join(" · ")}`,
            evidence: [priorEvId],
        },
    ];

    return successOutput({
        agentId: record.agentId,
        summary: `Verification ${passed ? "passed" : "failed"} — ${problems.length} problem(s), ${warnings.length} warning(s) across ${prior.length} output(s).`,
        confidence,
        findings,
        evidence,
        warnings: [...problems, ...warnings],
        dataUsed,
        nextStep: passed ? "synthesis" : "remediate",
        metadata: { passed, problems: problems.length, strict: passed },
    });
}