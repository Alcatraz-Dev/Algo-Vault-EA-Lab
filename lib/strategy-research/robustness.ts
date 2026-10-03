// ─────────────────────────────────────────────────────────────────────────────
// Robustness + overfitting analysis — deterministic research-quality layer.
//
// Every warning is generated from MEASURED outputs of the existing engines
// (backtest metrics, OOS/walk-forward outcome, Monte Carlo tail, execution
// variation runs). AI may later *explain* these warnings, but never creates or
// dismisses them. Negative results are never hidden: the report always lists
// every dimension, including the ones that were skipped (with the reason).
// ─────────────────────────────────────────────────────────────────────────────

import type {
    CandidateEvaluation,
    ResearchMissionSpec,
    ResearchWarning,
    RobustnessDimensionResult,
    RobustnessReport,
} from "./types";

const fmt = (n: number, digits = 1) => Number(n.toFixed(digits));

function oosWarnings(evaluation: CandidateEvaluation, spec: ResearchMissionSpec): ResearchWarning[] {
    const warnings: ResearchWarning[] = [];
    const v = evaluation.validation?.outcome;
    if (!v) {
        if (spec.requireOOS) {
            warnings.push({
                type: "missing_validation",
                severity: "high",
                message: "Out-of-sample validation was required by the mission but no result is available.",
                evidence: ["validation outcome missing"],
            });
        }
        return warnings;
    }
    const deg = v.degradation.overall;
    if (deg >= 12) {
        warnings.push({
            type: "oos_degradation",
            severity: "high",
            message: `Out-of-sample degradation ${fmt(deg)} is high — the in-sample edge did not persist.`,
            evidence: [
                `degradation.overall=${fmt(deg)}`,
                `winRateDiff=${fmt(v.degradation.winRateDiff, 2)}`,
                `profitFactorDiff=${fmt(v.degradation.profitFactorDiff, 2)}`,
                `maxDrawdownDiff=${fmt(v.degradation.maxDrawdownDiff, 2)}`,
                `verdict=${v.verdict}`,
            ],
        });
    } else if (deg >= 5 || v.verdict === "marginal" || v.verdict === "fragile") {
        warnings.push({
            type: "oos_degradation",
            severity: "medium",
            message: `Out-of-sample results diverge from in-sample results (degradation ${fmt(deg)}, verdict ${v.verdict}).`,
            evidence: [`degradation.overall=${fmt(deg)}`, `verdict=${v.verdict}`],
        });
    }
    const oosTrades = Math.min(v.outOfSample.trades, v.outOfSample.metrics.totalTrades);
    if (v.inSample.metrics.totalTrades > 0 && oosTrades === 0) {
        warnings.push({
            type: "oos_degradation",
            severity: "high",
            message: "The out-of-sample window produced zero trades — OOS behavior is unproven.",
            evidence: [
                `inSample trades=${v.inSample.metrics.totalTrades}`,
                `outOfSample trades=${v.outOfSample.trades}`,
            ],
        });
    }
    return warnings;
}

function walkForwardWarnings(evaluation: CandidateEvaluation, spec: ResearchMissionSpec): ResearchWarning[] {
    const warnings: ResearchWarning[] = [];
    const wf = evaluation.validation?.outcome.walkForward;
    if (!wf) return warnings;
    if (spec.requireWalkForward && !wf.enabled) {
        warnings.push({
            type: "missing_validation",
            severity: "high",
            message: "Walk-forward validation was required by the mission but could not run (insufficient data).",
            evidence: ["walkForward.enabled=false"],
        });
        return warnings;
    }
    if (!wf.enabled) return warnings;
    if (wf.windows.length === 0) {
        warnings.push({
            type: "walk_forward_unstable",
            severity: spec.requireWalkForward ? "high" : "medium",
            message: "Walk-forward produced no usable train/test windows.",
            evidence: ["windows=0"],
        });
    } else if (!wf.stable) {
        warnings.push({
            type: "walk_forward_unstable",
            severity: "high",
            message: `Walk-forward windows are unstable (stability ${fmt(wf.stabilityScore)}).`,
            evidence: [
                `windows=${wf.windows.length}`,
                `stabilityScore=${fmt(wf.stabilityScore)}`,
                `avg degradation=${fmt(
                    wf.windows.reduce((s, w) => s + w.degradationPct, 0) / wf.windows.length
                )}`,
            ],
        });
    }
    return warnings;
}

