import { AISignal, SignalAnalytics, SignalDirection, SignalResult } from "./types";
import { adminDatabase } from "@/lib/firebase-admin";
import { calculateSignalResult, targetR } from "./results";

export interface MarketSentiment {
    symbol: string;
    direction: SignalDirection | "NEUTRAL";
    confidence: number;
    signalCount: number;
    lastSignalAt: number;
}

const ACTIVE_SIGNAL_STATUSES = [
    "READY",
    "WATCH",
    "PENDING_ENTRY",
    "ENTRY_TRIGGERED",
    "ACTIVE",
    "TP1_HIT",
    "TP2_HIT",
    "TP3_HIT",
    "RUNNER",
];

const TP1_HIT_STATUSES = ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"];
const TP2_HIT_STATUSES = ["TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"];
const TP3_HIT_STATUSES = ["TP3_HIT", "RUNNER", "COMPLETED"];

function resolveOutcome(signal: AISignal): { result: SignalResult; resultR: number } {
    if (signal.result && signal.result !== "PENDING") {
        return { result: signal.result, resultR: Number(signal.resultR || 0) };
    }

    return calculateSignalResult(signal);
}

function getRiskReward(signal: AISignal): number {
    const plannedRR = Number(signal.riskReward);
    if (Number.isFinite(plannedRR) && plannedRR > 0) return plannedRR;

    return targetR(signal.entry, signal.stopLoss, signal.tp1);
}

function hasTp1Hit(signal: AISignal): boolean {
    return signal.tp1Hit === true || TP1_HIT_STATUSES.includes(signal.status);
}

function hasTp2Hit(signal: AISignal): boolean {
    return signal.tp2Hit === true || TP2_HIT_STATUSES.includes(signal.status);
}

function hasTp3Hit(signal: AISignal): boolean {
    return signal.tp3Hit === true || TP3_HIT_STATUSES.includes(signal.status);
}

function hasSlHit(signal: AISignal): boolean {
    return Number(signal.stopLossReachedAt) > 0 || signal.status === "STOPPED" || signal.result === "LOSS";
}

export async function calculateSignalAnalytics(): Promise<SignalAnalytics> {
    const snap = await adminDatabase.ref("aiSignals").get();

    const signals: AISignal[] = [];
    snap.forEach((child) => {
        const signal = child.val() as AISignal;
        if (signal && signal.id) signals.push(signal);
    });

    return calculateSignalAnalyticsFromSignals(signals);
}

