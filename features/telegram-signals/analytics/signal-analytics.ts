/**
 * AlgoVault Pro Signal Intelligence - Analytics Engine
 * Provides data-driven factual performance metrics segmented by timeframe, symbol, and session.
 * Does NOT generate subjective rankings or claim sources are "best".
 */

import { MIN_ANALYTICS_SAMPLE_SIZE } from "../config";
import type { ProSignal, SignalAnalyticsSegment } from "../types";

export interface AnalyticsFilter {
    sourceId?: string;
    groupId?: string;
    style?: string;
    timeframe?: string;
    symbol?: string;
}

export function computeSignalAnalytics(
    signals: ProSignal[],
    filter?: AnalyticsFilter
): SignalAnalyticsSegment {
    let filtered = signals;

    if (filter) {
        if (filter.sourceId) filtered = filtered.filter((s) => s.sourceMetadata.sourceId === filter.sourceId);
        if (filter.style) filtered = filtered.filter((s) => s.style === filter.style);
        if (filter.timeframe) filtered = filtered.filter((s) => s.timeframe === filter.timeframe);
        if (filter.symbol) filtered = filtered.filter((s) => s.symbol.toUpperCase() === filter.symbol!.toUpperCase());
    }

    const totalSignals = filtered.length;
    if (totalSignals === 0) {
        return {
            totalSignals: 0,
            wins: 0,
            losses: 0,
            expired: 0,
            cancelled: 0,
            winRate: 0,
            tp1HitRate: 0,
            tp2HitRate: 0,
            tp3HitRate: 0,
            tp4HitRate: 0,
            tp5RunnerRate: 0,
            avgDurationMinutes: 0,
            avgRiskReward: 0,
            sampleSize: 0,
            lowSampleSizeWarning: true,
        };
    }

    let wins = 0;
    let losses = 0;
    let expired = 0;
    let cancelled = 0;
    let tp1Hits = 0;
    let tp2Hits = 0;
    let tp3Hits = 0;
    let tp4Hits = 0;
    let tp5Hits = 0;
    let totalDurationMs = 0;
    let closedCount = 0;
    let totalRRSum = 0;
    let rrCount = 0;

    for (const signal of filtered) {
        if (signal.status === "EXPIRED") expired++;
        if (signal.status === "CANCELLED") cancelled++;
        if (signal.status === "STOPPED") losses++;

        const hasTpHit = signal.takeProfits.some((t) => t.hit);
        if (hasTpHit || ["TP1_HIT", "TP2_HIT", "TP3_HIT", "TP4_HIT", "TP5_OPEN_RUNNER", "CLOSED"].includes(signal.status)) {
            wins++;
        }

        if (signal.takeProfits.find((t) => t.index === 1)?.hit) tp1Hits++;
        if (signal.takeProfits.find((t) => t.index === 2)?.hit) tp2Hits++;
        if (signal.takeProfits.find((t) => t.index === 3)?.hit) tp3Hits++;
        if (signal.takeProfits.find((t) => t.index === 4)?.hit) tp4Hits++;
        if (signal.takeProfits.find((t) => t.index === 5 || t.type === "OPEN")?.hit) tp5Hits++;

        if (["CLOSED", "STOPPED"].includes(signal.status)) {
            closedCount++;
            totalDurationMs += Math.max(0, signal.lastUpdateAt - signal.createdAt);
        }

        // Calculate R:R
        const tp1Price = signal.takeProfits.find((t) => t.type === "PRICE")?.price;
        if (tp1Price && signal.stopLoss > 0 && signal.entryMin > 0) {
            const reward = Math.abs(tp1Price - signal.entryMin);
            const risk = Math.abs(signal.entryMin - signal.stopLoss);
            if (risk > 0) {
                totalRRSum += reward / risk;
                rrCount++;
            }
        }
    }

    const completedTrades = wins + losses;
    const winRate = completedTrades > 0 ? Number(((wins / completedTrades) * 100).toFixed(1)) : 0;
    const tp1HitRate = totalSignals > 0 ? Number(((tp1Hits / totalSignals) * 100).toFixed(1)) : 0;
    const tp2HitRate = totalSignals > 0 ? Number(((tp2Hits / totalSignals) * 100).toFixed(1)) : 0;
    const tp3HitRate = totalSignals > 0 ? Number(((tp3Hits / totalSignals) * 100).toFixed(1)) : 0;
    const tp4HitRate = totalSignals > 0 ? Number(((tp4Hits / totalSignals) * 100).toFixed(1)) : 0;
    const tp5RunnerRate = totalSignals > 0 ? Number(((tp5Hits / totalSignals) * 100).toFixed(1)) : 0;
    const avgDurationMinutes = closedCount > 0 ? Math.round(totalDurationMs / closedCount / (1000 * 60)) : 0;
    const avgRiskReward = rrCount > 0 ? Number((totalRRSum / rrCount).toFixed(2)) : 0;

    return {
        sourceId: filter?.sourceId,
        groupId: filter?.groupId,
        style: filter?.style as any,
        timeframe: filter?.timeframe as any,
        symbol: filter?.symbol,
        totalSignals,
        wins,
        losses,
        expired,
        cancelled,
        winRate,
        tp1HitRate,
        tp2HitRate,
        tp3HitRate,
        tp4HitRate,
        tp5RunnerRate,
        avgDurationMinutes,
        avgRiskReward,
        sampleSize: totalSignals,
        lowSampleSizeWarning: totalSignals < MIN_ANALYTICS_SAMPLE_SIZE,
    };
}