function sampleWarnings(evaluation: CandidateEvaluation): ResearchWarning[] {
    const warnings: ResearchWarning[] = [];
    const m = evaluation.backtest?.metrics;
    if (!m) return warnings;
    if (m.totalTrades < 20) {
        warnings.push({
            type: "insufficient_trades",
            severity: "high",
            message: `Only ${m.totalTrades} trades in the test window — statistically insufficient.`,
            evidence: [`totalTrades=${m.totalTrades}`, "minimum for ranking=10, comfort=50"],
        });
    } else if (m.totalTrades < 50) {
        warnings.push({
            type: "insufficient_trades",
            severity: "medium",
            message: `${m.totalTrades} trades — below the 50-trade comfort threshold.`,
            evidence: [`totalTrades=${m.totalTrades}`],
        });
    }
    return warnings;
}

function concentrationWarnings(evaluation: CandidateEvaluation): ResearchWarning[] {
    const warnings: ResearchWarning[] = [];
    const d = evaluation.backtest?.distribution;
    if (!d) return warnings;
    if (d.topMonthSharePct >= 60 && d.monthsCovered >= 3) {
        warnings.push({
            type: "date_range_dependence",
            severity: d.topMonthSharePct >= 80 ? "high" : "medium",
            message: `${d.topMonthSharePct}% of positive PnL came from a single month — results depend on a narrow date range.`,
            evidence: [`topMonthSharePct=${d.topMonthSharePct}`, `monthsCovered=${d.monthsCovered}`],
        });
    }
    if (d.profitableMonthShare < 0.4 && d.monthsCovered >= 4) {
        warnings.push({
            type: "date_range_dependence",
            severity: "medium",
            message: `Only ${Math.round(d.profitableMonthShare * 100)}% of traded months were profitable.`,
            evidence: [`profitableMonthShare=${d.profitableMonthShare}`, `monthsCovered=${d.monthsCovered}`],
        });
    }
    if (d.topRegimeSharePct >= 70) {
        warnings.push({
            type: "regime_dependence",
            severity: d.topRegimeSharePct >= 85 ? "high" : "medium",
            message: `${d.topRegimeSharePct}% of net PnL came from one market regime — regime-dependent edge.`,
            evidence: [`topRegimeSharePct=${d.topRegimeSharePct}`],
        });
    }
    return warnings;
}

