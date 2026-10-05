/**
 * AlgoVault — Portfolio Allocation Engine (Phase 15 §14/§15).
 *
 * PURE + DETERMINISTIC. No promise of optimality: every method states its
 * inputs, constraints and limitations. The engine produces target *weights*;
 * it never moves capital and never emits an execution instruction.
 *
 * Methods (all documented, all reproducible):
 *
 *   EQUAL                 wᵢ = 1/N over the eligible set
 *   RISK_BASED            wᵢ ∝ max(0, oosSharpeᵢ)     (Sharpe measured OOS)
 *   VOLATILITY_ADJUSTED   wᵢ ∝ 1 / volatilityᵢ
 *   RISK_PARITY           wᵢ ∝ 1 / (volatilityᵢ × drawdownᵢ)
 *   STRATEGY_BUDGET       wᵢ = stored user budget, renormalised
 *   USER_DEFINED          wᵢ = the user's own weights, validated and normalised
 *
 * Constraints clamp the raw scores before normalisation:
 *   MIN_SAMPLE_SIZE  excludes strategies with too little evidence
 *   MAX_WEIGHT / MIN_WEIGHT  cap and floor the final share
 *   HEALTH_FLOOR     forces any non-GOOD strategy to MIN_WEIGHT
 *
 * Every constraint that fires is reported, so a clamped target is never silent.
 */

import type {
    AgentPermissionLevel,
    AllocationConstraint,
    AllocationInput,
    AllocationLine,
    AllocationMethod,
    PortfolioAllocation,
    PortfolioAllocationRecommendation,
    PortfolioStrategyIntelligence,
} from "./types";

export interface AllocationRequest {
    portfolioId: string;
    method: AllocationMethod;
    inputs: AllocationInput[];
    /** Weights the user has explicitly pinned. Only used by USER_DEFINED. */
    userWeights?: Record<string, number>;
    /** Budgets the user has pinned. Only used by STRATEGY_BUDGET. */
    strategyBudgets?: Record<string, number>;
    constraints?: AllocationConstraint[];
    calculatedAt: number;
}

const DEFAULT_CONSTRAINTS: AllocationConstraint[] = [
    { kind: "MIN_SAMPLE_SIZE", value: 20, note: "Fewer than 20 closed trades is not enough evidence to size capital." },
];

function scoreOf(method: AllocationMethod, input: AllocationInput): number | null {
    switch (method) {
        case "EQUAL":
            return 1;
        case "RISK_BASED":
            return input.oosSharpe !== null && input.oosSharpe > 0 ? input.oosSharpe : 0;
        case "VOLATILITY_ADJUSTED":
            return input.volatility !== null && input.volatility > 0 ? 1 / input.volatility : null;
        case "RISK_PARITY": {
            const vol = input.volatility;
            const dd = input.maxDrawdownPercent;
            if (vol === null || dd === null || vol <= 0 || dd <= 0) return null;
            return 1 / (vol * dd);
        }
        case "STRATEGY_BUDGET":
        case "USER_DEFINED":
            return null; // handled by the caller-supplied weights
        default:
            return null;
    }
}

