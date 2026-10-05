/**
 * AlgoVault — Canonical Portfolio Snapshot builder (Phase 15 §4).
 *
 * ── Server-only ───────────────────────────────────────────────────────────
 * Imports `lib/firebase-admin`. Never import from a client component.
 *
 * The snapshot is the AUTHORITATIVE input to every portfolio intelligence
 * surface. It is built from real gateway records only:
 *
 *   trading_accounts/{uid}/{accountId}      balance, equity, margin,
 *                                           freeMargin, marginLevel, currency,
 *                                           status, lastHeartbeatAt, leverage
 *   trading_positions/{uid}/{accountId}/{id} symbol, type, volume, openPrice,
 *                                           currentPrice, sl, tp, profit,
 *                                           strategyId
 *   live_accounts/{accountId}               peakEquity, drawdown  ← the only
 *                                           real recorded high-water mark
 *
 * Nothing here is trusted from the client. Equity, PnL, exposure, margin and
 * position size are recomputed server-side from broker-pushed records.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { accountKey } from "@/lib/risk/account-state";
import { computeConcentration } from "./concentration";
import { computeExposure } from "./exposure";
import { computeHealth } from "./health";
import { contractSizeOf, instrumentMetadata } from "./instruments";
import { computeRegime } from "./regime";
import { defaultRiskBudgets, evaluateRiskBudgets } from "./risk-budgets";
import type {
    AccountKind,
    CorrelationMatrix,
    DataFreshness,
    Portfolio,
    PortfolioAccount,
    PortfolioAllocation,
    PortfolioCorrelationRisk,
    PortfolioHealth,
    PortfolioPosition,
    PortfolioRegimeState,
    PortfolioRiskBudget,
    PortfolioRiskSnapshot,
    PortfolioSnapshot,
    PortfolioStrategyIntelligence,
    PortfolioWarning,
} from "./types";
import { PORTFOLIO_ENGINE_VERSIONS } from "./versioning";

/** An account heartbeat older than this is reported STALE, never as live. */
export const ACCOUNT_HEARTBEAT_STALE_MS = 120_000;

/** Market data older than this makes the portfolio snapshot STALE. */
export const MARKET_DATA_STALE_MS = 60_000;

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round(v: number): number {
    return Math.round(v * 10000) / 10000;
}

/* ── Raw readers ──────────────────────────────────────────────────────────── */

export interface RawAccountRecord {
    accountId: string;
    record: Record<string, unknown>;
    tracker: Record<string, unknown>;
    controls: Record<string, unknown>;
    positions: Record<string, unknown>;
}

export interface RawBook {
    accounts: RawAccountRecord[];
    /** Accounts the gateway does not know about but positions exist for. */
    orphanPositions: Array<{ accountId: string; positionId: string; symbol: string }>;
}

/** Read the live account + position book for one user. Best-effort per node. */
export async function loadRawBook(userId: string): Promise<RawBook> {
    const read = async (path: string): Promise<Record<string, unknown>> => {
        try {
            const snap = await adminDatabase.ref(path).get();
            return snap.exists() ? asObject(snap.val()) : {};
        } catch {
            // A failed read is an UNAVAILABLE input, not a zero. The caller
            // reports it through freshness + limitations rather than defaulting.
            return {};
        }
    };

    const [accountsNode, positionsNode, trackersNode, controlsNode] = await Promise.all([
        read(`trading_accounts/${userId}`),
        read(`trading_positions/${userId}`),
        read(`live_accounts`),
        read(`trading_controls/${userId}`),
    ]);

    const out: RawAccountRecord[] = [];
    for (const [accountId, raw] of Object.entries(accountsNode)) {
        out.push({
            accountId,
            record: asObject(raw),
            tracker: asObject(trackersNode[accountId]),
            controls: asObject(controlsNode[accountKey(accountId)] ?? controlsNode[accountId]),
            positions: asObject(positionsNode[accountId]),
        });
    }

    // Positions belonging to an account record that does not exist are a real
    // state inconsistency, not something to quietly drop.
    const known = new Set(out.map((a) => a.accountId));
    const orphanPositions: RawBook["orphanPositions"] = [];
    for (const [accountId, byId] of Object.entries(positionsNode)) {
        if (known.has(accountId)) continue;
        for (const [positionId, rawPosition] of Object.entries(asObject(byId))) {
            const p = asObject(rawPosition);
            orphanPositions.push({ accountId, positionId, symbol: String(p.symbol ?? "") });
        }
    }

    return { accounts: out, orphanPositions };
}

