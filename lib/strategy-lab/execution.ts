import { SupportedSymbol, MarketCandle, Timeframe } from "@/lib/market-data/types";
import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser } from "@/lib/notifications";
import { BacktestMetrics, Deployment, DeployMode, ForwardMode, ForwardTest, Strategy } from "./types";
import { createForwardTest, buildForwardEntry } from "./forward";
import { saveDeployment, saveForwardTest } from "./storage";

// ─────────────────────────────────────────────────────────────────────────────
// Execution layer.
//
// Deployment = a strategy that has been "activated" for ongoing signals and
// optional MT5 execution.  This module owns:
//   • activateDeployment – create the deployment record and kick off a
//     forward test, optionally requesting MT5 execution.
//   • generateSignalFromDeployment – run the strategy's rules on the latest
//     bar and emit a ForwardTrade signal, persisting it and (optionally)
//     pushing a trading_order_request + notification.
//
// The signal itself is always written to  strategyLab/{uid}/forwardTests/{id}/signals
// so the monitor route can pick it up. The optional order-request is only
// written when mode = "live" or "demo" AND the EA gateway is connected.
// ─────────────────────────────────────────────────────────────────────────────

export function mapForwardMode(mode: DeployMode): ForwardMode {
    switch (mode) {
        case "live":
        case "demo":
            return "paper";
        case "alerts_only":
            return "signal_only";
        case "manual_confirmation":
        default:
            return "manual";
    }
}

export type ActivateDeploymentResult = {
    deployment: Deployment;
    forwardTest: ForwardTest | null;
    accessError?: string;
};

export async function activateDeployment(
    uid: string,
    strategy: Strategy,
    symbol: SupportedSymbol,
    deployMode: DeployMode,
    backtestMetrics: BacktestMetrics
): Promise<ActivateDeploymentResult> {
    const forwardMode = mapForwardMode(deployMode);

    const deployment: Deployment = {
        id: `dep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        uid,
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol,
        mode: deployMode,
        termsAccepted: false,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };

    const forwardTest = createForwardTest(strategy, symbol, backtestMetrics, strategy.timeframes, forwardMode);
    forwardTest.uid = uid;

    try {
        await saveDeployment(uid, deployment);
        await saveForwardTest(uid, forwardTest);
    } catch (err) {
        console.error("[strategy-lab/execution] saveDeployment/saveForwardTest failed:", err);
    }

    if (deployMode === "live" || deployMode === "demo") {
        try {
            void notifyUser(uid, {
                title: "Strategy Lab: Deployment Active",
                message: `${strategy.name} (${symbol}) is live on ${deployMode} mode.`,
                level: "info",
            });
        } catch {
            // notification failure is non-fatal
        }
    }

    return { deployment, forwardTest };
}

export type SignalGenerationResult = {
    signal: boolean;
    tradeId?: string;
    orderRequestWritten: boolean;
};

export async function generateSignalFromDeployment(
    deployment: Deployment,
    strategy: Strategy,
    symbol: SupportedSymbol,
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    existingForwardTest: ForwardTest
): Promise<SignalGenerationResult> {
    const trade = buildForwardEntry(
        strategy,
        symbol,
        candlesByTF,
        mapForwardMode(deployment.mode),
        existingForwardTest.signals,
        `dl_${deployment.id.slice(-6)}`
    );
    if (!trade) return { signal: false, orderRequestWritten: false };

    trade.reasoning = `[${deployment.strategyName}] ${trade.reasoning}`;
    existingForwardTest.signals.push(trade);
    existingForwardTest.updatedAt = Date.now();
    existingForwardTest.lastPrice = trade.currentPrice;

    try {
        await saveForwardTest(deployment.uid, existingForwardTest);
    } catch (err) {
        console.error("[strategy-lab/execution] saveForwardTest failed:", err);
    }

    let orderRequestWritten = false;
    if (deployment.mode === "live" || deployment.mode === "demo") {
        try {
            const clientOrderId = `slab_${trade.id}`;
            const orderRequest = {
                clientOrderId,
                userId: deployment.uid,
                symbol,
                side: trade.direction,
                type: "market",
                volume: strategy.risk.fixedLot || 0.01,
                sl: trade.sl,
                tp: trade.tp1,
                openPrice: trade.currentPrice,
                source: "strategy-lab",
                signalId: trade.signalId,
                strategyId: strategy.id,
                status: "PENDING_GATEWAY_EXECUTION",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            await adminDatabase
                .ref(`trading_order_requests/${deployment.uid}/${clientOrderId}`)
                .set(orderRequest);
            orderRequestWritten = true;

            void notifyUser(deployment.uid, {
                title: `Strategy Lab: ${trade.direction} ${symbol}`,
                message: `Entry ~${trade.entry.toFixed(2)} | SL ${trade.sl.toFixed(2)} | TP1 ${trade.tp1?.toFixed(2)}`,
                level: "info",
            });
        } catch (err) {
            console.error("[strategy-lab/execution] order request failed:", err);
        }
    } else {
void notifyUser(deployment.uid, {
                title: `Strategy Lab Signal: ${trade.direction} ${symbol}`,
                message: `Entry ~${trade.entry.toFixed(2)} | SL ${trade.sl.toFixed(2)} | TP1 ${trade.tp1?.toFixed(2)}\nMode: ${deployment.mode}`,
                level: "warning",
            });
    }

    return { signal: true, tradeId: trade.id, orderRequestWritten };
}

export async function stopDeployment(uid: string, deploymentId: string): Promise<boolean> {
    const snap = await adminDatabase.ref(`strategyLab/${uid}/deployments/${deploymentId}`).get();
    if (!snap.exists()) return false;
    const dep = snap.val() as Deployment;
    if (dep.status === "stopped") return true;

    dep.status = "stopped";
    dep.stoppedAt = Date.now();
    dep.updatedAt = Date.now();
    await adminDatabase.ref(`strategyLab/${uid}/deployments/${deploymentId}`).set(dep);

    void notifyUser(uid, {
        title: "Strategy Lab: Deployment Stopped",
        message: `${dep.strategyName} (${dep.symbol}) has been stopped.`,
        level: "info",
    });

    return true;
}