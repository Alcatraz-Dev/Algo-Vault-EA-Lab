/**
 * AlgoVault — Risk engine server-side state collector.
 *
 * Builds the AccountRiskState + emergency-stop flag consumed by the canonical
 * Risk Engine from live RTDB records. Everything read here is real gateway
 * data (accounts, positions, controls) — nothing is synthesized. Values the
 * platform does not record (e.g. realized daily loss) stay undefined and let
 * the canonical engine pass through on that axis rather than guessing.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import type { AccountRiskState, BrokerLimits, RiskLimits } from "./risk-engine";
import { brokerLimitsFromAccount } from "./risk-engine";
import type { DrawdownBreakerRecord } from "./drawdown-breaker";
import {
    effectiveDailyNotional,
    normalizeNotionalLedger,
    notionalAccountingIncomplete,
    notionalDayKey,
} from "./notional-ledger";

export interface RiskSnapshot {
    emergencyStop: boolean;
    account: AccountRiskState;
    controls: Record<string, unknown>;
    accountRecord: Record<string, unknown>;
    broker: BrokerLimits;
}

/** Normalize a user's accountId to the gateway spelling used in RTDB paths. */
export function accountKey(accountId: string): string {
    const trimmed = String(accountId || "").trim();
    return trimmed.startsWith("gateway_") ? trimmed : `gateway_${trimmed}`;
}

/**
 * Read live account state for the risk engine. `symbol` narrows the
 * per-symbol exposure computation to the intent's symbol.
 */
export async function loadAccountRiskSnapshot(
    userId: string,
    accountId: string,
    symbol?: string
): Promise<RiskSnapshot> {
    const key = accountKey(accountId);

    const [controlsSnap, accountSnap, positionsSnap, userSnap] = await Promise.all([
        adminDatabase.ref(`trading_controls/${userId}/${key}`).get(),
        adminDatabase.ref(`trading_accounts/${userId}/${key}`).get(),
        adminDatabase.ref(`trading_positions/${userId}/${key}`).get(),
        adminDatabase.ref(`users/${userId}`).get(),
    ]);

    const controls = (controlsSnap.val() || {}) as Record<string, unknown>;
    const accountRecord = (accountSnap.val() || {}) as Record<string, unknown>;

    const balance = Number(accountRecord.balance);
    const equity = Number(accountRecord.equity);

    let openPositionsCount: number | undefined;
    let symbolExposureLots: number | undefined;

    if (positionsSnap.exists()) {
        const positions = positionsSnap.val() as Record<string, { symbol?: string; volume?: number }>;
        const tickets = Object.keys(positions);
        openPositionsCount = tickets.length;
        if (symbol) {
            symbolExposureLots = tickets.reduce((sum, t) => {
                const pos = positions[t];
                if (pos && String(pos.symbol || "") === symbol) {
                    return sum + (Number(pos.volume) || 0);
                }
                return sum;
            }, 0);
        }
    }

    // Current floating drawdown (balance = realized, equity = balance + floating).
    let drawdownPercent: number | undefined;
    const userData = userSnap.exists() ? (userSnap.val() as Record<string, unknown>) : {};
    const storedMaxDD = Number(userData.maxDrawdown);
    const floatDD = Number.isFinite(balance) && Number.isFinite(equity) && balance > 0 && equity > 0
        ? Math.max(0, ((balance - equity) / balance) * 100)
        : 0;
    if (Number.isFinite(storedMaxDD) && storedMaxDD > 0) {
        drawdownPercent = storedMaxDD;
    } else if (floatDD > 0) {
        drawdownPercent = floatDD;
    }

    // Daily-loss data is only enforced when a control/EA reports it — the
    // platform does not otherwise persist realized daily PnL.
    const dailyLossPercentRaw = Number(controls.dailyLossPercent);
    const dailyLossPercent = Number.isFinite(dailyLossPercentRaw) && dailyLossPercentRaw > 0
        ? Math.abs(dailyLossPercentRaw)
        : undefined;

    // Stateful breaker: the latched flag is authoritative. A legacy boolean is
    // honoured, and a persisted breaker record counts only when TRIPPED — a
    // recovered equity curve never clears it here.
    const breaker = controls.drawdownBreaker as DrawdownBreakerRecord | undefined;
    const drawdownBreakerActive = controls.drawdownBreakerActive === true || breaker?.state === "TRIPPED";

    // Daily notional: the maintained ledger is authoritative (committed fills +
    // in-flight reservations). A legacy `dailyNotionalUsed` value is honoured
    // only when no ledger exists. A missing value stays undefined (unknown ≠
    // zero), and an unaccounted fill marks the day incomplete so the budget
    // check fails closed instead of enforcing a wrong number.
    let dailyNotionalUsed: number | undefined;
    let dailyNotionalIncomplete: boolean | undefined;
    if (controls.notionalLedger && typeof controls.notionalLedger === "object") {
        const ledger = normalizeNotionalLedger(controls.notionalLedger, notionalDayKey(Date.now()));
        dailyNotionalUsed = effectiveDailyNotional(ledger);
        dailyNotionalIncomplete = notionalAccountingIncomplete(ledger) || undefined;
    } else {
        const notionalRaw = Number(controls.dailyNotionalUsed);
        dailyNotionalUsed = Number.isFinite(notionalRaw) && notionalRaw >= 0 ? notionalRaw : undefined;
    }

    const account: AccountRiskState = {
        balance: Number.isFinite(balance) && balance > 0 ? balance : undefined,
        openPositionsCount,
        symbolExposureLots,
        dailyLossPercent,
        drawdownPercent,
        lastTradeAt: Number(accountRecord.lastTradeAt) || undefined,
        dailyNotionalUsed,
        dailyNotionalIncomplete,
        drawdownBreakerActive: drawdownBreakerActive ? true : undefined,
    };

    return {
        emergencyStop: controls.emergencyStop === true,
        account,
        controls,
        accountRecord,
        broker: brokerLimitsFromAccount(accountRecord),
    };
}