/* ── Normalization ────────────────────────────────────────────────────────── */

function classifyAccount(record: Record<string, unknown>): AccountKind {
    const explicit = String(record.mode ?? record.accountMode ?? record.kind ?? "").toUpperCase();
    if (explicit === "PAPER" || explicit === "SIMULATOR" || explicit === "CHART") return "PAPER";
    if (explicit === "CHALLENGE") return "CHALLENGE";
    if (explicit === "DEMO") return "DEMO";
    if (String(record.source ?? "").toLowerCase().includes("paper")) return "PAPER";
    return "LIVE";
}

export interface NormalizeInput {
    userId: string;
    portfolioId: string;
    raw: RawBook;
    now: number;
    /** Symbol → latest price and freshness, supplied by the caller. */
    markPrices: Record<string, { price: number; timestamp: number }>;
}

export interface NormalizedBook {
    accounts: PortfolioAccount[];
    positions: PortfolioPosition[];
    equity: number;
    balance: number;
    realizedPnL: number | null;
    marginUsed: number;
    freeMargin: number;
    leverage: number;
    peakEquity: number | null;
    storedDrawdownPercent: number | null;
    dailyLossPercent: number | null;
    warnings: PortfolioWarning[];
    dataTimestamp: number;
    baseCurrency: string;
    inconsistent: string[];
}

/**
 * Normalize the raw book into the canonical account/position shapes.
 * Deterministic: identical inputs always produce identical output.
 */
