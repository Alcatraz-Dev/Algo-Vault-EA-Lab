import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A trade journal entry stored under tradeJournal/{uid}. */
interface TradeJournalEntry {
    id?: string;
    result?: string;
    /** Outcome in R multiples (1R = the unit risked on the trade). */
    resultR?: number | string;
    /** Optional USD P/L for entries that record it. */
    pnl?: number | string;
    createdAt?: number | string;
    signalId?: string;
    symbol?: string;
    timeframe?: string;
}

interface WeeklyBucket {
    weekStart: number; // ms epoch of Monday 00:00 UTC
    trades: number;
    netR: number;
}

interface NormalizedTrade {
    id: string;
    createdAtMs: number;
    resultR: number; // R-multiple (0 if unknown, treated as breakeven)
    pnl: number | null; // USD P/L if recorded
    isWin: boolean;
    isLoss: boolean;
    isDecided: boolean;
    signalId?: string;
}

/** Normalise a journal record into a free list entry we can compute on. */
function normalizeTrade(raw: TradeJournalEntry, idx: number): NormalizedTrade | null {
    if (!raw || !raw.result) return null;
    const result = String(raw.result).toUpperCase();
    const rNum = Number(raw.resultR);
    const r = Number.isFinite(rNum) ? rNum : 0;
    const createdNum = Number(raw.createdAt);
    const createdAtMs = Number.isFinite(createdNum) && createdNum > 0 ? createdNum : Date.now();
    const pnlNum = Number(raw.pnl);
    const isWin = result === "WIN";
    const isLoss = result === "LOSS";
    const isDecided = isWin || isLoss;
    return {
        id: String(raw.id ?? `journal_${idx}`),
        createdAtMs,
        resultR: r,
        pnl: Number.isFinite(pnlNum) ? pnlNum : null,
        isWin,
        isLoss,
        isDecided,
        signalId: raw.signalId,
    };
}

/** Monday 00:00:00 UTC for the week containing ts. */
function weekStartUtc(ts: number): number {
    const d = new Date(ts);
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const offset = (day + 6) % 7; // distance back to Monday
    d.setUTCDate(d.getUTCDate() - offset);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
}

