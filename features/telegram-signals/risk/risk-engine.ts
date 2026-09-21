/**
 * AlgoVault Pro Signal Intelligence - Risk Engine & Auto-Execution Validator
 */

import type { ProSignal, RiskConfig } from "../types";
import type { RiskLimits } from "@/lib/risk/risk-engine";

export interface RiskValidationResult {
    valid: boolean;
    reason?: string;
    calculatedLot?: number;
}

/** Map legacy Telegram auto-execution settings into the canonical risk contract. */
export function riskLimitsFromConfig(config: RiskConfig): RiskLimits {
    return {
        emergencyStop: config.enabled === false,
        riskPercent: config.riskPercent,
        defaultLot: config.fixedLot,
        maxDailyLossPercent: config.maxDailyLossPercent,
        maxOpenPositions: config.maxOpenPositions,
        maxSymbolExposureLots: config.maxSymbolExposureLots,
        cooldownSeconds: config.cooldownSeconds,
        allowMarketEntries: config.allowMarketEntries,
        requireStopLoss: config.requireStopLoss,
    };
}

export function validateSignalRisk(
    signal: ProSignal,
    riskConfig: RiskConfig,
    accountState?: {
        accountBalance?: number;
        openPositionsCount?: number;
        currentSymbolExposureLots?: number;
        dailyLossPercent?: number;
        lastTradeTimestamp?: number;
    }
): RiskValidationResult {
    // 1. Check auto execution enabled
    if (!riskConfig.enabled) {
        return { valid: false, reason: "Auto-execution is disabled in user risk settings" };
    }

    // 2. Check signal status & expiration
    if (["EXPIRED", "CANCELLED", "CLOSED", "STOPPED", "INVALID"].includes(signal.status)) {
        return { valid: false, reason: `Signal is not executable (Status: ${signal.status})` };
    }

    if (Date.now() > signal.expirationAt) {
        return { valid: false, reason: "Signal has expired" };
    }

    // 3. Stop loss requirement
    if (riskConfig.requireStopLoss && (!signal.stopLoss || signal.stopLoss <= 0)) {
        return { valid: false, reason: "Signal lacks mandatory Stop Loss" };
    }

    // 4. Market entries check
    if (signal.entryType === "MARKET" && !riskConfig.allowMarketEntries) {
        return { valid: false, reason: "Market entry execution is disabled in risk settings" };
    }

    if (accountState) {
        // 5. Cooldown check
        if (
            riskConfig.cooldownSeconds > 0 &&
            accountState.lastTradeTimestamp &&
            Date.now() - accountState.lastTradeTimestamp < riskConfig.cooldownSeconds * 1000
        ) {
            return { valid: false, reason: `Trade execution cooldown active (${riskConfig.cooldownSeconds}s)` };
        }

        // 6. Max daily loss check
        if (
            accountState.dailyLossPercent !== undefined &&
            accountState.dailyLossPercent >= riskConfig.maxDailyLossPercent
        ) {
            return { valid: false, reason: `Max daily loss limit reached (${accountState.dailyLossPercent.toFixed(1)}%)` };
        }

        // 7. Max open positions check
        if (
            accountState.openPositionsCount !== undefined &&
            accountState.openPositionsCount >= riskConfig.maxOpenPositions
        ) {
            return { valid: false, reason: `Max open positions limit reached (${accountState.openPositionsCount})` };
        }

        // 8. Max symbol exposure check
        if (
            accountState.currentSymbolExposureLots !== undefined &&
            accountState.currentSymbolExposureLots >= riskConfig.maxSymbolExposureLots
        ) {
            return { valid: false, reason: `Max symbol exposure limit reached for ${signal.symbol}` };
        }
    }

    // Calculate position size / lot size
    let calculatedLot = riskConfig.fixedLot || 0.01;

    if (accountState?.accountBalance && signal.stopLoss > 0 && signal.entryMin > 0) {
        const riskAmount = (accountState.accountBalance * riskConfig.riskPercent) / 100;
        const pipsAtRisk = Math.abs(signal.entryMin - signal.stopLoss);
        if (pipsAtRisk > 0) {
            // Standard lot calculation heuristic
            const estimatedLot = Number((riskAmount / (pipsAtRisk * 100)).toFixed(2));
            calculatedLot = Math.max(0.01, Math.min(estimatedLot, riskConfig.maxSymbolExposureLots));
        }
    }

    return {
        valid: true,
        calculatedLot,
    };
}