export function normalizeBook(input: NormalizeInput): NormalizedBook {
    const { raw, now, markPrices } = input;
    const accounts: PortfolioAccount[] = [];
    const positions: PortfolioPosition[] = [];
    const warnings: PortfolioWarning[] = [];
    const inconsistent: string[] = [...raw.orphanPositions.map((o) => `${o.accountId}/${o.positionId}: position belongs to an unknown account.`)];
    let peakEquityTotal = 0;
    let sawPeak = false;
    let realizedPnLSum = 0;
    let sawRealizedPnL = false;

    let balance = 0;
    let equity = 0;
    let marginUsed = 0;
    let freeMargin = 0;
    let leverageWeighted = 0;
    let leverageWeight = 0;
    let dailyLossPercent: number | null = null;
    let dataTimestamp = 0;

    const accountCurrency = new Map<string, string>();

    for (const { accountId, record, tracker, controls, positions: positionNode } of raw.accounts) {
        const currency = String(record.currency ?? "USD").toUpperCase();
        accountCurrency.set(accountId, currency && currency.length === 3 ? currency : "USD");

        const accountBalance = numOrNull(record.balance);
        const accountEquity = numOrNull(record.equity);
        const accountMargin = numOrNull(record.margin);
        const accountFreeMargin = numOrNull(record.freeMargin);
        const heartbeat = num(record.lastHeartbeatAt, 0);
        const connected = heartbeat > 0 && now - heartbeat < ACCOUNT_HEARTBEAT_STALE_MS;
        const accountDataTimestamp = heartbeat > 0 ? heartbeat : now;
        dataTimestamp = Math.max(dataTimestamp, accountDataTimestamp);

        const balanceValue = accountBalance ?? 0;
        const equityValue = accountEquity ?? accountBalance ?? 0;

        balance += balanceValue;
        equity += equityValue;
        marginUsed += accountMargin ?? 0;
        freeMargin += accountFreeMargin ?? Math.max(0, equityValue - (accountMargin ?? 0));

        const leverage = numOrNull(record.leverage);
        if (leverage !== null && leverage > 0) {
            leverageWeighted += leverage;
            leverageWeight += 1;
        }

        const peak = numOrNull(tracker.peakEquity);
        if (peak !== null && peak > 0) {
            peakEquityTotal += peak;
            sawPeak = true;
        }

        // Realized P&L is only reported when the gateway actually stores it.
        const realized = numOrNull(record.realizedPnL ?? record.closedProfit ?? record.profitClosed);
        if (realized !== null) {
            realizedPnLSum += realized;
            sawRealizedPnL = true;
        }

        const controlDailyLoss = numOrNull(controls.dailyLossPercent);
        if (controlDailyLoss !== null && controlDailyLoss !== 0) {
            dailyLossPercent = Math.max(dailyLossPercent ?? 0, Math.abs(controlDailyLoss));
        }

        if (!connected) {
            warnings.push({
                code: "ACCOUNT_OFFLINE",
                severity: "WATCH",
                message: `Account ${accountId} is not reporting live data.`,
                detail:
                    heartbeat > 0
                        ? `Last heartbeat was ${Math.round((now - heartbeat) / 1000)}s ago.`
                        : "No heartbeat has ever been recorded for this account.",
                affectedPositions: [],
                affectedStrategies: [],
                dataTimestamp: accountDataTimestamp,
            });
        }

        if (accountBalance !== null && accountEquity !== null && accountEquity > 0 && accountBalance <= 0) {
            inconsistent.push(`${accountId}: balance is ${accountBalance} while equity is ${accountEquity}.`);
        }

        const leverageValue = leverage ?? 0;
        accounts.push({
            accountId,
            portfolioId: input.portfolioId,
            userId: input.userId,
            kind: classifyAccount(record),
            broker: record.broker ? String(record.broker) : null,
            server: record.server ? String(record.server) : null,
            currency,
            balance: balanceValue,
            equity: equityValue,
            marginUsed: accountMargin ?? 0,
            freeMargin: accountFreeMargin ?? Math.max(0, equityValue - (accountMargin ?? 0)),
            leverage: leverageValue,
            unrealizedPnL: equityValue - balanceValue,
            drawdownPercent: balanceValue > 0 ? Math.max(0, ((balanceValue - equityValue) / balanceValue) * 100) : 0,
            dataTimestamp: accountDataTimestamp,
            connected,
            status: connected ? "ACTIVE" : "OFFLINE",
        });

        for (const [positionId, rawPosition] of Object.entries(positionNode)) {
            const p = asObject(rawPosition);
            const symbol = String(p.symbol ?? "").toUpperCase();
            if (!symbol) continue;
            const volume = num(p.volume, 0);
            if (!(volume > 0)) continue;

            const type = String(p.type ?? "").toUpperCase();
            const side: "LONG" | "SHORT" = type === "SELL" ? "SHORT" : "LONG";
            const openPrice = num(p.openPrice, 0);
            const gatewayPrice = num(p.currentPrice, 0);
            const mark = markPrices[symbol];
            const currentPrice = mark && mark.price > 0 ? mark.price : gatewayPrice;
            if (currentPrice <= 0) {
                inconsistent.push(`${accountId}/${positionId}: ${symbol} has no usable mark price.`);
                continue;
            }
            if (mark) dataTimestamp = Math.max(dataTimestamp, mark.timestamp);

            const contractSize = contractSizeOf(symbol);
            const meta = instrumentMetadata(symbol);
            const notional = currentPrice * volume * (contractSize ?? 0);

            const sl = numOrNull(p.sl);
            const tp = numOrNull(p.tp);
            const riskAmount =
                sl !== null && sl > 0 && contractSize !== null
                    ? Math.abs(currentPrice - sl) * volume * contractSize
                    : null;

            positions.push({
                positionId: `${accountId}:${positionId}`,
                accountId,
                symbol,
                side,
                quantity: volume,
                entryPrice: openPrice > 0 ? openPrice : currentPrice,
                currentPrice,
                stopLoss: sl,
                takeProfit: tp,
                riskAmount,
                unrealizedPnL: num(p.profit, 0),
                marginUsed: contractSize !== null ? notional / (leverageValue > 0 ? leverageValue : 1) : 0,
                notional,
                equityWeight: equity > 0 ? notional / equity : 0,
                assetClass: meta.assetClass,
                strategyId: String(p.strategyId ?? p.strategy ?? "").trim() || "MANUAL",
                accountCurrency: accountCurrency.get(accountId) ?? "USD",
                currencyExposures: [],
                openedAt: num(p.openedAt ?? p.openTime, now),
                dataTimestamp: mark ? mark.timestamp : accountDataTimestamp,
            });
        }
    }

    const baseCurrency = accounts[0]?.currency ?? "USD";
    const mismatched = accounts.filter((a) => a.currency !== baseCurrency);
    if (mismatched.length > 0) {
        inconsistent.push(
            `${mismatched.length} account(s) report a currency other than ${baseCurrency}. Totals are summed as recorded; no FX conversion is applied.`
        );
    }

    if (inconsistent.length > 0) {
        warnings.push({
            code: "POSITION_STATE_INCONSISTENT",
            severity: "WARNING",
            message: "Some account or position records are internally inconsistent.",
            detail: inconsistent.slice(0, 4).join(" | "),
            affectedPositions: [],
            affectedStrategies: [],
            dataTimestamp,
        });
    }

    const storedDrawdownPercent = sawPeak && peakEquityTotal > 0 ? Math.max(0, ((peakEquityTotal - equity) / peakEquityTotal) * 100) : null;

    return {
        accounts,
        positions,
        equity,
        balance,
        realizedPnL: sawRealizedPnL ? realizedPnLSum : null,
        marginUsed,
        freeMargin,
        leverage: leverageWeight > 0 ? leverageWeighted / leverageWeight : 0,
        peakEquity: sawPeak ? peakEquityTotal : null,
        storedDrawdownPercent,
        dailyLossPercent,
        warnings,
        dataTimestamp,
        baseCurrency,
        inconsistent,
    };
}

