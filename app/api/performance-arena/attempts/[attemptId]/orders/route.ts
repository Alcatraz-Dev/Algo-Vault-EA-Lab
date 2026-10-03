import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../../_shared";
import { placeOrder, closePosition, ArenaError } from "@/lib/performance-arena/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
    return arenaOPTIONS();
}

interface OrderBody {
    action?: unknown;
    symbol?: unknown;
    side?: unknown;
    sizeLots?: unknown;
    stopLoss?: unknown;
    takeProfit?: unknown;
    tradeId?: unknown;
    clientRequestId?: unknown;
}

// Auth: bearer token. The client submits INTENT only (symbol/side/size/stop).
// Prices, costs, PnL, equity, rule evaluation and settlement are computed
// server-side from the canonical live-price resolver — a manipulated client
// cannot change balances, results or rule compliance. Idempotent on
// clientRequestId (order retries cannot double-fill).
export async function POST(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;

        const body = (await request.json().catch(() => null)) as OrderBody | null;
        if (!body) return arenaJson({ error: "JSON body required.", code: "INVALID_BODY" }, 400);

        const action = typeof body.action === "string" ? body.action : "market";

        if (action === "close") {
            if (typeof body.tradeId !== "string" || !body.tradeId) {
                return arenaJson({ error: "tradeId is required to close a position.", code: "INVALID_BODY" }, 400);
            }
            const state = await closePosition(
                auth.uid,
                attemptId,
                body.tradeId,
                typeof body.clientRequestId === "string" ? body.clientRequestId : undefined
            );
            return arenaJson({ state });
        }

        if (action !== "market" && action !== "limit" && action !== "stop") {
            return arenaJson({ error: "action must be market | close.", code: "INVALID_BODY" }, 400);
        }
        if (action !== "market") {
            // Pending limit/stop ENTRY orders are not part of v1 execution —
            // rejected honestly rather than silently treated as market orders.
            return arenaJson(
                { error: "Pending entry orders are not supported in this challenge build — use a market order with stop/take-profit.", code: "UNSUPPORTED_ORDER_TYPE" },
                400
            );
        }

        if (typeof body.symbol !== "string" || !body.symbol) {
            return arenaJson({ error: "symbol is required.", code: "INVALID_BODY" }, 400);
        }
        if (body.side !== "long" && body.side !== "short") {
            return arenaJson({ error: 'side must be "long" or "short".', code: "INVALID_BODY" }, 400);
        }
        const sizeLots = Number(body.sizeLots);
        if (!Number.isFinite(sizeLots) || sizeLots <= 0) {
            return arenaJson({ error: "sizeLots must be a positive number.", code: "INVALID_BODY" }, 400);
        }

        const result = await placeOrder(auth.uid, attemptId, {
            symbol: body.symbol,
            side: body.side,
            sizeLots,
            stopLoss: typeof body.stopLoss === "number" ? body.stopLoss : null,
            takeProfit: typeof body.takeProfit === "number" ? body.takeProfit : null,
            clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
        });

        return arenaJson({ trade: result.trade, duplicate: result.duplicate, state: result.state }, result.duplicate ? 200 : 201);
    } catch (error) {
        if (error instanceof ArenaError && error.code === "RULE_VIOLATION") {
            return arenaJson({ error: error.message, code: error.code, violations: error.details }, 422);
        }
        return arenaError(error, "Order failed.");
    }
}
