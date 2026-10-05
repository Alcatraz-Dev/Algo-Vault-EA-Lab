import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../../_shared";
import { placeOrder, closePosition, previewPartialClose, modifyPositionStops, cancelPendingOrder, ArenaError } from "@/lib/performance-arena/service";

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
    entryPrice?: unknown;
    orderType?: unknown;
    stopLossProvided?: unknown;
    takeProfitProvided?: unknown;
    orderId?: unknown;
    tradeId?: unknown;
    clientRequestId?: unknown;
    /** Partial close: absolute lot amount (mutually exclusive with percent). */
    closeLots?: unknown;
    /** Partial close: percent of the position VOLUME to close. */
    percent?: unknown;
    /**
     * Partial close: percent of the position's CURRENT NET UNREALIZED PROFIT to
     * lock. Mutually exclusive with closeLots/percent — the two modes mean
     * different things and are never inferred from one another.
     */
    profitPercent?: unknown;
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

        if (action === "close" || action === "previewClose") {
            if (typeof body.tradeId !== "string" || !body.tradeId) {
                return arenaJson({ error: "tradeId is required to close a position.", code: "INVALID_BODY" }, 400);
            }
            // Omitting every size field closes the whole position.
            const closeLots = body.closeLots === undefined || body.closeLots === null ? undefined : Number(body.closeLots);
            const percent = body.percent === undefined || body.percent === null ? undefined : Number(body.percent);
            const profitPercent = body.profitPercent === undefined || body.profitPercent === null ? undefined : Number(body.profitPercent);
            if (closeLots !== undefined && (!Number.isFinite(closeLots) || closeLots <= 0)) {
                return arenaJson({ error: "closeLots must be a positive number.", code: "INVALID_BODY" }, 400);
            }
            if (percent !== undefined && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
                return arenaJson({ error: "percent must be greater than 0 and at most 100.", code: "INVALID_BODY" }, 400);
            }
            if (profitPercent !== undefined && (!Number.isFinite(profitPercent) || profitPercent <= 0 || profitPercent > 100)) {
                return arenaJson({ error: "profitPercent must be greater than 0 and at most 100.", code: "INVALID_BODY" }, 400);
            }
            const provided = [closeLots, percent, profitPercent].filter((value) => value !== undefined);
            if (provided.length > 1) {
                return arenaJson(
                    { error: "Provide at most one of closeLots, percent or profitPercent.", code: "INVALID_BODY" },
                    400
                );
            }
            const size =
                closeLots !== undefined || percent !== undefined || profitPercent !== undefined
                    ? { lots: closeLots, percent, profitPercent }
                    : undefined;

            // Preview: same engine, same quote as the close that follows it.
            if (action === "previewClose") {
                const plan = await previewPartialClose(auth.uid, attemptId, body.tradeId, size);
                return arenaJson({ plan });
            }

            const state = await closePosition(
                auth.uid,
                attemptId,
                body.tradeId,
                typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
                size
            );
            return arenaJson({ state });
        }

        if (action === "cancelPending") {
            if (typeof body.orderId !== "string" || !body.orderId) return arenaJson({ error: "orderId is required.", code: "INVALID_BODY" }, 400);
            const state = await cancelPendingOrder(auth.uid, attemptId, body.orderId);
            return arenaJson({ state });
        }
        if (action === "modifyStops") {
            if (typeof body.tradeId !== "string" || !body.tradeId) return arenaJson({ error: "tradeId is required.", code: "INVALID_BODY" }, 400);
            const stopLoss = body.stopLossProvided === true ? body.stopLoss === null ? null : typeof body.stopLoss === "number" ? body.stopLoss : undefined : undefined;
            const takeProfit = body.takeProfitProvided === true ? body.takeProfit === null ? null : typeof body.takeProfit === "number" ? body.takeProfit : undefined : undefined;
            if (body.stopLossProvided === true && stopLoss === undefined || body.takeProfitProvided === true && takeProfit === undefined) return arenaJson({ error: "Stop and target must be a number or null.", code: "INVALID_BODY" }, 400);
            if (stopLoss === undefined && takeProfit === undefined) return arenaJson({ error: "stopLoss or takeProfit must be provided.", code: "INVALID_BODY" }, 400);
            const state = await modifyPositionStops(auth.uid, attemptId, body.tradeId, { stopLoss, takeProfit });
            return arenaJson({ state });
        }
        if (action !== "market" && action !== "limit" && action !== "stop") {
            return arenaJson({ error: "action must be market | limit | stop | close | previewClose | modifyStops | cancelPending.", code: "INVALID_BODY" }, 400);
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
            stopLoss: typeof body.stopLoss === "number" ? body.stopLoss : body.stopLoss === null ? null : undefined,
            takeProfit: typeof body.takeProfit === "number" ? body.takeProfit : body.takeProfit === null ? null : undefined,
            entryPrice: typeof body.entryPrice === "number" ? body.entryPrice : null,
            orderType: action,
            clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
        });

        return arenaJson(
            {
                trade: result.trade,
                duplicate: result.duplicate,
                reduced: result.reduced,
                reducedCentiLots: result.reducedCentiLots,
                state: result.state,
            },
            result.duplicate ? 200 : 201
        );
    } catch (error) {
        if (error instanceof ArenaError && error.code === "RULE_VIOLATION") {
            return arenaJson({ error: error.message, code: error.code, violations: error.details }, 422);
        }
        return arenaError(error, "Order failed.");
    }
}
