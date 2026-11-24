/**
 * Engine-agnostic purged validation runner.
 *
 * This module never backtests anything itself: it takes already-computed fold
 * results from the platform's existing engine (Strategy Lab / Strategy Engine)
 * and assembles the statistical evidence. That keeps one backtesting engine in
 * the product while making the validation layer reusable by the research
 * orchestrator, the optimizer and any future runner.
 */

import { stableHash } from "../canonical";
import { deflatedSharpeRatio, type DsrResult } from "./dsr";
import { createExperimentRecord, type ExperimentRecord, composeVerdict, type CompositeResult } from "./experiment";
import type { PurgedFold } from "./purged-cv";
import { sharpeRatio, mean as meanOf } from "./stats";

export interface FoldEvaluation {
    /** Trades produced on the training slice. */
    trainTrades: number;
    /** Trades produced on the test slice. */
    testTrades: number;
    /** Per-trade returns (R multiples) produced on the test slice. */
    testReturns: number[];
    /** Optional engine metrics for diagnostics, passed through untouched. */
    trainMetrics?: Record<string, unknown>;
    testMetrics?: Record<string, unknown>;
}

export interface PurgedValidationInput {
    folds: PurgedFold[];
    /** Calls the existing engine for each fold. Must be deterministic. */
    evaluate: (fold: PurgedFold, index: number) => FoldEvaluation;
    /**
     * Number of configurations explored before this one was selected.
     * Required for a DSR; omit and the DSR is reported unavailable.
     */
    trials?: number;
    /** Variance of Sharpe across those configurations (required when trials > 1). */
    trialSharpeVariance?: number;
    seed?: number | null;
    createdAt?: number;
    /** Free-form parameters recorded verbatim in the experiment record. */
    parameters?: Record<string, unknown>;
}

export interface FoldSummary {
    index: number;
    trainSize: number;
    testSize: number;
    trainTrades: number;
    testTrades: number;
    testSharpe: number | null;
    testMeanReturn: number;
}

export interface PurgedValidationResult {
    folds: FoldSummary[];
    /** Pooled out-of-sample trade returns across every fold. */
    pooledTestReturns: number[];
    pooledTestSharpe: number | null;
    totalTestTrades: number;
    totalTrainTrades: number;
    foldsWithoutTrades: number;
    dsr: DsrResult;
    composite: CompositeResult;
    experiment: ExperimentRecord;
    limitations: string[];
}

export function runPurgedValidation(input: PurgedValidationInput): PurgedValidationResult {
    if (!Array.isArray(input.folds) || input.folds.length === 0) {
        throw new Error("runPurgedValidation requires at least one fold.");
    }

    const summaries: FoldSummary[] = [];
    const pooled: number[] = [];
    let totalTestTrades = 0;
    let totalTrainTrades = 0;
    let foldsWithoutTrades = 0;

    input.folds.forEach((fold, index) => {
        const evaluation = input.evaluate(fold, index);
        if (!evaluation || !Array.isArray(evaluation.testReturns)) {
            throw new Error(`Fold ${index} returned no evaluation.`);
        }
        if (evaluation.testReturns.some((r) => !Number.isFinite(r))) {
            throw new Error(`Fold ${index} returned non-finite test returns.`);
        }
        totalTestTrades += evaluation.testTrades;
        totalTrainTrades += evaluation.trainTrades;
        if (evaluation.testTrades === 0) foldsWithoutTrades++;
        pooled.push(...evaluation.testReturns);
        summaries.push({
            index,
            trainSize: fold.train.length,
            testSize: fold.test.length,
            trainTrades: evaluation.trainTrades,
            testTrades: evaluation.testTrades,
            testSharpe: sharpeRatio(evaluation.testReturns),
            testMeanReturn: meanOf(evaluation.testReturns),
        });
    });

    const dsr =
        input.trials === undefined
            ? ({ available: false, reason: "The number of configurations explored (trials) was not recorded, so the selection bias cannot be adjusted for." } as DsrResult)
            : deflatedSharpeRatio({
                  returns: pooled,
                  trials: input.trials,
                  trialSharpeVariance: input.trialSharpeVariance,
              });

    const composite = composeVerdict({
        dsr: dsr.available ? dsr.dsr : null,
        pbo: null,
        observations: pooled.length,
        hasOosTrades: totalTestTrades > 0,
    });

    const experiment = createExperimentRecord({
        method: "PURGED_KFOLD",
        parameters: {
            folds: input.folds.length,
            foldSizes: summaries.map((f) => ({ train: f.trainSize, test: f.testSize })),
            trials: input.trials ?? null,
            trialSharpeVariance: input.trialSharpeVariance ?? null,
            ...(input.parameters ?? {}),
        },
        dataFingerprint: stableHash(input.folds.map((f) => ({ train: f.train, test: f.test }))),
        seed: input.seed ?? null,
        createdAt: input.createdAt,
    });

    const limitations = [
        "Purged folds remove label overlap and embargo leakage; they do not correct a biased dataset.",
        "Pooled out-of-sample returns are concatenated across folds and inherit each fold's regime mix.",
        "DSR is a multiple-testing adjustment, not a forecast of live performance.",
    ];
    if (foldsWithoutTrades > 0) {
        limitations.push(`${foldsWithoutTrades} fold(s) produced no test trades and contribute no evidence.`);
    }
    if (input.trials === undefined) {
        limitations.push("Trials were not recorded, so no DSR was computed.");
    }

    return {
        folds: summaries,
        pooledTestReturns: pooled,
        pooledTestSharpe: sharpeRatio(pooled),
        totalTestTrades,
        totalTrainTrades,
        foldsWithoutTrades,
        dsr,
        composite,
        experiment,
        limitations,
    };
}
