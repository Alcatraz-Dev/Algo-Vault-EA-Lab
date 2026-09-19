import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal } from "@/lib/ai-signals/types";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json().catch(() => ({}));

        const signalSnap = await adminDatabase.ref(`aiSignals/${id}`).get();
        if (!signalSnap.exists()) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }
        const signal = signalSnap.val() as AISignal;

        const isActive = ["ACTIVE", "READY", "RUNNER", "TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(signal.status);
        if (!isActive) {
            return NextResponse.json({ error: "Signal is not active — cannot execute." }, { status: 400 });
        }

        // Tier guard: PRO signals can only be executed by PRO users
        const { isProUser } = await import("@/lib/ai-signals/access");
        const isPro = await isProUser(user.uid);
        if (signal.tier === "PRO" && !isPro) {
            return NextResponse.json({ error: "PRO signal — upgrade required." }, { status: 403 });
        }

        // Load connected accounts
        const accountsSnap = await adminDatabase.ref(`trading_accounts/${user.uid}`).get();
        if (!accountsSnap.exists()) {
            return NextResponse.json({ error: "No trading accounts connected. Connect via Account → Trading Access first." }, { status: 400 });
        }

        let targetAccountId = body.accountId || null;
        const allAccounts: Array<{ accountId: string; balance: number; status: string; [k: string]: unknown }> = [];
        accountsSnap.forEach((child) => {
            const acct = child.val();
            if (acct && acct.status === "connected") {
                allAccounts.push({ accountId: acct.accountId, balance: acct.balance || 10000, ...acct });
            }
        });

        if (allAccounts.length === 0) {
            return NextResponse.json({ error: "No connected trading accounts available. Check your Trading Access page." }, { status: 400 });
        }

        // If no accountId specified or not found, pick first connected
        if (!targetAccountId || !allAccounts.find((a) => a.accountId === targetAccountId)) {
            targetAccountId = allAccounts[0].accountId;
        }

        const account = allAccounts.find((a) => a.accountId === targetAccountId)!;

        // Lot sizing: use body.lotSize override, otherwise calculate from risk%
        const spec = getSymbolSpec(signal.symbol);
        const pipSize = spec?.pipSize || 0.01;
        const digits = spec?.digits || 5;
        const riskPercent = signal.suggestedRiskPercent || 1;
        const slDistancePips = Math.abs(signal.entry - signal.stopLoss) / pipSize;

        let volume: number;
        if (body.lotSize && body.lotSize > 0) {
            volume = parseFloat(body.lotSize.toFixed(2));
        } else if (slDistancePips > 0) {
            const riskAmount = account.balance * (riskPercent / 100);
            const pipValuePerLot = spec?.tickValue ? spec.tickValue * 100 : 10;
            volume = riskAmount / (slDistancePips * pipValuePerLot);
            volume = Math.max(0.01, parseFloat(volume.toFixed(2)));
        } else {
            volume = 0.01;
        }

        const commandId = `sig_${signal.symbol.toLowerCase()}_${Date.now()}`;
        const now = Date.now();

        const command = {
            commandId,
            accountId: targetAccountId,
            action: signal.direction,
            symbol: signal.symbol,
            volume,
            price: 0,
            sl: parseFloat(signal.stopLoss.toFixed(digits)),
            tp: signal.tp1 ? parseFloat(signal.tp1.toFixed(digits)) : 0,
            tp2: signal.tp2 ? parseFloat(signal.tp2.toFixed(digits)) : 0,
            tp3: signal.tp3 ? parseFloat(signal.tp3.toFixed(digits)) : 0,
            status: "queued",
            source: "signal",
            signalId: signal.id,
            createdAt: now,
            createdBy: user.uid,
        };

        // Write command + execution record
        const updates: Record<string, unknown> = {};
        updates[`trading_order_requests/${user.uid}/${commandId}`] = command;
        updates[`signalExecutions/${user.uid}/${signal.id}/${commandId}`] = {
            commandId,
            accountId: targetAccountId,
            signalId: signal.id,
            symbol: signal.symbol,
            direction: signal.direction,
            volume,
            status: "queued",
            createdAt: now,
        };
        // Increment tradeCount on the signal
        updates[`aiSignals/${signal.id}/tradeCount`] = (signal.tradeCount || 0) + 1;
        updates[`aiSignals/${signal.id}/updatedAt`] = now;

        await adminDatabase.ref().update(updates);

        // Record event
        const event = {
            eventId: `exec_${commandId}`,
            signalId: signal.id,
            eventType: "STATUS_CHANGE" as const,
            price: signal.entry,
            timestamp: now,
            metadata: {
                commandId,
                accountId: targetAccountId,
                volume,
                direction: signal.direction,
                action: "executed_via_signal",
            },
        };
        await adminDatabase.ref(`signalEvents/${signal.id}/${event.eventId}`).set(event);

        return NextResponse.json({
            success: true,
            commandId,
            accountId: targetAccountId,
            volume,
            action: signal.direction,
            symbol: signal.symbol,
            status: "queued",
        });
    } catch (err) {
        console.error("[signal execute POST]", err);
        return NextResponse.json({ error: "Failed to queue trade." }, { status: 500 });
    }
}