/** UTC date key (yyyy-mm-dd) for unique-day counting. */
function utcDayKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function computeAnalytics(trades: NormalizedTrade[]) {
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.isWin).length;
    const losses = trades.filter((t) => t.isLoss).length;
    const decided = wins + losses;
    const winRate = decided > 0 ? (wins / decided) * 100 : 0;

    // Profit factor — only count decided trades' absolute R.
    const grossWin = trades.reduce((s, t) => s + (t.isWin ? Math.max(0, t.resultR) : 0), 0);
    const grossLoss = trades.reduce((s, t) => s + (t.isLoss ? Math.abs(Math.min(0, t.resultR)) : 0), 0);
    const profitFactorUnbounded = grossLoss === 0 && grossWin > 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : profitFactorUnbounded ? null : 0;

    const netR = trades.reduce((s, t) => s + t.resultR, 0);
    const expectancy = totalTrades > 0 ? netR / totalTrades : 0;
    const avgReturn = totalTrades > 0 ? netR / totalTrades : 0;

    const rValues = trades.map((t) => t.resultR);
    const mean = rValues.length > 0 ? rValues.reduce((s, v) => s + v, 0) / rValues.length : 0;
    const variance = rValues.length > 1
        ? rValues.reduce((s, v) => s + (v - mean) ** 2, 0) / (rValues.length - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    // Sharpe-like ratio over the per-trade distribution (assume unit period).
    const sharpeLike = stdDev > 0 ? Number((mean / stdDev).toFixed(3)) : 0;

    // Synthetic equity curve from R multiples — each trade risks 1R baseline.
    let peak = 0;
    let trough = 0;
    let running = 0;
    let maxDrawdownR = 0;
    let maxDrawdownPct = 0;
    for (const t of trades) {
        running += t.resultR;
        if (running > peak) peak = running;
        if (running < trough) trough = running;
        const ddFromPeak = peak - running;
        const ddFromTrough = running - trough;
        const dd = Math.max(ddFromPeak, ddFromTrough);
        if (dd > maxDrawdownR) maxDrawdownR = dd;
        // Drawdown % relative to peak-to-trough peak when we have one.
        if (peak > 0) {
            const pct = (dd / peak) * 100;
            if (pct > maxDrawdownPct) maxDrawdownPct = pct;
        }
    }

    const largestWin = trades.reduce((m, t) => Math.max(m, t.isWin ? t.resultR : 0), 0);
    const largestLoss = trades.reduce((m, t) => Math.min(m, t.isLoss ? t.resultR : 0), 0);

    // Consecutive wins / losses — scanned from newest backwards.
    const sortedDesc = [...trades].sort((a, b) => b.createdAtMs - a.createdAtMs);
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    if (sortedDesc.length > 0) {
        const first = sortedDesc[0];
        if (first.isWin) {
            for (const t of sortedDesc) { if (t.isWin) consecutiveWins += 1; else break; }
        } else if (first.isLoss) {
            for (const t of sortedDesc) { if (t.isLoss) consecutiveLosses += 1; else break; }
        }
    }
    // Max streaks (anywhere in the history)
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let curW = 0;
    let curL = 0;
    for (const t of sortedDesc) {
        if (t.isWin) { curW += 1; curL = 0; maxWinStreak = Math.max(maxWinStreak, curW); }
        else if (t.isLoss) { curL += 1; curW = 0; maxLossStreak = Math.max(maxLossStreak, curL); }
        else { curW = 0; curL = 0; }
    }

    // Weekly buckets
    const weekMap = new Map<number, WeeklyBucket>();
    for (const t of trades) {
        const ws = weekStartUtc(t.createdAtMs);
        const cur = weekMap.get(ws) ?? { weekStart: ws, trades: 0, netR: 0 };
        cur.trades += 1;
        cur.netR += t.resultR;
        weekMap.set(ws, cur);
    }
    const weeks = [...weekMap.values()].sort((a, b) => a.weekStart - b.weekStart);
    const weeksCovered = weeks.length;
    const bestWeek = weeks.reduce((m, w) => Math.max(m, w.netR), 0);
    const worstWeek = weeks.reduce((m, w) => Math.min(m, w.netR), 0);
    const avgTradesPerWeek = weeksCovered > 0 ? totalTrades / weeksCovered : 0;

    // Unique trading days (UTC-normalised).
    const uniqueDays = new Set(trades.map((t) => utcDayKey(t.createdAtMs)));

    // USD P/L totals (only if entries actually recorded pnl).
    const withPnl = trades.filter((t) => t.pnl !== null) as Array<NormalizedTrade & { pnl: number }>;
    const hasPnl = withPnl.length > 0;
    const totalPnlUsd = hasPnl ? withPnl.reduce((s, t) => s + (t.pnl as number), 0) : null;

    return {
        totalTrades,
        wins,
        losses,
        decided,
        winRate: Number(winRate.toFixed(2)),
        netR: Number(netR.toFixed(2)),
        avgReturn: Number(avgReturn.toFixed(3)),
        expectancy: Number(expectancy.toFixed(3)),
        profitFactor: profitFactor === null ? null : Number(profitFactor.toFixed(2)),
        profitFactorUnbounded,
        grossWin: Number(grossWin.toFixed(2)),
        grossLoss: Number(grossLoss.toFixed(2)),
        sharpeLike,
        maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
        maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
        largestWin: Number(largestWin.toFixed(2)),
        largestLoss: Number(largestLoss.toFixed(2)),
        consecutiveWins,
        consecutiveLosses,
        maxWinStreak,
        maxLossStreak,
        tradingDays: uniqueDays.size,
        weeksCovered,
        bestWeek: Number(bestWeek.toFixed(2)),
        worstWeek: Number(worstWeek.toFixed(2)),
        avgTradesPerWeek: Number(avgTradesPerWeek.toFixed(2)),
        totalPnlUsd: totalPnlUsd === null ? null : Number(totalPnlUsd.toFixed(2)),
        hasPnl,
    };
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const tradeSnap = await adminDatabase.ref(`tradeJournal/${user.uid}`).get();
        const raw = tradeSnap.exists()
            ? (tradeSnap.val() as Record<string, TradeJournalEntry>)
            : {};
        const trades = Object.entries(raw)
            .map(([id, val], idx) => ({ ...val, id, _idx: idx }))
            .map((entry) => normalizeTrade(entry, entry._idx))
            .filter((t): t is NormalizedTrade => t !== null);

        const analytics = computeAnalytics(trades);

        // Cross-reference with the aiSignals collection the user actually engaged with.
        const userSignalIds = new Set(
            trades.map((t) => t.signalId).filter((s): s is string => Boolean(s))
        );

        // Count aiSignals attributed to the user via the userSignal child node if present.
        const userSignalsRefSnap = await adminDatabase.ref(`userSignals/${user.uid}`).get();
        const userSignalsTotal = userSignalsRefSnap.exists()
            ? Object.keys(userSignalsRefSnap.val() as Record<string, unknown>).length
            : 0;
        const userSignalsWithTrades = trades.filter((t) => t.signalId && userSignalIds.has(t.signalId)).length;

        // Fall back to the full aiSignals count if the per-user mapping isn't present.
        let totalSignalsInDb = 0;
        if (userSignalsTotal === 0) {
            const signalSnap = await adminDatabase.ref("aiSignals").get();
            if (signalSnap.exists()) {
                signalSnap.forEach((child) => {
                    const s = child.val();
                    if (s && s.id) totalSignalsInDb += 1;
                });
            }
        }

        const verifiedPerformance = {
            verifiedAt: new Date().toISOString(),
            source: "tradeJournal",
            hasData: trades.length > 0,
            ...analytics,
            signalCorrelation: {
                userSignalsTotal: userSignalsTotal > 0 ? userSignalsTotal : totalSignalsInDb,
                userSignalsWithTrades: userSignalsTotal > 0 ? userSignalsWithTrades : analytics.totalTrades > 0 ? trades.filter((t) => t.signalId).length : 0,
                tradesLinkedToSignal: trades.filter((t) => t.signalId).length,
                coverage: analytics.totalTrades > 0
                    ? Number(((trades.filter((t) => t.signalId).length / analytics.totalTrades) * 100).toFixed(1))
                    : 0,
            },
            riskMetrics: {
                maxDrawdownR: analytics.maxDrawdownR,
                maxDrawdownPct: analytics.maxDrawdownPct,
                profitFactor: analytics.profitFactor,
                expectancy: analytics.expectancy,
                sharpeRatio: analytics.sharpeLike,
                largestWin: analytics.largestWin,
                largestLoss: analytics.largestLoss,
                maxWinStreak: analytics.maxWinStreak,
                maxLossStreak: analytics.maxLossStreak,
            },
        };

        return NextResponse.json({ success: true, verifiedPerformance }, { status: 200 });
    } catch (err) {
        console.error("[verified-performance]", err);
        return NextResponse.json({ error: "Failed to compute verified performance" }, { status: 500 });
    }
}