export function computeAllocation(request: AllocationRequest): PortfolioAllocation {
    const { method, inputs } = request;
    const constraints: AllocationConstraint[] = [...(request.constraints ?? []), ...DEFAULT_CONSTRAINTS];
    const limitations: string[] = [
        "Target weights are a deterministic function of the supplied inputs. They are not a forecast and not a claim of optimal allocation.",
    ];

    const minSample = constraints.find((c) => c.kind === "MIN_SAMPLE_SIZE")?.value ?? 0;
    const maxWeight = constraints.find((c) => c.kind === "MAX_WEIGHT")?.value ?? 1;
    const minWeight = constraints.find((c) => c.kind === "MIN_WEIGHT")?.value ?? 0;
    const healthFloor = constraints.find((c) => c.kind === "HEALTH_FLOOR")?.value ?? 0;

    const lines: AllocationLine[] = [];
    const rawScores: Array<{ strategyId: string; score: number; rationale: string[]; limitations: string[] }> = [];

    for (const input of inputs) {
        const rationale: string[] = [];
        const lineLimits: string[] = [];

        if (!input.active) {
            rationale.push("Strategy is not active — excluded from allocation.");
            rawScores.push({ strategyId: input.strategyId, score: 0, rationale, limitations: lineLimits });
            continue;
        }
        if (input.sampleSize < minSample) {
            rationale.push(`Only ${input.sampleSize} closed trade(s) — below the ${minSample} sample minimum, so no weight is assigned.`);
            lineLimits.push("Insufficient sample size for evidence-based sizing.");
            rawScores.push({ strategyId: input.strategyId, score: 0, rationale, limitations: lineLimits });
            continue;
        }

        if (method === "STRATEGY_BUDGET" || method === "USER_DEFINED") {
            const source = method === "STRATEGY_BUDGET" ? request.strategyBudgets : request.userWeights;
            const explicit = source?.[input.strategyId];
            if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
                rationale.push(`User-defined weight ${round(explicit)} from the stored ${method === "STRATEGY_BUDGET" ? "strategy budget" : "allocation"}.`);
                rawScores.push({ strategyId: input.strategyId, score: explicit, rationale, limitations: lineLimits });
            } else {
                rationale.push("No stored weight for this strategy under the selected method.");
                lineLimits.push("No user-defined weight available.");
                rawScores.push({ strategyId: input.strategyId, score: 0, rationale, limitations: lineLimits });
            }
            continue;
        }

        const score = scoreOf(method, input);
        if (score === null) {
            rationale.push(`Required input unavailable for ${method} — no weight assigned.`);
            lineLimits.push("Missing measured input for the selected method.");
            rawScores.push({ strategyId: input.strategyId, score: 0, rationale, limitations: lineLimits });
            continue;
        }
        rationale.push(describeScore(method, input, score));
        rawScores.push({ strategyId: input.strategyId, score, rationale, limitations: lineLimits });
    }

    const positive = rawScores.filter((r) => r.score > 0);
    const total = positive.reduce((acc, r) => acc + r.score, 0);

    if (total <= 0) {
        limitations.push(
            "No strategy produced a positive score under this method — every eligible weight is zero and the allocation is not normalized."
        );
    }

    const normalized = new Map<string, number>();
    for (const r of rawScores) {
        let weight = total > 0 ? r.score / total : 0;
        if (weight > 0 && maxWeight < 1 && weight > maxWeight) {
            weight = maxWeight;
            r.rationale.push(`Clamped to the ${maxWeight} max-weight constraint.`);
        }
        if (minWeight > 0 && r.score > 0 && weight < minWeight) {
            weight = minWeight;
            r.rationale.push(`Floored to the ${minWeight} min-weight constraint.`);
        }
        if (healthFloor > 0 && inputs.find((i) => i.strategyId === r.strategyId)?.health !== "GOOD" && r.score > 0) {
            weight = Math.min(weight, healthFloor);
            r.rationale.push(`Capped at ${healthFloor} because strategy health is not GOOD.`);
        }
        if (r.score === 0 && inputs.find((i) => i.strategyId === r.strategyId)?.health !== "GOOD" && inputs.find((i) => i.strategyId === r.strategyId)?.active) {
            r.rationale.push(`Non-GOOD health (${inputs.find((i) => i.strategyId === r.strategyId)?.health}) keeps this strategy at zero weight.`);
        }
        normalized.set(r.strategyId, weight);
    }

    const allocatedTotal = Array.from(normalized.values()).reduce((a, b) => a + b, 0);
    if (allocatedTotal > 0 && Math.abs(allocatedTotal - 1) > 0.0001) {
        // Renormalise after clamping so the result still sums to 1, then clamp
        // again — renormalising can otherwise push a capped line back over its
        // limit, which would make the constraint silently unenforceable.
        for (const [key, weight] of normalized) normalized.set(key, weight / allocatedTotal);
        if (maxWeight < 1) {
            for (const [key, weight] of normalized) {
                if (weight > maxWeight) {
                    normalized.set(key, maxWeight);
                    const entry = rawScores.find((r) => r.strategyId === key);
                    entry?.rationale.push(`Re-clamped to the ${maxWeight} max-weight constraint after renormalisation.`);
                }
            }
            const after = Array.from(normalized.values()).reduce((a, b) => a + b, 0);
            if (Math.abs(after - 1) > 0.0001) {
                limitations.push(
                    `The ${maxWeight} max-weight constraint cannot be satisfied while weights still sum to 1 — the result sums to ${after.toFixed(4)}. Relax the cap or add more eligible strategies.`
                );
            }
        }
        limitations.push("Weights were renormalised after constraint clamping; the raw scores did not map to exactly 1.");
    }

    for (const r of rawScores) {
        const current = inputs.find((i) => i.strategyId === r.strategyId)?.currentWeight ?? 0;
        const target = normalized.get(r.strategyId) ?? 0;
        lines.push({
            strategyId: r.strategyId,
            method,
            targetWeight: round(target),
            currentWeight: round(current),
            deltaWeight: round(target - current),
            rationale: r.rationale,
            limitations: r.limitations,
        });
    }

    return {
        portfolioId: request.portfolioId,
        method,
        inputs,
        constraints,
        lines,
        normalized: total > 0,
        calculatedAt: request.calculatedAt,
        limitations,
    };
}