/**
 * Assemble the canonical risk limits used for a manual entry on a connected
 * account: broker constraints (from the account record, falling back to MT5
 * platform defaults) plus per-account discretionary limits stored in
 * trading_controls (if an admin/EA wrote them).
 */
export function buildEntryRiskLimits(snapshot: RiskSnapshot): RiskLimits {
    const controls = snapshot.controls;
    const limits: RiskLimits = {
        ...snapshot.broker,
        emergencyStop: snapshot.emergencyStop,
    };
    if (!limits.minLot) limits.minLot = 0.01;
    if (!limits.lotStep) limits.lotStep = 0.01;
    if (!limits.maxLot) limits.maxLot = 100;

    const dailyLoss = Number(controls.maxDailyLossPercent);
    if (Number.isFinite(dailyLoss) && dailyLoss > 0) limits.maxDailyLossPercent = dailyLoss;
    const drawdown = Number(controls.maxDrawdownPercent);
    if (Number.isFinite(drawdown) && drawdown > 0) limits.maxDrawdownPercent = drawdown;
    const maxPos = Number(controls.maxOpenPositions);
    if (Number.isFinite(maxPos) && maxPos > 0) limits.maxOpenPositions = maxPos;
    const exposure = Number(controls.maxSymbolExposureLots);
    if (Number.isFinite(exposure) && exposure > 0) limits.maxSymbolExposureLots = exposure;
    const notional = Number(controls.maxDailyNotional);
    if (Number.isFinite(notional) && notional > 0) limits.maxDailyNotional = notional;

    return limits;
}

/**
 * Account-level limits ONLY — the discretionary controls an admin/EA wrote to
 * `trading_controls`, plus the emergency stop. No broker defaults are
 * invented: a path that cannot read symbol specifications must not pretend it
 * knows the minimum lot or lot step.
 *
 * Used by the Unified Trading Service, whose provider has not published symbol
 * specs yet. Limits that were never configured stay absent, so the canonical
 * engine passes through on those axes instead of rejecting honest orders.
 */
export function buildControlRiskLimits(snapshot: RiskSnapshot): RiskLimits {
    const controls = snapshot.controls;
    const limits: RiskLimits = { emergencyStop: snapshot.emergencyStop };

    const dailyLoss = Number(controls.maxDailyLossPercent);
    if (Number.isFinite(dailyLoss) && dailyLoss > 0) limits.maxDailyLossPercent = dailyLoss;
    const drawdown = Number(controls.maxDrawdownPercent);
    if (Number.isFinite(drawdown) && drawdown > 0) limits.maxDrawdownPercent = drawdown;
    const maxPos = Number(controls.maxOpenPositions);
    if (Number.isFinite(maxPos) && maxPos > 0) limits.maxOpenPositions = maxPos;
    const exposure = Number(controls.maxSymbolExposureLots);
    if (Number.isFinite(exposure) && exposure > 0) limits.maxSymbolExposureLots = exposure;
    const notional = Number(controls.maxDailyNotional);
    if (Number.isFinite(notional) && notional > 0) limits.maxDailyNotional = notional;

    return limits;
}