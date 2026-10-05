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

/**
 * Widget types the current UI renders. Anything outside this list has no
 * renderer, so stored layouts are migrated on read rather than rendering blanks.
 * Mirrors WIDGET_SPEC_BY_TYPE in components/dashboard/widgets.tsx.
 */
const SUPPORTED_WIDGET_TYPES = new Set([
    "portfolio_summary",
    "accounts",
    "equity_curve",
    "market_score",
    "risk",
    "positions",
    "exposure",
    "recent_alerts",
    "watchlist",
    "market_clock",
    // Command centre
    "signal_core",
    "confidence_meter",
    "live_chart",
    "mtf_bias",
    // Pro tier
    "market_regime",
    "volatility",
    "volume_analysis",
    "structure_events",
    "liquidity_map",
    "zones",
    "correlation_matrix",
    "market_breadth",
]);

/** Legacy type → current type. Old ids/types persisted for existing users. */
const LEGACY_WIDGET_TYPES: Record<string, string> = {
    risk_gauge: "risk",
    positions_table: "positions",
    performance_chart: "equity_curve",
    watchlist迷你: "watchlist",
};

const LEGACY_WIDGET_TITLES: Record<string, string> = {
    portfolio_summary: "Portfolio Summary",
    risk: "Risk & Margin",
    positions: "Open Positions",
    equity_curve: "Equity Curve",
    market_score: "Market Score",
    recent_alerts: "Recent Alerts",
    exposure: "Symbol Exposure",
    accounts: "Connected Accounts",
    watchlist: "Watchlist",
    market_clock: "Market Clock",
    signal_core: "Signal Core",
    confidence_meter: "Signal Confidence",
    live_chart: "Live Chart",
    mtf_bias: "Multi-Timeframe Bias",
    market_regime: "Market Regime",
    volatility: "Volatility Profile",
    volume_analysis: "Volume Analysis",
    structure_events: "Structure Events",
    liquidity_map: "Liquidity Map",
    zones: "Active Zones",
    correlation_matrix: "Correlation Matrix",
    market_breadth: "Symbol Scores",
};

/**
 * Maps a stored widget onto a type the UI can render. Returns null for types
 * that no longer have a renderer — dropping them on read (not on write) keeps
 * the stored layout intact while the UI stays blank-free.
 */
function migrateWidget(widget: Widget): Widget | null {
    const type = LEGACY_WIDGET_TYPES[widget.type] ?? widget.type;
    if (!SUPPORTED_WIDGET_TYPES.has(type)) return null;
    return {
        ...widget,
        type,
        title: LEGACY_WIDGET_TITLES[type] ?? widget.title,
        config: widget.config ?? {},
    };
}

function buildDefaultDashboard(): Omit<DashboardConfig, "id"> {
    const now = Date.now();
    return {
        name: "My Dashboard",
        widgets: [
            { id: "w_portfolio", type: "portfolio_summary", title: "Portfolio Summary", x: 0, y: 0, w: 3, h: 1, config: {} },
            { id: "w_equity", type: "equity_curve", title: "Equity Curve", x: 0, y: 1, w: 2, h: 2, config: {} },
            { id: "w_score", type: "market_score", title: "Market Score", x: 0, y: 2, w: 1, h: 2, config: { symbol: "XAUUSD", timeframe: "H1" } },
            { id: "w_positions", type: "positions", title: "Open Positions", x: 0, y: 3, w: 2, h: 1, config: {} },
            { id: "w_alerts", type: "recent_alerts", title: "Recent Alerts", x: 0, y: 4, w: 1, h: 1, config: {} },
        ],
        createdAt: now,
        updatedAt: now,
    };
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const dashRef = adminDatabase.ref(`dashboards/${user.uid}`);
        const snapshot = await dashRef.get();

        if (!snapshot.exists()) {
            const defaultDash = buildDefaultDashboard();
            await dashRef.child("default").set(defaultDash);
            return NextResponse.json({ success: true, dashboards: [{ id: "default", ...defaultDash }] });
        }

        const data = snapshot.val();
        const dashboards = Object.entries(data).map(([id, val]) => {
            const dash = val as Omit<DashboardConfig, "id">;
            return {
                id,
                ...dash,
                widgets: (dash.widgets || []).map(migrateWidget).filter((w): w is Widget => w !== null),
            };
        });

        // A layout that migrates down to zero renderable widgets is useless in the
        // UI, so fall back to the default layout rather than rendering an empty page.
        if (dashboards.length > 0 && dashboards.every((d) => d.widgets.length === 0)) {
            const defaultDash = buildDefaultDashboard();
            await dashRef.child("default").set(defaultDash);
            return NextResponse.json({ success: true, dashboards: [{ id: "default", ...defaultDash }] });
        }

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
