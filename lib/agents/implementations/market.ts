import {
    AgentExecutionRecord,
    AgentOutput,
    WorkflowContext,
} from "../types";
import {
    addEvidence,
    clamp,
    failureOutput,
    firstSnapshot,
    regimeLabel,
    round,
    snapshotOf,
    successOutput,
} from "./shared";

/**
 * Market-domain agent implementations:
 *   - market-scout       → detects candidate opportunities / unusual conditions
 *   - market-context     → regime / volatility / structure / session summary
 *   - volatility-agent   → volatility expansion analysis (parallel-capable)
 *   - structure-agent    → market structure analysis (parallel-capable)
 *
 * All of them are pure functions of measured snapshot data. They flag
 * conditions; the workflow's later agents (risk → critic → verification →
 * synthesis) decide whether anything is actionable.
 */

function readSnapshotFields(snap: Record<string, any> | null) {
    if (!snap) return null;
    const v = snap.volatility || {};
    const q = snap.quote || {};
    const s = snap.session || {};
    return {
        volatility: {
            state: String(v.state || ""),
            atrPercent: Number(v.atrPercent) || 0,
            rangeExpansion: Number(v.rangeExpansion) || 0,
        },
        regime: {
            regime: String(snap.regime?.regime || ""),
            confidence: Number(snap.regime?.confidence) || 0,
        },
        session: { current: String(s.current || "") },
        quote: {
            changePercent: Number(q.changePercent) || 0,
            spread: Number(q.spread) || 0,
            ask: Number(q.ask) || 0,
            bid: Number(q.bid) || 0,
        },
        structureCount: Array.isArray(snap.structure) ? snap.structure.length : 0,
        liquidityCount: Array.isArray(snap.liquidity) ? snap.liquidity.length : 0,
        mtfBias: (() => {
            const mtf = Array.isArray(snap.multiTimeframe) ? snap.multiTimeframe : [];
            return mtf.length > 0 ? String((mtf[mtf.length - 1] as { bias?: string }).bias || "") : "";
        })(),
    };
}

// ─── Market Scout ───────────────────────────────────────────────────────────

export async function marketScout(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const entries = Object.entries(context.market || {});
    if (entries.length === 0) {
        return successOutput({
            agentId: record.agentId,
            summary: "No market snapshot available — nothing to scout.",
            findings: [{ id: "scout_nodata", title: "No market data", detail: "The market data provider could not be reached for the configured symbols." }],
            dataUsed: ["market:none"],
            nextStep: "context",
        });
    }

    const findings: AgentOutput["findings"] = [];
    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const warnings: string[] = [];

    for (const [symbol, raw] of entries) {
        if (!raw || typeof raw !== "object") continue;
        const snap = readSnapshotFields(raw as Record<string, any>);
        if (!snap) continue;
        const used = `market:${symbol}:M5`;
        const evId = addEvidence(evidence, dataUsed, { dataUsed: used, note: `${symbol} snapshot measured` });

        const conditions: string[] = [];
        if (snap.volatility.rangeExpansion >= 1.5) {
            conditions.push(`volatility expansion ${round(snap.volatility.rangeExpansion)}×`);
        }
        if (snap.volatility.state === "extreme" || snap.volatility.state === "high") {
            conditions.push(`${snap.volatility.state} volatility`);
        }
        if (snap.structureCount >= 2) {
            conditions.push(`${snap.structureCount} structure events`);
        }
        if (Math.abs(snap.quote.changePercent) >= 0.8) {
            conditions.push(`momentum ${snap.quote.changePercent >= 0 ? "+" : ""}${round(snap.quote.changePercent)}%`);
        }
        const regimeOk = ["trending_bullish", "trending_bearish", "breakout", "high_volatility"].includes(snap.regime.regime);

        if (conditions.length >= 2 || (conditions.length >= 1 && regimeOk)) {
            findings.push({
                id: `scout_${symbol}`,
                title: `Candidate condition · ${symbol}`,
                detail: `${conditions.join(", ")} · regime ${regimeLabel(snap.regime.regime)} · session ${snap.session.current || "unknown"}. Scouts conditions — it does not decide.`,
                evidence: [evId],
                tags: ["scout", "candidate"],
            });
        }
    }

    if (findings.length === 0 && warnings.length === 0) {
        return successOutput({
            agentId: record.agentId,
            summary: `Scouted ${entries.length} symbol(s) — no candidate condition matched the baseline thresholds.`,
            findings: [{ id: "scout_none", title: "No candidate", detail: "No symbol crossed the scout thresholds on this run." }],
            evidence,
            dataUsed,
            nextStep: "context",
        });
    }

    return successOutput({
        agentId: record.agentId,
        summary: `Scouted ${entries.length} symbol(s); ${findings.length} candidate condition(s) flagged for the context agent.`,
        findings,
        evidence,
        warnings,
        dataUsed,
        nextStep: "context",
        metadata: { candidateCount: findings.length },
    });
}

// ─── Market Context ─────────────────────────────────────────────────────────

