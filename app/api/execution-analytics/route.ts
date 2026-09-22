import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

interface Mt5OrderRecord {
    ticket?: unknown;
    symbol?: unknown;
    type?: unknown;
    volume?: unknown;
    profit?: unknown;
    status?: unknown;
    slippageCost?: unknown;
    spreadCost?: unknown;
    commission?: unknown;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const accountId = request.nextUrl.searchParams.get("accountId") || "default";
        const snapshot = await adminDatabase.ref(`mt5_orders/${user.uid}/${accountId}`).get();
        const orders = snapshot.exists() ? snapshot.val() : {};
        const orderRows = Object.values(orders) as Mt5OrderRecord[];
        const orderList = orderRows.map((o) => ({
            ticket: o.ticket, symbol: o.symbol, type: o.type, volume: o.volume,
            profit: Number(o.profit || 0), status: o.status, slippage: Number(o.slippageCost || 0),
            spreadCost: Number(o.spreadCost || 0), commission: Number(o.commission || 0),
        }));
        const filledOrders = orderList.filter((o) => o.status === "FILLED" || o.status === "closed").length;
        const rejectedOrders = orderList.filter((o) => o.status === "REJECTED" || o.status === "FAILED").length;
        const totalSlippage = orderList.reduce((s, o) => s + Math.abs(Number(o.slippage || 0)), 0);
        const totalCosts = totalSlippage + orderList.reduce((s, o) => s + Math.abs(Number(o.spreadCost || 0)), 0) + orderList.reduce((s, o) => s + Math.abs(Number(o.commission || 0)), 0);
        const executionScore = Math.max(0, Math.min(100, 100 - (rejectedOrders > 5 ? 20 : rejectedOrders > 2 ? 10 : 0) - (totalSlippage > 5 ? 15 : totalSlippage > 2 ? 5 : 0)));
        return NextResponse.json({
            success: true,
            execution: {
                totalOrders: orderList.length, filledOrders, rejectedOrders,
                fillRate: orderList.length > 0 ? Math.round((filledOrders / orderList.length) * 100) : 0,
                rejectionRate: orderList.length > 0 ? Math.round((rejectedOrders / orderList.length) * 100) : 0,
                avgSlippage: filledOrders > 0 ? Math.round((totalSlippage / filledOrders) * 100) / 100 : 0,
                totalCosts: Math.round(totalCosts * 100) / 100, executionScore,
                executionQuality: executionScore >= 90 ? "EXCELLENT" : executionScore >= 70 ? "GOOD" : executionScore >= 50 ? "FAIR" : "POOR",
            },
        }, { status: 200 });
    } catch (err: unknown) {
        console.error("[execution-analytics]", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
