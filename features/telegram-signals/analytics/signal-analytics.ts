/**
 * AlgoVault Pro Signal Intelligence - Analytics Engine
 * Provides data-driven factual performance metrics segmented by timeframe, symbol, and session.
 * Does NOT generate subjective rankings or claim sources are "best".
 */

import { MIN_ANALYTICS_SAMPLE_SIZE } from "../config";
import type { SignalAnalyticsSegment, SignalStyle, SignalTimeframe } from "../types";

type RecordValue = Record<string, unknown>;

export interface AnalyticsTakeProfit {
    index: number;
    type: string;
    price: number | null;
    hit?: boolean;
    hitAt?: number;
    excursionPips?: number;
}

export interface AnalyticsSignal {
    id: string;
    sourceMetadata: {
        sourceId: string;
        channelId?: string;
    };
    receivedAt: number;
    createdAt: number;
    lastUpdateAt: number;
    status: string;
    takeProfits: AnalyticsTakeProfit[];
    symbol: string;
    style: string;
    timeframe: string;
    entryMin: number;
    stopLoss: number;
}

function isRecord(value: unknown): value is RecordValue {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function textValue(value: unknown): string | null {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
}

function identifierVariants(value: unknown): Set<string> {
    const raw = textValue(value);
    const variants = new Set<string>();
    if (!raw) return variants;

    const withoutAt = raw.startsWith("@") ? raw.slice(1) : raw;
    const withoutSourcePrefix = withoutAt.replace(/^src_*/i, "");
    const withoutLeadingDash = withoutSourcePrefix.replace(/^-/, "");
    const telegramIdWithoutPrefix = withoutLeadingDash.startsWith("100") && withoutLeadingDash.length > 3
        ? withoutLeadingDash.slice(3)
        : null;

    variants.add(raw);
    variants.add(withoutAt);
    variants.add(withoutSourcePrefix);
    variants.add(withoutLeadingDash);
    if (telegramIdWithoutPrefix) variants.add(telegramIdWithoutPrefix);
    return variants;
}

function normalizeTakeProfits(value: unknown): AnalyticsTakeProfit[] {
    const targets = Array.isArray(value)
        ? value
        : isRecord(value)
            ? Object.values(value)
            : [];

    return targets.flatMap((target, index) => {
        if (typeof target === "number") {
            return [{ index: index + 1, type: "PRICE", price: target }];
        }
        if (!isRecord(target)) return [];

        const price = finiteNumber(target.price);
        const rawType = textValue(target.type)?.toUpperCase();
        const type = rawType === "OPEN" ? "OPEN" : "PRICE";
        const rawIndex = finiteNumber(target.index);
        const hit = target.hit === true || target.hit === "true";
        const hitAt = finiteNumber(target.hitAt);
        const excursionPips = finiteNumber(target.excursionPips);

        return [{
            index: rawIndex !== null ? Math.max(1, Math.round(rawIndex)) : index + 1,
            type,
            price: type === "OPEN" ? null : price,
            ...(hit ? { hit: true } : {}),
            ...(hitAt !== null ? { hitAt } : {}),
            ...(excursionPips !== null ? { excursionPips } : {}),
        }];
    });
}

export function normalizeSignalForAnalytics(value: unknown, fallbackId?: string): AnalyticsSignal | null {
    if (!isRecord(value)) return null;

    const metadataValue = isRecord(value.sourceMetadata) ? value.sourceMetadata : value;
    const sourceId = textValue(metadataValue.sourceId) || textValue(value.sourceId);
    const channelId = textValue(metadataValue.channelId) || textValue(value.channelId);
    if (!sourceId && !channelId) return null;

    const latency = isRecord(value.latency) ? value.latency : {};
    const receivedAt = finiteNumber(value.receivedAt)
        ?? finiteNumber(latency.receivedAt)
        ?? finiteNumber(value.timestamp)
        ?? finiteNumber(value.createdAt);
    if (receivedAt === null) return null;

    const createdAt = finiteNumber(value.createdAt) ?? receivedAt;
    const events = Array.isArray(value.events) ? value.events : [];
    const latestEventAt = events.reduce((latest, event) => {
        const timestamp = isRecord(event) ? finiteNumber(event.timestamp) : null;
        return timestamp === null ? latest : Math.max(latest, timestamp);
    }, 0);
    const lastUpdateAt = finiteNumber(value.lastUpdateAt)
        ?? finiteNumber(value.updatedAt)
        ?? Math.max(createdAt, receivedAt, latestEventAt);
    const status = (textValue(value.status)?.toUpperCase() || "CREATED") as string;
    const normalizedSourceId = sourceId || channelId || fallbackId || "unknown";
    const id = textValue(value.id)
        || textValue(value.fingerprint)
        || fallbackId
        || `${normalizedSourceId}:${receivedAt}`;

    return {
        id,
        sourceMetadata: {
            sourceId: normalizedSourceId,
            ...(channelId ? { channelId } : {}),
        },
        receivedAt,
        createdAt,
        lastUpdateAt,
        status,
        takeProfits: normalizeTakeProfits(value.takeProfits),
        symbol: (textValue(value.symbol) || "UNKNOWN").toUpperCase(),
        style: (textValue(value.style) || "UNKNOWN").toUpperCase(),
        timeframe: (textValue(value.timeframe) || "UNKNOWN").toUpperCase(),
        entryMin: finiteNumber(value.entryMin) ?? finiteNumber(value.entry) ?? 0,
        stopLoss: finiteNumber(value.stopLoss) ?? 0,
    };
}

export function collectSignals(signalsRoot: unknown): AnalyticsSignal[] {
    const signalsById = new Map<string, AnalyticsSignal>();

    if (!isRecord(signalsRoot)) return [];

    for (const [shardKey, shardValue] of Object.entries(signalsRoot)) {
        if (!isRecord(shardValue)) continue;

        const entries = isRecord(shardValue.sourceMetadata)
            || shardValue.receivedAt !== undefined
            || shardValue.createdAt !== undefined
            || shardValue.status !== undefined
            ? [[shardKey, shardValue] as const]
            : Object.entries(shardValue);

        for (const [signalKey, signalValue] of entries) {
            const signal = normalizeSignalForAnalytics(signalValue, signalKey);
            if (!signal) continue;

            const current = signalsById.get(signal.id);
            if (!current || signal.lastUpdateAt > current.lastUpdateAt || signal.receivedAt > current.receivedAt) {
                signalsById.set(signal.id, signal);
            }
        }
    }

    return Array.from(signalsById.values());
}

function hasIntersection(left: Set<string>, right: Set<string>): boolean {
    for (const value of left) {
        if (right.has(value)) return true;
    }
    return false;
}

export function sourceMatchesSignal(
    signal: AnalyticsSignal,
    sourceId: string,
    sourceKey: string,
    channelId?: string
): boolean {
    const sourceAliases = new Set<string>();
    [sourceId, sourceKey, channelId].forEach((value) => {
        identifierVariants(value).forEach((alias) => sourceAliases.add(alias));
    });

    return hasIntersection(
        identifierVariants(signal.sourceMetadata.sourceId),
        sourceAliases
    ) || hasIntersection(
        identifierVariants(signal.sourceMetadata.channelId),
        sourceAliases
    );
}

export interface AnalyticsFilter {
    sourceId?: string;
    groupId?: string;
    style?: string;
    timeframe?: string;
    symbol?: string;
}

export function computeSignalAnalytics(
    signals: AnalyticsSignal[],
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
        style: filter?.style as SignalStyle,
        timeframe: filter?.timeframe as SignalTimeframe,
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