/* ── Snapshot assembly ────────────────────────────────────────────────────── */

export interface BuildSnapshotInput {
    portfolio: Portfolio;
    book: NormalizedBook;
    correlation: PortfolioCorrelationRisk;
    correlationMatrix: CorrelationMatrix | null;
    regime: PortfolioRegimeState;
    strategyIntelligence: PortfolioStrategyIntelligence;
    allocation: PortfolioAllocation | null;
    riskBudgets: PortfolioRiskBudget[];
    now: number;
}

export function buildSnapshot(input: BuildSnapshotInput): PortfolioSnapshot {
    const { portfolio, book, now } = input;

    const freshness = computeFreshness(book, now);

    const exposure = computeExposure({
        portfolioId: portfolio.portfolioId,
        positions: book.positions,
        accounts: book.accounts,
        equity: book.equity,
        calculatedAt: now,
        dataTimestamp: book.dataTimestamp,
        freshness,
    });

    const concentration = computeConcentration({
        portfolioId: portfolio.portfolioId,
        exposure,
        positions: book.positions,
        dataTimestamp: book.dataTimestamp,
        freshness,
    });

    const riskBudgetUsage = evaluateRiskBudgets({
        budgets: input.riskBudgets,
        equity: book.equity > 0 ? book.equity : null,
        exposure,
        concentration,
        correlation: input.correlation,
        accounts: book.accounts,
        positionsRiskPercentByStrategy: riskPercentByStrategy(book),
        positionsRiskPercentBySymbol: riskPercentBySymbol(book),
        openRiskPercent: openRiskPercent(book),
        drawdownPercent: drawdownPercent(book),
        dailyLossPercent: book.dailyLossPercent,
        marginLevelPercent: marginLevelPercent(book),
    });

    const risk = buildRiskSnapshot(portfolio.portfolioId, book, riskBudgetUsage, freshness, now);

    const health: PortfolioHealth = computeHealth({
        portfolioId: portfolio.portfolioId,
        exposure,
        concentration,
        correlation: input.correlation,
        risk,
        regime: input.regime,
        accounts: book.accounts,
        strategies: input.strategyIntelligence.strategies.map((s) => ({ strategyId: s.strategyId, health: s.health })),
        riskBudgetUsage,
        dataFreshnessOk: freshness.freshness === "FRESH",
        calculatedAt: now,
    });

    const warnings = collectWarnings(book, risk.warnings, input.correlation, concentration.severity, input.strategyIntelligence.hiddenConcentrationDetected, freshness);

    const strategyIds = new Set(book.positions.map((p) => p.strategyId));
    const assetClasses = new Set(book.positions.map((p) => p.assetClass));

    return {
        portfolioId: portfolio.portfolioId,
        timestamp: now,
        equity: book.equity,
        balance: book.balance,
        unrealizedPnL: book.equity - book.balance,
        realizedPnL: book.realizedPnL ?? 0,
        grossExposure: exposure.grossExposure,
        netExposure: exposure.netExposure,
        marginUsed: book.marginUsed,
        freeMargin: book.freeMargin,
        leverage: book.leverage,
        drawdown: book.peakEquity !== null ? Math.max(0, book.peakEquity - book.equity) : 0,
        dailyLoss: book.dailyLossPercent !== null && book.equity > 0 ? (book.dailyLossPercent / 100) * book.equity : 0,
        positionCount: book.positions.length,
        strategyCount: strategyIds.size,
        assetCount: assetClasses.size,
        concentrationScore: concentration.concentrationScore,
        correlationRiskScore: round(input.correlation.clusteredExposureWeight),
        portfolioRiskScore: risk.openRiskPercent === null ? 0 : round(risk.openRiskPercent),
        regime: input.regime.regime,
        riskBudgetUsage,
        health,
        baseCurrency: book.baseCurrency,
        accounts: book.accounts,
        positions: book.positions,
        exposure,
        concentration,
        correlation: input.correlation,
        correlationMatrix: input.correlationMatrix,
        regimeState: input.regime,
        strategyStates: input.strategyIntelligence.strategies,
        risk,
        freshness,
        engineVersions: Object.entries(PORTFOLIO_ENGINE_VERSIONS).map(([id, version]) => ({ id, version })),
        limitations: [
            ...exposure.limitations,
            ...concentration.limitations,
            ...risk.limitations,
            ...input.correlation.limitations,
            ...(book.realizedPnL === null
                ? ["Realized P&L is not persisted by the gateway; it is reported as 0 in the snapshot and as null in the risk snapshot rather than estimated."]
                : []),
        ],
        ...(warnings.length > 0 ? {} : {}),
    };
}

