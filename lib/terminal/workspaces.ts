/**
 * Terminal workspace presets — Phase 5 §4.
 *
 * A workspace is a *view definition*: which panels are visible, how the rails
 * are sized, the starting timeframe, the default intelligence mode and the
 * Smart Money layers the chart should start with when the symbol has no
 * persisted layer state of its own.
 *
 * Workspaces never fetch anything and never hold data. Switching workspace is
 * a pure state transition — the same panels stay mounted, so no panel
 * re-subscribes to market data. That is deliberate (Phase 5 §37).
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { IntelligenceMode, PanelId, PanelState, WorkspaceId } from "./types";

export interface WorkspacePreset {
    id: WorkspaceId;
    label: string;
    /** One-line description shown in the switcher tooltip. */
    description: string;
    defaultTimeframe: Timeframe;
    defaultIntelligenceMode: IntelligenceMode;
    chatOpen: boolean;
    /** Panel visibility + rail weights. Panels absent from here are hidden. */
    panels: Record<PanelId, PanelState>;
    /** Chart layer hints — only applied where the symbol has no saved layers. */
    layers?: Record<string, boolean>;
    /** Pro-only workspaces stay visible to Free users but are marked. */
    pro: boolean;
}

/** Rail weights are normalised by the shell; they only express relative size. */
function panels(spec: Partial<Record<PanelId, number>>, hidden: PanelId[] = []): Record<PanelId, PanelState> {
    const ids: PanelId[] = ["watchlist", "chart", "intelligence", "account", "events", "chat", "sessions", "monitor"];
    const out = {} as Record<PanelId, PanelState>;
    for (const id of ids) {
        out[id] = {
            visible: !hidden.includes(id) && spec[id] !== undefined,
            size: spec[id] ?? 1,
        };
    }
    return out;
}

// Keys are ChartLayerId values from components/pro-scalping-terminal/chart-layers.ts.
// They are hints only: the chart merges them under any layer state the user
// already persisted for that symbol.
const BASE_LAYERS: Record<string, boolean> = {
    volume: true,
    vwap: false,
    sessionLevels: true,
    prevDayHighLow: true,
    supportResistance: true,
    fvg: true,
    orderBlocks: false,
    bosChoch: true,
    liquidityLevels: false,
    equalHighsLows: false,
    dailyPivots: false,
    ema20: true,
    ema50: false,
    rsiPane: false,
    macdPane: false,
};

const SMC_LAYERS: Record<string, boolean> = {
    ...BASE_LAYERS,
    vwap: true,
    supportResistance: true,
    orderBlocks: true,
    liquidityLevels: true,
    equalHighsLows: true,
    dailyPivots: true,
};

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
    {
        id: "scalping",
        label: "Scalping",
        description: "Tight execution view: watchlist, chart, live signals and a compact risk read-out.",
        defaultTimeframe: "M1",
        defaultIntelligenceMode: "signals",
        chatOpen: false,
        pro: false,
        panels: panels({ watchlist: 0.9, chart: 3, intelligence: 1.1, account: 1, events: 1, chat: 1.2, sessions: 0.7 }),
        layers: { ...BASE_LAYERS, sessionLevels: true, vwap: true, rsiPane: true, atrPane: true },
    },
    {
        id: "day-trading",
        label: "Day Trading",
        description: "Balanced single-chart workspace with structure, positions and the event feed.",
        defaultTimeframe: "M15",
        defaultIntelligenceMode: "structure",
        chatOpen: true,
        pro: false,
        panels: panels({ watchlist: 1, chart: 3, intelligence: 1.2, account: 1.1, events: 1, chat: 1.2 }),
        layers: { ...BASE_LAYERS },
    },
    {
        id: "smart-money",
        label: "Smart Money",
        description: "Structure-first layout: liquidity, imbalances and order blocks take the right rail.",
        defaultTimeframe: "M5",
        defaultIntelligenceMode: "liquidity",
        chatOpen: true,
        pro: true,
        panels: panels({ watchlist: 0.8, chart: 3, intelligence: 1.5, account: 0.9, events: 1.1, chat: 1 }),
        layers: SMC_LAYERS,
    },
    {
        id: "research",
        label: "Research",
        description: "Wide chart, events expanded, no order ticket — for reading the market, not taking it.",
        defaultTimeframe: "H1",
        defaultIntelligenceMode: "structure",
        chatOpen: true,
        pro: true,
        panels: panels({ watchlist: 1, chart: 3.4, intelligence: 1.3, events: 1.5, chat: 1.2 }, ["account"]),
        layers: { ...BASE_LAYERS, supportResistance: true, dailyPivots: true, ema200: true },
    },
    {
        id: "portfolio",
        label: "Portfolio",
        description: "Account-led layout: positions, orders and risk above the intelligence rail.",
        defaultTimeframe: "H4",
        defaultIntelligenceMode: "risk",
        chatOpen: false,
        pro: true,
        panels: panels({ watchlist: 1.2, chart: 2.4, intelligence: 1, account: 1.8, events: 0.9 }, ["chat"]),
        layers: { ...BASE_LAYERS, volume: true },
    },
    {
        id: "ai-trading",
        label: "AI Trading",
        description: "Copilot-forward layout with the chat permanently open beside the chart.",
        defaultTimeframe: "M15",
        defaultIntelligenceMode: "ai",
        chatOpen: true,
        pro: true,
        panels: panels({ watchlist: 0.9, chart: 2.6, intelligence: 1.2, account: 1, events: 1, chat: 1.6 }),
        layers: { ...BASE_LAYERS },
    },
    {
        id: "paper",
        label: "Paper Trading",
        description: "Simulated-account workspace. Everything here is a paper fill — never live.",
        defaultTimeframe: "M5",
        defaultIntelligenceMode: "setups",
        chatOpen: true,
        pro: false,
        panels: panels({ watchlist: 1, chart: 2.8, intelligence: 1.2, account: 1.5, events: 1, chat: 1.2 }),
        layers: { ...BASE_LAYERS },
    },
];

export const WORKSPACE_PRESET_BY_ID: Record<WorkspaceId, WorkspacePreset> = Object.fromEntries(
    WORKSPACE_PRESETS.map((p) => [p.id, p])
) as Record<WorkspaceId, WorkspacePreset>;

export function isWorkspaceId(value: unknown): value is WorkspaceId {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(WORKSPACE_PRESET_BY_ID, value);
}

/** A preset's panels, with sizes normalised so the sum is 1. */
export function normalisedPanels(preset: WorkspacePreset): Record<PanelId, PanelState> {
    const visible = Object.entries(preset.panels).filter(([, p]) => p.visible);
    const total = visible.reduce((sum, [, p]) => sum + (Number.isFinite(p.size) && p.size > 0 ? p.size : 1), 0) || 1;
    const out = {} as Record<PanelId, PanelState>;
    for (const [id, panel] of Object.entries(preset.panels) as Array<[PanelId, PanelState]>) {
        const size = panel.visible ? (Number.isFinite(panel.size) && panel.size > 0 ? panel.size : 1) / total : 0;
        out[id] = { visible: panel.visible, size };
    }
    return out;
}