function round(v: number): number {
    return Math.round(v * 10000) / 10000;
}

function describeScore(method: AllocationMethod, input: AllocationInput, score: number): string {
    switch (method) {
        case "EQUAL":
            return "Equal weight across the eligible strategy set.";
        case "RISK_BASED":
            return `OOS Sharpe ${round(input.oosSharpe ?? 0)} over ${input.sampleSize} trades → raw score ${round(score)}.`;
        case "VOLATILITY_ADJUSTED":
            return `Realised volatility ${round((input.volatility ?? 0) * 100)}% → inverse-volatility score ${round(score)}.`;
        case "RISK_PARITY":
            return `Volatility ${round((input.volatility ?? 0) * 100)}% × max drawdown ${round(input.maxDrawdownPercent ?? 0)}% → risk-parity score ${round(score)}.`;
        default:
            return `Raw score ${round(score)}.`;
    }
}

/* ── Capital allocation recommendations ───────────────────────────────────── */

export interface RecommendationOptions {
    /** Weight change below which MAINTAIN is the honest answer. */
    deadband?: number;
    /** Correlation at or above which two strategies are treated as substitutes. */
    correlationSubstituteThreshold?: number;
    now: number;
}

/**
 * Turn an allocation into a per-strategy recommendation. Recommendations are
 * ADVICE: `requiresApproval` is always true and no recommendation ever carries
 * an execution payload.
 */
