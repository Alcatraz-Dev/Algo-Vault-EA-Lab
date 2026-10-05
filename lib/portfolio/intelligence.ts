/**
 * AlgoVault — Portfolio AI interpretation + chat context (Phase 15 §27/§49/§50).
 *
 * The AI layer CONSUMES structured deterministic context. It never computes
 * authoritative equity, exposure, PnL, margin, risk or correlation — those come
 * from the engines in `lib/portfolio/*` and are passed in here.
 *
 * Every AI statement is labelled with one of five epistemic levels:
 *   OBSERVED        a raw datum read from an account or market feed
 *   CALCULATED      a deterministic engine output
 *   INFERRED        a conclusion drawn from observed/calculated facts
 *   SIMULATED       the output of a simulation (never a historical fact)
 *   RECOMMENDATION  an advisory action that requires approval
 *
 * When the AI gateway is unavailable, `buildDeterministicBrief` produces the
 * same contract from the engines alone and marks it `deterministicOnly: true`.
 * The UI must render that label rather than pretending an AI wrote it.
 */

import type {
    DataFreshness,
    PortfolioDecisionEvidence,
    PortfolioIntelligenceBrief,
    PortfolioSnapshot,
    PortfolioStressTest,
} from "./types";

/** Serialize a portfolio context for the AI router. Numbers only where measured. */
export function buildPortfolioContext(snapshot: PortfolioSnapshot, stress?: PortfolioStressTest | null): string {
    const lines: string[] = [];

    lines.push(`PORTFOLIO ${snapshot.portfolioId} (base currency ${snapshot.baseCurrency})`);
    lines.push(`Data timestamp: ${new Date(snapshot.freshness.dataTimestamp).toISOString()} · freshness ${snapshot.freshness.freshness}`);
    lines.push("");
    lines.push("MEASURED ACCOUNT STATE (do not recompute or contradict):");
    lines.push(`- equity ${snapshot.equity.toFixed(2)}, balance ${snapshot.balance.toFixed(2)}, unrealized ${snapshot.unrealizedPnL.toFixed(2)}`);
    lines.push(`- gross notional ${snapshot.grossExposure.toFixed(2)}, net notional ${snapshot.netExposure.toFixed(2)}`);
    lines.push(`- margin used ${snapshot.marginUsed.toFixed(2)}, free margin ${snapshot.freeMargin.toFixed(2)}, leverage ${snapshot.leverage}`);
    lines.push(`- drawdown ${snapshot.risk.drawdownPercent?.toFixed(2) ?? "UNAVAILABLE"}%, open risk ${snapshot.risk.openRiskPercent?.toFixed(2) ?? "UNAVAILABLE"}%`);

    lines.push("");
    lines.push("EXPOSURE (deterministic):");
    for (const s of snapshot.exposure.bySymbol.slice(0, 8)) {
        lines.push(`- ${s.key}: ${(s.grossWeight * 100).toFixed(1)}% gross, net ${((s.signedWeight ?? 0) * 100).toFixed(1)}%`);
    }
    lines.push("CURRENCY EXPOSURE:");
    for (const c of snapshot.exposure.byCurrency.slice(0, 6)) {
        if (c.status !== "AVAILABLE") continue;
        lines.push(`- ${c.key}: ${((c.signedWeight ?? 0) * 100).toFixed(1)}% signed`);
    }

    lines.push("");
    lines.push("CONCENTRATION (Herfindahl of measured weights):");
    for (const a of snapshot.concentration.axes) {
        if (a.status !== "AVAILABLE") continue;
        lines.push(`- ${a.axis}: HHI ${a.hhi.toFixed(3)}, top ${a.topShare.toFixed(3)}, effective bets ${a.effectiveCount.toFixed(2)}`);
    }

    lines.push("");
    lines.push("CORRELATION:");
    if (snapshot.correlationMatrix && snapshot.correlationMatrix.pairs.length > 0) {
        lines.push(`- ${snapshot.correlationMatrix.pairs.length} pair(s) over ${snapshot.correlationMatrix.window} ${snapshot.correlationMatrix.timeframe} bars (${snapshot.correlationMatrix.method})`);
        for (const p of snapshot.correlationMatrix.pairs.slice(0, 10)) {
            lines.push(
                p.coefficient === null
                    ? `- ${p.a}/${p.b}: UNAVAILABLE (${p.status}, ${p.observations} obs)`
                    : `- ${p.a}/${p.b}: ρ ${p.coefficient.toFixed(3)} (${p.observations} obs)`
            );
        }
    } else {
        lines.push("- UNAVAILABLE: no aligned price history for the held symbols. Do not describe any correlation.");
    }
    lines.push(`- clustered exposure weight ${(snapshot.correlation.clusteredExposureWeight * 100).toFixed(1)}%, severity ${snapshot.correlation.severity}`);

    lines.push("");
    lines.push("RISK BUDGETS:");
    for (const u of snapshot.riskBudgetUsage) {
        lines.push(`- ${u.kind}${u.scopeKey ? ` (${u.scopeKey})` : ""}: ${u.usedPercent}% of ${u.limitPercent}% → ${u.status}`);
    }

    lines.push("");
    lines.push("HEALTH COMPONENTS:");
    for (const c of snapshot.health.components) {
        lines.push(`- ${c.component}: ${c.rating} (${c.score}) — ${c.reasons[0] ?? ""}`);
    }

    lines.push("");
    lines.push(`REGIME: ${snapshot.regime} at ${(snapshot.regimeState.confidence * 100).toFixed(0)}% confidence`);
    for (const e of snapshot.regimeState.evidence) {
        lines.push(`- ${e.metric}: ${e.observed} vs threshold ${e.threshold}`);
    }

    if (stress) {
        lines.push("");
        lines.push(`STRESS (${stress.method}):`);
        for (const s of stress.scenarios) {
            lines.push(`- ${s.scenario.name} [${s.scenario.basis}]: ${s.pnlImpactPercent.toFixed(2)}% equity impact`);
        }
    }

    lines.push("");
    lines.push("LIMITATIONS (must be stated in the answer):");
    for (const l of snapshot.limitations.slice(0, 10)) lines.push(`- ${l}`);

    return lines.join("\n");
}

