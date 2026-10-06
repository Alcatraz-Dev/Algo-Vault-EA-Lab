/**
 * Phase 16 §33 — Cross-Asset Agent Team.
 *
 * Seven READ_ONLY agents over the ONE stored Global Cross-Asset Intelligence
 * Graph. They reuse the existing Phase 14 agent runtime (`workflow-engine`
 * executors) — there is no second agent system here.
 *
 * Rules:
 *   • the graph comes from `context.crossAsset`, which the server populates
 *     from the canonical stored snapshot — never from client input;
 *   • when no snapshot exists every agent FAILS CLOSED with an explicit
 *     "no cross-asset graph available" output instead of inventing state;
 *   • outputs are observations and readings, never trade instructions —
 *     execution still has to pass Risk → Portfolio Risk Supervisor →
 *     Execution Supervisor → Permission Gate → user approval (§34).
 */

import { AgentEvidence, AgentExecutionRecord, AgentOutput, WorkflowContext } from "../types";
import { addEvidence, round, successOutput } from "./shared";

/* ── typed view over the stored graph ─────────────────────────────────────── */

interface CorrelationEdgeView {
    a: string;
    b: string;
    coefficient: number | null;
    stability: string;
    term: string;
    claims: Array<{ kind?: string; text?: string }>;
}

interface SignalView {
    type: string;
    status: string;
    summary: string;
    confidence: number;
}

interface RegimeView {
    activeStates: string[];
    axes: Array<{ axis: string; state: string; confidence: number }>;
}

