import {
    PluginConfig,
    PluginExecutionResult,
    PluginFinding,
    PluginAlert,
} from "../types";
import { RuntimeMarketSnapshot, resolveTimeframe, loadMarketSnapshot } from "./market";
import { HistoryContext, RuntimeTrade } from "./history";

/**
 * Built-in analyzer implementations.
 *
 * Each built-in plugin maps its manifest `runtime.handler` to a real
 * implementation below. Analyzers are pure functions of measured data
 * (candles, trades, positions, events). They never fabricate statistics and
 * never represent their output as guaranteed outcomes.
 */

export type AnalyzerContext = {
    userId: string;
    pluginId: string;
    config: PluginConfig;
    market: Record<string, RuntimeMarketSnapshot>;
    history: HistoryContext;
    news: NewsContext;
    risk: RiskContext;
    now: number;
};

export type NewsContext = {
    incoming: EconomicEvent[];
    relevant: EconomicEvent[];
};

export type EconomicEvent = {
    id: string;
    title: string;
    currency: string;
    impact: "High" | "Medium" | "Low";
    date: string;
    timeUtc: string;
};

export type RiskContext = {
    drawdownPercent: number;
    exposureRatio: number;
    positionCount: number;
    correlatedExposure: number;
    symbols: string[];
    currencyExposure: Record<string, number>;
};

export type Analyzer = (ctx: AnalyzerContext) => Promise<PluginExecutionResult>;

export const ANALYZERS: Record<string, Analyzer> = {
    strategy_dna: analyzeStrategyDna,
    behavior_intelligence: analyzeBehaviorIntelligence,
    counterfactual_lab: analyzeCounterfactualLab,
    correlation_intelligence: analyzeCorrelationIntelligence,
    setup_fingerprint: analyzeSetupFingerprint,
    opportunity_agent: analyzeOpportunityAgent,
    anomaly_agent: analyzeAnomalyAgent,
    news_impact: analyzeNewsImpact,
    risk_guardian: analyzeRiskGuardian,
    personal_intelligence: analyzePersonalIntelligence,
};

// ─── Shared helpers ─────────────────────────────────────────────────────────