export function calculateSignalAnalyticsFromSignals(signals: AISignal[]): SignalAnalytics {
    const bySymbolGroups = new Map<string, AISignal[]>();
    for (const signal of signals) {
        const symbol = (signal.symbol || "UNKNOWN").toUpperCase();
        if (!bySymbolGroups.has(symbol)) bySymbolGroups.set(symbol, []);
        bySymbolGroups.get(symbol)!.push(signal);
    }

    const sentiments: MarketSentiment[] = [];
    for (const [symbol, group] of bySymbolGroups) {
        const residue = group.filter((signal) =>
            ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED", "STOPPED"].includes(signal.status)
        );

        const confidences = group.map((signal) => Number(signal.confidence) || 0);
        const confidence =
            confidences.length > 0
                ? Math.round(
                      (confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 10
                  ) / 10
                : 0;

        let direction: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
        const buyConfidence = group
            .filter((signal) => signal.direction === "BUY")
            .reduce((sum, signal) => sum + (Number(signal.confidence) || 0), 0);
        const sellConfidence = group
            .filter((signal) => signal.direction === "SELL")
            .reduce((sum, signal) => sum + (Number(signal.confidence) || 0), 0);
        if (buyConfidence + sellConfidence > 0) {
            direction = buyConfidence >= sellConfidence ? "BUY" : "SELL";
            if (Math.abs(buyConfidence - sellConfidence) / Math.max(buyConfidence + sellConfidence, 1) < 0.15) {
                direction = "NEUTRAL";
            }
        }

        sentiments.push({
            symbol,
            direction,
            confidence,
            signalCount: group.length,
            lastSignalAt: residue.length > 0
                ? Math.max(...residue.map((signal) => signal.updatedAt || signal.createdAt))
                : Math.max(...group.map((signal) => signal.updatedAt || signal.createdAt)),
        });
    }

    sentiments.sort((a, b) => b.signalCount - a.signalCount);

    const outcomes = signals.map((signal) => resolveOutcome(signal));
    const totalSignals = signals.length;
    const activeSignals = signals.filter((signal) => ACTIVE_SIGNAL_STATUSES.includes(signal.status)).length;
    const winningSignals = outcomes.filter((outcome) => outcome.result === "WIN").length;
    const losingSignals = outcomes.filter((outcome) => outcome.result === "LOSS").length;
    const breakevenSignals = outcomes.filter((outcome) => outcome.result === "BREAKEVEN").length;
    const expiredSignals = outcomes.filter((outcome) => outcome.result === "EXPIRED").length;
    const cancelledSignals = outcomes.filter((outcome) => outcome.result === "CANCELLED").length;
    const winRate = winningSignals + losingSignals > 0
        ? (winningSignals / (winningSignals + losingSignals)) * 100
        : 0;

    const rrs = signals.map(getRiskReward).filter((value) => Number.isFinite(value) && value > 0);
    const averageRR = rrs.length > 0 ? rrs.reduce((sum, value) => sum + value, 0) / rrs.length : 0;

    const confidences = signals
        .map((signal) => Number(signal.confidence))
        .filter((value) => Number.isFinite(value) && value > 0);
    const averageConfidence = confidences.length > 0
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : 0;

    const tp1Hits = signals.filter(hasTp1Hit).length;
    const tp2Hits = signals.filter(hasTp2Hit).length;
    const tp3Hits = signals.filter(hasTp3Hit).length;
    const slHits = signals.filter(hasSlHit).length;

    const tp1HitRate = totalSignals > 0 ? (tp1Hits / totalSignals) * 100 : 0;
    const tp2HitRate = totalSignals > 0 ? (tp2Hits / totalSignals) * 100 : 0;
    const tp3HitRate = totalSignals > 0 ? (tp3Hits / totalSignals) * 100 : 0;
    const slRate = totalSignals > 0 ? (slHits / totalSignals) * 100 : 0;

    return {
        totalSignals,
        activeSignals,
        winningSignals,
        losingSignals,
        breakevenSignals,
        expiredSignals,
        cancelledSignals,
        winRate: Math.round(winRate * 10) / 10,
        averageRR: Math.round(averageRR * 100) / 100,
        averageConfidence: Math.round(averageConfidence * 10) / 10,
        tp1Hits,
        tp2Hits,
        tp3Hits,
        slHits,
        tp1HitRate: Math.round(tp1HitRate * 10) / 10,
        tp2HitRate: Math.round(tp2HitRate * 10) / 10,
        tp3HitRate: Math.round(tp3HitRate * 10) / 10,
        slRate: Math.round(slRate * 10) / 10,
        bySymbol: calculateGroupStats(signals),
        byTimeframe: calculateGroupStats(signals, "timeframe"),
        bySession: calculateSessionStats(signals),
        byRegime: calculateGroupStats(signals, "marketRegime"),
        sentiments,
        generatedAt: Date.now(),
    };
}

function calculateGroupStats(
    signals: AISignal[],
    field?: keyof AISignal
): Record<string, { count: number; winRate: number; avgRR: number }> {
    const groups: Record<string, AISignal[]> = {};
    for (const signal of signals) {
        const key = field ? String(signal[field] || "unknown") : (signal.symbol || "UNKNOWN").toUpperCase();
        if (!groups[key]) groups[key] = [];
        groups[key].push(signal);
    }

    const result: Record<string, { count: number; winRate: number; avgRR: number }> = {};
    for (const [key, group] of Object.entries(groups)) {
        const outcomes = group.map((signal) => resolveOutcome(signal));
        const wins = outcomes.filter((outcome) => outcome.result === "WIN").length;
        const losses = outcomes.filter((outcome) => outcome.result === "LOSS").length;
        const rrs = group.map(getRiskReward).filter((value) => Number.isFinite(value) && value > 0);

        result[key] = {
            count: group.length,
            winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
            avgRR: rrs.length > 0 ? Math.round((rrs.reduce((sum, value) => sum + value, 0) / rrs.length) * 100) / 100 : 0,
        };
    }

    return result;
}

function calculateSessionStats(
    signals: AISignal[]
): Record<string, { count: number; winRate: number; avgRR: number }> {
    const groups: Record<string, AISignal[]> = {};
    for (const signal of signals) {
        const hour = new Date(signal.createdAt).getUTCHours();
        let session = "unknown";
        if (hour >= 0 && hour < 8) session = "asian";
        else if (hour >= 7 && hour < 16) session = "london";
        else if (hour >= 12 && hour < 21) session = "new_york";
        else session = "off_hours";

        if (!groups[session]) groups[session] = [];
        groups[session].push(signal);
    }

    const result: Record<string, { count: number; winRate: number; avgRR: number }> = {};
    for (const [key, group] of Object.entries(groups)) {
        const outcomes = group.map((signal) => resolveOutcome(signal));
        const wins = outcomes.filter((outcome) => outcome.result === "WIN").length;
        const losses = outcomes.filter((outcome) => outcome.result === "LOSS").length;
        const rrs = group.map(getRiskReward).filter((value) => Number.isFinite(value) && value > 0);

        result[key] = {
            count: group.length,
            winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
            avgRR: rrs.length > 0 ? Math.round((rrs.reduce((sum, value) => sum + value, 0) / rrs.length) * 100) / 100 : 0,
        };
    }

    return result;
}

export async function trackDailySignals(uid?: string): Promise<{ date: string; free: number; total: number }> {
    const today = new Date().toISOString().split("T")[0];
    const startOfDay = new Date(`${today}T00:00:00Z`).getTime();
    const endOfDay = new Date(`${today}T23:59:59.999Z`).getTime();

    const snap = await adminDatabase.ref("aiSignals").get();

    let count = 0;
    if (snap.exists()) {
        snap.forEach((child) => {
            const signal = child.val() as AISignal;
            if (!signal || Number(signal.createdAt) < startOfDay || Number(signal.createdAt) > endOfDay) return;
            if (uid && signal.createdFor && signal.createdFor !== uid) return;
            if (uid && !signal.createdFor) return;
            count++;
        });
    }

    return { date: today, free: count, total: count };
}
