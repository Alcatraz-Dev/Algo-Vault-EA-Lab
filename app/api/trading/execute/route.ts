import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";
import type { ExecuteInput } from "@/lib/trading/unified/service";
import type { TradingExecutionType } from "@/lib/trading/unified/domain";

export const runtime = "nodejs";

const EXECUTION_TYPES: TradingExecutionType[] = [
    "PLACE_ORDER",
    "MODIFY_POSITION",
    "CLOSE_POSITION",
    "PARTIAL_CLOSE",
    "CANCEL_ORDER",
];

/**
 * POST /api/trading/execute
 *
 * The single execution entry point for every channel: the Pro Terminal, the
 * AI surfaces, signals, bots, workflows and the future TradingView extension.
 *
 * Everything that matters is decided server-side: the caller is authenticated,
 * `accountId` is resolved to a provider by its namespace (the client cannot
 * name a provider), the environment is read from the provider record and must
 * be DEMO, the risk engine runs, the idempotency key is claimed, and the
 * adapter verifies the fill at the provider before reporting success.
 */
export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const executionType = String(body.executionType ?? "").toUpperCase() as TradingExecutionType;
        if (!EXECUTION_TYPES.includes(executionType)) {
            return NextResponse.json(
                { success: false, error: { code: "INVALID_REQUEST", message: "Unsupported executionType." } },
                { status: 400 }
            );
        }

        let accountId = String(body.accountId ?? "").trim();
        if (!accountId || accountId === "default") {
            try {
                const { adminDatabase } = await import("@/lib/firebase-admin");
                const accountsSnap = await adminDatabase.ref(`trading_accounts/${token.uid}`).get();
                if (accountsSnap.exists()) {
                    const accountsVal = accountsSnap.val() as Record<string, Record<string, unknown>>;
                    const keys = Object.keys(accountsVal || {});
                    // Prefer connected or live gateway account
                    const liveMatch = keys.find((k) => k.startsWith("gateway_") && (accountsVal[k]?.status === "connected" || accountsVal[k]?.status === "online"));
                    const gatewayMatch = keys.find((k) => k.startsWith("gateway_"));
                    accountId = liveMatch || gatewayMatch || keys[0] || accountId;
                }
            } catch {
                // Ignore resolution error and let UnifiedTradingService fail closed
            }
        } else if (!accountId.startsWith("gateway_") && /^\d+$/.test(accountId)) {
            accountId = `gateway_${accountId}`;
        }

        const input: ExecuteInput = {
            // userId comes from the verified token, never from the body.
            userId: token.uid,
            accountId,
            clientRequestId: String(body.clientRequestId ?? "").trim(),
            correlationId: typeof body.correlationId === "string" ? body.correlationId : undefined,
            executionType,
            symbol: typeof body.symbol === "string" ? body.symbol : undefined,
            side: body.side === "SELL" ? "SELL" : body.side === "BUY" ? "BUY" : undefined,
            volume: typeof body.volume === "number" ? body.volume : undefined,
            percentage: typeof body.percentage === "number" ? body.percentage : undefined,
            kind:
                body.kind === "LIMIT" || body.kind === "STOP" || body.kind === "STOP_LIMIT"
                    ? body.kind
                    : "MARKET",
            price: typeof body.price === "number" ? body.price : null,
            stopLoss: typeof body.stopLoss === "number" ? body.stopLoss : null,
            takeProfit: typeof body.takeProfit === "number" ? body.takeProfit : null,
            positionId: typeof body.positionId === "string" ? body.positionId : undefined,
            orderId: typeof body.orderId === "string" ? body.orderId : undefined,
            source: typeof body.source === "string" ? body.source.slice(0, 40) : "api",
            // Passed through so a hostile `environment: "LIVE"` is rejected
            // explicitly rather than silently ignored.
            environment: typeof body.environment === "string" ? body.environment : undefined,
        };

        const service = createUnifiedTradingService();
        const { result, httpStatus } = await service.execute(input);

        // Diagnostic: surface rejection codes to the server log so 501/4xx are
        // immediately identifiable without digging through the RTDB audit log.
        if (result.status === "REJECTED" || result.status === "FAILED") {
            console.warn("[trading/execute] rejected", {
                accountId: input.accountId,
                errorCode: result.error?.code,
                errorMessage: result.error?.message,
                httpStatus,
            });
        }

        // Real-time trade history: a confirmed close is written to
        // `trading_history` immediately so the terminal's Trade History tab
        // updates without waiting for the next gateway snapshot diff.
        if (executionType === "CLOSE_POSITION" || executionType === "PARTIAL_CLOSE") {
            if (result.status === "SUCCEEDED" && token?.uid) {
                try {
                    const { adminDatabase } = await import("@/lib/firebase-admin");
                    const accountId = String(body.accountId || "").trim();

                    // The closed position's last known state (entry price,
                    // open time, side) as last mirrored by the gateway.
                    const posId = String(body.positionId || result.position?.id || "").trim();
                    let openState: Record<string, unknown> = {};
                    if (posId) {
                        const posSnap = await adminDatabase
                            .ref(`trading_positions/${token.uid}/${accountId}/${posId}`)
                            .get();
                        openState = (posSnap.val() || {}) as Record<string, unknown>;
                    }

                    const historyTicket = String(
                        result.providerRef ||
                            posId ||
                            result.position?.providerRef ||
                            result.position?.id ||
                            body.clientRequestId ||
                            ""
                    ).trim();
                    if (!historyTicket) throw new Error("No ticket for the closed trade.");

                    const openPrice = Number(openState.openPrice ?? result.position?.entryPrice ?? 0);
                    const closePrice = Number(result.filledPrice ?? result.position?.currentPrice ?? 0);
                    const direction = String(
                        openState.type || result.position?.side || body.side || "BUY"
                    ).toUpperCase() === "SELL" ? -1 : 1;
                    const priceMovePct =
                        openPrice > 0 && closePrice > 0
                            ? Math.round(((closePrice - openPrice) / openPrice) * 100 * direction * 100) / 100
                            : null;

                    await adminDatabase
                        .ref(`trading_history/${token.uid}/${accountId}/${historyTicket}`)
                        .set({
                            ticket: historyTicket,
                            symbol: String(openState.symbol || result.position?.symbol || body.symbol || ""),
                            type: String(openState.type || result.position?.side || body.side || "BUY"),
                            volume: Number(result.filledVolume ?? openState.volume ?? result.position?.volume ?? 0),
                            openPrice,
                            closePrice,
                            profit: Number(result.position?.profit ?? openState.profit ?? 0),
                            swap: Number(result.position?.swap ?? openState.swap ?? 0),
                            magic: String(openState.magic ?? ""),
                            comment: String(openState.comment ?? ""),
                            openedAt: Number(openState.openedAt ?? result.position?.openedAt ?? 0),
                            closedAt: Date.now(),
                            closeSource: "execute",
                            priceMovePct,
                        });
                } catch (e) {
                    console.error("[execute] trading_history write failed:", e);
                }
            }
        }

        return NextResponse.json(
            {
                // EXECUTED_PENDING_SYNC is a real provider-confirmed outcome:
                // the trade executed and only the synced position mirror is
                // late. Reporting it as success=false would invite a retry
                // that idempotency would have to absorb — the truth is in
                // result.status, which the terminal renders verbatim.
                success: result.status === "SUCCEEDED" || result.status === "EXECUTED_PENDING_SYNC",
                duplicate: result.duplicate,
                result,
            },
            { status: httpStatus }
        );
    } catch (error) {
        console.error("[trading/execute POST]", error);
        return NextResponse.json(
            {
                success: false,
                error: { code: "UNKNOWN_PROVIDER_ERROR", message: "Execution failed unexpectedly." },
            },
            { status: 500 }
        );
    }
}