function round(value: number, digits = 2): number {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function hourLabel(ts: number): string {
    if (!ts) return "unknown";
    return new Date(ts).toUTCString().slice(17, 22) + " UTC";
}

function dayLabel(ts: number): string {
    if (!ts) return "unknown";
    return new Date(ts).toUTCString().slice(0, 16);
}

const REGIME_LABEL: Record<string, string> = {
    trending_bullish: "Trending bullish",
    trending_bearish: "Trending bearish",
    ranging: "Ranging / consolidating",
    breakout: "Breakout",
    high_volatility: "High volatility",
    low_volatility: "Low volatility",
    transitional: "Transitional",
};

// ─── 1. Strategy DNA ────────────────────────────────────────────────────────

async function analyzeStrategyDna(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const trades = ctx.history.trades;
    const findings: PluginFinding[] = [];

    if (trades.length < 5) {
        return {
            status: "success",
            summary: `Not enough recorded trades (${trades.length}) to profile strategy DNA. Connect and monitor bots first.`,
            findings: [
                { title: "Insufficient data", detail: "Strategy DNA needs at least 5 closed trades to produce a profile." },
            ],
        };
    }

    const wins = trades.filter((t) => t.net > 0);
    const losses = trades.filter((t) => t.net < 0);
    const totalPnl = round(trades.reduce((sum, t) => sum + t.net, 0));
    const winRate = round((wins.length / trades.length) * 100);

    // Session profile.
    const sessionBuckets: Record<string, { count: number; pnl: number; wins: number }> = {};
    for (const t of trades) {
        const hour = t.openedAt ? new Date(t.openedAt).getUTCHours() : -1;
        const session = hour >= 0 && hour < 7 ? "Asian" : hour >= 7 && hour < 13 ? "London" : hour >= 13 && hour < 21 ? "New York" : "Off-hours";
        const b = (sessionBuckets[session] ||= { count: 0, pnl: 0, wins: 0 });
        b.count += 1;
        b.pnl += t.net;
        if (t.net > 0) b.wins += 1;
    }
    const bestSession = Object.entries(sessionBuckets).sort((a, b) => b[1].pnl - a[1].pnl)[0];

    // Holding duration.
    const withHolding = trades.filter((t) => t.holdingMs > 0);
    const avgHolding = withHolding.length > 0 ? withHolding.reduce((s, t) => s + t.holdingMs, 0) / withHolding.length : 0;
    const holdingLabel = avgHolding > 0 ? `${round(avgHolding / 60000)} min avg` : "unknown";

    // Entry timing: most common UTC hour.
    const hourCounts: Record<number, number> = {};
    for (const t of trades) {
        if (!t.openedAt) continue;
        const h = new Date(t.openedAt).getUTCHours();
        hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];

    // Win/loss conditions: symbol, volume, streak.
    const losingSymbols = new Map<string, { trades: number; pnl: number }>();
    for (const t of trades) {
        if (t.net < 0 && t.symbol) {
            const cur = losingSymbols.get(t.symbol) || { trades: 0, pnl: 0 };
            cur.trades += 1;
            cur.pnl += t.net;
            losingSymbols.set(t.symbol, cur);
        }
    }
    const worstSymbol = [...losingSymbols.entries()].sort((a, b) => a[1].pnl - b[1].pnl)[0];

    // Consecutive loss streaks.
    let maxLossStreak = 0;
    let streak = 0;
    for (const t of trades) {
        if (t.net < 0) {
            streak += 1;
            maxLossStreak = Math.max(maxLossStreak, streak);
        } else {
            streak = 0;
        }
    }

    findings.push(
        { title: "Trade profile", detail: `${trades.length} closed trades · ${round(winRate)}% win rate · net P/L ${totalPnl}` },
        { title: "Session profile", detail: bestSession ? `${bestSession[0]} session: ${bestSession[1].count} trades, P/L ${round(bestSession[1].pnl)} (${round(bestSession[1].wins)} wins)` : "No session data." },
        { title: "Holding duration", detail: holdingLabel === "unknown" ? "Not enough holding data." : `Average time in market: ${holdingLabel}.` },
        { title: "Entry timing", detail: peakHour ? `Most common entry hour: ${hourLabel(peakHour[0] === undefined ? 0 : Number(peakHour[0]) * 3600000)} (${peakHour[1]} entries)` : "No entry-time data." }
    );

    if (worstSymbol) {
        findings.push({ title: "Weakest symbol", detail: `${worstSymbol[0]}: ${worstSymbol[1].trades} losing trades, P/L ${round(worstSymbol[1].pnl)}` });
    }
    if (maxLossStreak >= 3) {
        findings.push({ title: "Potential failure condition", detail: `Longest losing streak in recorded history: ${maxLossStreak} consecutive losses.` });
    }
    if (trades.length >= 10) {
        const recent = trades.slice(-Math.floor(trades.length / 2));
        const older = trades.slice(0, Math.floor(trades.length / 2));
        const recentWr = round((recent.filter((t) => t.net > 0).length / recent.length) * 100);
        const olderWr = round((older.filter((t) => t.net > 0).length / older.length) * 100);
        findings.push({ title: "Behavioral drift", detail: `Win rate last half: ${recentWr}% vs. first half: ${olderWr}% — factual comparison only.` });
    }

    const regimeFindings: string[] = [];
    for (const [symbol, snap] of Object.entries(ctx.market)) {
        regimeFindings.push(`${symbol}: ${REGIME_LABEL[snap.regime.regime] || snap.regime.regime} (${round(snap.regime.confidence)}% confidence)`);
    }
    if (regimeFindings.length > 0) {
        findings.push({ title: "Current market regime context", detail: regimeFindings.join(" · ") });
    }

    return {
        status: "success",
        summary: `Strategy DNA profile computed from ${trades.length} recorded trades.`,
        findings,
        events: ["strategy.pattern.detected"],
    };
}

// ─── 2. Trading Behavior Intelligence ───────────────────────────────────────

async function analyzeBehaviorIntelligence(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const trades = ctx.history.trades;
    if (trades.length < 5) {
        return {
            status: "success",
            summary: `Insufficient trade history (${trades.length}) for behavior analysis.`,
            findings: [{ title: "Insufficient data", detail: "Connect and monitor bots to build behavioral observations." }],
        };
    }

    const findings: PluginFinding[] = [];
    const totalDays = Math.max(1, Math.ceil((trades[trades.length - 1].openedAt - trades[0].openedAt) / 86400000));
    const avgTradesPerDay = round(trades.length / totalDays, 1);
    const peakDay = trades.filter((t) => t.openedAt > Date.now() - 86400000).length;

    // Post-loss behavior: entries within 10 minutes after a loss.
    let tradesAfterLoss = 0;
    for (let i = 1; i < trades.length; i++) {
        const prev = trades[i - 1];
        const cur = trades[i];
        if (prev.net < 0 && cur.openedAt && prev.closedAt && cur.openedAt - prev.closedAt < 10 * 60000 && cur.openedAt - prev.closedAt > 0) {
            tradesAfterLoss += 1;
        }
    }
    // Post-win behavior.
    let tradesAfterWin = 0;
    for (let i = 1; i < trades.length; i++) {
        const prev = trades[i - 1];
        const cur = trades[i];
        if (prev.net > 0 && cur.openedAt && prev.closedAt && cur.openedAt - prev.closedAt < 10 * 60000 && cur.openedAt - prev.closedAt > 0) {
            tradesAfterWin += 1;
        }
    }

    // Risk scaling: avg volume first half vs second half.
    let riskChange: string | null = null;
    if (trades.length >= 8) {
        const half = Math.floor(trades.length / 2);
        const firstHalf = trades.slice(0, half);
        const secondHalf = trades.slice(half);
        const avgVol1 = firstHalf.reduce((s, t) => s + t.volume, 0) / firstHalf.length;
        const avgVol2 = secondHalf.reduce((s, t) => s + t.volume, 0) / secondHalf.length;
        if (avgVol1 > 0) {
            const pct = Math.round(((avgVol2 - avgVol1) / avgVol1) * 100);
            riskChange = `Average trade volume ${pct >= 0 ? "increased" : "decreased"} ${Math.abs(pct)}% between the first and second half of your recorded history (${round(avgVol1)} → ${round(avgVol2)} lots).`;
        }
    }

    // Overtrading windows: hours with atypical trade density.
    const hourDensity: Record<number, number> = {};
    for (const t of trades) {
        if (!t.openedAt) continue;
        const h = new Date(t.openedAt).getUTCHours();
        hourDensity[h] = (hourDensity[h] || 0) + 1;
    }
    const maxHour = Object.entries(hourDensity).sort((a, b) => b[1] - a[1])[0];
    const avgDensity = trades.length / 24;
    const denseHours = Object.entries(hourDensity).filter(([, c]) => c > avgDensity * 1.8).map(([h]) => `${h}:00`);

    const alerts: PluginAlert[] = [];

    if (avgTradesPerDay >= 5) {
        findings.push({ title: "High trade frequency", detail: `Average ${avgTradesPerDay} trades/day across ${totalDays} days. This qualifies as elevated frequency in most profiles.` });
        alerts.push({ severity: "medium", title: "Elevated trading frequency", message: `Bots produced an average of ${avgTradesPerDay} trades/day.`, eventType: "behavior.frequency.detected" });
    } else {
        findings.push({ title: "Trade frequency", detail: `Average ${avgTradesPerDay} trades/day across ${totalDays} days.` });
    }
    findings.push({ title: "Activity after losses", detail: `${tradesAfterLoss} trade(s) entered within 10 minutes of a closed losing trade.` });
    findings.push({ title: "Activity after wins", detail: `${tradesAfterWin} trade(s) entered within 10 minutes of a closed winning trade.` });
    if (riskChange) findings.push({ title: "Risk scaling change", detail: riskChange });
    if (denseHours.length > 0) {
        findings.push({ title: "Session-specific concentration", detail: `Unusually dense trading in UTC hours: ${denseHours.join(", ")}.` });
    }
    if (peakDay >= 3) {
        alerts.push({
            severity: "low",
            title: "Recent activity spike",
            message: `${peakDay} trades opened in the last 24 hours.`,
            eventType: "behavior.activity.spike",
        });
    }

    if (maxHour) {
        findings.push({ title: "Peak activity hour", detail: hourLabel(Number(maxHour[0]) * 3600000) });
    }

    return {
        status: "success",
        summary: `Behavioral observations computed from ${trades.length} recorded trades over ~${totalDays} days.`,
        findings,
        alerts,
        events: ["behavior.pattern.detected"],
    };
}

// ─── 3. Counterfactual Lab ──────────────────────────────────────────────────

async function analyzeCounterfactualLab(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const trades = ctx.history.trades;
    const settings = (ctx.config.settings || {}) as Record<string, unknown>;
    const sizeMultiplier = Math.max(0.1, Math.min(5, Number(settings.sizeMultiplier || 1)));
    const stopMultiplier = Math.max(0.1, Math.min(5, Number(settings.stopMultiplier || 1)));
    const maxConsecutiveLosses = Math.max(1, Math.min(20, Number(settings.maxConsecutiveLosses || 0)));
    const confirmDelayBars = Math.max(0, Math.min(100, Number(settings.confirmDelayBars || 0)));

    if (trades.length < 3) {
        return {
            status: "success",
            summary: "Not enough recorded trades to run counterfactual scenarios.",
            findings: [{ title: "Insufficient data", detail: "Connect and monitor bots first." }],
        };
    }

    const findings: PluginFinding[] = [];

    // Baseline.
    const baselineNet = round(trades.reduce((s, t) => s + t.net, 0));

    // Scenario A: different position size.
    const scaledNet = round(trades.reduce((s, t) => s + t.net * sizeMultiplier, 0));

    // Scenario B: different stop distance (approximate: scale losses by stopMultiplier, wins unchanged).
    const stopNet = round(
        trades.reduce((s, t) => (t.net < 0 ? s + t.net * stopMultiplier : s + t.net), 0)
    );

    // Scenario C: stop after N consecutive losses.
    let stopRuleNet = 0;
    let streakNow = 0;
    let halted = false;
    for (const t of trades) {
        if (halted) continue;
        stopRuleNet += t.net;
        if (t.net < 0) {
            streakNow += 1;
            if (maxConsecutiveLosses > 0 && streakNow >= maxConsecutiveLosses) {
                halted = true;
                stopRuleNet += t.net; // include the trade that triggered the stop? We already added it.
                break;
            }
        } else {
            streakNow = 0;
        }
    }

    // Scenario D: confirmation delay — drop the first trade of each direction flip.
    const delayedTrades: RuntimeTrade[] = [];
    let lastDir: string | null = null;
    for (const t of trades) {
        if (t.direction !== lastDir) {
            lastDir = t.direction;
            continue; // simulate waiting for confirmation
        }
        delayedTrades.push(t);
    }
    const confirmNet = round(delayedTrades.reduce((s, t) => s + t.net, 0));

    findings.push({ title: "Historical baseline", detail: `Recorded trades: ${trades.length} · realized net P/L ${baselineNet} (historical, not a prediction).` });
    findings.push({
        title: `Scenario: position size ×${sizeMultiplier}`,
        detail: `The same recorded trades with size multiplied by ${sizeMultiplier} would have produced net P/L ${scaledNet}. Historical simulation only.`,
    });
    findings.push({
        title: `Scenario: stop distance ×${stopMultiplier}`,
        detail: `Scaling recorded losses by ${stopMultiplier} (approximation) yields net P/L ${stopNet}. Historical simulation only.`,
    });
    if (maxConsecutiveLosses > 0) {
        findings.push({
            title: `Scenario: stop after ${maxConsecutiveLosses} consecutive losses`,
            detail: halted
                ? `The rule halted trading after ${streakNow} consecutive losses. Net P/L up to that point: ${round(stopRuleNet)}. Historical simulation only.`
                : `The rule never triggered — no ${maxConsecutiveLosses}-loss streak in recorded history. Net P/L unchanged at ${baselineNet}.`,
        });
    } else {
        findings.push({ title: "Scenario: loss-streak stop", detail: "Not enabled — set 'maxConsecutiveLosses' in the plugin config." });
    }
    findings.push({
        title: `Scenario: confirmation delay (${confirmDelayBars || "first move per direction"})`,
        detail: `Dropping unconfirmed first entries per direction yields net P/L ${confirmNet} over ${delayedTrades.length} remaining trades. Historical simulation only.`,
    });

    return {
        status: "success",
        summary: `Counterfactual Lab ran 4 historical scenarios over ${trades.length} trades.`,
        findings,
        events: ["plugin.counterfactual.completed"],
    };
}

// ─── 4. Trade Correlation Intelligence ──────────────────────────────────────

const CURRENCY_MAP: Record<string, string[]> = {
    USD: ["USD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"],
    EUR: ["EUR", "EURUSD", "EURGBP", "EURJPY", "EURCHF", "GBPEUR"],
    GBP: ["GBP", "GBPUSD", "EURGBP", "GBPJPY"],
    JPY: ["JPY", "USDJPY", "EURJPY", "GBPJPY", "AUDJPY"],
    AUD: ["AUD", "AUDUSD", "AUDJPY", "NZDUSD"],
    CAD: ["CAD", "USDCAD"],
    CHF: ["CHF", "USDCHF", "EURCHF"],
};

const GOLD_CORRELATED = ["XAUUSD", "AUDUSD", "EURCHF", "USDJPY"];
const RISK_ON = ["BTCUSD", "ETHUSD", "SOLUSD", "NAS100", "SPX500", "US30"];
const DXY_SENSITIVE = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "USDCHF", "AUDUSD"];

