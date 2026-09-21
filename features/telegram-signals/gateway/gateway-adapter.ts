/**
 * AlgoVault Pro Signal Intelligence - Gateway Adapter
 * Reuses existing AlgoVaultGateway and MT5 execution infrastructure.
 * DO NOT REBUILD GATEWAY OR DUPLICATE MT5 EXECUTION CODE.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { getGatewayTokenForUser, hasActiveTradingLicense } from "@/lib/gateway";
import type { ProSignal } from "../types";

export interface ExecutionRequest {
    userId: string;
    signal: ProSignal;
    mt5Account: string;
    volume: number;
}

export interface ExecutionResponse {
    success: boolean;
    ticket?: string;
    commandId?: string;
    status?: "queued";
    message?: string;
    error?: string;
}

export async function dispatchProSignalToGateway(
    req: ExecutionRequest
): Promise<ExecutionResponse> {
    const { userId, signal, mt5Account, volume } = req;

    try {
        // 1. Verify user gateway token or trading license
        const token = await getGatewayTokenForUser(userId);
        const hasLicense = await hasActiveTradingLicense(userId);

        if (!token && !hasLicense) {
            return {
                success: false,
                error: "No active AlgoVault Gateway token or trading license found for user.",
            };
        }

        const ticket = String(Math.floor(10000000 + Math.random() * 90000000));
        const now = Date.now();
        const tp1Price = signal.takeProfits.find((t) => t.type === "PRICE")?.price || null;

        const positionData = {
            ticket,
            symbol: signal.symbol.replace("/", ""),
            type: signal.direction,
            volume: Number(volume || 0.01),
            openPrice: signal.entryMin,
            currentPrice: signal.entryMin,
            stopLoss: signal.stopLoss,
            takeProfit: tp1Price,
            profit: 0.0,
            swap: 0.0,
            magic: 999888, // Pro Signals Magic Number
            source: "AlgoVault Pro Signals",
            signalId: signal.id,
            userId,
            openedAt: now,
            lastSeenAt: now,
            updatedAt: now,
            status: "PENDING_MT5_EXECUTION",
        };

        // Write to existing mt5_orders database node
        await adminDatabase.ref(`mt5_orders/${mt5Account}/${ticket}`).set(positionData);

        // Also record in live_positions node for real-time tracking
        await adminDatabase.ref(`live_positions/live_${mt5Account}/${ticket}`).set(positionData);

        return {
            success: true,
            ticket,
            commandId: ticket,
            status: "queued",
            message: `Pro Signal #${ticket} (${signal.symbol} ${signal.direction}) dispatched to MT5 Account ${mt5Account}`,
        };
    } catch (err) {
        console.error("[dispatchProSignalToGateway]", err);
        return {
            success: false,
            error: err instanceof Error ? err.message : "Failed to dispatch order to Gateway",
        };
    }
}
