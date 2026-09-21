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

    const account: AccountRiskState = {
        balance: Number.isFinite(balance) && balance > 0 ? balance : undefined,
        openPositionsCount,
        symbolExposureLots,
        dailyLossPercent,
        drawdownPercent,
        lastTradeAt: Number(accountRecord.lastTradeAt) || undefined,
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

    return limits;
}