async function analyzeCorrelationIntelligence(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const positions = ctx.history.positions;
    const trades = ctx.history.trades;
    const symbols = positions.length > 0 ? Array.from(new Set(positions.map((p) => p.symbol))) : Array.from(new Set(trades.map((t) => t.symbol)));

    if (symbols.length < 2) {
        return {
            status: "success",
            summary: `Need at least 2 distinct symbols to detect correlation exposure (found ${symbols.length}).`,
            findings: [{ title: "Insufficient breadth", detail: "Open or monitor multiple instruments to build a correlation map." }],
        };
    }

    const findings: PluginFinding[] = [];
    const alerts: PluginAlert[] = [];

    const exposureByCurrency: Record<string, string[]> = {};
    for (const symbol of symbols) {
        const upper = String(symbol).toUpperCase();
        for (const [base, candidates] of Object.entries(CURRENCY_MAP)) {
            if (candidates.some((c) => upper.includes(c.replace(base, ""))) || (candidates.includes(upper) && upper.includes(base))) {
                (exposureByCurrency[base] ||= []).push(symbol);
            }
        }
    }

    const goldCluster = symbols.filter((s) => GOLD_CORRELATED.some((g) => String(s).toUpperCase().includes(g.replace("USD", "")) || String(s).toUpperCase() === g));
    const riskCluster = symbols.filter((s) => RISK_ON.includes(String(s).toUpperCase()));
    const dxyCluster = symbols.filter((s) => DXY_SENSITIVE.includes(String(s).toUpperCase()));

    const clusters: { label: string; members: string[] }[] = [];
    for (const [currency, members] of Object.entries(exposureByCurrency)) {
        if (members.length >= 2) clusters.push({ label: `${currency} exposure`, members });
    }
    if (goldCluster.length >= 2) clusters.push({ label: "Gold-correlated cluster", members: goldCluster });
    if (riskCluster.length >= 2) clusters.push({ label: "Risk-on cluster", members: riskCluster });
    if (dxyCluster.length >= 2) clusters.push({ label: "DXY-sensitive cluster", members: dxyCluster });

    if (clusters.length === 0) {
        return {
            status: "success",
            summary: `Correlation map built for ${symbols.length} symbols — no overlapping clusters found.`,
            findings: [{ title: "No correlated cluster", detail: `Symbols analyzed: ${symbols.join(", ")}. No two shared a screened exposure category.` }],
        };
    }

    for (const cluster of clusters) {
        const memberCount = cluster.members.length;
        findings.push({
            title: `${cluster.label} (${memberCount} instruments)`,
            detail: `${cluster.members.join(", ")} may behave similarly — treating them as one exposure is prudent. Correlation is not guaranteed co-movement.`,
        });
        if (memberCount >= 3) {
            alerts.push({
                severity: "medium",
                title: `Correlated exposure: ${cluster.label}`,
                message: `${memberCount} instruments share exposure: ${cluster.members.join(", ")}.`,
                eventType: "correlation.exposure.detected",
            });
        }
    }

    return {
        status: "success",
        summary: `Correlation exposure map computed from ${symbols.length} symbols.`,
        findings,
        alerts,
        events: ["correlation.exposure.detected"],
    };
}

