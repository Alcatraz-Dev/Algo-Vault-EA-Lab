/**
 * Pro Scalping Terminal — shared pure helpers.
 *
 * Client-safe: no React, no Firebase, no network. Everything the terminal
 * panels need to format, parse and aggregate is here so the components stay
 * render-only.
 *
 * Nothing in this file invents market data. Sessions are the same UTC windows
 * the analytics engine uses (`lib/analytics/sessions.ts`); journal analytics
 * are computed only from entries the user actually has.
 */

// ── price formatting ──────────────────────────────────────────────────────────

/**
 * Digits for a price, from explicit symbol rules first (JPY pairs, metals),
 * then from magnitude so the same rule works for indices, crypto and FX.
 */
export function fmtPrice(value: number | null | undefined, symbol?: string): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const s = (symbol ?? "").toUpperCase();
    let digits: number;
    if (s.endsWith("JPY")) digits = 3;
    else if (s === "XAUUSD") digits = 2;
    else if (s === "XAGUSD") digits = 3;
    else if (Math.abs(value) >= 10) digits = 2;
    else if (Math.abs(value) >= 1) digits = 5;
    else digits = 5;
    return value.toFixed(digits);
}

export function fmtSignedPct(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function fmtSigned(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function fmtTime(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
    return new Date(ms).toISOString().slice(11, 16) + " UTC";
}

export function fmtDate(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
    return new Date(ms).toISOString().slice(0, 10);
}

/** "prev_day_high" → "Prev day high". */
export function humaniseKey(key: string): string {
    return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// ── sessions (mirrors lib/analytics/sessions.ts UTC windows) ────────────────

export type SessionWindow = { key: string; name: string; startMin: number; endMin: number };

export const SESSION_WINDOWS: SessionWindow[] = [
    { key: "asian", name: "Asia", startMin: 0, endMin: 8 * 60 },
    { key: "london", name: "London", startMin: 7 * 60, endMin: 16 * 60 },
    { key: "overlap", name: "London / NY", startMin: 12 * 60, endMin: 16 * 60 },
    { key: "new_york", name: "New York", startMin: 12 * 60, endMin: 21 * 60 },
];

export type SessionRow = SessionWindow & { active: boolean; progress: number };

export type SessionState = {
    rows: SessionRow[];
    activeLabel: string;
    weekend: boolean;
    nextEventLabel: string | null;
    nextEventInMin: number | null;
};

function deltaTo(minutesNow: number, target: number): number {
    return (target - minutesNow + 1440) % 1440;
}

export function sessionState(nowMs: number): SessionState {
    const d = new Date(nowMs);
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const weekday = d.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;

    const rows: SessionRow[] = SESSION_WINDOWS.map((w) => {
        const active = !weekend && utcMin >= w.startMin && utcMin < w.endMin;
        const span = w.endMin - w.startMin;
        const progress = Math.max(0, Math.min(1, (utcMin - w.startMin) / span));
        return { ...w, active, progress: active ? progress : 0 };
    });

    // The overlap window is the premium session; name it first when inside it.
    const overlap = rows.find((r) => r.key === "overlap");
    const plainActive = rows.filter((r) => r.key !== "overlap" && r.active);
    const activeLabel = weekend
        ? "Weekend — market closed"
        : overlap && overlap.active
          ? "London / NY overlap"
          : plainActive.length > 0
            ? plainActive.map((r) => r.name).join(" + ")
            : "Closed";

    let nextEventLabel: string | null = null;
    let nextEventInMin: number | null = null;
    if (weekend) {
        // Minutes until Monday 00:00 UTC (Asia open).
        const daysUntilMonday = weekday === 6 ? 2 : 1;
        const midnight = deltaTo(utcMin, 0);
        nextEventInMin = midnight + daysUntilMonday * 1440;
        nextEventLabel = "Asia opens";
    } else {
        for (const w of SESSION_WINDOWS) {
            const toOpen = deltaTo(utcMin, w.startMin);
            const toClose = deltaTo(utcMin, w.endMin);
            if (toOpen > 0 && (nextEventInMin === null || toOpen < nextEventInMin)) {
                nextEventInMin = toOpen;
                nextEventLabel = `${w.name} opens`;
            }
            if (utcMin >= w.startMin && utcMin < w.endMin && (nextEventInMin === null || toClose < nextEventInMin)) {
                nextEventInMin = toClose;
                nextEventLabel = `${w.name} closes`;
            }
        }
    }

    return { rows, activeLabel, weekend, nextEventLabel, nextEventInMin };
}

export function fmtCountdown(min: number | null): string {
    if (min === null) return "—";
    if (min < 1) return "<1m";
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
}

// ── trade journal parsing + analytics ────────────────────────────────────────

export type TerminalTrade = {
    id: string;
    symbol: string | null;
    direction: string | null;
    setup: string | null;
    result: "win" | "loss" | "breakeven" | null;
    r: number | null;
    createdAt: number | null;
    session: string | null;
    timeframe: string | null;
};

/**
 * Normalise whatever the journal API returned into settled trades. Records
 * with neither a result nor an R value are skipped — an unlabelled row cannot
 * be counted without inventing its outcome.
 */
export function parseTrades(raw: unknown): TerminalTrade[] {
    if (!Array.isArray(raw)) return [];
    const out: TerminalTrade[] = [];
    for (let i = 0; i < raw.length; i++) {
        const entry: unknown = raw[i];
        if (!entry || typeof entry !== "object") continue;
        const r = entry as Record<string, unknown>;
        const resultRaw = String(r.result ?? r.outcome ?? "").toUpperCase();
        const result: TerminalTrade["result"] = resultRaw.includes("WIN")
            ? "win"
            : resultRaw.includes("LOSS") || resultRaw === "LOSE"
              ? "loss"
              : resultRaw.includes("BREAKEVEN") || resultRaw === "BE"
                ? "breakeven"
                : null;
        const rNum = Number(r.resultR ?? r.rMultiple ?? r.r);
        const rVal = Number.isFinite(rNum) ? rNum : null;
        const createdNum = Number(r.createdAt ?? r.closedAt ?? r.timestamp);
        const createdAt = Number.isFinite(createdNum) && createdNum > 0 ? createdNum : null;
        if (result === null && rVal === null) continue;
        out.push({
            id: String(r.id ?? r.tradeId ?? `trade_${i}`),
            symbol: typeof r.symbol === "string" && r.symbol ? r.symbol : null,
            direction: typeof r.direction === "string" && r.direction ? r.direction : null,
            setup:
                typeof r.setup === "string" && r.setup
                    ? r.setup
                    : typeof r.setupType === "string" && r.setupType
                      ? r.setupType
                      : null,
            result,
            r: rVal,
            createdAt,
            session: typeof r.session === "string" && r.session ? r.session : null,
            timeframe: typeof r.timeframe === "string" && r.timeframe ? r.timeframe : null,
        });
    }
    return out;
}

export type BreakdownRow = { key: string; n: number; wins: number; netR: number; avgR: number };

export type JournalAnalytics = {
    total: number;
    wins: number;
    losses: number;
    breakeven: number;
    /** Over decided trades (win/loss) only. */
    winRate: number | null;
    netR: number | null;
    avgR: number | null;
    profitFactor: number | null;
    profitFactorUnbounded: boolean;
    best: number | null;
    worst: number | null;
    streak: { kind: "win" | "loss"; count: number } | null;
    bySetup: BreakdownRow[];
    bySymbol: BreakdownRow[];
    bySession: BreakdownRow[];
};

function groupBy(trades: TerminalTrade[], pick: (t: TerminalTrade) => string | null): BreakdownRow[] {
    const map = new Map<string, { n: number; wins: number; netR: number }>();
    for (const t of trades) {
        const key = pick(t);
        if (!key) continue;
        const cur = map.get(key) ?? { n: 0, wins: 0, netR: 0 };
        cur.n += 1;
        if (t.result === "win") cur.wins += 1;
        cur.netR += t.r ?? 0;
        map.set(key, cur);
    }
    return [...map.entries()]
        .map(([key, v]) => ({ key, n: v.n, wins: v.wins, netR: v.netR, avgR: v.n > 0 ? v.netR / v.n : 0 }))
        .sort((a, b) => b.netR - a.netR);
}

export function computeJournalAnalytics(trades: TerminalTrade[]): JournalAnalytics {
    const withR = trades.filter((t) => t.r !== null);
    const wins = trades.filter((t) => t.result === "win").length;
    const losses = trades.filter((t) => t.result === "loss").length;
    const breakeven = trades.filter((t) => t.result === "breakeven").length;
    const decided = wins + losses;
    const netR = withR.reduce((s, t) => s + (t.r ?? 0), 0);
    const grossWin = withR.reduce((s, t) => s + Math.max(0, t.r ?? 0), 0);
    const grossLoss = withR.reduce((s, t) => s + Math.min(0, t.r ?? 0), 0);
    const rs = withR.map((t) => t.r ?? 0);

    // Streak over the most recent settled trades, newest first.
    const sorted = [...trades].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    let streak: JournalAnalytics["streak"] = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
        const t = sorted[i];
        if (t.result !== "win" && t.result !== "loss") break;
        if (streak === null) streak = { kind: t.result, count: 1 };
        else if (streak.kind === t.result) streak.count += 1;
        else break;
    }

    return {
        total: trades.length,
        wins,
        losses,
        breakeven,
        winRate: decided > 0 ? (wins / decided) * 100 : null,
        netR: withR.length > 0 ? netR : null,
        avgR: withR.length > 0 ? netR / withR.length : null,
        profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : null,
        profitFactorUnbounded: grossLoss === 0 && grossWin > 0,
        best: rs.length > 0 ? Math.max(...rs) : null,
        worst: rs.length > 0 ? Math.min(...rs) : null,
        streak,
        bySetup: groupBy(trades, (t) => t.setup),
        bySymbol: groupBy(trades, (t) => t.symbol),
        bySession: groupBy(trades, (t) => t.session),
    };
}

// ── economic calendar (shape of /api/calendar) ──────────────────────────────

export type CalendarEvent = {
    id: string;
    date: string;
    timeUtc: string;
    currency: string;
    flag: string;
    title: string;
    impact: "High" | "Medium" | "Low";
    forecast: string;
    previous: string;
    actual?: string;
};

/** Best-effort UTC timestamp for a calendar row; null when unparseable. */
export function eventTimestamp(e: CalendarEvent): number | null {
    if (!e.date) return null;
    const time = /^\d{2}:\d{2}/.test(e.timeUtc) ? e.timeUtc.slice(0, 5) : "00:00";
    const ts = Date.parse(`${e.date}T${time}:00Z`);
    return Number.isFinite(ts) ? ts : null;
}

// ── position sizing (standard contract conventions) ─────────────────────────

/** Standard contract size per 1.0 lot. Verify with your broker before use. */
export function contractSizeFor(symbol: string): number {
    const s = symbol.toUpperCase();
    if (s === "XAUUSD") return 100; // 100 oz per lot
    if (s === "XAGUSD") return 5000; // 5000 oz per lot
    if (s.endsWith("USD") && s.length === 6 && !["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOGEUSD", "BNBUSD", "LTCUSD", "DOTUSD"].includes(s))
        return 100_000; // FX standard lot
    return 1; // indices, crypto, equities: priced per unit
}

export function positionSize(
    balance: number,
    riskPct: number,
    entry: number,
    stop: number,
    symbol: string
): { riskAmount: number; stopDistance: number; lots: number; units: number } | null {
    const contract = contractSizeFor(symbol);
    const stopDistance = Math.abs(entry - stop);
    if (!Number.isFinite(balance) || !Number.isFinite(riskPct) || !Number.isFinite(entry) || !Number.isFinite(stop)) return null;
    if (balance <= 0 || riskPct <= 0 || stopDistance <= 0) return null;
    const riskAmount = (balance * riskPct) / 100;
    const lots = riskAmount / (stopDistance * contract);
    return { riskAmount, stopDistance, lots, units: lots * contract };
}