interface GraphView {
    nodeCount: number;
    edgeCount: number;
    dataTimestamp: number;
    createdAt: number;
    correlations: CorrelationEdgeView[];
    signals: SignalView[];
    regime: RegimeView | null;
    clusters: Array<{ label: string; memberCount: number }>;
    limitations: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Normalise the context payload. Returns null when nothing is available. */
export function readGraph(context: WorkflowContext): GraphView | null {
    const raw = context.crossAsset;
    if (!isRecord(raw)) return null;
    const snapshot = isRecord(raw.snapshot) ? raw.snapshot : raw;
    if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return null;

    const edges = snapshot.edges as unknown[];
    const nodes = snapshot.nodes as unknown[];

    const correlations: CorrelationEdgeView[] = [];
    for (const e of edges) {
        if (!isRecord(e)) continue;
        const type = String(e.relationshipType ?? "");
        if (type !== "CORRELATION" && type !== "INVERSE_CORRELATION") continue;
        correlations.push({
            a: String(e.sourceNodeId ?? "").replace(/^instrument:/, ""),
            b: String(e.targetNodeId ?? "").replace(/^instrument:/, ""),
            coefficient: typeof e.coefficient === "number" ? e.coefficient : null,
            stability: String(e.stability ?? "UNKNOWN"),
            term: String(e.term ?? "UNKNOWN"),
            claims: Array.isArray(e.claims) ? (e.claims as Array<{ kind?: string; text?: string }>) : [],
        });
    }

    const signals: SignalView[] = [];
    if (Array.isArray(snapshot.signals)) {
        for (const s of snapshot.signals as unknown[]) {
            if (!isRecord(s)) continue;
            const status = String(s.status ?? "");
            if (status !== "DETECTED" && status !== "CONFIRMED") continue;
            signals.push({
                type: String(s.type ?? ""),
                status,
                summary: String(s.summary ?? ""),
                confidence: typeof s.confidence === "number" ? s.confidence : 0,
            });
        }
    }

    let regime: RegimeView | null = null;
    if (isRecord(snapshot.regime)) {
        const r = snapshot.regime;
        regime = {
            activeStates: Array.isArray(r.activeStates) ? (r.activeStates as unknown[]).map(String) : [],
            axes: Array.isArray(r.axes)
                ? (r.axes as unknown[]).filter(isRecord).map((a) => ({
                      axis: String(a.axis ?? ""),
                      state: String(a.state ?? "UNKNOWN"),
                      confidence: typeof a.confidence === "number" ? a.confidence : 0,
                  }))
                : [],
        };
    }

    const clusters: Array<{ label: string; memberCount: number }> = [];
    if (Array.isArray(snapshot.clusters)) {
        for (const c of snapshot.clusters as unknown[]) {
            if (!isRecord(c)) continue;
            clusters.push({
                label: String(c.label ?? "cluster"),
                memberCount: Array.isArray(c.memberNodeIds) ? c.memberNodeIds.length : 0,
            });
        }
    }

    return {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        dataTimestamp: Number(snapshot.dataTimestamp ?? 0),
        createdAt: Number(snapshot.createdAt ?? 0),
        correlations,
        signals,
        regime,
        clusters,
        limitations: Array.isArray(snapshot.limitations) ? (snapshot.limitations as unknown[]).map(String) : [],
    };
}

/** Honest fail-closed output shared by the whole team. */
function noGraph(agentId: string, nextStep: string): AgentOutput {
    return {
        agentId,
        status: "failed",
        confidence: 0,
        summary:
            "No cross-asset graph is available in this execution context — nothing was analysed and nothing was inferred (fail-closed, §16).",
        findings: [],
        evidence: [],
        warnings: ["cross_asset_context_missing"],
        dataUsed: [],
        nextStep,
        error: "cross_asset_context_missing",
    };
}

/* ── 1. Global Market Analyst ─────────────────────────────────────────────── */

export async function globalMarketAnalyst(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const graph = readGraph(context);
    if (!graph) return noGraph(record.agentId, "relationship-analyst");

    const evidence: AgentEvidence[] = [];
    const dataUsed: string[] = [];
    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: `crossAsset:graph:${graph.createdAt}`,
        note: `Graph snapshot with ${graph.nodeCount} nodes / ${graph.edgeCount} edges read at dataTimestamp ${graph.dataTimestamp}.`,
    });

    const states = graph.regime?.activeStates ?? [];
    const findings: AgentOutput["findings"] = [
        {
            id: "global_state",
            title: `Global state: ${states.length > 0 ? states.join(" + ") : "UNKNOWN"}`,
            detail:
                graph.regime && graph.regime.axes.length > 0
                    ? graph.regime.axes.map((a) => `${a.axis}=${a.state}`).join(", ")
                    : "The stored snapshot carries no regime axes.",
            evidence: [evId],
            tags: ["cross-asset", "regime"],
        },
    ];

    return successOutput({
        agentId: record.agentId,
        summary: `Read global market state from the stored graph: ${states.join(", ") || "UNKNOWN"} across ${graph.nodeCount} nodes.`,
        confidence: states.length > 0 ? 0.7 : 0.3,
        findings,
        evidence,
        dataUsed,
        nextStep: "relationship-analyst",
        metadata: { regimeStates: states, nodeCount: graph.nodeCount, edgeCount: graph.edgeCount },
    });
}

/* ── 2. Relationship Analyst ──────────────────────────────────────────────── */