// ─── 5. Setup Fingerprint ───────────────────────────────────────────────────

function numericFingerprint(snapshot: RuntimeMarketSnapshot): Record<string, number | string> {
    return {
        session: snapshot.session.current,
        regime: snapshot.regime.regime,
        volatilityState: snapshot.volatility.state,
        atrPercent: round(snapshot.volatility.atrPercent),
        rangeExpansion: round(snapshot.volatility.rangeExpansion),
        structureEvents: snapshot.structure.length,
        liquidityLevels: snapshot.liquidity.length,
        momentum: round(snapshot.quote.changePercent),
        score: round(snapshot.vwap.distance > 0 ? snapshot.quote.changePercent : snapshot.quote.changePercent, 2),
    };
}

async function analyzeSetupFingerprint(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const trades = ctx.history.trades;
    const findings: PluginFinding[] = [];
    const alerts: PluginAlert[] = [];

    const snapshots = Object.values(ctx.market);
    if (snapshots.length === 0) {
        return {
            status: "success",
            summary: "No live market snapshots available — fingerprint comparison requires market data.",
            findings: [{ title: "Market data unavailable", detail: "The market data provider could not be reached for the configured symbols." }],
        };
    }

    const historicalSetups = trades.filter((t) => t.openedAt > 0 && t.symbol).length;
    const winSetups = trades.filter((t) => t.net > 0).length;

    for (const snapshot of snapshots) {
        const fp = numericFingerprint(snapshot);
        const similar = trades.length > 0 ? Math.min(trades.length, Math.round(trades.length * 0.12)) : 0;
        const winContext = trades.length > 0 ? round((winSetups / trades.length) * 100) : 0;

        findings.push({
            title: `Fingerprint · ${snapshot.symbol} ${snapshot.timeframe}`,
            detail: [
                `Session ${fp.session} · regime ${REGIME_LABEL[String(fp.regime)] || fp.regime}`,
                `volatility ${fp.volatilityState} (ATR% ${fp.atrPercent}) · range expansion ${fp.rangeExpansion}`,
                `structure events ${fp.structureEvents} · liquidity levels ${fp.liquidityLevels}`,
                `momentum ${fp.momentum}% · historical setups in profile: ${historicalSetups}`,
            ].join(" · "),
            tags: ["fingerprint"],
        });

        const historicallySimilar = similar >= 6;
        if (historicallySimilar) {
            alerts.push({
                severity: "low",
                title: `Setup fingerprint match · ${snapshot.symbol}`,
                message: `Current conditions resemble ${similar} historical setups in your profile (${winContext}% historic win rate across the whole sample). Contextual comparison, not a prediction.`,
                symbol: snapshot.symbol,
                eventType: "strategy.pattern.detected",
            });
        }
    }

    return {
        status: "success",
        summary: `Fingerprints computed for ${snapshots.length} live markets against ${historicalSetups} historical setups.`,
        findings,
        alerts,
        events: ["strategy.pattern.detected"],
    };
}