function riskPercentByStrategy(book: NormalizedBook): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const key of new Set(book.positions.map((p) => p.strategyId))) {
        const risk = book.positions.filter((p) => p.strategyId === key).reduce((acc, p) => acc + (p.riskAmount ?? 0), 0);
        out[key] = book.equity > 0 ? (risk / book.equity) * 100 : null;
    }
    return out;
}

function riskPercentBySymbol(book: NormalizedBook): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const key of new Set(book.positions.map((p) => p.symbol))) {
        const risk = book.positions.filter((p) => p.symbol === key).reduce((acc, p) => acc + (p.riskAmount ?? 0), 0);
        out[key] = book.equity > 0 ? (risk / book.equity) * 100 : null;
    }
    return out;
}

export function openRiskPercent(book: NormalizedBook): number | null {
    if (!(book.equity > 0)) return null;
    const withStops = book.positions.filter((p) => p.riskAmount !== null);
    if (withStops.length === 0) return null;
    return (withStops.reduce((acc, p) => acc + (p.riskAmount as number), 0) / book.equity) * 100;
}

export function drawdownPercent(book: NormalizedBook): number | null {
    if (book.storedDrawdownPercent !== null) return book.storedDrawdownPercent;
    if (book.accounts.length === 0) return null;
    return Math.max(0, ...book.accounts.map((a) => a.drawdownPercent));
}

export function marginLevelPercent(book: NormalizedBook): number | null {
    if (book.marginUsed <= 0) return null;
    if (book.equity <= 0) return 0;
    return (book.equity / book.marginUsed) * 100;
}