export async function relationshipAnalyst(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const graph = readGraph(context);
    if (!graph) return noGraph(record.agentId, "correlation-agent");

    const evidence: AgentEvidence[] = [];
    const dataUsed: string[] = [];
    const measured = graph.correlations.filter((c) => c.coefficient !== null);
    const strongest = [...measured].sort(
        (x, y) => Math.abs(y.coefficient ?? 0) - Math.abs(x.coefficient ?? 0)
    );

    const findings: AgentOutput["findings"] = [];
    const top = strongest[0];
    if (top) {
        const evId = addEvidence(evidence, dataUsed, {
            dataUsed: `crossAsset:edge:${top.a}:${top.b}`,
            note: `${top.a} ↔ ${top.b} ρ=${round(top.coefficient ?? 0)} (${top.term}, stability ${top.stability}).`,
            value: top.coefficient ?? undefined,
        });
        findings.push({
            id: "strongest_relationship",
            title: `Strongest measured relationship: ${top.a} ↔ ${top.b}`,
            detail: `ρ = ${round(top.coefficient ?? 0)} — a measured historical association, not a causal or predictive claim (§56, §57).`,
            evidence: [evId],
            tags: ["cross-asset", "relationship"],
        });
    }

    const unstable = measured.filter((c) => c.stability === "BREAKING" || c.stability === "FLIPPING");
    for (const u of unstable.slice(0, 3)) {
        const evId = addEvidence(evidence, dataUsed, {
            dataUsed: `crossAsset:edge:${u.a}:${u.b}`,
            note: `${u.a} ↔ ${u.b} stability ${u.stability} (ρ=${round(u.coefficient ?? 0)}).`,
        });
        findings.push({
            id: `unstable_${u.a}_${u.b}`,
            title: `${u.a} ↔ ${u.b} relationship is ${u.stability.toLowerCase()}`,
            detail: `Measured stability ${u.stability} over the current window — the relationship may not hold in the next one.`,
            evidence: [evId],
            tags: ["cross-asset", "stability"],
        });
    }

    return successOutput({
        agentId: record.agentId,
        summary: `Read ${measured.length} measured relationship(s); ${unstable.length} classified BREAKING/FLIPPING.`,
        confidence: measured.length > 0 ? 0.65 : 0.3,
        findings,
        evidence,
        dataUsed,
        nextStep: "correlation-agent",
        metadata: { relationshipCount: measured.length, strongest: top ? `${top.a}/${top.b}` : null },
    });
}

/* ── 3. Correlation Agent ─────────────────────────────────────────────────── */

export async function correlationAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const graph = readGraph(context);
    if (!graph) return noGraph(record.agentId, "regime-agent");

    const evidence: AgentEvidence[] = [];
    const dataUsed: string[] = [];
    const changeSignals = graph.signals.filter((s) =>
        ["CORRELATION_BREAK", "RELATIONSHIP_FLIP", "RELATIONSHIP_STRENGTHENING", "RELATIONSHIP_WEAKENING"].includes(s.type)
    );

    const findings: AgentOutput["findings"] = changeSignals.slice(0, 5).map((s) => {
        const evId = addEvidence(evidence, dataUsed, {
            dataUsed: `crossAsset:signal:${s.type}`,
            note: s.summary,
            value: s.confidence,
        });
        return {
            id: `corr_${s.type}_${findingsIdSuffix(s.summary)}`,
            title: `${s.type.replace(/_/g, " ").toLowerCase()} observed`,
            detail: `${s.summary} [${s.status}] — an observation, not a trade signal (§18).`,
            evidence: [evId],
            tags: ["cross-asset", "correlation"],
        };
    });

    return successOutput({
        agentId: record.agentId,
        summary: `${changeSignals.length} active correlation-change signal(s) in the stored graph.`,
        confidence: changeSignals.length > 0 ? 0.6 : 0.3,
        findings,
        evidence,
        dataUsed,
        nextStep: "regime-agent",
        metadata: { activeSignals: changeSignals.length, breaks: changeSignals.filter((s) => s.type === "CORRELATION_BREAK").length },
    });
}

function findingsIdSuffix(text: string): string {
    return text.replace(/[^a-z0-9]/gi, "").slice(0, 16);
}

/* ── 4. Regime Agent ──────────────────────────────────────────────────────── */