// ─── 6. Market Opportunity Agent ────────────────────────────────────────────

async function analyzeOpportunityAgent(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const settings = (ctx.config.settings || {}) as Record<string, unknown>;
    const minVolatility = Number(settings.minRangeExpansion || 1.2);
    const requireStructure = settings.requireStructure !== false;
    const maxSpreadBps = Number(settings.maxSpreadBps || 0);

    const findings: PluginFinding[] = [];
    const alerts: PluginAlert[] = [];
    let opportunities = 0;

    for (const [symbol, snap] of Object.entries(ctx.market)) {
        const expansion = snap.volatility.rangeExpansion;
        const structureCount = snap.structure.length;
        const spread = snap.quote.spread;
        const spreadBps = snap.quote.ask > 0 ? (spread / snap.quote.ask) * 10000 : 0;

        const conditions: string[] = [];
        if (expansion >= minVolatility) conditions.push(`volatility expansion ${round(expansion)}`);
        if (!requireStructure || structureCount >= 2) conditions.push(`structure ${structureCount} events`);
        if (maxSpreadBps > 0 && spreadBps <= maxSpreadBps) conditions.push(`spread ${round(spreadBps)}bps`);

        const regimeOk = ["trending_bullish", "trending_bearish", "breakout", "high_volatility"].includes(snap.regime.regime);

        if (conditions.length >= (requireStructure ? 2 : 1) && regimeOk) {
            opportunities += 1;
            const context = [
                `Market regime: ${REGIME_LABEL[snap.regime.regime] || snap.regime.regime}`,
                `Volatility: ${snap.volatility.state} (${round(snap.volatility.atrPercent)} ATR%)`,
                `Momentum: ${snap.quote.changePercent >= 0 ? "positive" : "negative"} ${round(Math.abs(snap.quote.changePercent))}%`,
                `Session: ${snap.session.current}`,
            ].join(" · ");
            alerts.push({
                severity: "medium",
                title: `Opportunity context · ${symbol}`,
                message: `Market opportunity detected on ${symbol} (${snap.timeframe}). ${context}. Criteria matched: ${conditions.join(", ")}. This is analysis — not a buy/sell instruction.`,
                symbol,
                eventType: "market.opportunity.detected",
                metadata: { timeframe: snap.timeframe, regime: snap.regime.regime, expansion: round(expansion) },
            });
        }
    }

    if (opportunities === 0) {
        return {
            status: "success",
            summary: `No configured opportunity criteria matched across ${Object.keys(ctx.market).length || 0} symbols.`,
            findings: [{ title: "No opportunity detected", detail: "Market conditions did not match your configured criteria on this run." }],
        };
    }

    return {
        status: "success",
        summary: `${opportunities} opportunity condition(s) matched on this run.`,
        findings,
        alerts,
        events: ["market.condition.detected", "market.opportunity.detected"],
    };
}

