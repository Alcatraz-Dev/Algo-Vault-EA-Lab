/**
 * Evidence report — the human/UI view of one validation run.
 *
 * Every stage line carries the same status the pipeline attested to, plus the
 * execution id that makes the result traceable. `evidenceStatus` is derived,
 * never assumed: a report with missing stages says so instead of implying the
 * strategy was validated.
 */

import type { StageResult, ValidationPipelineResult } from "./pipeline";

export interface EvidenceReportCandidate {
    evidenceDefinition?: unknown;
    [key: string]: unknown;
}

export interface EvidenceReport {
    pattern: unknown;
    stages: Array<{
        stage: string;
        status: string;
        resultId: string | null;
        note: string | null;
        executedAt: number | null;
        executionId: string | null;
        engine: string | null;
        observations: string[];
    }>;
    evidenceStatus: string;
    validationId: string | null;
    limitations: string[];
    dataQuality: string;
}

export function buildEvidenceReport(
    candidate: EvidenceReportCandidate | null | undefined,
    stages: readonly StageResult[],
    pipeline?: ValidationPipelineResult,
): EvidenceReport {
    const typed = stages ?? [];
    const evidenceStatus =
        pipeline?.evidenceStatus ??
        (typed.some((s) => s.status === "FAILED")
            ? "FAILED"
            : typed.length > 0 && typed.every((s) => s.status === "COMPLETED")
              ? "EVIDENCE_COMPLETE"
              : "INCOMPLETE");

    return {
        pattern: candidate?.evidenceDefinition,
        stages: typed.map((s) => ({
            stage: s.stage,
            status: s.status,
            resultId: s.resultId ?? null,
            note: s.note ?? null,
            executedAt: s.executedAt ?? null,
            executionId: s.evidence?.executionId ?? null,
            engine: s.evidence?.engine ?? null,
            observations: s.evidence?.observations ?? [],
        })),
        evidenceStatus,
        validationId: pipeline?.validationId ?? null,
        limitations: [
            "Results are historical simulations, not future predictions.",
            "Backtest uses next_bar_open.",
            "OOS is an unseen validation period only when the split was produced by the validation engine.",
            "Monte Carlo resamples actual trades.",
            "A completed validation is not a certification of profitability.",
        ],
        dataQuality: "Refer to the existing data-quality report.",
    };
}