function monteCarloWarnings(evaluation: CandidateEvaluation, spec: ResearchMissionSpec): ResearchWarning[] {
    const warnings: ResearchWarning[] = [];
    const mc = evaluation.monteCarlo?.summary;
    if (!mc) {
        if (spec.requireMonteCarlo) {
            warnings.push({
                type: "missing_validation",
                severity: "high",
                message: "Monte Carlo analysis was required by the mission but no result is available.",
                evidence: ["monteCarlo missing"],
            });
        }
        return warnings;
    }
    if (mc.simulations === 0) {
        warnings.push({
            type: "monte_carlo_fragile",
            severity: "high",
            message: "Monte Carlo could not run on the available trade sample.",
            evidence: mc.limitations.length > 0 ? mc.limitations : [`sourceTradeCount=${mc.sourceTradeCount}`],
        });
        return warnings;
    }
    if (mc.profitProbability !== null && mc.profitProbability < 0.35) {
        warnings.push({
            type: "monte_carlo_fragile",
            severity: "high",
            message: `Only ${(mc.profitProbability * 100).toFixed(0)}% of resampled paths ended profitable.`,
            evidence: [
                `profitProbability=${(mc.profitProbability * 100).toFixed(1)}%`,
                `simulations=${mc.simulations}`,
                `returnP5=${mc.returnP5 !== null ? (mc.returnP5 * 100).toFixed(1) + "%" : "n/a"}`,
            ],
        });
    } else if (mc.profitProbability !== null && mc.profitProbability < 0.5) {
        warnings.push({
            type: "monte_carlo_fragile",
            severity: "medium",
            message: `Monte Carlo profit probability is ${(mc.profitProbability * 100).toFixed(0)}% — below an even coin flip.`,
            evidence: [`profitProbability=${(mc.profitProbability * 100).toFixed(1)}%`, `simulations=${mc.simulations}`],
        });
    }
    if (mc.drawdownP95 !== null && mc.drawdownP95 >= 0.25) {
        warnings.push({
            type: "monte_carlo_fragile",
            severity: "medium",
            message: `95th-percentile resampled drawdown is ${(mc.drawdownP95 * 100).toFixed(0)}%.`,
            evidence: [`drawdownP95=${(mc.drawdownP95 * 100).toFixed(1)}%`],
        });
    }
    return warnings;
}

function executionWarnings(evaluation: CandidateEvaluation): ResearchWarning[] {
    const warnings: ResearchWarning[] = [];
    const ev = evaluation.executionVariation;
    if (!ev) return warnings;
    const base = ev.baseNet;
    if (Math.abs(base) < 1e-9) return warnings;
    const spreadDrop = (base - ev.spreadDoubledNet) / Math.abs(base);
    const slippageDrop = (base - ev.slippageDoubledNet) / Math.abs(base);
    if (base > 0 && (spreadDrop >= 0.5 || slippageDrop >= 0.5)) {
        warnings.push({
            type: "execution_sensitivity",
            severity: spreadDrop >= 1 || slippageDrop >= 1 ? "high" : "medium",
            message: "Net profit collapses under doubled spread/slippage — the edge is execution-sensitive.",
            evidence: [
                `baseNet=${fmt(base, 2)}`,
                `spreadDoubledNet=${fmt(ev.spreadDoubledNet, 2)}`,
                `slippageDoubledNet=${fmt(ev.slippageDoubledNet, 2)}`,
            ],
        });
    }
    if (base < 0) {
        warnings.push({
            type: "unrealistic_assumptions",
            severity: "medium",
            message: "Base configuration is net-negative; positive results elsewhere would depend on cost assumptions.",
            evidence: [`baseNet=${fmt(base, 2)}`],
        });
    }
    return warnings;
}

function parameterWarnings(evaluation: CandidateEvaluation): ResearchWarning[] {
    const warnings: ResearchWarning[] = [];
    const r = evaluation.robustness;
    if (!r) return warnings;
    // The robustness engine defaults parameterSensitivity to 30 when NO grid
    // search exists — that is "unknown", not "measured", so it is not a signal.
    // Only a measured low factor (grid search present would set >0 by spread)
    // fires here; with research missions we record it as an explicit unknown.
    if (r.factors.parameterSensitivity <= 25) {
        warnings.push({
            type: "parameter_sensitivity",
            severity: "high",
            message: "Parameter grid shows large performance spread across neighboring settings.",
            evidence: [`parameterSensitivity=${r.factors.parameterSensitivity}`],
        });
    }
    if (r.grade === "D") {
        warnings.push({
            type: "parameter_sensitivity",
            severity: "high",
            message: "Existing robustness engine grades this candidate D.",
            evidence: [`score=${r.score}`, `grade=${r.grade}`, ...r.notes.slice(0, 3)],
        });
    }
    return warnings;
}