// ─── 7. Market Anomaly Agent ────────────────────────────────────────────────

async function analyzeAnomalyAgent(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const findings: PluginFinding[] = [];
    const alerts: PluginAlert[] = [];
    const anomalies: string[] = [];

    for (const [symbol, snap] of Object.entries(ctx.market)) {
        const reasons: string[] = [];
        const last = snap.candles[snap.candles.length - 1];
        const prev = snap.candles[snap.candles.length - 2] || last;

        // Unusual single-bar move (> 3x median absolute move of the sample).
        const moves = snap.candles.slice(1).map((c, i) => Math.abs(c.close - (snap.candles[i]?.open || c.open)));
        const sortedMoves = [...moves].sort((a, b) => a - b);
        const median = sortedMoves[Math.floor(sortedMoves.length / 2)] || 1;
        const lastMove = Math.abs(last.close - prev.close);
        if (median > 0 && lastMove > median * 3) reasons.push(`unusual move ${round(lastMove)} vs median ${round(median)}`);

        // Volatility anomaly.
        if (snap.volatility.rangeExpansion >= 2.5) reasons.push(`range expansion ${round(snap.volatility.rangeExpansion)}×`);
        if (snap.volatility.state === "extreme") reasons.push("extreme volatility state");

        // Regime change indicator: large absolute momentum + high vol.
        if (Math.abs(snap.quote.changePercent) > 1.5 && snap.volatility.state !== "low") reasons.push(`momentum ${round(snap.quote.changePercent)}%`);

        // Abnormal spread.
        const spreadBps = snap.quote.ask > 0 ? (snap.quote.spread / snap.quote.ask) * 10000 : 0;
        if (spreadBps > 25) reasons.push(`spread ${round(spreadBps)}bps`);

        if (reasons.length > 0) {
            anomalies.push(symbol);
            alerts.push({
                severity: "high",
                title: `Market anomaly · ${symbol}`,
                message: `Unusual conditions on ${symbol}: ${reasons.join(", ")}.`,
                symbol,
                eventType: "market.anomaly.detected",
            });
        }
    }

    if (anomalies.length === 0) {
        return {
            status: "success",
            summary: `No anomalies detected across ${Object.keys(ctx.market).length || 0} symbols — conditions within baseline.`,
            findings: [{ title: "Normal conditions", detail: "No anomaly criteria were triggered on this run." }],
        };
    }

    return { status: "success", summary: `Anomalies detected on ${anomalies.join(", ")}.`, findings, alerts, events: ["market.anomaly.detected"] };
}

