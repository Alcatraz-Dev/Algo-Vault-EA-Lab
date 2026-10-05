/**
 * Dashboard layout presets & widget normalization (Phase 5 §34).
 *
 * Pure data + a pure transform, extracted from the dashboard page so the
 * preset catalogue and the load/save round-trip can be unit-tested without
 * mounting React (DoD: "Dashboard — widget state persistence").
 */

import { WIDGET_SPEC_BY_TYPE, type DashboardWidget } from "@/components/dashboard/widgets";

export type PresetWidget = [type: string, w: number];

export interface DashboardPreset {
    id: string;
    label: string;
    description: string;
    widgets: PresetWidget[];
}

/**
 * Named starting points. They only reference widget types that already exist
 * in the catalog — a preset can never introduce a widget with no data source.
 */
export const DASHBOARD_PRESETS: DashboardPreset[] = [
    {
        id: "trader",
        label: "Trader",
        description: "Balanced: chart, positions, risk and the day's signals.",
        widgets: [
            ["live_chart", 3],
            ["portfolio_summary", 1],
            ["positions", 2],
            ["risk", 1],
            ["signal_core", 1],
            ["structure_events", 2],
            ["recent_alerts", 1],
            ["equity_curve", 2],
        ],
    },
    {
        id: "scalper",
        label: "Scalper",
        description: "Speed: chart, live signals, volatility and the clock.",
        widgets: [
            ["live_chart", 3],
            ["signal_core", 1],
            ["confidence_meter", 1],
            ["volatility", 1],
            ["market_clock", 1],
            ["structure_events", 2],
            ["positions", 2],
            ["market_score", 1],
        ],
    },
    {
        id: "smart-money",
        label: "Smart Money",
        description: "Structure-led: liquidity, zones, MTF bias and regime.",
        widgets: [
            ["live_chart", 3],
            ["structure_events", 2],
            ["liquidity_map", 1],
            ["zones", 2],
            ["mtf_bias", 1],
            ["market_regime", 1],
            ["volume_analysis", 1],
            ["watchlist", 1],
        ],
    },
    {
        id: "investor",
        label: "Investor",
        description: "Account-first: portfolio, equity, exposure and risk.",
        widgets: [
            ["portfolio_summary", 2],
            ["equity_curve", 3],
            ["accounts", 1],
            ["exposure", 1],
            ["risk", 1],
            ["positions", 2],
            ["correlation_matrix", 2],
            ["market_clock", 1],
        ],
    },
    {
        id: "researcher",
        label: "Researcher",
        description: "Reading the market: regime, breadth, correlation, scores.",
        widgets: [
            ["live_chart", 3],
            ["market_regime", 1],
            ["market_breadth", 2],
            ["correlation_matrix", 2],
            ["market_score", 1],
            ["structure_events", 2],
            ["liquidity_map", 1],
            ["watchlist", 1],
        ],
    },
    {
        id: "ai-trader",
        label: "AI Trader",
        description: "Command centre: AI signal panels with the account around them.",
        widgets: [
            ["live_chart", 3],
            ["signal_core", 1],
            ["confidence_meter", 1],
            ["mtf_bias", 1],
            ["portfolio_summary", 1],
            ["positions", 2],
            ["recent_alerts", 1],
            ["equity_curve", 2],
        ],
    },
];

/**
 * The persistence normalizer: applied when a stored layout is loaded and
 * before every save, so load → save → load is a fixed point. Hostile or
 * stale rows degrade to something renderable (spec-default width, height 1,
 * object config) instead of crashing the board.
 */
export function normalizeWidget(widget: DashboardWidget): DashboardWidget {
    const spec = WIDGET_SPEC_BY_TYPE[widget.type];
    const width = spec?.widths.includes(widget.w) ? widget.w : (spec?.widths[0] ?? 1);
    return { ...widget, w: width, h: widget.h === 2 ? 2 : 1, config: widget.config ?? {} };
}
