import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { adminDatabase } from "@/lib/firebase-admin";
import { getAdminSubscriptionStatus } from "@/lib/subscription-server";
import { getProSignals } from "@/features/telegram-signals/signals/signal-engine";
import { dispatchProSignalToGateway } from "@/features/telegram-signals/gateway/gateway-adapter";
import { riskLimitsFromConfig } from "@/features/telegram-signals/risk/risk-engine";
import {
    buildEntryRiskLimits,
    loadAccountRiskSnapshot,
} from "@/lib/risk/account-state";
import {
    evaluateOrder,
    type OrderDirection,
    type OrderEntryKind,
    type OrderIntent,
} from "@/lib/risk/risk-engine";
import type { ProSignal, TakeProfitTarget } from "@/features/telegram-signals/types";
import type { AISignal } from "@/lib/ai-signals/types";

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const subStatus = await getAdminSubscriptionStatus(uid);
        if (!subStatus.hasSubscription && decodedToken.role !== "admin") {
            return NextResponse.json(
                { error: "Pro subscription required", hasPro: false },
                { status: 403 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const { signalId, mt5Account, volume, userSettings } = body;

        if (!signalId) {
            return NextResponse.json({ error: "signalId is required" }, { status: 400 });
        }

        // Get the signal — check user's Telegram signals first, then fall back
        // to the global AI signals store (where PRO-tier AI signals live).
        const telegramSignals = await getProSignals(uid);
        const telegramSignal = telegramSignals.find((s) => s.id === signalId);
        const isAiSignal = !telegramSignal;

        let signal: ProSignal | AISignal;
        if (telegramSignal) {
            signal = telegramSignal;
        } else {
            const aiSnap = await adminDatabase.ref(`aiSignals/${signalId}`).get();
            if (!aiSnap.exists()) {
                return NextResponse.json({ error: "Signal not found" }, { status: 404 });
            }
            signal = aiSnap.val() as AISignal;
        }

        // Use provided MT5 account or default
        const account = mt5Account || "default";

        // Determine volume: explicit body volume wins; otherwise the canonical Risk
        // Engine sizes it from risk settings (or falls back to the default lot).
        let orderVolume = volume !== undefined && volume !== null && volume !== ""
            ? Number(volume)
            : undefined;

        // Adapt AI signal to ProSignal shape for the gateway which expects
        // `takeProfits` (array) and `entryMin`, whereas AISignal uses
        // individual `tp1`/`tp2`/`tp3` fields and `entry`.
        const gatewaySignal = isAiSignal
            ? adaptAiSignalToPro(signal as AISignal)
            : (signal as ProSignal);

        // ── Canonical risk gate ─────────────────────────────────────────────
        // Every dispatch passes through the canonical Risk Engine with real
        // account state. The intent mirrors exactly what gets enqueued below.
        const entryKind: OrderEntryKind = gatewaySignal.entryType === "LIMIT"
            ? "LIMIT"
            : gatewaySignal.entryType === "STOP"
            ? "STOP"
            : "MARKET";
        const refPrice = entryKind === "MARKET"
            ? 0
            : (gatewaySignal.direction === "BUY" ? gatewaySignal.entryMin : gatewaySignal.entryMax);
        const direction: OrderDirection = gatewaySignal.direction === "SELL" ? "SELL" : "BUY";
        const tp1Price =
            gatewaySignal.takeProfits.find((t) => t.type === "PRICE" && t.index === 1)?.price ?? null;

        const riskState = await loadAccountRiskSnapshot(uid, account, gatewaySignal.symbol);
        const riskLimits = userSettings?.autoExecution
            ? { ...buildEntryRiskLimits(riskState), ...riskLimitsFromConfig(userSettings.autoExecution) }
            : buildEntryRiskLimits(riskState);

        const riskIntent: OrderIntent = {
            symbol: gatewaySignal.symbol,
            direction,
            entryKind,
            price: refPrice,
            volume: orderVolume,
            sl: gatewaySignal.stopLoss,
            tp: tp1Price,
        };
        const decision = evaluateOrder(riskIntent, riskLimits, riskState.account, Date.now());
        if (!decision.approved) {
            return NextResponse.json(
                { error: `Order rejected by risk engine: ${decision.reason ?? decision.code}` },
                { status: 403 }
            );
        }
        orderVolume = decision.volume ?? orderVolume ?? 0.01;

        // Dispatch to AlgoVault Gateway
        const result = await dispatchProSignalToGateway({
            userId: uid,
            signal: gatewaySignal,
            mt5Account: account,
            volume: orderVolume,
        });

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Failed to dispatch to Gateway" },
                { status: 500 }
            );
        }

        // Record the honest dispatch event. No EXECUTED status exists yet: the
        // command is queued and the gateway EA confirms real execution later.
        const now = Date.now();
        const executionEvent = {
            id: `evt_${now}_ORDER_QUEUED`,
            signalId: signal.id,
            type: "ORDER_QUEUED",
            timestamp: now,
            message: "Trade queued for gateway dispatch — awaiting real MT5 execution.",
            metadata: {
                commandId: result.commandId,
                mt5Account: account,
                volume: orderVolume,
                status: result.status || "queued",
            },
        };

        if (isAiSignal) {
            const aiSignal = signal as AISignal;
            const updatedSignal = {
                ...aiSignal,
                tradeCount: (aiSignal.tradeCount || 0) + 1,
                updatedAt: now,
                timeline: [
                    ...(aiSignal.timeline || []),
                    executionEvent,
                ],
            };
            await adminDatabase.ref(`aiSignals/${signalId}`).set(updatedSignal);
            return NextResponse.json({
                success: true,
                commandId: result.commandId,
                status: result.status,
                message: result.message,
                signal: updatedSignal,
            });
        }

        // Telegram ProSignal path
        const tgSignal = signal as ProSignal;
        const updatedSignal = {
            ...tgSignal,
            events: [
                ...tgSignal.events,
                executionEvent,
            ],
            lastUpdateAt: now,
        };

        await adminDatabase.ref(`telegramSignals/${uid}/${signalId}`).set(updatedSignal);

        return NextResponse.json({
            success: true,
            commandId: result.commandId,
            status: result.status,
            message: result.message,
            signal: updatedSignal,
        });
    } catch (err: any) {
        console.error("[POST /api/pro-signals/execute]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}

function adaptAiSignalToPro(aiSignal: AISignal): ProSignal {
    const takeProfits: TakeProfitTarget[] = [];
    if (aiSignal.tp1 != null) takeProfits.push({ index: 1, type: "PRICE" as const, price: aiSignal.tp1, hit: false });
    if (aiSignal.tp2 != null) takeProfits.push({ index: 2, type: "PRICE" as const, price: aiSignal.tp2, hit: false });
    if (aiSignal.tp3 != null) takeProfits.push({ index: 3, type: "PRICE" as const, price: aiSignal.tp3, hit: false });

    return {
        id: aiSignal.id,
        fingerprint: "",
        symbol: aiSignal.symbol,
        direction: aiSignal.direction,
        entryType: "MARKET",
        entry: aiSignal.entry,
        entryMin: aiSignal.entry,
        entryMax: aiSignal.entry,
        stopLoss: aiSignal.stopLoss,
        takeProfits,
        openTarget: false,
        style: "SCALPING",
        timeframe: "M1",
        createdAt: aiSignal.createdAt,
        receivedAt: aiSignal.createdAt,
        expirationAt: aiSignal.expiresAt,
        status: "CREATED",
        sourceMetadata: { sourceId: "ai-engine", sourceType: "custom_webhook" },
        parserMetadata: { fastParsed: false, confidence: aiSignal.confidence, warnings: [], errors: [], aiUsed: true },
        latency: { receivedAt: aiSignal.createdAt, parsedAt: 0, normalizedAt: 0 },
        rawMessageId: aiSignal.id,
        events: aiSignal.timeline as any[],
        lastUpdateAt: aiSignal.updatedAt,
    };
}