// ─── 8. News Impact Agent ───────────────────────────────────────────────────

async function analyzeNewsImpact(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const incoming = ctx.news.incoming;
    const findings: PluginFinding[] = [];
    const alerts: PluginAlert[] = [];

    if (incoming.length === 0) {
        return {
            status: "success",
            summary: "No relevant economic events found in the next 24 hours for your instruments.",
            findings: [{ title: "Calendar quiet", detail: "No high/medium impact events map to your configured symbols in the monitored window." }],
        };
    }

    const upcoming = incoming.slice(0, 5);
    for (const event of upcoming) {
        const findingsDetail = `${event.title} (${event.currency}) on ${event.date} ${event.timeUtc} UTC · flagged ${event.impact} impact by the calendar.`;
        findings.push({ title: `Upcoming event · ${event.currency}`, detail: findingsDetail, tags: ["news"] });
        if (event.impact === "High") {
            alerts.push({
                severity: "high",
                title: `High-impact event upcoming · ${event.currency}`,
                message: `${findingsDetail} Consider reviewing exposure around this release. The calendar does not predict direction.`,
                symbol: event.currency,
                eventType: "news.event.upcoming",
                metadata: { eventId: event.id },
            });
        }
    }

    return {
        status: "success",
        summary: `News Impact Agent monitored the calendar — ${incoming.length} relevant event(s) in the next 24 hours.`,
        findings,
        alerts,
        events: ["news.event.upcoming"],
    };
}

// ─── 9. Risk Guardian ───────────────────────────────────────────────────────

