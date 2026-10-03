import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { ai } from "@/lib/ai/client";
import { getCandidate, getMission } from "@/lib/strategy-research/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

function evidenceBlock(candidate: Awaited<ReturnType<typeof getCandidate>>): string {
    if (!candidate) return "No candidate.";
    const ev = candidate.evaluation;
    const lines: string[] = [];
    lines.push(`Candidate: ${candidate.strategy?.name ?? candidate.id}`);
    lines.push(`Market/timeframe: ${candidate.hypothesis.market} ${candidate.strategy?.timeframes.setup ?? ""}`);
    lines.push(`Lifecycle: ${candidate.lifecycle}${candidate.rejectedReason ? ` (rejected: ${candidate.rejectedReason})` : ""}`);
    lines.push(`Direction: ${candidate.hypothesis.direction}; concepts: ${candidate.hypothesis.concepts.join(", ")}`);
    lines.push(`Entry rules: ${(candidate.strategy?.entryRules ?? []).map((r) => `${r.group} ${r.operator} ${String(r.value)}`).join(" AND ") || "—"}`);
    if (ev?.backtest) {
        const m = ev.backtest.metrics;
        lines.push(
            `Backtest: trades=${m.totalTrades} winRate=${m.winRate.toFixed(1)}% PF=${m.profitFactor.toFixed(2)} net=${m.netProfit.toFixed(2)} maxDD=${m.maxDrawdownPct.toFixed(1)}% expectancyR=${m.expectancyR.toFixed(2)}`
        );
        if (ev.backtest.window) {
            lines.push(
                `Window: ${new Date(ev.backtest.window.from).toISOString().slice(0, 10)} → ${new Date(ev.backtest.window.to).toISOString().slice(0, 10)} (${ev.backtest.window.bars} bars, ${ev.backtest.window.dataSource ?? "unknown"} source)`
            );
        }
        if (ev.backtest.distribution) {
            lines.push(
                `Distribution: months=${ev.backtest.distribution.monthsCovered} topMonthShare=${ev.backtest.distribution.topMonthSharePct}% topRegimeShare=${ev.backtest.distribution.topRegimeSharePct}% profitableMonths=${Math.round(ev.backtest.distribution.profitableMonthShare * 100)}%`
            );
        }
    }
    if (ev?.validation) {
        const v = ev.validation.outcome;
        lines.push(
            `OOS: verdict=${v.verdict} degradation=${v.degradation.overall} IS(trades=${v.inSample.metrics.totalTrades}, PF=${v.inSample.metrics.profitFactor.toFixed(2)}) OOS(trades=${v.outOfSample.metrics.totalTrades}, PF=${v.outOfSample.metrics.profitFactor.toFixed(2)})`
        );
        lines.push(
            `Walk-forward: enabled=${v.walkForward.enabled} windows=${v.walkForward.windows.length} stable=${v.walkForward.stable} stabilityScore=${v.walkForward.stabilityScore}`
        );
    }
    if (ev?.monteCarlo) {
        const mc = ev.monteCarlo.summary;
        lines.push(
            `Monte Carlo: simulations=${mc.simulations} seed=${mc.seed} profitProbability=${mc.profitProbability !== null ? (mc.profitProbability * 100).toFixed(1) + "%" : "n/a"} drawdownP95=${mc.drawdownP95 !== null ? (mc.drawdownP95 * 100).toFixed(1) + "%" : "n/a"}`
        );
        if (mc.limitations.length > 0) lines.push(`MC limitations: ${mc.limitations.join("; ")}`);
    }
    if (ev?.executionVariation) {
        lines.push(
            `Execution variation: base=${ev.executionVariation.baseNet.toFixed(2)} spread×2=${ev.executionVariation.spreadDoubledNet.toFixed(2)} slippage×2=${ev.executionVariation.slippageDoubledNet.toFixed(2)}`
        );
    }
    if (candidate.robustnessReport) {
        lines.push(`Robustness: ${candidate.robustnessReport.status}`);
        for (const d of candidate.robustnessReport.dimensions) {
            lines.push(`  - ${d.dimension}: ${d.status} — ${d.detail}`);
        }
    }
    if (candidate.warnings.length > 0) {
        lines.push("Deterministic warnings:");
        for (const w of candidate.warnings) lines.push(`  - [${w.severity}] ${w.type}: ${w.message}`);
    }
    if (candidate.score) {
        lines.push(`Research score: ${candidate.score.total}/100 (${candidate.score.verdict}); factors=${JSON.stringify(candidate.score.factors)}`);
    }
    if (candidate.rejectedNotes.length > 0) {
        lines.push(`Rejection notes: ${candidate.rejectedNotes.join(" | ")}`);
    }
    return lines.join("\n");
}

// Auth: owner bearer + Pro entitlement re-checked. The AI only EXPLAINS the
// deterministic evidence above — it never generates metrics, code, or trades.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; candidateId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;
        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json({ error: access.reason ?? "Access denied" }, { status: 403, headers: corsHeaders });
        }

        const { id, candidateId } = await params;
        const mission = await getMission(uid, id);
        if (!mission || mission.uid !== uid) {
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }
        const candidate = await getCandidate(uid, id, candidateId);
        if (!candidate) {
            return NextResponse.json({ error: "Candidate not found" }, { status: 404, headers: corsHeaders });
        }

        const system = [
            "You are a research analyst inside AlgoVault explaining a strategy research candidate.",
            "You ONLY interpret the deterministic evidence provided. You NEVER invent numbers, metrics, results, guarantees, or trading advice.",
            "Be concise and neutral: describe what the evidence shows, the main risks/warnings, and what would need to be verified next.",
            "This is research output, not investment advice. Never call it a winning or guaranteed strategy.",
        ].join("\n");

        const prompt = [
            "Explain this research candidate to its owner in plain language (max 220 words, structured as: What it tests · What the evidence shows · Main concerns · Next verification step).",
            "",
            evidenceBlock(candidate),
        ].join("\n");

        let explanation: string;
        try {
            explanation = await ai.generateText(prompt, system);
        } catch (err) {
            const message = err instanceof Error ? err.message : "AI provider failure";
            return NextResponse.json(
                { error: `AI_UNAVAILABLE: ${message}` },
                { status: 503, headers: corsHeaders }
            );
        }

        if (!explanation || !explanation.trim()) {
            return NextResponse.json(
                { error: "AI_UNAVAILABLE: empty explanation returned." },
                { status: 503, headers: corsHeaders }
            );
        }

        return NextResponse.json(
            { explanation: explanation.trim().slice(0, 4000) },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/explain]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Explanation failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