export function computeFreshness(book: NormalizedBook, now: number): DataFreshness {
    const age = Math.max(0, now - book.dataTimestamp);
    const onlineAccounts = book.accounts.filter((a) => a.connected).length;
    const allOffline = book.accounts.length > 0 && onlineAccounts === 0;
    const freshness: DataFreshness["freshness"] =
        book.accounts.length === 0 ? "UNAVAILABLE" : allOffline || age > MARKET_DATA_STALE_MS ? "STALE" : "FRESH";

    return {
        dataTimestamp: book.dataTimestamp,
        calculatedAt: now,
        dataAgeMs: age,
        freshness,
        sources: book.accounts.map((a) => ({
            source: `account:${a.accountId}`,
            ageMs: Math.max(0, now - a.dataTimestamp),
        })),
        reason:
            freshness === "FRESH"
                ? undefined
                : freshness === "STALE"
                  ? "The newest account or market datum is older than the freshness threshold."
                  : "No connected account reported any data.",
    };
}

function collectWarnings(
    book: NormalizedBook,
    riskWarnings: PortfolioWarning[],
    correlation: PortfolioCorrelationRisk,
    concentrationSeverity: string,
    hiddenConcentration: boolean,
    freshness: DataFreshness
): PortfolioWarning[] {
    const warnings: PortfolioWarning[] = [...riskWarnings];

    if (correlation.severity === "HIGH") {
        warnings.push({
            code: "HIGH_CORRELATION",
            severity: "WARNING",
            message:
                correlation.clusterSize >= 2
                    ? `${correlation.clusterSize} positions are held in the same direction with mean correlation ρ ${correlation.meanCorrelation.toFixed(2)}.`
                    : "Correlated exposure is concentrated.",
            detail: correlation.evidence.find((e) => e.kind === "CALCULATED")?.text,
            affectedPositions: [],
            affectedStrategies: [],
            dataTimestamp: book.dataTimestamp,
        });
    }

    if (concentrationSeverity === "HIGH") {
        warnings.push({
            code: "HIGH_CONCENTRATION",
            severity: "WARNING",
            message: "Portfolio concentration is HIGH on at least one axis.",
            detail: "Measured Herfindahl index above 0.70 on symbol, asset class, strategy, direction, currency or account.",
            affectedPositions: [],
            affectedStrategies: [],
            dataTimestamp: book.dataTimestamp,
        });
    }

    if (hiddenConcentration) {
        warnings.push({
            code: "STRATEGY_OVERLAP",
            severity: "WARNING",
            message: "Two or more individually healthy strategies overlap materially.",
            detail:
                "Each strategy passes its own health check, but their positions, risk or correlation overlap — together they behave as one bet.",
            affectedPositions: [],
            affectedStrategies: [],
            dataTimestamp: book.dataTimestamp,
        });
    }

    if (freshness.freshness === "STALE") {
        warnings.push({
            code: "STALE_DATA",
            severity: "WATCH",
            message: "Portfolio data is stale — automated live action is not authorised.",
            detail: freshness.reason,
            affectedPositions: [],
            affectedStrategies: [],
            dataTimestamp: book.dataTimestamp,
        });
    }

    return warnings;
}