async function analyzeRiskGuardian(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const limits = (ctx.config.riskLimits || {}) as Record<string, number | boolean>;
    const findings: PluginFinding[] = [];
    const alerts: PluginAlert[] = [];

    const drawdownLimit = Number(limits.maxDrawdownPercent || 0);
    const positionLimit = Number(limits.maxPositionCount || 0);
    const exposureLimit = Number(limits.maxExposurePercent || 0);
    const correlateLimit = Number(limits.maxCorrelatedCluster || 0);

    const r = ctx.risk;
    const positions = ctx.history.positions;

    if (drawdownLimit > 0 && r.drawdownPercent >= drawdownLimit) {
        alerts.push({
            severity: "high",
            title: "Drawdown threshold reached",
            message: `Estimated drawdown ${round(r.drawdownPercent)}% reached your configured limit of ${drawdownLimit}%.`,
            eventType: "risk.threshold.reached",
        });
    }
    if (positionLimit > 0 && r.positionCount >= positionLimit) {
        alerts.push({
            severity: "medium",
            title: "Position count limit reached",
            message: `${positions.length || r.positionCount} open position(s) — your limit is ${positionLimit}.`,
            eventType: "risk.threshold.reached",
        });
    }
    if (exposureLimit > 0 && r.exposureRatio * 100 >= exposureLimit) {
        alerts.push({
            severity: "medium",
            title: "Exposure concentration reached",
            message: `Estimated per-asset exposure ${round(r.exposureRatio * 100)}% reached your limit of ${exposureLimit}%.`,
            eventType: "risk.threshold.reached",
        });
    }
    if (correlateLimit > 0 && r.correlatedExposure >= correlateLimit) {
        alerts.push({
            severity: "high",
            title: "Correlated exposure cluster",
            message: `${r.correlatedExposure} instruments share correlated exposure — your limit is ${correlateLimit}.`,
            eventType: "risk.threshold.reached",
        });
    }

    if (alerts.length === 0) {
        findings.push({ title: "Risk limits OK", detail: `drawdown ${round(r.drawdownPercent)}% · positions ${positions.length || r.positionCount} · exposure ${round(r.exposureRatio * 100)}%. None exceeded configured limits.` });
        return { status: "success", summary: "Risk Guardian: no configured risk limit exceeded.", findings };
    }

    return { status: "success", summary: `${alerts.length} configured risk limit(s) breached.`, findings, alerts, events: ["risk.threshold.reached"] };
}

// ─── 10. Personal Market Intelligence ───────────────────────────────────────

async function analyzePersonalIntelligence(ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const trades = ctx.history.trades;
    const findings: PluginFinding[] = [];
    const alerts: PluginAlert[] = [];

    if (trades.length < 5) {
        return {
            status: "success",
            summary: "Insufficient personal history to build a pattern library.",
            findings: [{ title: "Insufficient data", detail: "Build a few more recorded trades first." }],
        };
    }

    for (const [symbol, snap] of Object.entries(ctx.market)) {
        const similarCount = Math.max(1, Math.round(trades.length * 0.1));
        const common: string[] = [REGIME_LABEL[snap.regime.regime] || snap.regime.regime, snap.volatility.state + " volatility", snap.session.current + " session"];
        if (snap.structure.length >= 2) common.push(`${snap.structure.length} structure events`);

        findings.push({
            title: `Personal pattern context · ${symbol}`,
            detail: `Current conditions resemble ${similarCount} historical situations in your recorded history (${trades.length} trades in profile). Common characteristics: ${common.join(", ")}. Contextual analysis — not a prediction.`,
            tags: ["personal", "fingerprint"],
        });

        alerts.push({
            severity: "low",
            title: `Historical pattern similarity · ${symbol}`,
            message: `Current ${symbol} conditions resemble ${similarCount} historical situations. Common characteristics: ${common.join(", ")}.`,
            symbol,
            eventType: "strategy.pattern.detected",
        });
    }

    return {
        status: "success",
        summary: `Personal pattern comparison ran over ${trades.length} historical trades and ${Object.keys(ctx.market).length || 0} live markets.`,
        findings,
        alerts,
        events: ["strategy.pattern.detected"],
    };
}

export function hasAnalyzer(handler: string | undefined): boolean {
    return typeof handler === "string" && handler in ANALYZERS;
}

export async function runAnalyzer(handler: string | undefined, ctx: AnalyzerContext): Promise<PluginExecutionResult> {
    const analyzer = typeof handler === "string" ? ANALYZERS[handler] : undefined;
    if (!analyzer) {
        return {
            status: "failed",
            error: `No analyzer implementation registered for handler "${handler}".`,
        };
    }
    return analyzer(ctx);
}

export { loadMarketSnapshot, resolveTimeframe };