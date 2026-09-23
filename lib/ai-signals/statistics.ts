import { AISignal, SignalStats, SignalTier, SignalResult } from "./types";
import { adminDatabase } from "@/lib/firebase-admin";
import { calculateSignalResult } from "./results";
import { calculateProfitUSD } from "./calculations";

/**
 * Signal statistics engine — derived data, calculated only from the
 * immutable signal history stored under `aiSignals/`. Aggregations can be
 * cached under `signalStats/` and rebuilt at any time from source data.
 */

export type StatsFilter = {
    period?: "today" | "week" | "month" | "last7" | "last30" | "last90" | "all";
    tier?: SignalTier | "all";
    symbol?: string;
    timeframe?: string;
    direction?: "BUY" | "SELL";
    entitlement?: "all" | "free";
};

const PERIOD_RANGES: Record<NonNullable<StatsFilter["period"]>, (now: number) => number> = {
    today: (now) => {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    },
    week: (now) => {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        const day = d.getDay();
        const diff = day === 0 ? 6 : day - 1;
        d.setDate(d.getDate() - diff);
        return d.getTime();
    },
    month: (now) => {
        const d = new Date(now);
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    },
    last7: (now) => now - 7 * 86400000,
    last30: (now) => now - 30 * 86400000,
    last90: (now) => now - 90 * 86400000,
    all: () => 0,
};

export function matchesFilter(signal: AISignal, filter: StatsFilter, now: number): boolean {
    if (filter.period && filter.period !== "all") {
        const start = PERIOD_RANGES[filter.period](now);
        const created = Number(signal.createdAt || 0);
        const completed = Number(signal.completedAt || signal.createdAt || 0);
        const refTime = Math.max(created, completed);
        if (refTime < start) return false;
    }

    if (filter.tier && filter.tier !== "all") {
        if (signal.tier !== filter.tier) return false;
    }

    if (filter.entitlement === "free" && signal.tier === "PRO") {
        return false;
    }

    if (filter.symbol) {
        if (signal.symbol !== filter.symbol) return false;
    }

    if (filter.timeframe) {
        if (signal.timeframe !== filter.timeframe) return false;
    }

    if (filter.direction) {
        if (signal.direction !== filter.direction) return false;
    }

    return true;
}

export interface StreakInfo {
    maxWinningStreak: number;
    maxLosingStreak: number;
    currentStreak: number;
}

export function calculateStreaks(results: SignalResult[]): StreakInfo {
    let maxWin = 0;
    let maxLoss = 0;
    let curWin = 0;
    let curLoss = 0;
    let currentStreak = 0;

    const chronological = [...results].reverse();

    for (const r of chronological) {
        if (r === "WIN") {
            curWin++;
            curLoss = 0;
            maxWin = Math.max(maxWin, curWin);
        } else if (r === "LOSS") {
            curLoss++;
            curWin = 0;
            maxLoss = Math.max(maxLoss, curLoss);
        } else {
            curWin = 0;
            curLoss = 0;
        }
    }

    for (const r of results) {
        if (r === "WIN") {
            if (currentStreak >= 0) currentStreak++;
            else currentStreak = 1;
        } else if (r === "LOSS") {
            if (currentStreak <= 0) currentStreak--;
            else currentStreak = -1;
        } else {
            break;
        }
    }

    return { maxWinningStreak: maxWin, maxLosingStreak: maxLoss, currentStreak };
}




