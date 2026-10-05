/**
 * AlgoVault Terminal — Phase 5 shared workspace types.
 *
 * Pure data contracts for the unified trading workspace. Nothing in this file
 * performs I/O or reaches for `window`; persistence and React live one layer
 * above (`components/terminal/TerminalContext.tsx`).
 *
 * Rule: a terminal field either carries a value that came from a real engine,
 * or it is explicitly `null`. There is no third state — the UI renders
 * "unavailable", never a guess.
 */

import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";

/* ── Workspaces ───────────────────────────────────────────────────────────── */

export const WORKSPACE_IDS = [
    "scalping",
    "day-trading",
    "smart-money",
    "research",
    "portfolio",
    "ai-trading",
    "paper",
] as const;

export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

/* ── Panels ───────────────────────────────────────────────────────────────── */

export const PANEL_IDS = [
    "watchlist",
    "chart",
    "intelligence",
    "account",
    "events",
    "chat",
    "sessions",
    "monitor",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelState {
    visible: boolean;
    /** Rail weight (0..1) — the shell normalises it into a grid/fr size. */
    size: number;
}

/* ── Intelligence ─────────────────────────────────────────────────────────── */

export const INTELLIGENCE_MODES = [
    "structure",
    "liquidity",
    "setups",
    "signals",
    "risk",
    "portfolio",
    "ai",
] as const;

export type IntelligenceMode = (typeof INTELLIGENCE_MODES)[number];

/* ── Account / connection ─────────────────────────────────────────────────── */

/**
 * What kind of account the terminal is acting on. `unknown` is a real state:
 * the terminal has not established an account, so every execution control is
 * disabled rather than assumed to be paper.
 */
export type AccountMode = "paper" | "live" | "unknown";

export type ConnectionStatus = "live" | "stale" | "disconnected" | "loading";

/* ── Persisted terminal state ─────────────────────────────────────────────── */

export interface TerminalState {
    version: 1;
    workspace: WorkspaceId;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    /** Ordered symbols of the active watchlist group. */
    watchlist: string[];
    /** Group name → symbols. Custom groups are user-defined and stored locally. */
    watchlistGroups: Record<string, string[]>;
    /** Favourite symbols, surfaced as their own group. */
    favorites: string[];
    panels: Record<PanelId, PanelState>;
    intelligenceMode: IntelligenceMode;
    chatOpen: boolean;
    accountMode: AccountMode;
}

/* ── Chart focus (event → chart navigation, Phase 5 §32) ──────────────────── */

/**
 * A request to move the shared chart to a specific point in time. Bumped
 * `seq` guarantees repeated clicks on the same event still fire.
 */
export interface ChartFocusRequest {
    seq: number;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    /** Epoch ms of the bar to centre on. */
    time: number;
    /** Optional price to centre the price scale on. */
    price?: number;
    /** Event id — the chart can mark it. */
    eventId?: string;
    label?: string;
}

/* ── Events (Phase 5 §31) ─────────────────────────────────────────────────── */

export type TerminalEventType =
    | "BOS"
    | "CHOCH"
    | "SWEEP"
    | "FVG_CREATED"
    | "FVG_MITIGATED"
    | "OB_CREATED"
    | "OB_MITIGATED"
    | "STRATEGY_SIGNAL"
    | "POSITION_OPENED"
    | "POSITION_CLOSED"
    | "RISK_WARNING"
    | "ALERT_TRIGGERED"
    | "SESSION_CHANGE";

export type TerminalEventSource =
    | "smart-money"
    | "analysis"
    | "signal"
    | "strategy"
    | "account"
    | "risk"
    | "alert"
    | "session";

export interface TerminalEvent {
    id: string;
    /** Epoch ms. */
    timestamp: number;
    symbol: string;
    timeframe: Timeframe;
    type: TerminalEventType;
    source: TerminalEventSource;
    title: string;
    detail?: string;
    /** Level/price the event refers to, when the engine produced one. */
    price?: number;
    severity: "info" | "notice" | "warning" | "critical";
}

/* ── Trading chat context (Phase 5 §23) ───────────────────────────────────── */

/**
 * Structured context handed to the trading chat. Every section is optional
 * and every leaf is nullable — a missing engine result becomes `null` plus a
 * `missing[]` entry, never an invented default.
 */
export interface TradingChatContext {
    /** Always present. */
    session: {
        workspace: WorkspaceId;
        accountMode: AccountMode;
        generatedAt: number;
        /** Freshness of the market slice, ms since the newest candle/quote. */
        marketAgeMs: number | null;
    };
    market: {
        symbol: string;
        timeframe: string;
        lastPrice: number | null;
        changePct: number | null;
        session: string | null;
        sessionLabel: string | null;
        regime: string | null;
        volatility: string | null;
        dataAsOf: number | null;
    };
    chart: {
        chartType: string | null;
        activeLayers: string[] | null;
        drawings: number | null;
    } | null;
    indicators: Array<{ name: string; value: number | null; status: string }> | null;
    smartMoney: {
        structureBias: string | null;
        structureEvents: Array<{ type: string; direction: string; price: number; timestamp: number }> | null;
        liquidity: Array<{ type: string; price: number; strength: number }> | null;
        sweeps: Array<{ side: string; level: number; confirmed: boolean; timestamp: number }> | null;
        imbalances: Array<{ direction: string; high: number; low: number; status: string; createdAt: number }> | null;
        orderBlocks: Array<{ direction: string; high: number; low: number; status: string; createdAt: number }> | null;
        multiTimeframe: Array<{ timeframe: string; bias: string; available: boolean }> | null;
    };
    strategy: {
        activeStrategy: string | null;
        lastDecision: string | null;
        decisionReasons: string[] | null;
    } | null;
    positions: Array<{
        ticket: string;
        symbol: string;
        side: string;
        size: number;
        entry: number;
        current: number | null;
        sl: number | null;
        tp: number | null;
        pnl: number | null;
        openedAt: number | null;
        strategy: string | null;
    }> | null;
    orders: Array<{
        ticket: string;
        symbol: string;
        type: string;
        size: number;
        price: number;
        sl: number | null;
        tp: number | null;
        status: string;
    }> | null;
    risk: {
        status: "SAFE" | "WARNING" | "RESTRICTED" | "HALTED" | null;
        dailyLossPct: number | null;
        openRiskPct: number | null;
        exposurePct: number | null;
        equity: number | null;
        balance: number | null;
        availableMargin: number | null;
        usedMargin: number | null;
        reasons: string[] | null;
    } | null;
    setups: Array<{
        id: string;
        symbol: string;
        timeframe: string;
        state: string;
        matched: number;
        total: number;
        evidence: string[];
        entry?: number | null;
        invalidation?: number | null;
        target?: number | null;
    }> | null;
    recentTrades: Array<{ closedAt: number; symbol: string; side: string; pnl: number | null }> | null;
    backtest: { strategy: string; symbol: string; timeframe: string; trades: number; winRate: number | null; netPnl: number | null } | null;
    replay: { active: boolean; position: number | null } | null;
    alerts: Array<{ id: string; symbol: string; condition: string; triggered: boolean }> | null;
    /** The user's question — echoed so the payload is self-describing. */
    question: string;
    /**
     * Names of sections that could NOT be filled because the engine/data was
     * unavailable. The chat MUST refuse to speak about these as if current.
     */
    missing: string[];
}
