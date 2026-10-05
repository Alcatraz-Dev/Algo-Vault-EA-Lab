/**
 * AlgoVault — Portfolio Intelligence chat (Phase 15 §27).
 *
 * Answers the questions a trader actually asks about the whole book:
 *   "How exposed am I to USD?" / "Which strategies are overlapping?" /
 *   "Why is my portfolio risk high?" / "What happens if XAUUSD drops 3%?" /
 *   "Which strategy contributes most to current drawdown?" /
 *   "Are my positions highly correlated?" / "What if volatility doubled?" /
 *   "Which strategies should I review?"
 *
 * Every answer is built from the deterministic snapshot and is labelled by
 * epistemic level. Nothing here is generated free-hand: the intent matcher is a
 * keyword classifier over a fixed vocabulary, and each handler is a pure
 * function of the snapshot.
 */

import { runStressTests, buildScenario } from "./stress";
import type {
    PortfolioIntelligenceBrief,
    PortfolioSnapshot,
    PortfolioStressTest,
} from "./types";

export type PortfolioQuestionIntent =
    | "currency_exposure"
    | "strategy_overlap"
    | "why_risk_high"
    | "symbol_shock"
    | "drawdown_contributor"
    | "correlation_check"
    | "volatility_scenario"
    | "strategies_to_review"
    | "health_summary"
    | "unknown";

export interface PortfolioAnswer {
    intent: PortfolioQuestionIntent;
    /** Every claim carries its epistemic level. */
    lines: Array<{ kind: "OBSERVED" | "CALCULATED" | "INFERRED" | "SIMULATED" | "RECOMMENDATION"; text: string }>;
    brief?: PortfolioIntelligenceBrief;
    limitations: string[];
}

/**
 * Intent classification. Keyword-based and deliberately narrow: an unmatched
 * question returns `unknown` rather than a guess, so the chat can say it did
 * not understand instead of inventing an analysis.
 */
export function classifyPortfolioQuestion(question: string): PortfolioQuestionIntent {
    const q = question.toLowerCase();

    if (/\b(usd|eur|jpy|gbp|currency|exposed to|fx exposure)\b/.test(q) && /expos|how much|currency/.test(q)) {
        return "currency_exposure";
    }
    if (/strateg/.test(q) && /overlap|duplicat|correlat/.test(q)) return "strategy_overlap";
    if (/why/.test(q) && /risk/.test(q)) return "why_risk_high";
    if (/(what|how).*(happens|drop|fell|falls|crash|shock)/.test(q) && /%|percent/.test(q)) return "symbol_shock";
    if (/drawdown/.test(q) && /(contribut|cause|which strategy)/.test(q)) return "drawdown_contributor";
    if (/correlat/.test(q)) return "correlation_check";
    if (/volatil/.test(q) && /(double|doubled|twice|increase|spike)/.test(q)) return "volatility_scenario";
    if (/strateg/.test(q) && /review|look at|attention|problem|worst/.test(q)) return "strategies_to_review";
    if (/(health|how.*portfolio|overall|summary|overview)/.test(q)) return "health_summary";
    return "unknown";
}