export function calculateStats(signals: AISignal[], filter: StatsFilter = {}): SignalStats {
    const now = Date.now();
    const filtered = signals.filter((s) => matchesFilter(s, filter, now));

    const totalSignals = filtered.length;

    // Resolve terminal results deterministically.
    const resolved: { signal: AISignal; result: SignalResult; resultR: number }[] = [];

    for (const s of filtered) {
        const outcome = s.result && s.result !== "PENDING"
            ? { result: s.result, resultR: Number(s.resultR || 0) }
            : calculateSignalResult(s);
        resolved.push({ signal: s, result: outcome.result, resultR: outcome.resultR });
    }

    const completed = resolved.filter((r) => r.result === "WIN" || r.result === "LOSS" || r.result === "BREAKEVEN");
    const winning = resolved.filter((r) => r.result === "WIN");
    const losing = resolved.filter((r) => r.result === "LOSS");
    const breakeven = resolved.filter((r) => r.result === "BREAKEVEN");
    const expired = resolved.filter((r) => r.result === "EXPIRED");

    const winRate = completed.length > 0 ? (winning.length / completed.length) * 100 : 0;

    const runds = resolved.filter((r) => r.result === "WIN" || r.result === "LOSS").map((r) => r.resultR);
    const totalR = runds.reduce((a, b) => a + b, 0);
    const averageR = runds.length > 0 ? totalR / runds.length : 0;


    // Exact USD calculations (0.01 lot baseline)
    let grossProfitUSD = 0;
    let grossLossUSD = 0;

    for (const r of winning) {
        const s = r.signal;
        const target = (s.tp3Hit || ["TP3_HIT","RUNNER","COMPLETED"].includes(s.status)) && s.tp3
            ? s.tp3
            : (s.tp2Hit || ["TP2_HIT"].includes(s.status)) && s.tp2
            ? s.tp2
            : s.tp1 || s.entry;
        const p = calculateProfitUSD(s.symbol, s.direction, s.entry, target, 0.01);
        grossProfitUSD += Math.max(0, p);
    }

    for (const r of losing) {
        const s = r.signal;
        const p = calculateProfitUSD(s.symbol, s.direction, s.entry, s.stopLoss, 0.01);
        grossLossUSD += Math.abs(Math.min(0, p));
    }

    const totalProfitUSD = Math.round((grossProfitUSD - grossLossUSD) * 100) / 100;
    const monetaryProfitFactor = grossLossUSD > 0 ? Math.round((grossProfitUSD / grossLossUSD) * 100) / 100 : grossProfitUSD > 0 ? null : 0;

    const grossProfit = winning.reduce((a, r) => a + Math.max(r.resultR, 0), 0);
    const grossLoss = Math.abs(losing.reduce((a, r) => a + Math.min(r.resultR, 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0;

    const winAmounts = winning.map((r) => r.resultR);
    const lossAmounts = losing.map((r) => Math.abs(r.resultR));

    const averageWin = winAmounts.length > 0 ? winAmounts.reduce((a, b) => a + b, 0) / winAmounts.length : 0;
    const averageLoss = lossAmounts.length > 0 ? lossAmounts.reduce((a, b) => a + b, 0) / lossAmounts.length : 0;
    const largestWin = winAmounts.length > 0 ? Math.max(...winAmounts) : 0;
    const largestLoss = lossAmounts.length > 0 ? Math.max(...lossAmounts) : 0;

    const affectedSignals = completed.filter((r) => r.result === "WIN" || r.result === "LOSS");
    const tp1Hits = completed.filter((r) => r.signal.tp1Hit || ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(r.signal.status)).length;
    const tp2Hits = completed.filter((r) => r.signal.tp2Hit || ["TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(r.signal.status)).length;
    const tp3Hits = completed.filter((r) => r.signal.tp3Hit || ["TP3_HIT", "RUNNER", "COMPLETED"].includes(r.signal.status)).length;

    const tp1HitRate = affectedSignals.length > 0 ? (tp1Hits / affectedSignals.length) * 100 : 0;
    const tp2HitRate = affectedSignals.length > 0 ? (tp2Hits / affectedSignals.length) * 100 : 0;
    const tp3HitRate = affectedSignals.length > 0 ? (tp3Hits / affectedSignals.length) * 100 : 0;

    const avgStrength = filtered.length > 0
        ? filtered.reduce((a, s) => a + Number(s.confidence || 0), 0) / filtered.length
        : 0;

    // Max drawdown (run-down of cumulative R over chronological completed results).
    let peak = 0;
    let running = 0;
    let maxDrawdown = 0;

    const chronologicalResults = [...completed].reverse();
    for (const r of chronologicalResults) {
        running += r.resultR;
        if (running > peak) peak = running;
        if (peak - running > maxDrawdown) maxDrawdown = peak - running;
    }

    const streaks = calculateStreaks(completed.map((r) => r.result));

    return {
        period: filter.period || "all",
        tier: filter.tier && filter.tier !== "all" ? filter.tier : undefined,
        symbol: filter.symbol,
        timeframe: filter.timeframe,
        totalSignals,
        winningSignals: winning.length,
        losingSignals: losing.length,
        breakevenSignals: breakeven.length,
        expiredSignals: expired.length,
        winRate: Math.round(winRate * 10) / 10,
        lossRate: Math.round((completed.length > 0 ? (losing.length / completed.length) * 100 : 0) * 10) / 10,
        averageR: Math.round(averageR * 100) / 100,
        totalR: Math.round(totalR * 100) / 100,
        profitFactor: profitFactor === null ? null : Math.round(profitFactor * 100) / 100,
        totalProfitUSD,
        grossProfitUSD: Math.round(grossProfitUSD * 100) / 100,
        grossLossUSD: Math.round(grossLossUSD * 100) / 100,
        monetaryProfitFactor,
        averageWin: Math.round(averageWin * 100) / 100,
        averageLoss: Math.round(averageLoss * 100) / 100,
        largestWin: Math.round(largestWin * 100) / 100,
        largestLoss: Math.round(largestLoss * 100) / 100,
        maxWinningStreak: streaks.maxWinningStreak,
        maxLosingStreak: streaks.maxLosingStreak,
        tp1HitRate: Math.round(tp1HitRate * 10) / 10,
        tp2HitRate: Math.round(tp2HitRate * 10) / 10,
        tp3HitRate: Math.round(tp3HitRate * 10) / 10,
        averageSignalStrength: Math.round(avgStrength * 10) / 10,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        calculatedAt: Date.now(),
    };
}

export async function getAllSignals(): Promise<AISignal[]> {
    const snap = await adminDatabase.ref("aiSignals").get();
    const signals: AISignal[] = [];
    if (snap.exists()) {
        snap.forEach((child) => {
            const s = child.val() as AISignal;
            if (s && s.id) signals.push(s);
        });
    }
    return signals;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getCachedStats(filter: StatsFilter = {}): Promise<SignalStats> {
    const cacheKey = [
        "signalStats",
        filter.period || "all",
        filter.tier || "all",
        filter.symbol || "all",
        filter.timeframe || "all",
        filter.direction || "all",
        filter.entitlement || "all",
    ].join("/");

    const path = `signalStats/cache/${cacheKey.replace(/[^a-zA-Z0-9\/]/g, "_")}`;

    try {
        const snap = await adminDatabase.ref(path).get();
        if (snap.exists()) {
            const cached = snap.val() as SignalStats & { calculatedAt: number };
            if (cached && Date.now() - cached.calculatedAt < CACHE_TTL_MS) {
                return cached;
            }
        }
    } catch {
        // ignore cache read errors, fall through to calculation
    }

    const signals = await getAllSignals();
    const stats = calculateStats(signals, filter);

    try {
        await adminDatabase.ref(path).set(stats);
    } catch {
        // never fail the request because the cache write failed
    }

    return stats;
}