export async function regimeAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const graph = readGraph(context);
    if (!graph) return noGraph(record.agentId, "portfolio-context-agent");

    const evidence: AgentEvidence[] = [];
    const dataUsed: string[] = [];
    const regimeSignals = graph.signals.filter((s) => s.type === "REGIME_SHIFT" || s.type.startsWith("VOLATILITY_"));

    const findings: AgentOutput["findings"] = [];
    if (graph.regime) {
        for (const axis of graph.regime.axes) {
            if (axis.state === "UNKNOWN") continue;
            const evId = addEvidence(evidence, dataUsed, {
                dataUsed: `crossAsset:regime:${axis.axis}`,
                note: `${axis.axis} = ${axis.state} (rule confidence ${round(axis.confidence)}).`,
                value: axis.confidence,
            });
            findings.push({
                id: `regime_${axis.axis}`,
                title: `${axis.axis}: ${axis.state}`,
                detail: `Measured on the stored multi-axis regime snapshot; UNKNOWN axes are reported as UNKNOWN, never guessed (§16).`,
                evidence: [evId],
                tags: ["cross-asset", "regime"],
            });
        }
    }
    for (const s of regimeSignals.slice(0, 3)) {
        const evId = addEvidence(evidence, dataUsed, {
            dataUsed: `crossAsset:signal:${s.type}`,
            note: s.summary,
        });
        findings.push({
            id: `regime_signal_${findingsIdSuffix(s.summary)}`,
            title: `${s.type.replace(/_/g, " ")}`,
            detail: s.summary,
            evidence: [evId],
            tags: ["cross-asset", "transition"],
        });
    }

    return successOutput({
        agentId: record.agentId,
        summary: `Regime axes: ${(graph.regime?.activeStates ?? ["UNKNOWN"]).join(", ")}; ${regimeSignals.length} regime/volatility signal(s).`,
        confidence: graph.regime && graph.regime.axes.length > 0 ? 0.65 : 0.3,
        findings,
        evidence,
        dataUsed,
        nextStep: "portfolio-context-agent",
        metadata: { activeStates: graph.regime?.activeStates ?? [], transitions: regimeSignals.length },
    });
}

/* ── 5. Portfolio Context Agent ───────────────────────────────────────────── */

export async function portfolioContextAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const graph = readGraph(context);
    if (!graph) return noGraph(record.agentId, "cross-asset-research-agent");

    const evidence: AgentEvidence[] = [];
    const dataUsed: string[] = [];
    const positionCount = Number(context.risk?.positionCount ?? 0);
    const correlatedExposure = Number(context.risk?.correlatedExposure ?? 0);

    if (positionCount === 0) {
        return successOutput({
            agentId: record.agentId,
            summary:
                "Global cross-asset conditions were read, but there are no open positions — portfolio impact is not applicable.",
            confidence: 0.5,
            findings: [
                {
                    id: "no_holdings",
                    title: "No portfolio exposure",
                    detail: `Global states: ${(graph.regime?.activeStates ?? ["UNKNOWN"]).join(", ")}. No holdings means no correlated-exposure warning applies.`,
                    tags: ["cross-asset", "portfolio"],
                },
            ],
            evidence,
            dataUsed,
            nextStep: "cross-asset-research-agent",
            metadata: { positionCount: 0 },
        });
    }

    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: "portfolio:risk",
        note: `${positionCount} open position(s), correlatedExposure=${round(correlatedExposure)}.`,
        value: correlatedExposure,
    });

    const warning =
        correlatedExposure >= 0.5
            ? "Cross-asset correlated exposure is elevated relative to gross exposure — review before adding correlated positions."
            : correlatedExposure >= 0.3
              ? "Cross-asset correlated exposure is moderate — position sizing should account for it."
              : "Cross-asset correlated exposure is low at current levels.";

    const findings: AgentOutput["findings"] = [
        {
            id: "exposure_context",
            title: "Portfolio × global conditions",
            detail: `${warning} Global states: ${(graph.regime?.activeStates ?? ["UNKNOWN"]).join(", ")}. This is a review recommendation, never an execution instruction (§34).`,
            evidence: [evId],
            tags: ["cross-asset", "portfolio"],
        },
    ];

    return successOutput({
        agentId: record.agentId,
        summary: `Connected global conditions to ${positionCount} open position(s); correlated exposure ${round(correlatedExposure)}.`,
        confidence: 0.6,
        findings,
        evidence,
        dataUsed,
        nextStep: "cross-asset-research-agent",
        metadata: { positionCount, correlatedExposure },
    });
}