/** All deterministic research warnings for a candidate (never empty of findings when problems exist). */
export function buildResearchWarnings(
    evaluation: CandidateEvaluation | null,
    spec: ResearchMissionSpec
): ResearchWarning[] {
    if (!evaluation || !evaluation.backtest) {
        return [
            {
                type: "missing_validation",
                severity: "high",
                message: "No backtest evidence — nothing can be validated.",
                evidence: ["evaluation.backtest=null"],
            },
        ];
    }
    const warnings: ResearchWarning[] = [
        ...oosWarnings(evaluation, spec),
        ...walkForwardWarnings(evaluation, spec),
        ...sampleWarnings(evaluation),
        ...concentrationWarnings(evaluation),
        ...monteCarloWarnings(evaluation, spec),
        ...executionWarnings(evaluation),
        ...parameterWarnings(evaluation),
    ];
    // Deterministic order: severity first, then declaration order.
    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    return warnings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

// ── Robustness report ────────────────────────────────────────────────────────

function dimensionResults(
    evaluation: CandidateEvaluation,
    spec: ResearchMissionSpec,
    warnings: ResearchWarning[]
): RobustnessDimensionResult[] {
    const has = (type: ResearchWarning["type"]) => warnings.filter((w) => w.type === type);
    const statusFor = (type: ResearchWarning["type"]): RobustnessDimensionResult["status"] => {
        const found = has(type);
        if (found.some((w) => w.severity === "high")) return "fail";
        if (found.length > 0) return "concern";
        return "pass";
    };
    const v = evaluation.validation?.outcome ?? null;
    const wf = v?.walkForward ?? null;
    const mc = evaluation.monteCarlo?.summary ?? null;
    const results: RobustnessDimensionResult[] = [];

    // 1. OOS degradation
    results.push({
        dimension: "oos_degradation",
        status: v ? statusFor("oos_degradation") || (spec.requireOOS ? "pass" : "skipped") : spec.requireOOS ? "fail" : "skipped",
        detail: v
            ? `degradation=${fmt(v.degradation.overall)} verdict=${v.verdict}`
            : "No OOS validation available.",
        evidence: v
            ? [
                  `IS trades=${v.inSample.metrics.totalTrades} winRate=${fmt(v.inSample.metrics.winRate)}%`,
                  `OOS trades=${v.outOfSample.metrics.totalTrades} winRate=${fmt(v.outOfSample.metrics.winRate)}%`,
              ]
            : ["validation missing"],
    });

    // 2. Walk-forward stability
    results.push({
        dimension: "walk_forward_stability",
        status: !wf || !wf.enabled
            ? spec.requireWalkForward ? "fail" : "skipped"
            : wf.windows.length === 0
                ? spec.requireWalkForward ? "fail" : "skipped"
                : wf.stable && !has("walk_forward_unstable").length
                    ? "pass"
                    : has("walk_forward_unstable").some((w) => w.severity === "high") ? "fail" : "concern",
        detail: !wf || !wf.enabled
            ? "Walk-forward not run for this candidate."
            : `windows=${wf.windows.length} stable=${wf.stable} stabilityScore=${fmt(wf.stabilityScore)}`,
        evidence: wf && wf.windows.length > 0
            ? wf.windows.slice(0, 5).map(
                  (w, i) =>
                      `window ${i + 1}: train ${new Date(w.train.from).toISOString().slice(0, 10)}→${new Date(w.train.to).toISOString().slice(0, 10)}, test degradation=${fmt(w.degradationPct)}`
              )
            : ["no windows"],
    });

    // 3. Monte Carlo tail
    results.push({
        dimension: "monte_carlo_tail",
        status: !mc
            ? spec.requireMonteCarlo ? "fail" : "skipped"
            : mc.simulations === 0
                ? "fail"
                : has("monte_carlo_fragile").some((w) => w.severity === "high")
                    ? "fail"
                    : has("monte_carlo_fragile").length > 0 ? "concern" : "pass",
        detail: !mc
            ? "Monte Carlo not run."
            : mc.simulations === 0
                ? `No simulations (${mc.limitations[0] ?? "no source trades"}).`
                : `simulations=${mc.simulations} profitProbability=${mc.profitProbability !== null ? (mc.profitProbability * 100).toFixed(0) + "%" : "n/a"} drawdownP95=${mc.drawdownP95 !== null ? (mc.drawdownP95 * 100).toFixed(0) + "%" : "n/a"}`,
        evidence: mc ? [`seed=${mc.seed}`, `sourceTrades=${mc.sourceTradeCount}`, ...mc.limitations.slice(0, 2)] : ["monteCarlo missing"],
    });

    // 4. Parameter sensitivity
    const r = evaluation.robustness;
    results.push({
        dimension: "parameter_sensitivity",
        status: has("parameter_sensitivity").some((w) => w.severity === "high")
            ? "fail"
            : has("parameter_sensitivity").length > 0 ? "concern" : "skipped",
        detail: r
            ? `robustness factor parameterSensitivity=${r.factors.parameterSensitivity} (no parameter grid run — conservative default; sensitivity largely unknown)`
            : "No robustness score available.",
        evidence: r ? [`grade=${r.grade}`, `score=${r.score}`] : ["robustness missing"],
    });

    // 5. Trade sample
    const trades = evaluation.backtest?.metrics.totalTrades ?? 0;
    results.push({
        dimension: "trade_sample",
        status: trades >= 50 ? "pass" : trades >= 20 ? "concern" : "fail",
        detail: `${trades} trades in the tested window.`,
        evidence: [`totalTrades=${trades}`],
    });

    // 6. Execution variation
    const ev = evaluation.executionVariation;
    results.push({
        dimension: "execution_variation",
        status: !ev
            ? "skipped"
            : has("execution_sensitivity").some((w) => w.severity === "high")
                ? "fail"
                : has("execution_sensitivity").length > 0 ? "concern" : "pass",
        detail: !ev
            ? "Execution-variation runs skipped (budget or engine failure)."
            : `base=${fmt(ev.baseNet, 2)} spread×2=${fmt(ev.spreadDoubledNet, 2)} slippage×2=${fmt(ev.slippageDoubledNet, 2)}`,
        evidence: ev ? [`baseNet=${fmt(ev.baseNet, 2)}`, `spreadDoubledNet=${fmt(ev.spreadDoubledNet, 2)}`, `slippageDoubledNet=${fmt(ev.slippageDoubledNet, 2)}`] : ["variation missing"],
    });

    // 7. Regime coverage
    const dist = evaluation.backtest?.distribution ?? null;
    results.push({
        dimension: "regime_coverage",
        status: !dist
            ? "skipped"
            : has("regime_dependence").some((w) => w.severity === "high")
                ? "fail"
                : has("regime_dependence").length > 0 ? "concern" : "pass",
        detail: !dist
            ? "No trade-distribution evidence."
            : `topRegimeShare=${dist.topRegimeSharePct}% months=${dist.monthsCovered} profitableMonths=${Math.round(dist.profitableMonthShare * 100)}%`,
        evidence: dist ? [`topRegimeSharePct=${dist.topRegimeSharePct}`, `monthsCovered=${dist.monthsCovered}`] : ["distribution missing"],
    });

    return results;
}

/** Full deterministic robustness report for a candidate. */
export function buildRobustnessReport(
    candidateId: string,
    evaluation: CandidateEvaluation | null,
    spec: ResearchMissionSpec
): RobustnessReport {
    const warnings = buildResearchWarnings(evaluation, spec);
    if (!evaluation || !evaluation.backtest) {
        return {
            candidateId,
            dimensions: [],
            warnings,
            status: "incomplete",
            generatedAt: Date.now(),
        };
    }
    const dimensions = dimensionResults(evaluation, spec, warnings);
    const status: RobustnessReport["status"] = dimensions.some((d) => d.status === "fail")
        ? "fragile"
        : dimensions.some((d) => d.status === "concern")
            ? "concerns"
            : dimensions.every((d) => d.status === "skipped")
                ? "incomplete"
                : "robust";
    return { candidateId, dimensions, warnings, status, generatedAt: Date.now() };
}
