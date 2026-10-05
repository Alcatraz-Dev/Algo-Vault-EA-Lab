import { areChallengesEnabled } from "./feature-flags";
import { evaluateSettlement, type SettlementInput, type SettlementVerdict } from "@/lib/performance-arena/settlement";
import { evaluateAccountRules, type RuleContext } from "@/lib/performance-arena/rules";
import type { ChallengeAccount, ChallengeEvaluation, ChallengeTemplate, TradingEvent } from "./contracts";
import { calculateDrawdown } from "./risk";

export type ChallengeFeatureState = "ENABLED" | "BLOCKED";
export function challengeFeatureState(): ChallengeFeatureState {
    return areChallengesEnabled() ? "ENABLED" : "BLOCKED";
}

/** The challenge backend's deterministic account rules; stale data only emits warnings. */
export function evaluateChallengeRules(context: RuleContext) {
    return challengeFeatureState() === "BLOCKED"
        ? { status: "BLOCKED" as const, reason: "Challenge evaluation is disabled." }
        : { status: "AVAILABLE" as const, events: evaluateAccountRules(context) };
}

/** Pure pass/fail evaluation, delegating all rule semantics to Performance Arena. */
export function evaluateChallenge(input: SettlementInput): SettlementVerdict {
    if (challengeFeatureState() === "BLOCKED") {
        return { action: "blocked", reasonCode: "CHALLENGES_DISABLED", reason: "Challenge evaluation is disabled." };
    }
    return evaluateSettlement(input);
}

export interface ChallengeAnalytics {
    profitability: { score: number | null; explanation: string };
    riskManagement: { score: number | null; explanation: string };
    consistency: { score: number | null; explanation: string };
    drawdownControl: { score: number | null; explanation: string };
    executionQuality: { score: number | null; explanation: string };
}

/** Explainable analytics, based only on the provided server-computed evidence. */
export function buildChallengeAnalytics(input: {
    returnPct: number | null;
    riskBreaches: number | null;
    totalTrades: number | null;
    winningTrades: number | null;
    drawdownPct: number | null;
    maxDrawdownPct: number | null;
    executionFailures: number | null;
}): ChallengeAnalytics {
    const ratio = (numerator: number, denominator: number) => denominator > 0 ? Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100))) : null;
    const capped = (value: number | null) => value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, Math.round(value)));
    const wins = input.winningTrades;
    const trades = input.totalTrades;
    const riskScore = input.riskBreaches === null ? null : capped(100 - input.riskBreaches * 15);
    const drawdownScore = input.drawdownPct === null || input.maxDrawdownPct === null || input.maxDrawdownPct <= 0
        ? null
        : capped(100 - (input.drawdownPct / input.maxDrawdownPct) * 100);
    const winRate = wins === null || trades === null || trades <= 0 ? null : ratio(wins, trades);
    const executionScore = input.executionFailures === null || trades === null || trades <= 0
        ? null
        : capped(100 - (input.executionFailures / trades) * 100);
    return {
        profitability: { score: capped(input.returnPct === null ? null : 50 + input.returnPct * 2), explanation: input.returnPct === null ? "Return data is unavailable." : `Based on server-recorded return of ${input.returnPct}%.` },
        riskManagement: { score: riskScore, explanation: input.riskBreaches === null ? "Risk rule history is unavailable." : `${input.riskBreaches} recorded risk breach(es) inform this score.` },
        consistency: { score: winRate, explanation: winRate === null ? "A trade sample is unavailable." : `${wins} of ${trades} trades were profitable.` },
        drawdownControl: { score: drawdownScore, explanation: drawdownScore === null ? "Drawdown evidence is unavailable." : `Observed ${input.drawdownPct}% drawdown against ${input.maxDrawdownPct}% allowed.` },
        executionQuality: { score: executionScore, explanation: executionScore === null ? "Execution outcome evidence is unavailable." : `${input.executionFailures} execution failure(s) across ${trades} trades.` },
    };
}

export interface TradingAuditSink {
    append(event: TradingEvent): Promise<void>;
}

/** Optional extension of the existing RTDB admin store; no new path is assumed. */
export interface TradingAuditRepository extends TradingAuditSink {
    getAccount(userId: string, accountId: string): Promise<ChallengeAccount | null>;
    getTemplate(templateId: string): Promise<ChallengeTemplate | null>;
    evaluate(userId: string, accountId: string): Promise<ChallengeEvaluation | null>;
}

export function drawdownForChallenge(peakEquity: number | null, equity: number | null) {
    return peakEquity === null || equity === null ? null : calculateDrawdown(peakEquity, equity);
}
