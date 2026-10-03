// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Graph + lineage integration.
//
// Research edges are built with the EXISTING graph helpers (buildEdge /
// buildEdgeId / resolveLineage / validateGraph from
// lib/market-intelligence/knowledge). Relationship types were extended
// additively (MISSION_GENERATED, STRATEGY_TESTED_ON, STRATEGY_SIMILAR_TO, …);
// nothing in the graph subsystem was rebuilt.
//
// Edge storage: strategyResearch/{uid}/knowledge/{missionId} (owner/admin),
// validated by the existing validateGraph() so research edges obey the same
// relationship rules as every other edge in the platform.
// ─────────────────────────────────────────────────────────────────────────────

import { buildEdge } from "@/lib/market-intelligence/knowledge/relationship-builder";
import { validateGraph } from "@/lib/market-intelligence/knowledge/validation";
import type { KnowledgeEdge, KnowledgeNodeRef } from "@/lib/market-intelligence/knowledge/types";
import type { ResearchCandidate, ResearchMission } from "./types";

// ── Node builders ────────────────────────────────────────────────────────────

export function missionNode(mission: Pick<ResearchMission, "id" | "spec">): KnowledgeNodeRef {
    return { type: "research_mission", id: mission.id, symbol: mission.spec.markets[0] };
}

export function hypothesisNode(candidate: ResearchCandidate): KnowledgeNodeRef {
    return {
        type: "research_hypothesis",
        id: candidate.hypothesis.id,
        symbol: candidate.hypothesis.market,
    };
}

export function strategyNode(candidate: ResearchCandidate): KnowledgeNodeRef | null {
    if (!candidate.strategy) return null;
    return {
        type: "strategy_candidate",
        id: candidate.strategy.id,
        symbol: candidate.hypothesis.market,
        timeframe: candidate.strategy.timeframes.setup,
    };
}

function evidenceNode(candidate: ResearchCandidate): KnowledgeNodeRef {
    return { type: "evidence_report", id: `${candidate.id}:evidence` };
}

// ── Edge set for one candidate ───────────────────────────────────────────────

/**
 * Builds the complete, deterministic edge set for one research candidate:
 *
 *   mission  ──MISSION_GENERATED──▶ hypothesis
 *   mission  ──MISSION_GENERATED──▶ strategy
 *   strategy ──HYPOTHESIS_DERIVED_FROM──▶ hypothesis
 *   strategy ──STRATEGY_TESTED_ON──▶ backtest
 *   strategy ──HAS_OOS_RESULT──▶ oos            (+ STRATEGY_FAILED_OOS on failure)
 *   strategy ──HAS_WALK_FORWARD_RESULT──▶ wf    (+ STRATEGY_FAILED_WALK_FORWARD on failure)
 *   strategy ──HAS_MONTE_CARLO_RESULT──▶ mc
 *   strategy ──HAS_ROBUSTNESS_RESULT──▶ robustness
 *   strategy ──SUPPORTED_BY / STRATEGY_SUPPORTED_BY──▶ evidence (survivors)
 *   strategy ──STRATEGY_SIMILAR_TO──▶ linked strategy (dedup)
 */