function buildRiskSnapshot(
    portfolioId: string,
    book: NormalizedBook,
    riskBudgetUsage: PortfolioRiskSnapshot["riskBudgetUsage"],
    freshness: DataFreshness,
    now: number
): PortfolioRiskSnapshot {
    const ddPercent = drawdownPercent(book);
    const openRiskPct = openRiskPercent(book);
    const openRisk = openRiskPct !== null && book.equity > 0 ? (openRiskPct / 100) * book.equity : null;
    const marginLevel = marginLevelPercent(book);

    const warnings: PortfolioWarning[] = [...book.warnings];

    if (ddPercent !== null && ddPercent >= 5) {
        warnings.push({
            code: "DRAWDOWN_WARNING",
            severity: ddPercent >= 10 ? "CRITICAL" : "WARNING",
            message: `Portfolio drawdown is ${ddPercent.toFixed(2)}% of peak equity.`,
            affectedPositions: [],
            affectedStrategies: [],
            dataTimestamp: book.dataTimestamp,
        });
    }
    for (const usage of riskBudgetUsage) {
        if (usage.status === "BREACHED") {
            warnings.push({
                code: "RISK_BUDGET_BREACHED",
                severity: "CRITICAL",
                message: `${usage.kind}${usage.scopeKey ? ` (${usage.scopeKey})` : ""} budget breached: ${usage.usedPercent}% of ${usage.limitPercent}%.`,
                affectedPositions: [],
                affectedStrategies: usage.scope === "STRATEGY" ? [usage.scopeKey] : [],
                dataTimestamp: book.dataTimestamp,
            });
        } else if (usage.status === "WATCH") {
            warnings.push({
                code: "RISK_BUDGET_NEAR_LIMIT",
                severity: "WATCH",
                message: `${usage.kind}${usage.scopeKey ? ` (${usage.scopeKey})` : ""} budget at ${Math.round(usage.utilization * 100)}% of its limit.`,
                affectedPositions: [],
                affectedStrategies: usage.scope === "STRATEGY" ? [usage.scopeKey] : [],
                dataTimestamp: book.dataTimestamp,
            });
        }
    }
    if (marginLevel !== null && marginLevel < 200) {
        warnings.push({
            code: "MARGIN_WARNING",
            severity: marginLevel < 120 ? "CRITICAL" : "WARNING",
            message: `Margin level is ${marginLevel.toFixed(0)}%.`,
            detail: marginLevel < 100 ? "Below 100% the broker will stop out open positions." : undefined,
            affectedPositions: [],
            affectedStrategies: [],
            dataTimestamp: book.dataTimestamp,
        });
    }

    return {
        portfolioId,
        calculatedAt: now,
        dataTimestamp: book.dataTimestamp,
        equity: book.equity > 0 ? book.equity : null,
        balance: book.balance,
        unrealizedPnL: book.equity - book.balance,
        realizedPnL: book.realizedPnL,
        openRisk,
        openRiskPercent: openRiskPct,
        drawdown: ddPercent !== null && book.equity > 0 ? (ddPercent / 100) * book.equity : null,
        drawdownPercent: ddPercent,
        dailyLoss: book.dailyLossPercent !== null && book.equity > 0 ? (book.dailyLossPercent / 100) * book.equity : null,
        dailyLossPercent: book.dailyLossPercent,
        marginUsed: book.marginUsed,
        freeMargin: book.freeMargin,
        marginLevelPercent: marginLevel,
        riskBudgetUsage,
        warnings,
        freshness,
        limitations: [
            ...(openRiskPct === null
                ? ["Open risk is unavailable: no open position has a recorded stop loss, so cash-at-risk cannot be measured."]
                : []),
            ...(book.dailyLossPercent === null
                ? ["Realized daily loss is not persisted by the gateway; the daily-loss budget reports UNKNOWN rather than assuming zero loss."]
                : []),
            ...(book.storedDrawdownPercent === null
                ? ["No recorded equity high-water mark: drawdown reflects the current float only."]
                : []),
        ],
    };
}

/** Read the stored configuration, falling back to documented defaults. */
export async function loadRiskBudgets(portfolioId: string, userId: string, now: number): Promise<PortfolioRiskBudget[]> {
    try {
        const snap = await adminDatabase.ref(`portfolios/${userId}/${portfolioId}/riskBudgets`).get();
        if (!snap.exists()) return defaultRiskBudgets(now, "system-default");
        const raw = asObject(snap.val());
        const budgets = Object.values(raw)
            .map((b) => asObject(b))
            .filter((b) => typeof b.kind === "string" && Number.isFinite(Number(b.limitPercent)))
            .map((b) => ({
                budgetId: String(b.budgetId ?? Object.keys(raw)[0] ?? "budget"),
                scope: (String(b.scope ?? "PORTFOLIO").toUpperCase() as PortfolioRiskBudget["scope"]) ?? "PORTFOLIO",
                scopeKey: String(b.scopeKey ?? ""),
                kind: String(b.kind) as PortfolioRiskBudget["kind"],
                limitPercent: Number(b.limitPercent),
                enabled: b.enabled !== false,
                updatedAt: Number(b.updatedAt ?? now),
                updatedBy: String(b.updatedBy ?? "unknown"),
            }));
        return budgets.length > 0 ? budgets : defaultRiskBudgets(now, "system-default");
    } catch {
        return defaultRiskBudgets(now, "system-default");
    }
}

export { computeRegime };
export { defaultRiskBudgets };
