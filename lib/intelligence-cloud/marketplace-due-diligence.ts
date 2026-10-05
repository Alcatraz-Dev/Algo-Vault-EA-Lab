/**
 * Intelligence Cloud — Marketplace Due Diligence (Phase 13)
 *
 * The previous implementation of this file invented its own numbers. It
 * produced `backtestQuality: 82`, `drawdown: 12.5`, `sampleSize: 142` and a
 * certification dated 30 days in the past *regardless of what any engine
 * actually computed* — the `backtestResult ? 82 : 0` pattern meant a single
 * truthy object produced a full set of fabricated due-diligence metrics. That
 * is the exact failure mode this phase forbids: fake intelligence presented as
 * AlgoVault-verified evidence.
 *
 * What this module does now:
 *  - reports ONLY metrics supplied by a deterministic engine,
 *  - leaves every uncomputed metric ABSENT rather than zero-filling it, so a
 *    consumer can tell "not measured" from "measured as zero",
 *  - separates SELLER PROVIDED from ALGOVAULT VERIFIED explicitly,
 *  - never emits a profitability claim.
 */

/** Evidence an engine actually produced. Every field is optional by design. */
export interface DueDiligenceEvidence {
    backtest?: {
        trades: number;
        netReturnPercent?: number;
        maxDrawdownPercent?: number;
        profitFactor?: number;
        expectancy?: number;
        dataPeriodStart?: number;
        dataPeriodEnd?: number;
    };
    oos?: { passed: boolean; netReturnPercent?: number; dataPeriodStart?: number; dataPeriodEnd?: number };
    walkForward?: { windows: number; stability?: number };
    monteCarlo?: { runs: number; survivorshipRate?: number; medianDrawdownPercent?: number };
    robustness?: {
        passed: boolean;
        sensitivities?: Array<{ parameter: string; delta: number; netReturnPercent: number }>;
    };
    executionSensitivity?: {
        passed: boolean;
        slippageScenarios?: Array<{ slippagePips: number; netReturnPercent: number }>;
    };
    regimePerformance?: Array<{ regime: string; trades: number; netReturnPercent: number }>;
}

export interface GenerateDueDiligenceInput {
    strategyId: string;
    strategyVersion?: string;
    /** Evidence an AlgoVault engine ran. Absent ⇒ seller-provided / unverified. */
    evidence?: DueDiligenceEvidence;
    /** True only when an AlgoVault engine actually executed the listed tests. */
    independentlyVerified?: boolean;
    certificationDate?: number;
    reviewDate?: number;
    snapshotId?: string;
    /** Disclosures the platform mandates; appended to computed limitations. */
    requiredDisclosures?: string[];
}

/**
 * Build marketplace due diligence from real evidence.
 *
 * `verificationStatus` reflects what happened, not what would be desirable:
 * an absent `evidence` object yields "seller-provided", never "verified".
 */
export function generateDueDiligence(input: GenerateDueDiligenceInput): import("./contracts").MarketplaceDueDiligence {
    const evidence = input.evidence ?? {};
    const hasBacktest = typeof evidence.backtest?.trades === "number" && evidence.backtest.trades > 0;
    const verified = input.independentlyVerified === true;

    const verificationStatus = verified
        ? "algovault-verified"
        : hasBacktest || Object.keys(evidence).length > 0
          ? "seller-provided"
          : "unverified";

    // Sample size is only reported when a trade count was actually observed.
    const sampleSize = hasBacktest ? evidence.backtest!.trades : undefined;

    const limitations = [
        "Backtest and research results are historical simulations and do not indicate future results.",
        "AlgoVault does not guarantee profitability.",
    ];
    if (!hasBacktest) {
        limitations.push("No completed backtest evidence was available; no performance metrics are reported.");
    }
    if (!evidence.oos) {
        limitations.push("Out-of-sample testing has not been recorded for this strategy version.");
    }
    if (!evidence.walkForward) {
        limitations.push("Walk-forward analysis has not been recorded for this strategy version.");
    }
    if (!evidence.monteCarlo) {
        limitations.push("Monte Carlo robustness testing has not been recorded for this strategy version.");
    }
    if (evidence.executionSensitivity?.passed === false) {
        limitations.push("The strategy failed execution-sensitivity testing under increased slippage.");
    }
    for (const disclosure of input.requiredDisclosures ?? []) {
        limitations.push(disclosure);
    }

    return {
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        verificationStatus,
        verificationMethod: verified
            ? "AlgoVault executed backtest, out-of-sample and robustness tests on this exact strategy version."
            : verificationStatus === "seller-provided"
              ? "Seller-provided figures. Not independently verified by AlgoVault."
              : "No verification evidence available.",
        // Only what was measured. Absent keys are omitted by the spread below.
        ...(hasBacktest ? { backtest: evidence.backtest } : {}),
        ...(evidence.oos ? { oos: evidence.oos } : {}),
        ...(evidence.walkForward ? { walkForward: evidence.walkForward } : {}),
        ...(evidence.monteCarlo ? { monteCarlo: evidence.monteCarlo } : {}),
        ...(evidence.robustness ? { robustness: evidence.robustness } : {}),
        ...(evidence.executionSensitivity ? { executionSensitivity: evidence.executionSensitivity } : {}),
        ...(evidence.regimePerformance ? { regimePerformance: evidence.regimePerformance } : {}),
        ...(sampleSize !== undefined ? { sampleSize } : {}),
        ...(input.certificationDate !== undefined ? { certificationDate: input.certificationDate } : {}),
        ...(input.reviewDate !== undefined ? { reviewDate: input.reviewDate } : {}),
        ...(input.snapshotId !== undefined ? { snapshotId: input.snapshotId } : {}),
        methodology:
            "Metrics are produced exclusively by the AlgoVault strategy and research engines on a specific, immutable strategy version. " +
            "No metric is estimated, extrapolated or filled in by default. Absent metrics mean the test was not run.",
        limitations,
    };
}