/** Answer a question from the deterministic snapshot. Pure. */
export function answerPortfolioQuestion(
    question: string,
    snapshot: PortfolioSnapshot,
    now: number = Date.now()
): PortfolioAnswer {
    const intent = classifyPortfolioQuestion(question);
    const limitations = [...snapshot.limitations];

    switch (intent) {
        case "currency_exposure": {
            const slices = snapshot.exposure.byCurrency.filter((c) => c.status === "AVAILABLE");
            if (slices.length === 0) {
                return {
                    intent,
                    lines: [
                        {
                            kind: "OBSERVED",
                            text: "Currency exposure is UNAVAILABLE — the open positions carry no determinable currency split. This is reported as unavailable, not as zero.",
                        },
                    ],
                    limitations,
                };
            }
            return {
                intent,
                lines: [
                    { kind: "CALCULATED", text: "Signed currency exposure as a share of total currency notional:" },
                    ...slices.map((c) => ({
                        kind: "CALCULATED" as const,
                        text: `${c.key}: ${((c.signedWeight ?? 0) * 100).toFixed(1)}% (gross ${(c.grossWeight * 100).toFixed(1)}%)`,
                    })),
                    {
                        kind: "INFERRED",
                        text: `A single currency above +25% or below −25% means a meaningful part of the book moves with one macro variable.`,
                    },
                ],
                limitations,
            };
        }

        case "strategy_overlap": {
            if (snapshot.strategyCount <= 1) {
                return {
                    intent,
                    lines: [
                        { kind: "OBSERVED", text: "Only one strategy bucket is present in this portfolio, so there is nothing to overlap with." },
                    ],
                    limitations,
                };
            }
            const strategies = snapshot.exposure.byStrategy.filter((s) => s.status === "AVAILABLE");
            const overlapping = strategies.filter((s) => s.grossWeight > 0.3);
            return {
                intent,
                lines: [
                    { kind: "CALCULATED", text: `Strategy exposure: ${strategies.map((s) => `${s.key} ${(s.grossWeight * 100).toFixed(1)}%`).join(", ")}` },
                    ...(overlapping.length > 1
                        ? [{
                              kind: "INFERRED" as const,
                              text: `${overlapping.map((s) => s.key).join(", ")} each hold more than 30% of gross exposure — if they trade the same instruments, they compound rather than diversify.`,
                          }]
                        : [{
                              kind: "CALCULATED" as const,
                              text: "No single strategy bucket holds more than 30% of gross exposure.",
                          }]),
                ],
                limitations,
            };
        }

        case "why_risk_high": {
            const breached = snapshot.riskBudgetUsage.filter((u) => u.status === "BREACHED");
            const watch = snapshot.riskBudgetUsage.filter((u) => u.status === "WATCH");
            const lines: PortfolioAnswer["lines"] = [
                { kind: "CALCULATED", text: `Open risk at stop is ${snapshot.risk.openRiskPercent?.toFixed(2) ?? "UNAVAILABLE"}% of equity.` },
                { kind: "CALCULATED", text: `Drawdown is ${snapshot.risk.drawdownPercent?.toFixed(2) ?? "UNAVAILABLE"}%.` },
                { kind: "CALCULATED", text: `Gross exposure is ${(snapshot.exposure.grossToEquity ?? 0).toFixed(2)}× equity.` },
            ];
            for (const b of breached) {
                lines.push({ kind: "CALCULATED", text: `Breached: ${b.kind}${b.scopeKey ? ` (${b.scopeKey})` : ""} at ${b.usedPercent}% of ${b.limitPercent}%.` });
            }
            for (const w of watch) {
                lines.push({ kind: "CALCULATED", text: `Near limit: ${w.kind} at ${Math.round(w.utilization * 100)}% of its budget.` });
            }
            if (snapshot.correlation.severity === "HIGH") {
                lines.push({
                    kind: "INFERRED",
                    text: `Correlation is contributing: ${snapshot.correlation.clusterSize} same-direction positions at mean ρ ${snapshot.correlation.meanCorrelation.toFixed(2)}.`,
                });
            }
            if (breached.length === 0 && watch.length === 0 && snapshot.correlation.severity !== "HIGH") {
                lines.push({ kind: "CALCULATED", text: "No budget is breached or near its limit — measured risk is within the configured budgets." });
            }
            return { intent, lines, limitations };
        }

        case "symbol_shock": {
            const match = question.match(/([A-Z]{3,10})\s*(?:drops?|falls?|falls by|down|-)?\s*(\d+(?:\.\d+)?)?\s*%/i);
            const symbol = (match?.[1] ?? snapshot.exposure.bySymbol[0]?.key ?? "").toUpperCase();
            const pct = Number(match?.[2] ?? 3);
            if (!symbol || !Number.isFinite(pct) || pct <= 0) {
                return {
                    intent,
                    lines: [{ kind: "OBSERVED", text: "I could not read a symbol and a percentage from that question — try \"what happens if XAUUSD drops 3%\"." }],
                    limitations,
                };
            }
            const stress = shockStress(snapshot, symbol, -pct / 100, now);
            const entry = stress.scenarios[0];
            return {
                intent,
                lines: [
                    { kind: "SIMULATED", text: `Moving ${symbol} −${pct}% and repricing the book (${entry?.scenario.basis}) changes equity by ${entry?.pnlImpact.toFixed(2) ?? "UNAVAILABLE"} (${entry?.pnlImpactPercent.toFixed(2) ?? "?"}%).` },
                    ...(entry?.breaches.length ? [{ kind: "SIMULATED" as const, text: `Budget impact: ${entry.breaches.join(" ")}` }] : []),
                    { kind: "RECOMMENDATION", text: "This is a sensitivity calculation, not a prediction. It does not tell you the move will happen." },
                ],
                limitations: [...limitations, ...stress.limitations],
            };
        }

        case "drawdown_contributor": {
            const byStrategy = snapshot.exposure.byStrategy.filter((s) => s.status === "AVAILABLE");
            const contributors = snapshot.positions
                .filter((p) => p.unrealizedPnL < 0)
                .sort((a, b) => a.unrealizedPnL - b.unrealizedPnL)
                .slice(0, 5);
            return {
                intent,
                lines: [
                    { kind: "CALCULATED", text: `Current drawdown ${snapshot.risk.drawdownPercent?.toFixed(2) ?? "UNAVAILABLE"}%.` },
                    ...(contributors.length > 0
                        ? [
                              { kind: "CALCULATED" as const, text: `Largest open losers: ${contributors.map((p) => `${p.symbol} ${p.unrealizedPnL.toFixed(2)} (${p.strategyId})`).join(", ")}` },
                          ]
                        : [{ kind: "OBSERVED" as const, text: "No open position is currently losing." }]),
                    { kind: "CALCULATED", text: `Strategy exposure weights: ${byStrategy.map((s) => `${s.key} ${(s.grossWeight * 100).toFixed(1)}%`).join(", ") || "none"}` },
                    { kind: "INFERRED", text: "Drawdown attribution here is by open P&L and exposure weight — realized drawdown per strategy needs historical closed trades, which are not stored in the snapshot." },
                ],
                limitations,
            };
        }

        case "correlation_check": {
            if (!snapshot.correlationMatrix || snapshot.correlationMatrix.pairs.length === 0) {
                return {
                    intent,
                    lines: [{ kind: "OBSERVED", text: "Correlation is UNAVAILABLE — no aligned price history for the held symbols. I will not describe a correlation I cannot measure." }],
                    limitations,
                };
            }
            const strong = snapshot.correlationMatrix.pairs
                .filter((p) => p.coefficient !== null && Math.abs(p.coefficient) >= 0.6)
                .slice(0, 8);
            return {
                intent,
                lines: [
                    { kind: "CALCULATED", text: `${snapshot.correlationMatrix.pairs.length} pair(s) measured over ${snapshot.correlationMatrix.window} ${snapshot.correlationMatrix.timeframe} bars.` },
                    ...(strong.length > 0
                        ? strong.map((p) => ({ kind: "CALCULATED" as const, text: `${p.a}/${p.b}: ρ ${p.coefficient?.toFixed(3)} (${p.observations} aligned bars)` }))
                        : [{ kind: "CALCULATED" as const, text: "No pair exceeds |ρ| 0.60 over the measured window." }]),
                    ...(snapshot.correlation.shiftingPairs.length > 0
                        ? [{ kind: "CALCULATED" as const, text: `${snapshot.correlation.shiftingPairs.length} pair(s) shifted materially against the previous window.` }]
                        : []),
                    { kind: "INFERRED", text: "Correlation describes how instruments moved together in the past. It is not a trading signal and it can break without warning." },
                ],
                limitations,
            };
        }

        case "volatility_scenario": {
            const stress = runStressTests({
                portfolioId: snapshot.portfolioId,
                positions: snapshot.positions,
                accounts: snapshot.accounts,
                equity: snapshot.equity,
                scenarios: [
                    buildScenario({
                        scenarioId: "vol-doubled",
                        kind: "VOLATILITY_EXPANSION",
                        name: "Volatility doubled",
                        parameters: { defaultShockPercent: -0.02, frictionCostPercent: 0.1 },
                        methodology: "2% adverse move plus 10bps of execution cost per unit of gross notional.",
                    }),
                ],
                riskBudgets: snapshot.riskBudgetUsage.map((u) => ({ kind: u.kind, limitPercent: u.limitPercent, scopeKey: u.scopeKey })),
                generatedAt: now,
                dataTimestamp: snapshot.freshness.dataTimestamp,
            });
            const entry = stress.scenarios[0];
            return {
                intent,
                lines: [
                    { kind: "SIMULATED", text: `A volatility expansion to a 2% adverse move costs ${entry?.pnlImpact.toFixed(2) ?? "UNAVAILABLE"} (${entry?.pnlImpactPercent.toFixed(2) ?? "?"}%) of equity.` },
                    ...(entry?.breaches.length ? [{ kind: "SIMULATED" as const, text: `Breaches: ${entry.breaches.join(" ")}` }] : [{ kind: "SIMULATED" as const, text: "No configured budget is breached under this scenario." }]),
                    { kind: "RECOMMENDATION", text: "SIMULATION — NOT FORECAST. It shows sensitivity to a shock, not the likelihood of one." },
                ],
                limitations: [...limitations, ...stress.limitations],
            };
        }

        case "strategies_to_review": {
            const strategies = snapshot.strategyStates;
            if (strategies.length === 0) {
                return {
                    intent,
                    lines: [{ kind: "OBSERVED", text: "No strategies are attributed to this portfolio yet, so there is nothing to review." }],
                    limitations,
                };
            }
            const review = strategies
                .filter((s) => s.health !== "GOOD" || s.maxDrawdownPercent === null || s.sampleSize === 0)
                .sort((a, b) => a.health.localeCompare(b.health));
            return {
                intent,
                lines: [
                    { kind: "CALCULATED", text: `${strategies.length} strategy/strategies tracked.` },
                    ...(review.length > 0
                        ? review.map((s) => ({
                              kind: "CALCULATED" as const,
                              text: `${s.strategyId}: health ${s.health}, max drawdown ${s.maxDrawdownPercent?.toFixed(2) ?? "UNAVAILABLE"}%, sample ${s.sampleSize}.`,
                          }))
                        : [{ kind: "CALCULATED" as const, text: "Every tracked strategy is healthy with a recorded drawdown and sample size." }]),
                    ...(snapshot.correlationMatrix && snapshot.correlationMatrix.pairs.length > 0
                        ? [{ kind: "RECOMMENDATION" as const, text: "Review strategies whose correlation to the rest of the book rose — individually healthy strategies can fail together." }]
                        : []),
                ],
                limitations,
            };
        }

        case "health_summary": {
            return {
                intent,
                lines: [
                    { kind: "CALCULATED", text: `Overall health: ${snapshot.health.overall}.` },
                    ...snapshot.health.components.map((c) => ({
                        kind: "CALCULATED" as const,
                        text: `${c.component}: ${c.rating}${c.reasons[0] ? ` — ${c.reasons[0]}` : ""}`,
                    })),
                    { kind: "CALCULATED", text: `Regime ${snapshot.regime} at ${(snapshot.regimeState.confidence * 100).toFixed(0)}% confidence.` },
                ],
                limitations,
            };
        }

        default:
            return {
                intent: "unknown",
                lines: [
                    {
                        kind: "OBSERVED",
                        text: "I did not match that question to a portfolio analysis I can answer honestly.",
                    },
                    {
                        kind: "RECOMMENDATION",
                        text: "Try: \"how exposed am I to USD\", \"which strategies overlap\", \"why is my portfolio risk high\", \"what happens if XAUUSD drops 3%\", \"are my positions highly correlated\", or \"which strategies should I review\".",
                    },
                ],
                limitations,
            };
    }
}

function shockStress(snapshot: PortfolioSnapshot, symbol: string, shockPercent: number, now: number): PortfolioStressTest {
    return runStressTests({
        portfolioId: snapshot.portfolioId,
        positions: snapshot.positions,
        accounts: snapshot.accounts,
        equity: snapshot.equity,
        scenarios: [
            buildScenario({
                scenarioId: `shock-${symbol.toLowerCase()}`,
                kind: "MARKET_GAP",
                name: `${symbol} ${(shockPercent * 100).toFixed(1)}%`,
                parameters: { defaultShockPercent: 0, [`${symbol}.shockPercent`]: shockPercent },
                methodology: `Only ${symbol} moves ${(shockPercent * 100).toFixed(2)}%; every other position is held constant.`,
            }),
        ],
        riskBudgets: snapshot.riskBudgetUsage.map((u) => ({ kind: u.kind, limitPercent: u.limitPercent, scopeKey: u.scopeKey })),
        generatedAt: now,
        dataTimestamp: snapshot.freshness.dataTimestamp,
    });
}

export { classifyPortfolioQuestion as classifyIntent };
