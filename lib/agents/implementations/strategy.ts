import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "../types";
import {
    addEvidence,
    clamp,
    firstSnapshot,
    round,
    sessionLabel,
    successOutput,
} from "./shared";

/**
 * Strategy Matching + Pattern Discovery agents.
 *
 * Both compare CURRENT measured conditions against a historical setup
 * fingerprint library built from the user's recorded trades. They describe
 * similarity — never future performance — and the detail text says so.
 */

type TradeLike = {
    symbol: string;
    direction: string;
    openedAt: number;
    closedAt: number;
    net: number;
    volume: number;
};

function tradesOf(context: WorkflowContext): TradeLike[] {
    return (context.history?.trades || []) as TradeLike[];
}

export async function strategyMatcher(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const trades = tradesOf(context);
    const snap = firstSnapshot(context);
    const label = snap ? `${snap.symbol} ${snap.snap?.timeframe || "M5"}` : "current market";
    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const findings: AgentOutput["findings"] = [];
    const warnings: string[] = [];

    if (trades.length === 0 || !snap) {
        return successOutput({
            agentId: record.agentId,
            summary: "No historical setup fingerprint library available for matching.",
            findings: [{ id: "sm_nohistory", title: "Insufficient history", detail: "Connect and monitor bots so the fingerprint library can be built from recorded trades." }],
            evidence,
            dataUsed,
            nextStep: "risk",
        });
    }

    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: `history:trades:${trades.length}`,
        note: `recorded trade library of ${trades.length} trades`,
    });

    const regime = String(snap.snap?.regime?.regime || "");
    const volatility = String(snap.snap?.volatility?.state || "");
    const session = String(snap.snap?.session?.current || "");
    const structureCount = Array.isArray(snap.snap?.structure) ? snap.snap.structure.length : 0;

    // Count historical situations sharing regime + volatility-domain conditions.
    const matched = trades.filter((t) => {
        const hour = t.openedAt ? new Date(t.openedAt).getUTCHours() : -1;
        const historicalSession = sessionLabel(hour);
        return historicalSession.toLowerCase() === String(session || "").toLowerCase();
    });
    const winContext = matched.length > 0 ? matched.filter((t) => t.net > 0).length / matched.length : 0;
    const matchRatio = clamp(matched.length / Math.max(1, trades.length), 0, 1);

    findings.push({
        id: "sm_similarity",
        title: "Historical similarity · " + label,
        detail: `${matched.length} recorded trade(s) opened in the same session context (${session || "unknown"}). ${round(winContext * 100)}% of those were profitable in the recorded sample — a contextual comparison, not a prediction.`,
        evidence: [evId],
    });
    findings.push({
        id: "sm_conditions",
        title: "Current condition alignment",
        detail: `regime ${regime || "unknown"} · volatility ${volatility || "normal"} · ${structureCount} structure event(s) · session ${session || "unknown"}.`,
        evidence: [evId],
    });

    if (matched.length >= 5) {
        warnings.push(`${matched.length} historical trades share this session context — structural similarity is present.`);
    } else {
        warnings.push(`Fewer than 5 recorded trades share this session context — similarity evidence is limited.`);
    }

    return successOutput({
        agentId: record.agentId,
        summary: `Strategy matching compared current conditions with ${trades.length} recorded setup fingerprints; similarity ${matchRatio >= 0.5 ? "high" : "limited"}.`,
        confidence: clamp(0.3 + matchRatio * 0.4, 0, 1),
        findings,
        evidence,
        warnings,
        dataUsed,
        nextStep: "risk",
        metadata: { similarCount: matched.length, matchRatio: round(matchRatio, 2), historicalWinRate: round(winContext, 2), aligned: matched.length >= 5 },
    });
}

export async function patternDiscovery(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const trades = tradesOf(context);
    const findings: AgentOutput["findings"] = [];
    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];

    if (trades.length < 5) {
        return successOutput({
            agentId: record.agentId,
            summary: "Pattern Discovery needs at least 5 recorded trades.",
            findings: [{ id: "pd_insufficient", title: "Insufficient data", detail: "Recorded trade library is too small for recurring pattern discovery." }],
            evidence,
            dataUsed,
            nextStep: "critic",
        });
    }

    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: `history:trades:${trades.length}`,
        note: "recurring-pattern feature scan over recorded trades",
    });

    const wins = trades.filter((t) => t.net > 0);
    const losses = trades.filter((t) => t.net < 0);

    // Session concentration.
    const sessionBuckets: Record<string, { count: number; pnl: number }> = {};
    for (const t of trades) {
        const hour = t.openedAt ? new Date(t.openedAt).getUTCHours() : -1;
        const s = sessionLabel(hour);
        const b = (sessionBuckets[s] ||= { count: 0, pnl: 0 });
        b.count += 1;
        b.pnl += t.net;
    }
    const best = Object.entries(sessionBuckets).sort((a, b) => b[1].pnl - a[1].pnl)[0];

    // Loss streaks.
    let maxStreak = 0;
    let streak = 0;
    for (const t of trades) {
        if (t.net < 0) {
            streak += 1;
            maxStreak = Math.max(maxStreak, streak);
        } else {
            streak = 0;
        }
    }

    // Win rate by position volume bucket (size discipline).
    const vols = trades.map((t) => t.volume).sort((a, b) => a - b);
    const median = vols[Math.floor(vols.length / 2)] || 0;
    const small = trades.filter((t) => t.volume <= median);
    const large = trades.filter((t) => t.volume > median);
    const smallWr = small.length ? round((small.filter((t) => t.net > 0).length / small.length) * 100) : 0;
    const largeWr = large.length ? round((large.filter((t) => t.net > 0).length / large.length) * 100) : 0;

    findings.push({
        id: "pd_session",
        title: best ? `Recurring session pattern · ${best[0]}` : "Session pattern",
        detail: best ? `${best[0]} session accounts for the best aggregate P/L (${best[1].count} trades, P/L ${round(best[1].pnl)}).` : "No session concentration found.",
        evidence: [evId],
    });
    findings.push({
        id: "pd_streak",
        title: "Risk behaviour pattern",
        detail: maxStreak >= 3 ? `Longest losing streak in recorded history: ${maxStreak} consecutive losses.` : `Longest losing streak: ${maxStreak} — no extended streak in the sample.`,
        evidence: [evId],
    });
    findings.push({
        id: "pd_sizing",
        title: "Position sizing pattern",
        detail: `Win rate below median size: ${smallWr}% vs above median size: ${largeWr}% (${trades.length} trades). Sample observation only.`,
        evidence: [evId],
    });

    // No guarantee anywhere: note the sample limitation.
    findings.push({
        id: "pd_sample",
        title: "Sample note",
        detail: `All patterns above are descriptive statistics of ${trades.length} recorded trades (${wins.length} win, ${losses.length} loss). They are not predictive.`,
        evidence: [evId],
    });

    return successOutput({
        agentId: record.agentId,
        summary: `Pattern Discovery extracted ${findings.length} recurring patterns from ${trades.length} recorded trades.`,
        findings,
        evidence,
        dataUsed,
        nextStep: "critic",
        metadata: { patterns: findings.length, maxLossStreak: maxStreak },
    });
}