export function buildCandidateEdges(mission: ResearchMission, candidate: ResearchCandidate): KnowledgeEdge[] {
    const edges: KnowledgeEdge[] = [];
    const missionRef = missionNode(mission);
    const hypRef = hypothesisNode(candidate);
    const stratRef = strategyNode(candidate);

    edges.push(buildEdge(missionRef, "MISSION_GENERATED", hypRef));
    edges.push(buildEdge(hypRef, "HYPOTHESIS_DERIVED_FROM", missionRef));
    if (!stratRef) return dedupe(edges);

    edges.push(buildEdge(missionRef, "MISSION_GENERATED", stratRef));
    edges.push(buildEdge(stratRef, "HYPOTHESIS_DERIVED_FROM", hypRef));

    const ev = candidate.evaluation;
    const backtestId = ev?.backtest?.backtestId ?? null;
    if (backtestId) {
        const btRef: KnowledgeNodeRef = {
            type: "backtest",
            id: backtestId,
            symbol: candidate.hypothesis.market,
            timeframe: candidate.strategy?.timeframes.setup,
        };
        edges.push(buildEdge(stratRef, "STRATEGY_TESTED_ON", btRef));
    }

    if (ev?.validation) {
        const oosRef: KnowledgeNodeRef = { type: "oos", id: `${candidate.id}:oos` };
        const wfRef: KnowledgeNodeRef = { type: "walk_forward", id: `${candidate.id}:wf` };
        edges.push(buildEdge(stratRef, "HAS_OOS_RESULT", oosRef));
        edges.push(buildEdge(stratRef, "HAS_WALK_FORWARD_RESULT", wfRef));

        const outcome = ev.validation.outcome;
        const failedOos = candidate.rejectedReason === "oos_failed" || candidate.rejectedReason === "overfit_detected" || outcome.verdict === "fragile";
        const failedWf = candidate.rejectedReason === "walk_forward_unstable" ||
            (outcome.walkForward.enabled && outcome.walkForward.windows.length > 0 && !outcome.walkForward.stable);
        if (failedOos) edges.push(buildEdge(stratRef, "STRATEGY_FAILED_OOS", oosRef));
        if (failedWf) edges.push(buildEdge(stratRef, "STRATEGY_FAILED_WALK_FORWARD", wfRef));
    }

    if (ev?.monteCarlo) {
        edges.push(
            buildEdge(stratRef, "HAS_MONTE_CARLO_RESULT", {
                type: "monte_carlo",
                id: `${candidate.id}:mc`,
            })
        );
    }
    if (ev?.robustness) {
        edges.push(
            buildEdge(stratRef, "HAS_ROBUSTNESS_RESULT", {
                type: "robustness",
                id: `${candidate.id}:robustness`,
            })
        );
    }

    const survived = candidate.lifecycle === "survivor" || candidate.lifecycle === "incubated" ||
        candidate.lifecycle === "forward_testing" || candidate.lifecycle === "validated";
    if (survived && (candidate.score?.total ?? 0) > 0) {
        const evRef = evidenceNode(candidate);
        edges.push(buildEdge(stratRef, "SUPPORTED_BY", evRef));
        edges.push(buildEdge(stratRef, "STRATEGY_SUPPORTED_BY", evRef));
        edges.push(buildEdge(evRef, "EVIDENCED_BY", stratRef));
    }

    if (candidate.linkedTo) {
        const dupRef: KnowledgeNodeRef = { type: "strategy_candidate", id: candidate.linkedTo };
        edges.push(buildEdge(stratRef, "STRATEGY_SIMILAR_TO", dupRef));
        edges.push(buildEdge(dupRef, "STRATEGY_SIMILAR_TO", stratRef));
    }

    return dedupe(edges);
}

function dedupe(edges: KnowledgeEdge[]): KnowledgeEdge[] {
    const seen = new Set<string>();
    const out: KnowledgeEdge[] = [];
    for (const e of edges) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
    }
    return out;
}

/** Validates research edges with the EXISTING graph validator. */
export function validateResearchEdges(edges: KnowledgeEdge[]): ReturnType<typeof validateGraph> {
    return validateGraph(edges);
}

// ── Lineage ──────────────────────────────────────────────────────────────────

export interface LineageEntry {
    kind:
        | "mission"
        | "hypothesis"
        | "strategy"
        | "backtest"
        | "oos"
        | "walk_forward"
        | "monte_carlo"
        | "robustness"
        | "incubation"
        | "forward_test";
    id: string;
    label: string;
    status: "completed" | "failed" | "pending" | "skipped";
    detail?: string;
    at?: number;
}

/**
 * The complete traceable lineage of one candidate:
 * Research Mission → Hypothesis → Strategy → Backtest → OOS → Walk-Forward →
 * Monte Carlo → Robustness → Incubation → Forward Test.
 */
