// Account health scoring for a user, rolled up across their broker accounts.
//
// ── Why this is a pure module ──────────────────────────────────────────────────
// Both `/api/account-health` (self-service) and `/api/admin/account-health`
// (operator view) need the same verdict, so it lives here rather than being
// copy-pasted. Every function takes the facts it needs as an argument: no
// Firebase, no env, no clock. That keeps the whole scoring matrix testable
// offline, and it guarantees the two routes cannot drift apart.
//
// ── Thresholds are the platform's, not invented here ───────────────────────────
// Margin bands match `app/risk/page.tsx` (>500 safe, >200 warning, else danger)
// and the position-risk formula matches `app/api/analytics/risk`. A health
// console that disagreed with the risk page on the same account would be worse
// than no console.
//
// ── Honesty about missing data ─────────────────────────────────────────────────
// Three specific ways this refuses to invent a good result:
//   1. `hasData` comes from the account's OWN records. The `aiSignals` library is
//      platform-wide, so counting it would hand a perfect score to every user
//      including those who have never traded.
//   2. `marginLevel: 0` with `margin: 0` means "not leveraged", not "margin
//      called". It reports SAFE and surfaces no level, because a 0 that means
//      "nothing at risk" must never render as a red warning.
//   3. An unresolved signal library reports no win rate at all rather than 0%.
//      Thirty-two pending signals are not a 0% win rate; they are no sample.

import type {
    AccountHealthAccount,
    AccountHealthAccountView,
    AccountHealthDirectory,
    AccountHealthDirectoryEntry,
    AccountHealthFacts,
    AccountHealthPositionView,
    AccountHealthReport,
    ExposureStatus,
    HealthStatus,
    RiskLevel,
} from "./types";