/**
 * The deterministic brief. Always available, never wrong, and explicitly
 * labelled when no AI narration was produced.
 */
export function buildDeterministicBrief(
    snapshot: PortfolioSnapshot,
    stress?: PortfolioStressTest | null
): PortfolioIntelligenceBrief {
    const evidence: PortfolioDecisionEvidence[] = [
        {
            id: "brief:equity",
            kind: "OBSERVED",
            source: "portfolio-snapshot",
            detail: `Equity ${snapshot.equity.toFixed(2)} ${snapshot.baseCurrency} across ${snapshot.accounts.length} account(s), ${snapshot.positionCount} open position(s).`,
            value: snapshot.equity,
        },
        {
            id: "brief:exposure",
            kind: "CALCULATED",
            source: "portfolio-exposure-engine",
            detail: `Gross notional ${snapshot.grossExposure.toFixed(2)} (${(snapshot.exposure.grossToEquity ?? 0).toFixed(2)}× equity), net ${snapshot.netExposure.toFixed(2)}.`,
            value: snapshot.grossExposure,
        },
        {
            id: "brief:correlation",
            kind: snapshot.correlationMatrix && snapshot.correlationMatrix.pairs.length > 0 ? "CALCULATED" : "OBSERVED",
            source: "portfolio-correlation-engine",
            detail:
                snapshot.correlationMatrix && snapshot.correlationMatrix.pairs.length > 0
                    ? `Largest correlated cluster holds ${(snapshot.correlation.clusteredExposureWeight * 100).toFixed(1)}% of gross exposure at mean ρ ${snapshot.correlation.meanCorrelation.toFixed(2)}.`
                    : "Correlation is UNAVAILABLE for the held symbols.",
            value: snapshot.correlation.clusteredExposureWeight,
        },
        ...snapshot.health.components
            .filter((c) => c.rating === "WARNING" || c.rating === "CRITICAL")
            .slice(0, 4)
            .map((c) => ({
                id: `brief:health:${c.component}`,
                kind: "CALCULATED" as const,
                source: "portfolio-health-engine",
                detail: `${c.component} is ${c.rating}: ${c.reasons[0] ?? ""}`,
            })),
    ];

    const currentState = snapshot.exposure.bySymbol.slice(0, 5).map(
        (s) => `${s.key}: ${(s.grossWeight * 100).toFixed(1)}% of gross exposure (${s.positionCount} position(s))`
    );

    const risks = snapshot.risk.warnings.map((w) => `[${w.severity}] ${w.message}`);

    const scenarios = (stress?.scenarios ?? []).map(
        (s) => `${s.scenario.name} (${s.scenario.basis}): ${s.pnlImpactPercent.toFixed(2)}% equity impact`
    );

    return {
        summary:
            `Portfolio risk is ${snapshot.portfolioRiskScore}% of equity at stop; concentration score ${snapshot.concentrationScore}; ` +
            `regime ${snapshot.regime}; overall health ${snapshot.health.overall}.`,
        currentState,
        evidence,
        portfolioImpact: [
            `Gross ${(snapshot.exposure.grossToEquity ?? 0).toFixed(2)}× equity, net ${(snapshot.exposure.netToEquity ?? 0).toFixed(2)}×.`,
            `Largest symbol weight ${((snapshot.exposure.bySymbol[0]?.grossWeight ?? 0) * 100).toFixed(1)}%.`,
        ],
        risks,
        scenarios,
        recommendation: [
            "Deterministic guidance only: review any budget marked BREACHED before adding risk.",
            "No capital has been moved and none will be without explicit approval.",
        ],
        limitations: snapshot.limitations,
        dataFreshness: snapshot.freshness as DataFreshness,
        deterministicOnly: true,
    };
}

/** Parse an AI response into the canonical brief contract, or fail closed. */
export function briefFromAi(text: string, snapshot: PortfolioSnapshot): PortfolioIntelligenceBrief | null {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return null;

    // The AI must echo the measured anchor. If it does not, the response is
    // discarded rather than shown with a hedge attached.
    const anchor = snapshot.equity.toFixed(2);
    if (!trimmed.includes(anchor)) return null;

    return {
        summary: trimmed.split("\n")[0].slice(0, 400),
        currentState: [],
        evidence: [
            {
                id: "ai:anchor",
                kind: "CALCULATED",
                source: "portfolio-snapshot",
                detail: `AI response was anchored to the measured equity of ${anchor} ${snapshot.baseCurrency}.`,
                value: snapshot.equity,
            },
        ],
        portfolioImpact: [],
        risks: [],
        scenarios: [],
        recommendation: [],
        limitations: snapshot.limitations,
        dataFreshness: snapshot.freshness,
        deterministicOnly: false,
    };
}