export function buildCandidateLineage(
    mission: ResearchMission,
    candidate: ResearchCandidate
): LineageEntry[] {
    const entries: LineageEntry[] = [];
    entries.push({
        kind: "mission",
        id: mission.id,
        label: mission.name,
        status: mission.status === "cancelled" ? "failed" : mission.status === "completed" ? "completed" : "pending",
        detail: `${mission.spec.markets.join(", ")} · ${mission.spec.timeframes.join("/")} · ${mission.spec.tradingStyle}`,
        at: mission.createdAt,
    });
    entries.push({
        kind: "hypothesis",
        id: candidate.hypothesis.id,
        label: candidate.hypothesis.rationale.slice(0, 120) || "Hypothesis",
        status: "completed",
        detail: `source=${candidate.hypothesis.source} · concepts=${candidate.hypothesis.concepts.join(",")}`,
        at: candidate.hypothesis.createdAt,
    });

    const comp = candidate.compilation;
    entries.push({
        kind: "strategy",
        id: comp.strategyId ?? candidate.id,
        label: candidate.strategy?.name ?? "Compilation",
        status: comp.valid ? "completed" : "failed",
        detail: comp.valid
            ? comp.warnings.length > 0
                ? `${comp.warnings.length} compiler warning(s)`
                : "compiled cleanly"
            : comp.errors.join("; ").slice(0, 200),
        at: candidate.createdAt,
    });

    const ev = candidate.evaluation;
    if (!ev) {
        for (const kind of ["backtest", "oos", "walk_forward", "monte_carlo", "robustness"] as const) {
            entries.push({ kind, id: `${candidate.id}:${kind}`, label: kindLabel(kind), status: "pending" });
        }
        entries.push(...tailEntries(mission, candidate));
        return entries;
    }

    entries.push({
        kind: "backtest",
        id: ev.backtest?.backtestId ?? `${candidate.id}:backtest`,
        label: "Deterministic backtest",
        status: ev.backtest ? "completed" : "failed",
        detail: ev.backtest
            ? `${ev.backtest.metrics.totalTrades} trades · PF ${ev.backtest.metrics.profitFactor.toFixed(2)} · DD ${ev.backtest.metrics.maxDrawdownPct.toFixed(1)}%`
            : "backtest unavailable",
        at: ev.backtest?.executedAt,
    });
    entries.push({
        kind: "oos",
        id: `${candidate.id}:oos`,
        label: "Out-of-sample validation",
        status: !ev.validation
            ? mission.spec.requireOOS ? "failed" : "skipped"
            : ev.validation.outcome.verdict === "fragile" ? "failed" : "completed",
        detail: ev.validation
            ? `verdict=${ev.validation.outcome.verdict} · degradation=${ev.validation.outcome.degradation.overall}`
            : "no OOS result",
        at: ev.validation?.outcome.generatedAt,
    });
    const wf = ev.validation?.outcome.walkForward;
    entries.push({
        kind: "walk_forward",
        id: `${candidate.id}:wf`,
        label: "Walk-forward validation",
        status: !wf || !wf.enabled
            ? mission.spec.requireWalkForward && !wf ? "failed" : "skipped"
            : wf.windows.length === 0
                ? mission.spec.requireWalkForward ? "failed" : "skipped"
                : wf.stable ? "completed" : "failed",
        detail: wf ? `windows=${wf.windows.length} · stable=${wf.stable} · score=${wf.stabilityScore}` : "not run",
    });
    entries.push({
        kind: "monte_carlo",
        id: `${candidate.id}:mc`,
        label: "Monte Carlo robustness",
        status: !ev.monteCarlo
            ? mission.spec.requireMonteCarlo ? "failed" : "skipped"
            : ev.monteCarlo.summary.simulations === 0 ? "failed" : "completed",
        detail: ev.monteCarlo
            ? `simulations=${ev.monteCarlo.summary.simulations} · profitProbability=${ev.monteCarlo.summary.profitProbability !== null ? (ev.monteCarlo.summary.profitProbability * 100).toFixed(0) + "%" : "n/a"}`
            : "not run",
    });
    entries.push({
        kind: "robustness",
        id: `${candidate.id}:robustness`,
        label: "Robustness analysis",
        status: candidate.robustnessReport
            ? candidate.robustnessReport.status === "fragile" ? "failed" : "completed"
            : "pending",
        detail: candidate.robustnessReport
            ? `${candidate.robustnessReport.status} · ${candidate.robustnessReport.warnings.length} warning(s)`
            : "pending",
        at: candidate.robustnessReport?.generatedAt,
    });
    entries.push(...tailEntries(mission, candidate));
    return entries;
}

/** Incubation + forward-test lineage entries (always present, honest status). */
function tailEntries(mission: ResearchMission, candidate: ResearchCandidate): LineageEntry[] {
    return [
        {
            kind: "incubation",
            id: candidate.incubationStrategyId ?? `${candidate.id}:incubation`,
            label: "Strategy Lab incubation",
            status: candidate.incubationStrategyId ? "completed" : "pending",
            detail: candidate.incubationStrategyId
                ? `saved as ${candidate.incubationStrategyId}`
                : "not incubated (requires survivor status)",
        },
        {
            kind: "forward_test",
            id: candidate.forwardTestId ?? `${candidate.id}:forward`,
            label: "Forward / paper test",
            status: candidate.forwardTestId ? "completed" : mission.spec.forwardTesting ? "pending" : "skipped",
            detail: candidate.forwardTestId
                ? "existing Strategy Lab forward-test harness (signal-only)"
                : mission.spec.forwardTesting ? "not created yet" : "disabled for this mission",
        },
    ];
}

function kindLabel(kind: LineageEntry["kind"]): string {
    switch (kind) {
        case "backtest": return "Deterministic backtest";
        case "oos": return "Out-of-sample validation";
        case "walk_forward": return "Walk-forward validation";
        case "monte_carlo": return "Monte Carlo robustness";
        case "robustness": return "Robustness analysis";
        default: return kind;
    }
}
