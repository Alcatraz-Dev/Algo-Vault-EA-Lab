/**
 * Canonical account / portfolio state (Phase 4).
 *
 * Balance · Equity · Available/Used margin · Unrealized/Realized P&L ·
 * Exposure · Drawdown · Daily P&L — identical computation for backtest,
 * replay, paper and (later) live. Paper accounts are ISOLATED objects: a
 * paper balance is never mixed with a live balance.
 */

import type { AccountState, ExecutionEnvironment, PortfolioSnapshot, Position } from "./types";

export interface CreateAccountInput {
    id: string;
    environment: ExecutionEnvironment;
    balance: number;
    now: number;
    /** Paper only: extra capital added for simulation. */
    deposit?: number;
}

export function createAccount(input: CreateAccountInput): AccountState {
    const balance = input.balance + (input.deposit ?? 0);
    return {
        id: input.id,
        environment: input.environment,
        balance,
        equity: balance,
        peakEquity: balance,
        availableMargin: balance,
        usedMargin: 0,
        unrealizedPnL: 0,
        realizedPnL: 0,
        exposure: 0,
        dailyPnL: 0,
        dailyPnLDate: dayKey(input.now),
        drawdownAbs: 0,
        drawdownPct: 0,
        consecutiveLosses: 0,
        halted: false,
        initialBalance: balance,
        deposits: input.deposit ?? 0,
        withdrawals: 0,
        createdAt: input.now,
        updatedAt: input.now,
    };
}

export function dayKey(timestamp: number): string {
    return new Date(timestamp).toISOString().split("T")[0];
}

/** Reset the daily P&L bucket when the trading day rolls over. */
export function rollDay(account: AccountState, now: number): AccountState {
    const key = dayKey(now);
    if (key === account.dailyPnLDate) return account;
    return { ...account, dailyPnLDate: key, dailyPnL: 0 };
}

/** Apply a realized P&L (trade closed) to the account. */
export function applyRealized(account: AccountState, pnl: number, now: number): AccountState {
    const next = { ...account };
    next.balance = round2(next.balance + pnl);
    next.realizedPnL = round2(next.realizedPnL + pnl);
    next.dailyPnL = round2(next.dailyPnL + pnl);
    if (pnl < 0) next.consecutiveLosses += 1;
    else if (pnl > 0) next.consecutiveLosses = 0;
    next.updatedAt = now;
    return next;
}

export interface MarkInput {
    positions: Position[];
    /** Mark price per symbol (open positions only). */
    priceOf: (symbol: string, side: "LONG" | "SHORT") => number;
    contractSizes: Record<string, number>;
}

/** Mark-to-market: equity, drawdown, exposure, margin. */
export function markAccount(account: AccountState, input: MarkInput, now: number): AccountState {
    const next = { ...account };
    let unrealized = 0;
    let exposure = 0;
    let usedMargin = 0;

    for (const pos of input.positions) {
        if (pos.status !== "open") continue;
        const price = input.priceOf(pos.symbol, pos.side);
        const move = pos.side === "LONG" ? price - pos.entryPrice : pos.entryPrice - price;
        const contract = input.contractSizes[pos.symbol] ?? 100;
        unrealized += move * pos.remainingQuantity * contract;
        exposure += price * pos.remainingQuantity * contract;
        usedMargin += price * pos.remainingQuantity * contract; // 1:1 margin assumption (documented)
    }

    next.unrealizedPnL = round2(unrealized);
    next.equity = round2(next.balance + unrealized);
    next.exposure = round2(exposure);
    next.usedMargin = round2(usedMargin);
    next.availableMargin = round2(Math.max(0, next.equity - next.usedMargin));
    next.peakEquity = Math.max(next.peakEquity, next.equity);
    next.drawdownAbs = round2(Math.max(0, next.peakEquity - next.equity));
    next.drawdownPct = next.peakEquity > 0 ? Number(((next.drawdownAbs / next.peakEquity) * 100).toFixed(2)) : 0;
    next.updatedAt = now;
    return next;
}

export function haltAccount(account: AccountState, reason: string, now: number): AccountState {
    return { ...account, halted: true, haltReason: reason, updatedAt: now };
}

export function resumeAccount(account: AccountState, now: number): AccountState {
    return { ...account, halted: false, haltReason: undefined, updatedAt: now };
}

/** Isolated paper deposit / withdrawal (simulation capital only). */
export function deposit(account: AccountState, amount: number, now: number): AccountState {
    if (amount <= 0) return account;
    return {
        ...account,
        balance: round2(account.balance + amount),
        equity: round2(account.equity + amount),
        peakEquity: Math.max(account.peakEquity, round2(account.equity + amount)),
        deposits: round2(account.deposits + amount),
        updatedAt: now,
    };
}

export function withdraw(account: AccountState, amount: number, now: number): AccountState {
    if (amount <= 0) return account;
    const capped = Math.min(amount, Math.max(0, account.balance));
    return {
        ...account,
        balance: round2(account.balance - capped),
        equity: round2(account.equity - capped),
        withdrawals: round2(account.withdrawals + capped),
        updatedAt: now,
    };
}

/** Read-only view handed to strategies. */
export function portfolioSnapshot(account: AccountState, openPositions: number): PortfolioSnapshot {
    return {
        balance: account.balance,
        equity: account.equity,
        availableMargin: account.availableMargin,
        usedMargin: account.usedMargin,
        unrealizedPnL: account.unrealizedPnL,
        realizedPnL: account.realizedPnL,
        exposure: account.exposure,
        drawdownPct: account.drawdownPct,
        dailyPnL: account.dailyPnL,
        openPositions,
        halted: account.halted,
        haltReason: account.haltReason,
    };
}

function round2(v: number): number {
    return Number(v.toFixed(2));
}