/* ── 6. Cross-Asset Research Agent ────────────────────────────────────────── */

export async function crossAssetResearchAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const graph = readGraph(context);
    if (!graph) return noGraph(record.agentId, "global-intelligence-supervisor");

    const evidence: AgentEvidence[] = [];
    const dataUsed: string[] = [];
    const hypotheses: string[] = [];

    const measured = graph.correlations.filter((c) => c.coefficient !== null).slice(0, 3);
    for (const c of measured) {
        hypotheses.push(
            `Does ${c.a} behaviour differ when its ${c.term.toLowerCase()} relationship with ${c.b} is ${c.stability.toLowerCase()}? (test with historical windows, OOS, walk-forward, Monte Carlo)`
        );
    }
    for (const s of graph.signals.filter((x) => x.type === "CORRELATION_BREAK" || x.type === "REGIME_SHIFT").slice(0, 2)) {
        hypotheses.push(
            `Does strategy performance change around observed events of type ${s.type}? (deterministic feature generation + backtest, no future leakage)`
        );
    }

    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: `crossAsset:graph:${graph.createdAt}`,
        note: `${hypotheses.length} hypothesis/hypotheses generated from ${measured.length} measured relationship(s) and ${graph.signals.length} stored signal(s).`,
    });

    const findings: AgentOutput["findings"] = hypotheses.map((h, i) => ({
        id: `hypothesis_${i}`,
        title: `Research question ${i + 1}`,
        detail: h,
        evidence: [evId],
        tags: ["cross-asset", "research"],
    }));

    return successOutput({
        agentId: record.agentId,
        summary: `${hypotheses.length} testable cross-asset hypothesis(es) framed from measured relationships — none is a conclusion (§27).`,
        confidence: 0.5,
        findings,
        evidence,
        dataUsed,
        nextStep: "global-intelligence-supervisor",
        metadata: { hypotheses },
    });
}

/* ── 7. Global Intelligence Supervisor ────────────────────────────────────── */

export async function globalIntelligenceSupervisor(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const graph = readGraph(context);
    const outputs = Object.entries(context.agentOutputs ?? {});

    const evidence: AgentEvidence[] = [];
    const dataUsed: string[] = [];
    const conflicts: string[] = [];

    const summaries: string[] = [];
    for (const [agentId, out] of outputs) {
        if (!out || agentId === record.agentId) continue;
        summaries.push(`${agentId}: ${out.summary}`);
        if (out.status === "failed") conflicts.push(`${agentId} failed or had no data — its absence is not evidence of safety.`);
    }

    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: "agentOutputs:consolidation",
        note: `Consolidated ${summaries.length} agent output(s) with the stored graph ${graph ? `(${graph.nodeCount} nodes)` : "(absent)"}.`,
    });

    const states = graph?.regime?.activeStates ?? ["UNKNOWN"];
    const finding: AgentOutput["findings"] = [
        {
            id: "consolidated",
            title: `Cross-asset picture: ${states.join(" + ")}`,
            detail:
                summaries.length > 0
                    ? summaries.join(" | ")
                    : "No upstream agent outputs were present in this execution; only the stored graph was read.",
            evidence: [evId],
            tags: ["cross-asset", "supervisor"],
        },
    ];

    return successOutput({
        agentId: record.agentId,
        summary: `Supervised ${summaries.length} agent output(s); global states ${states.join(", ")}. Consolidation adds no new measurements and no predictions.`,
        confidence: outputs.length > 0 ? 0.6 : 0.35,
        findings: finding,
        evidence,
        dataUsed,
        warnings: conflicts,
        nextStep: "",
        metadata: { conflicts, agentCount: summaries.length, graphAvailable: Boolean(graph) },
    });
}