export async function marketContextAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const snap = firstSnapshot(context);
    if (!snap) {
        return failureOutput(record.agentId, "No market snapshot to build context from.", { dataUsed: ["market:none"] });
    }
    const f = readSnapshotFields(snap.snap);
    if (!f) {
        return failureOutput(record.agentId, "Market snapshot was malformed.", { dataUsed: [`market:${snap.symbol}`] });
    }

    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const used = `market:${snap.symbol}:M5`;
    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: used,
        note: `${snap.symbol} regime/volatility/structure snapshot`,
    });

    const findings: AgentOutput["findings"] = [
        {
            id: "ctx_regime",
            title: "Market regime",
            detail: `${regimeLabel(f.regime.regime)} (${round(f.regime.confidence)}% confidence)`,
            evidence: [evId],
        },
        {
            id: "ctx_volatility",
            title: "Volatility",
            detail: `${f.volatility.state || "normal"} · ATR% ${round(f.volatility.atrPercent)} · range expansion ${round(f.volatility.rangeExpansion)}×`,
            evidence: [evId],
        },
        {
            id: "ctx_structure",
            title: "Structure",
            detail: `${f.structureCount} structure event(s), ${f.liquidityCount} liquidity level(s)`,
            evidence: [evId],
        },
        {
            id: "ctx_session",
            title: "Session",
            detail: `${f.session.current || "unknown"} · bias ${f.mtfBias || "neutral"}`,
            evidence: [evId],
        },
    ];

    return successOutput({
        agentId: record.agentId,
        summary: `${snap.symbol}: ${regimeLabel(f.regime.regime)} regime, ${f.volatility.state || "normal"} volatility, ${f.session.current || "unknown"} session.`,
        confidence: clamp(f.regime.confidence / 100, 0, 1),
        findings,
        evidence,
        dataUsed,
        nextStep: "analysis",
        metadata: {
            regime: f.regime.regime,
            volatility: f.volatility.state,
            session: f.session.current,
            structureCount: f.structureCount,
        },
    });
}

// ─── Volatility Agent (parallel-capable) ────────────────────────────────────

export async function volatilityAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const entries = Object.entries(context.market || {});
    const findings: AgentOutput["findings"] = [];
    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const warnings: string[] = [];

    for (const [symbol, raw] of entries) {
        if (!raw || typeof raw !== "object") continue;
        const snap = readSnapshotFields(raw as Record<string, any>);
        if (!snap) continue;
        const used = `market:${symbol}:volatility`;
        const evId = addEvidence(evidence, dataUsed, {
            dataUsed: used,
            value: snap.volatility.rangeExpansion,
            note: `range expansion ratio for ${symbol}`,
        });
        const detail = `ATR% ${round(snap.volatility.atrPercent)} · expansion ${round(snap.volatility.rangeExpansion)}× · state ${snap.volatility.state || "normal"}`;
        findings.push({
            id: `vol_${symbol}`,
            title: `Volatility · ${symbol}`,
            detail,
            evidence: [evId],
        });
        if (snap.volatility.rangeExpansion >= 2.5) {
            warnings.push(`${symbol}: extreme range expansion ${round(snap.volatility.rangeExpansion)}×.`);
        }
    }

    const volatileCount = findings.filter((f) => f.detail.includes("extreme") || warnings.length > 0).length;
    return successOutput({
        agentId: record.agentId,
        summary: `Volatility assessed on ${findings.length} symbol(s); ${warnings.length} extreme expansion warning(s).`,
        findings,
        evidence,
        warnings,
        dataUsed,
        nextStep: "strategy_matching",
        metadata: { extremeSymbols: warnings.length },
    });
}

// ─── Structure Agent (parallel-capable) ─────────────────────────────────────

export async function structureAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const entries = Object.entries(context.market || {});
    const findings: AgentOutput["findings"] = [];
    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const warnings: string[] = [];

    for (const [symbol, raw] of entries) {
        if (!raw || typeof raw !== "object") continue;
        const snap = readSnapshotFields(raw as Record<string, any>);
        if (!snap) continue;
        const used = `market:${symbol}:structure`;
        const evId = addEvidence(evidence, dataUsed, {
            dataUsed: used,
            value: snap.structureCount,
            note: `structure event count for ${symbol}`,
        });
        const aligned = snap.structureCount >= 2;
        findings.push({
            id: `struct_${symbol}`,
            title: `Structure · ${symbol}`,
            detail: `${snap.structureCount} structure event(s), ${snap.liquidityCount} liquidity level(s) — ${aligned ? "structure aligned" : "no clear structure"} on this snapshot.`,
            evidence: [evId],
        });
        if (!aligned) warnings.push(`${symbol}: no strong structure evidence on this snapshot.`);
    }

    return successOutput({
        agentId: record.agentId,
        summary: `Structure analysed on ${findings.length} symbol(s).`,
        findings,
        evidence,
        warnings,
        dataUsed,
        nextStep: "strategy_matching",
        metadata: { alignedCount: findings.filter((f) => f.detail.includes("aligned")).length },
    });
}