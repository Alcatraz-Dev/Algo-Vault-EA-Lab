import type { Strategy } from "@/lib/strategy-lab/types";
import { cashValueForMove, simSymbolSpec, sizePosition } from "@/lib/strategy-engine/simulation";
import { evaluateRisk, type RiskCheckInput } from "@/lib/strategy-engine/risk";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import type { AccountState, OrderIntent, RiskLimits, RiskVerdict } from "@/lib/strategy-engine/types";

export interface PositionRiskRequest {
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit?: number | null;
    equity: number;
}

function knownSpec(symbol: string) {
    return getSymbolSpec(symbol) ? simSymbolSpec(symbol) : null;
}

function validRequest(input: PositionRiskRequest): boolean {
    const stopIsValid = input.side === "LONG" ? input.stopLoss < input.entryPrice : input.stopLoss > input.entryPrice;
    return Boolean(knownSpec(input.symbol)) && (input.side === "LONG" || input.side === "SHORT") &&
        Number.isFinite(input.quantity) && input.quantity > 0 &&
        Number.isFinite(input.entryPrice) && input.entryPrice > 0 &&
        Number.isFinite(input.stopLoss) && input.stopLoss > 0 && stopIsValid &&
        Number.isFinite(input.equity) && input.equity > 0;
}

export function calculateRiskAmount(input: PositionRiskRequest): number | null {
    if (!validRequest(input)) return null;
    const spec = knownSpec(input.symbol);
    return spec ? cashValueForMove(Math.abs(input.entryPrice - input.stopLoss), input.quantity, spec) : null;
}

export function calculateRiskPercent(input: PositionRiskRequest): number | null {
    const amount = calculateRiskAmount(input);
    return amount === null ? null : (amount / input.equity) * 100;
}

export function calculatePotentialLoss(input: PositionRiskRequest): number | null {
    return calculateRiskAmount(input);
}

export function calculatePotentialProfit(input: PositionRiskRequest): number | null {
    if (!validRequest(input) || !Number.isFinite(input.takeProfit) || (input.takeProfit ?? 0) <= 0) return null;
    const isFavorable = input.side === "LONG"
        ? input.takeProfit! > input.entryPrice
        : input.takeProfit! < input.entryPrice;
    const spec = knownSpec(input.symbol);
    if (!isFavorable || !spec) return null;
    const move = Math.abs(input.takeProfit! - input.entryPrice);
    return cashValueForMove(move, input.quantity, spec);
}

export function calculateRiskReward(input: PositionRiskRequest): number | null {
    const loss = calculatePotentialLoss(input);
    const profit = calculatePotentialProfit(input);
    return loss === null || profit === null || loss <= 0 ? null : profit / loss;
}

/** Delegates the sizing math and lot-step constraints to the existing simulator. */
export function calculatePositionSize(input: {
    strategy: Strategy;
    symbol: string;
    balance: number;
    stopDistance: number;
}): number | null {
    if (!Number.isFinite(input.balance) || input.balance <= 0 || !Number.isFinite(input.stopDistance) || input.stopDistance <= 0) return null;
    const spec = knownSpec(input.symbol);
    if (!spec) return null;
    const quantity = sizePosition({
        strategy: input.strategy,
        balance: input.balance,
        riskPrice: input.stopDistance,
        spec,
    });
    return quantity > 0 ? quantity : null;
}

export function calculateMargin(price: number, quantity: number, symbol: string, leverage: number): number | null {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(leverage) || leverage <= 0) return null;
    const spec = knownSpec(symbol);
    return spec ? (price * quantity * spec.contractSize) / leverage : null;
}

export function calculateExposure(price: number, quantity: number, symbol: string): number | null {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) return null;
    const spec = knownSpec(symbol);
    return spec ? price * quantity * spec.contractSize : null;
}

export function calculateDrawdown(peakEquity: number, equity: number): { amount: number; percent: number } | null {
    if (!Number.isFinite(peakEquity) || peakEquity <= 0 || !Number.isFinite(equity) || equity < 0) return null;
    const amount = Math.max(0, peakEquity - equity);
    return { amount, percent: (amount / peakEquity) * 100 };
}

export function calculateDailyLoss(account: Pick<AccountState, "dailyPnL" | "dailyStartBalance" | "balance">): number | null {
    const base = account.dailyStartBalance ?? account.balance;
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(account.dailyPnL)) return null;
    return Math.max(0, -account.dailyPnL);
}

export function validateOrderRisk(limits: RiskLimits, input: RiskCheckInput): RiskVerdict {
    return evaluateRisk(limits, input);
}

export interface RiskEngine {
    calculatePositionSize: typeof calculatePositionSize;
    calculateRiskAmount: typeof calculateRiskAmount;
    calculateRiskPercent: typeof calculateRiskPercent;
    calculatePotentialLoss: typeof calculatePotentialLoss;
    calculatePotentialProfit: typeof calculatePotentialProfit;
    calculateRiskReward: typeof calculateRiskReward;
    calculateMargin: typeof calculateMargin;
    calculateExposure: typeof calculateExposure;
    calculateDrawdown: typeof calculateDrawdown;
    calculateDailyLoss: typeof calculateDailyLoss;
    validateOrderRisk: (limits: RiskLimits, input: RiskCheckInput) => RiskVerdict;
}

/** Pure shared facade consumed by terminal, simulator, and research code. */
export const tradingRiskEngine: RiskEngine = {
    calculatePositionSize,
    calculateRiskAmount,
    calculateRiskPercent,
    calculatePotentialLoss,
    calculatePotentialProfit,
    calculateRiskReward,
    calculateMargin,
    calculateExposure,
    calculateDrawdown,
    calculateDailyLoss,
    validateOrderRisk,
};

export type { OrderIntent };
