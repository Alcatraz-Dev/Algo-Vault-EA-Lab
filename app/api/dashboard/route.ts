import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type Widget = {
    id: string;
    type: string;
    title: string;
    x: number; y: number; w: number; h: number;
    config: Record<string, unknown>;
};

type DashboardConfig = {
    id: string;
    name: string;
    widgets: Widget[];
    createdAt: number;
    updatedAt: number;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const dashRef = adminDatabase.ref(`dashboards/${user.uid}`);
        const snapshot = await dashRef.get();

        if (!snapshot.exists()) {
            const defaultDash: Omit<DashboardConfig, "id"> = {
                name: "My Dashboard",
                widgets: [
                    { id: "w1", type: "portfolio_summary", title: "Portfolio", x: 0, y: 0, w: 2, h: 1, config: {} },
                    { id: "w2", type: "market_score", title: "Market Score", x: 2, y: 0, w: 1, h: 1, config: { symbol: "XAUUSD" } },
                    { id: "w3", type: "risk_gauge", title: "Risk", x: 0, y: 1, w: 1, h: 1, config: {} },
                    { id: "w4", type: "recent_alerts", title: "Alerts", x: 1, y: 1, w: 2, h: 1, config: {} },
                ],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            await dashRef.child("default").set(defaultDash);
            return NextResponse.json({ success: true, dashboards: [{ id: "default", ...defaultDash }] });
        }

        const data = snapshot.val();
        const dashboards = Object.entries(data).map(([id, val]) => ({ id, ...(val as Omit<DashboardConfig, "id">) }));

        return NextResponse.json({ success: true, dashboards });
    } catch (err) {
        console.error("Dashboard GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { name, widgets, dashboardId } = body;

        if (dashboardId) {
            await adminDatabase.ref(`dashboards/${user.uid}/${dashboardId}`).update({
                ...(name && { name }),
                ...(widgets && { widgets }),
                updatedAt: Date.now(),
            });
            return NextResponse.json({ success: true });
        }

        const dashRef = adminDatabase.ref(`dashboards/${user.uid}`).push();
        const dash: Omit<DashboardConfig, "id"> = {
            name: name || "Untitled Dashboard",
            widgets: widgets || [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await dashRef.set(dash);

        return NextResponse.json({ success: true, dashboard: { id: dashRef.key, ...dash } });
    } catch (err) {
        console.error("Dashboard POST error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { dashboardId } = await request.json();
        if (!dashboardId) return NextResponse.json({ error: "dashboardId required" }, { status: 400 });

        await adminDatabase.ref(`dashboards/${user.uid}/${dashboardId}`).remove();
        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
