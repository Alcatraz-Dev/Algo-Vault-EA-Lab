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

        const input: ExecuteInput = {
            // userId comes from the verified token, never from the body.
            userId: token.uid,
            accountId: String(body.accountId ?? "").trim(),
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