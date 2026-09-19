import { AISignal, SignalAnalytics, SignalDirection } from "./types";
import { adminDatabase } from "@/lib/firebase-admin";

export interface MarketSentiment {
    symbol: string;
    direction: SignalDirection | "NEUTRAL";
    confidence: number;
    signalCount: number;
    lastSignalAt: number;
}

export async function calculateSignalAnalytics(): Promise<SignalAnalytics> {
    const snap = await adminDatabase.ref("aiSignals").get();

    const signals: AISignal[] = [];
    snap.forEach((child) => {
        signals.push(child.val() as AISignal);
    });

    const bySymbolGroups = new Map<string, AISignal[]>();
    for (const s of signals) {
        const sym = (s.symbol || "UNKNOWN").toUpperCase();
        if (!bySymbolGroups.has(sym)) bySymbolGroups.set(sym, []);
        bySymbolGroups.get(sym)!.push(s);
    }

    const sentiments: MarketSentiment[] = [];
    for (const [symbol, group] of bySymbolGroups) {
        const residue = group.filter((s) =>
            ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED", "STOPPED"].includes(s.status)
        );

        const confidences = group.map((s) => s.confidence || 0);
        const confidence =
            confidences.length > 0
                ? Math.round(
                      (confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10
                  ) / 10
                : 0;

        let direction: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
        const buyConfidence = group
            .filter((s) => s.direction === "BUY")
            .reduce((a, c) => a + (c.confidence || 0), 0);
        const sellConfidence = group
            .filter((s) => s.direction === "SELL")
            .reduce((a, c) => a + (c.confidence || 0), 0);
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
                ? Math.max(...residue.filter((s) => s.createdAt || s.updatedAt).map((s) => s.updatedAt || s.createdAt))
                : Math.max(...group.map((s) => s.updatedAt || s.createdAt)),
        });
    }

    sentiments.sort((a, b) => b.signalCount - a.signalCount);

    const totalSignals = signals.length;
    const activeSignals = signals.filter((s) => ["READY", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER"].includes(s.status)).length;
    const winningSignals = signals.filter((s) => ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status)).length;
    const losingSignals = signals.filter((s) => s.status === "STOPPED").length;
    const expiredSignals = signals.filter((s) => s.status === "EXPIRED").length;
    const cancelledSignals = signals.filter((s) => s.status === "CANCELLED").length;

    const completedSignals = signals.filter((s) => ["STOPPED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status));
    const winRate = completedSignals.length > 0 ? (winningSignals / completedSignals.length) * 100 : 0;

    const rrs = completedSignals.filter((s) => s.riskReward > 0).map((s) => s.riskReward);
    const averageRR = rrs.length > 0 ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0;

    const confidences = signals.filter((s) => s.confidence > 0).map((s) => s.confidence);
    const averageConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    const tp1Hit = signals.filter((s) => ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status)).length;
    const tp2Hit = signals.filter((s) => ["TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status)).length;
    const tp3Hit = signals.filter((s) => ["TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status)).length;

    const tp1HitRate = totalSignals > 0 ? (tp1Hit / totalSignals) * 100 : 0;
    const tp2HitRate = totalSignals > 0 ? (tp2Hit / totalSignals) * 100 : 0;
    const tp3HitRate = totalSignals > 0 ? (tp3Hit / totalSignals) * 100 : 0;
    const slRate = totalSignals > 0 ? (losingSignals / totalSignals) * 100 : 0;

    const bySymbol = calculateGroupStats(signals, "symbol");
    const byTimeframe = calculateGroupStats(signals, "timeframe");
    const bySession = calculateSessionStats(signals);
    const byRegime = calculateGroupStats(signals, "marketRegime");

    return {
        totalSignals,
        activeSignals,
        winningSignals,
        losingSignals,
        expiredSignals,
        cancelledSignals,
        winRate: Math.round(winRate * 10) / 10,
        averageRR: Math.round(averageRR * 100) / 100,
        averageConfidence: Math.round(averageConfidence * 10) / 10,
        tp1HitRate: Math.round(tp1HitRate * 10) / 10,
        tp2HitRate: Math.round(tp2HitRate * 10) / 10,
        tp3HitRate: Math.round(tp3HitRate * 10) / 10,
        slRate: Math.round(slRate * 10) / 10,
        bySymbol,
        byTimeframe,
        bySession,
        byRegime,
        generatedAt: Date.now(),
    };
}

function calculateGroupStats(
    signals: AISignal[],
    field: keyof AISignal
): Record<string, { count: number; winRate: number; avgRR: number }> {
    const groups: Record<string, AISignal[]> = {};
    for (const s of signals) {
        const key = String(s[field] || "unknown");
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
    }

    const result: Record<string, { count: number; winRate: number; avgRR: number }> = {};
    for (const [key, group] of Object.entries(groups)) {
        const completed = group.filter((s) => ["STOPPED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status));
        const wins = group.filter((s) => ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status));
        const rrs = completed.filter((s) => s.riskReward > 0).map((s) => s.riskReward);

        result[key] = {
            count: group.length,
            winRate: completed.length > 0 ? Math.round((wins.length / completed.length) * 1000) / 10 : 0,
            avgRR: rrs.length > 0 ? Math.round((rrs.reduce((a, b) => a + b, 0) / rrs.length) * 100) / 100 : 0,
        };
    }

    return result;
}

function calculateSessionStats(
    signals: AISignal[]
): Record<string, { count: number; winRate: number; avgRR: number }> {
    const groups: Record<string, AISignal[]> = {};
    for (const s of signals) {
        const hour = new Date(s.createdAt).getUTCHours();
        let session = "unknown";
        if (hour >= 0 && hour < 8) session = "asian";
        else if (hour >= 7 && hour < 16) session = "london";
        else if (hour >= 12 && hour < 21) session = "new_york";
        else session = "off_hours";

        if (!groups[session]) groups[session] = [];
        groups[session].push(s);
    }

    const result: Record<string, { count: number; winRate: number; avgRR: number }> = {};
    for (const [key, group] of Object.entries(groups)) {
        const completed = group.filter((s) => ["STOPPED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status));
        const wins = group.filter((s) => ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(s.status));
        const rrs = completed.filter((s) => s.riskReward > 0).map((s) => s.riskReward);

        result[key] = {
            count: group.length,
            winRate: completed.length > 0 ? Math.round((wins.length / completed.length) * 1000) / 10 : 0,
            avgRR: rrs.length > 0 ? Math.round((rrs.reduce((a, b) => a + b, 0) / rrs.length) * 100) / 100 : 0,
        };
    }

    return result;
}

export async function trackDailySignals(): Promise<{ date: string; free: number; total: number }> {
    const today = new Date().toISOString().split("T")[0];
    const startOfDay = new Date(`${today}T00:00:00Z`).getTime();
    const endOfDay = new Date(`${today}T23:59:59Z`).getTime();

    const snap = await adminDatabase.ref("aiSignals").get();

    let count = 0;
    if (snap.exists()) {
        snap.forEach((child) => {
            const signal = child.val() as AISignal;
            if (signal.createdAt >= startOfDay && signal.createdAt <= endOfDay) {
                count++;
            }
        });
    }

    return { date: today, free: count, total: count };
}