export function recommendAllocation(
    allocation: PortfolioAllocation,
    intelligence: PortfolioStrategyIntelligence | null,
    options: RecommendationOptions
): PortfolioAllocationRecommendation[] {
    const deadband = options.deadband ?? 0.05;
    const substituteThreshold = options.correlationSubstituteThreshold ?? 0.7;
    const stateById = new Map((intelligence?.strategies ?? []).map((s) => [s.strategyId, s]));

    return allocation.lines.map((line) => {
        const state = stateById.get(line.strategyId) ?? null;
        const input = allocation.inputs.find((i) => i.strategyId === line.strategyId) ?? null;
        const rationale: string[] = [];
        const evidence: PortfolioAllocationRecommendation["evidence"] = [];

        let action: PortfolioAllocationRecommendation["action"];
        if (!input || !input.active) {
            action = "PAUSE";
            rationale.push("Strategy is not active.");
        } else if (state && (state.health === "CRITICAL" || state.health === "WARNING")) {
            action = "REDUCE";
            rationale.push(`Strategy health is ${state.health}.`);
            evidence.push({
                id: `${line.strategyId}:health`,
                metric: "strategyHealth",
                observed: state.health,
                note: "Measured from the strategy's own performance window.",
            });
        } else if (state && state.health === "UNKNOWN") {
            action = "REVIEW";
            rationale.push("Strategy health is unknown — insufficient measured evidence to size capital.");
        } else if (Math.abs(line.deltaWeight) <= deadband) {
            action = "MAINTAIN";
            rationale.push(`Target weight differs from current by ${round(line.deltaWeight)}, within the ±${deadband} deadband.`);
        } else if (line.deltaWeight > 0) {
            action = "INCREASE";
            rationale.push(`Target weight ${round(line.targetWeight)} vs current ${round(line.currentWeight)}.`);
        } else {
            action = "REDUCE";
            rationale.push(`Target weight ${round(line.targetWeight)} vs current ${round(line.currentWeight)}.`);
        }

        // Substitution check — the "healthy alone, harmful together" case.
        if (intelligence && state) {
            const substitutes = intelligence.overlaps.filter(
                (o) => o.kind === "CORRELATION" && (o.a === line.strategyId || o.b === line.strategyId) && o.overlap >= substituteThreshold
            );
            if (substitutes.length > 0) {
                action = action === "INCREASE" ? "REVIEW" : action;
                rationale.push(
                    `Correlated with ${substitutes.map((s) => `${s.a === line.strategyId ? s.b : s.a} (ρ ${round(s.overlap)})`).join(", ")} — scaling up may not diversify the portfolio.`
                );
                evidence.push({
                    id: `${line.strategyId}:substitution`,
                    metric: "maxCorrelationToOtherStrategy",
                    observed: round(Math.max(...substitutes.map((s) => s.overlap))),
                    note: "Strategies above this correlation are treated as substitutes, not diversification.",
                });
            }
        }

        if (input) {
            evidence.push({
                id: `${line.strategyId}:sample`,
                metric: "sampleSize",
                observed: input.sampleSize,
                note: "Closed trades behind every statistic for this strategy.",
            });
            if (input.oosSharpe === null) {
                evidence.push({
                    id: `${line.strategyId}:oos`,
                    metric: "oosSharpe",
                    observed: "unavailable",
                    note: "No out-of-sample validation exists for this strategy — sizing rests on in-sample data only.",
                });
            }
        }

        const confidence = confidenceFor(action, input, state);
        return {
            portfolioId: allocation.portfolioId,
            generatedAt: options.now,
            strategyId: line.strategyId,
            action,
            targetWeight: line.targetWeight,
            currentWeight: line.currentWeight,
            confidence,
            rationale,
            evidence,
            requiresApproval: true,
            permissionRequired: "USER_CONFIRMATION" as AgentPermissionLevel,
            limitations: [
                ...line.limitations,
                "This is a recommendation, not an execution instruction. AlgoVault never moves live capital automatically.",
                ...(input && input.oosSharpe === null ? ["No out-of-sample evidence available."] : []),
                ...(state && state.correlationToPortfolio === null ? ["Strategy-to-portfolio correlation unavailable."] : []),
            ],
        };
    });
}

function confidenceFor(
    action: PortfolioAllocationRecommendation["action"],
    input: AllocationInput | null,
    state: { sampleSize: number; oosSharpe: number | null; health: string } | null
): number {
    if (!input || !state) return 0.3;
    let confidence = 0.5;
    if (state.sampleSize >= 100) confidence += 0.2;
    else if (state.sampleSize >= 30) confidence += 0.1;
    if (state.oosSharpe !== null) confidence += 0.15;
    if (state.health === "GOOD") confidence += 0.1;
    if (state.health === "UNKNOWN") confidence -= 0.3;
    if (action === "PAUSE" && !input.active) confidence = 0.8;
    return Math.round(Math.max(0.05, Math.min(0.95, confidence)) * 100) / 100;
}
