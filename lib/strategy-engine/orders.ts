/**
 * Canonical order lifecycle (Phase 4).
 *
 * CREATED → SUBMITTED → OPEN → PARTIALLY_FILLED → FILLED
 *                    ↘ CANCELLED / REJECTED
 *
 * Not every environment uses every state (a backtest market order goes
 * CREATED → SUBMITTED → FILLED inside one step), but the abstraction supports
 * the full machine so paper/live can grow into it without changing strategies.
 */

import type { ExecutionFill, Order, OrderIntent, OrderStatus } from "./types";

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
    CREATED: ["SUBMITTED", "CANCELLED", "REJECTED"],
    SUBMITTED: ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED"],
    OPEN: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED"],
    PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED"],
    FILLED: [],
    CANCELLED: [],
    REJECTED: [],
};

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["FILLED", "CANCELLED", "REJECTED"];

export function isTerminalOrder(status: OrderStatus): boolean {
    return TERMINAL_ORDER_STATUSES.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return ORDER_TRANSITIONS[from].includes(to);
}

let orderSeq = 0;

/** Test hook for deterministic order ids. */
export function resetOrderIds(): void {
    orderSeq = 0;
}

export function createOrder(symbol: string, intent: OrderIntent, now: number): Order {
    orderSeq++;
    return {
        id: intent.clientOrderId ?? `ord-${now.toString(36)}-${orderSeq}`,
        clientOrderId: intent.clientOrderId,
        symbol,
        side: intent.side,
        type: intent.type,
        quantity: intent.quantity,
        price: intent.price,
        stopLoss: intent.stopLoss,
        takeProfit: intent.takeProfit,
        status: "CREATED",
        filledQuantity: 0,
        avgFillPrice: 0,
        fills: [],
        reason: intent.reason,
        source: intent.source,
        strategyId: intent.strategyId,
        strategyVersion: intent.strategyVersion,
        positionId: intent.positionId,
        createdAt: now,
        updatedAt: now,
    };
}

/** Invalid transitions return the order unchanged (and are reported). */
export function transitionOrder(
    order: Order,
    to: OrderStatus,
    now: number,
    patch?: Partial<Pick<Order, "rejectReason" | "positionId">>
): { order: Order; changed: boolean; error?: string } {
    if (order.status === to) return { order, changed: false };
    if (!canTransition(order.status, to)) {
        return { order, changed: false, error: `Invalid order transition ${order.status} → ${to}` };
    }
    return {
        order: { ...order, ...patch, status: to, updatedAt: now },
        changed: true,
    };
}

/** Record a fill; recalculates average price and terminal status. */
export function applyFill(order: Order, fill: ExecutionFill): { order: Order; changed: boolean; error?: string } {
    if (isTerminalOrder(order.status)) {
        return { order, changed: false, error: `Order already ${order.status}` };
    }
    if (fill.quantity <= 0 || fill.price <= 0) {
        return { order, changed: false, error: "Invalid fill" };
    }
    if (order.status === "CREATED") {
        const submitted = transitionOrder(order, "SUBMITTED", fill.timestamp);
        if (!submitted.order) return { order, changed: false, error: "Cannot submit" };
        order = submitted.order;
    }

    const filledQuantity = Number((order.filledQuantity + fill.quantity).toFixed(4));
    const totalValue =
        order.avgFillPrice * order.filledQuantity + fill.price * fill.quantity;
    const avgFillPrice = filledQuantity > 0 ? totalValue / filledQuantity : fill.price;
    const fills = [...order.fills, fill];
    const status: OrderStatus = filledQuantity + 1e-9 >= order.quantity ? "FILLED" : "PARTIALLY_FILLED";

    const next = transitionOrder(order, status, fill.timestamp);
    if (next.error) return { order, changed: false, error: next.error };

    return {
        order: {
            ...next.order,
            filledQuantity,
            avgFillPrice: Number(avgFillPrice.toFixed(6)),
            fills,
        },
        changed: true,
    };
}

export function orderProgress(order: Order): number {
    if (order.quantity <= 0) return 0;
    return Math.min(1, order.filledQuantity / order.quantity);
}