function round(value: number, dp: number): number {
    const f = 10 ** dp;
    return Math.round(value * f) / f;
}

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function str(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

/** Contract size used by the platform's own risk maths. */
const CONTRACT_SIZE = 100;

/**
 * Cash at risk on one position.
 *
 * Mirrors `app/api/analytics/risk/route.ts`: distance from the current price to
 * the stop, falling back to the open price, times volume times contract size.
 * The `* 100` is load-bearing — without it every risk figure, and therefore
 * every "position at risk" flag, reads a hundred times too small.
 */
function positionRisk(p: { currentPrice?: unknown; sl?: unknown; openPrice?: unknown; volume?: unknown }): number {
    const volume = num(p.volume);
    const current = num(p.currentPrice);
    const sl = num(p.sl);
    const open = num(p.openPrice);
    if (sl > 0 && current > 0) return Math.abs(current - sl) * volume * CONTRACT_SIZE;
    if (open > 0 && current > 0) return Math.abs(open - current) * volume * CONTRACT_SIZE;
    return 0;
}

/** A signal counts as resolved once it has left the pending state. */
function isResolved(result: unknown): boolean {
    const r = str(result).trim().toUpperCase();
    return r !== "" && r !== "PENDING" && r !== "OPEN" && r !== "ACTIVE";
}

function isWin(result: unknown): boolean {
    const r = str(result).trim().toUpperCase();
    return r === "WIN" || r === "WON" || r === "TP" || r === "WINNER";
}

/**
 * Build the account health verdict.
 *
 * The score starts at 100, subtracts each risk dimension (capped independently
 * so no single dimension can zero the account alone), then adds back only what
 * is genuinely earned: a non-negative open P/L on positions that actually exist,
 * and a signal library that has resolved well.
 */
export function buildAccountHealthReport(facts: AccountHealthFacts): AccountHealthReport {
    const accounts = facts.accounts ?? [];
    const positionsIn = facts.positions ?? [];
    const signals = facts.signals ?? [];

    // ── Roll the broker accounts up ─────────────────────────────────────────
    // Money sums; margin level takes the *weakest* account that is actually
    // leveraged, because a portfolio is only as safe as its tightest account.
    let balance = 0;
    let equity = 0;
    let freeMargin = 0;
    let marginUsed = 0;
    let worstMarginLevel: number | null = null;

    const accountViews: AccountHealthAccountView[] = accounts.map((a: AccountHealthAccount) => {
        const accBalance = num(a.balance);
        const accEquity = num(a.equity);
        const accMargin = num(a.margin);
        const accMarginLevel = num(a.marginLevel);
        const accountId = str(a.accountId) || "account";

        balance += accBalance;
        equity += accEquity;
        freeMargin += num(a.freeMargin);
        marginUsed += accMargin;
        // Only a leveraged account has a meaningful level. MT5 writes 0 for
        // "no margin in use", and letting that into the minimum would report
        // every idle account as redlined.
        if (accMargin > 0 && accMarginLevel > 0) {
            worstMarginLevel = worstMarginLevel === null ? accMarginLevel : Math.min(worstMarginLevel, accMarginLevel);
        }

        return {
            accountId,
            currency: str(a.currency, "USD"),
            balance: accBalance,
            equity: accEquity,
            margin: accMargin,
            marginLevel: accMarginLevel,
            positions: num(a.positionsCount),
            status: str(a.status, "unknown"),
            lastHeartbeatAt: num(a.lastHeartbeatAt),
        };
    });

    // ── Positions ──────────────────────────────────────────────────────────
    // A position counts as "at risk" when the cash between its current price and
    // its stop exceeds 5% of the balance, the same 5% the risk route uses. A zero
    // balance makes that threshold zero, so guard it — otherwise every position
    // reads as risky and a wiped account reads as maximally exposed.
    const riskThreshold = balance > 0 ? balance * 0.05 : Infinity;

    let positionPnl = 0;
    let positionsAtRisk = 0;

    const positions: AccountHealthPositionView[] = positionsIn.map((p) => {
        const profit = num(p.profit);
        positionPnl += profit;
        const risk = round(positionRisk(p), 2);
        const atRisk = risk > riskThreshold;
        if (atRisk) positionsAtRisk++;
        return {
            symbol: str(p.symbol, "—"),
            type: str(p.type),
            volume: num(p.volume),
            profit: round(profit, 2),
            risk,
            atRisk,
        };
    });

    const totalPositions = positions.length;

    // Account-level floating P/L comes from equity vs balance, which is what the
    // broker reports and what the rest of the platform computes. The per-position
    // profits are the same quantity decomposed, and are shown in the table.
    const floatingPnl = round(equity - balance, 2);
    const floatingPnlPct = balance > 0 ? (floatingPnl / balance) * 100 : 0;
    const liveDrawdown = balance > 0 ? ((balance - equity) / balance) * 100 : 0;
    const marginUtilization = balance > 0 ? (marginUsed / balance) * 100 : 0;
    const maxDrawdown = num(facts.maxDrawdown);

    // The worse of live and recorded-peak drawdown drives the verdict: an account
    // sitting at equity today that already lost 60% from its peak is not SAFE,
    // and reporting only the live number would hide it.
    const effectiveDrawdown = Math.max(liveDrawdown, maxDrawdown);

    // ── Signal library ─────────────────────────────────────────────────────
    const resolved = signals.filter((s) => isResolved(s.result));
    const wins = resolved.filter((s) => isWin(s.result));
    const winRatio = resolved.length > 0 ? wins.length / resolved.length : 0;
    const resolvedWithR = resolved.filter((s) => Number.isFinite(Number(s.resultR)));

    // ── Score ──────────────────────────────────────────────────────────────
    const drawdownPenalty = Math.min(Math.max(effectiveDrawdown, 0) * 2, 30);
    const marginPenalty = Math.min(Math.max(marginUtilization, 0) * 0.5, 20);
    const exposurePenalty = Math.min(positionsAtRisk * 5, 15);
    const positionCountPenalty = totalPositions > 10 ? 10 : 0;
    // Only an open book can be in profit. Without this, having no positions at
    // all scores the full +10 — a free pass for inactivity.
    const pnlCredit = totalPositions > 0 && floatingPnl >= 0 ? 10 : 0;
    // No resolved sample means no quality credit, and no 0%-win-rate story.
    const signalCredit = resolved.length > 0 ? winRatio * 15 : 0;

    const score = Math.max(0, Math.min(100, Math.round(
        100
        - drawdownPenalty
        - marginPenalty
        - exposurePenalty
        - positionCountPenalty
        + pnlCredit
        + signalCredit,
    )));

    const riskLevel: RiskLevel = score < 50 ? "HIGH" : score < 70 ? "MODERATE" : "LOW";

    const drawdownStatus: HealthStatus =
        effectiveDrawdown > 15 ? "DANGER" : effectiveDrawdown > 8 ? "WARNING" : "SAFE";

    // No margin in use means no margin call, whatever the level field says.
    const marginStatus: HealthStatus = marginUsed <= 0 || worstMarginLevel === null
        ? "SAFE"
        : worstMarginLevel < 200 ? "DANGER" : worstMarginLevel < 500 ? "WARNING" : "SAFE";

    const exposureStatus: ExposureStatus =
        totalPositions > 8 ? "HIGH" : totalPositions > 5 ? "MODERATE" : "LOW";

    // Own records only. Never the shared signal library.
    const hasData = accounts.length > 0
        && (balance > 0 || equity > 0 || totalPositions > 0);

    return {
        score,
        riskLevel,
        drawdownStatus,
        marginStatus,
        exposureStatus,
        hasData,
        metrics: {
            balance: round(balance, 2),
            equity: round(equity, 2),
            freeMargin: round(freeMargin, 2),
            floatingPnl,
            floatingPnlPct: round(floatingPnlPct, 1),
            // Left unclamped, matching `app/api/analytics/risk`: equity above
            // balance is a profit, and the platform reports that as a negative
            // drawdown rather than rounding it away. The *penalty* clamps at 0.
            drawdown: round(liveDrawdown, 1),
            maxDrawdown: round(maxDrawdown, 1),
            peakEquity: round(num(facts.peakEquity), 2),
            marginLevel: worstMarginLevel === null ? null : round(worstMarginLevel, 1),
            marginUtilization: round(marginUtilization, 1),
            marginCallDistance: worstMarginLevel === null
                ? 0
                : round(Math.max(0, worstMarginLevel - 100), 1),
            totalPositions,
            positionsAtRisk,
            // Sum the already-rounded per-position risks, so the total matches
            // what the operator sees in the position list rather than a value
            // that silently differs from the sum of its parts.
            openRisk: round(positions.reduce((sum, p) => sum + p.risk, 0), 2),
            accounts: accounts.length,
        },
        trading: {
            totalSignals: signals.length,
            resolvedSignals: resolved.length,
            winRate: resolved.length > 0 ? round((wins.length / resolved.length) * 100, 1).toFixed(1) : null,
            averageR: resolvedWithR.length > 0
                ? (resolvedWithR.reduce((s, sig) => s + num(sig.resultR), 0) / resolvedWithR.length).toFixed(2)
                : null,
        },
        breakdown: {
            drawdown: Math.round(drawdownPenalty),
            margin: Math.round(marginPenalty),
            exposure: Math.round(exposurePenalty + positionCountPenalty),
            pnl: pnlCredit,
            signalQuality: Math.round(signalCredit),
        },
        accounts: accountViews,
        positions,
    };
}

// ── Admin directory ───────────────────────────────────────────────────────────

/** Worst first, so an operator's eye lands on the accounts that need work. */
const RISK_RANK: Record<RiskLevel, number> = { HIGH: 0, MODERATE: 1, LOW: 2 };

/**
 * Roll per-account reports into the admin directory.
 *
 * Sorted worst-first rather than alphabetically: the purpose of this view is to
 * surface the accounts that are in trouble, and an alphabetical list buries
 * them. Accounts with no activity sort last, since "no data" is not a finding.
 */
export function buildAccountHealthDirectory(entries: AccountHealthDirectoryEntry[]): AccountHealthDirectory {
    const sorted = [...entries].sort((a, b) => {
        // Inactive accounts always sink to the bottom, whatever their score.
        if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
        if (!a.hasData) return a.uid < b.uid ? -1 : 1;
        const rank = RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel];
        if (rank !== 0) return rank;
        if (a.score !== b.score) return a.score - b.score;
        return a.uid < b.uid ? -1 : 1;
    });

    let active = 0;
    let highRisk = 0;
    let moderateRisk = 0;
    let lowRisk = 0;
    for (const e of sorted) {
        if (!e.hasData) continue;
        active++;
        if (e.riskLevel === "HIGH") highRisk++;
        else if (e.riskLevel === "MODERATE") moderateRisk++;
        else lowRisk++;
    }

    const share = (n: number) => (active > 0 ? Math.round((n / active) * 100) : 0);
    const distribution: Record<RiskLevel, number> = {
        HIGH: share(highRisk),
        MODERATE: share(moderateRisk),
        LOW: share(lowRisk),
    };

    return {
        accounts: sorted,
        totals: {
            accounts: sorted.length,
            active,
            highRisk,
            moderateRisk,
            lowRisk,
            // Only meaningful when something is actually being monitored; an
            // empty platform is not an "all impaired" platform.
            allImpaired: active > 0 && highRisk === active,
        },
        distribution,
    };
}
