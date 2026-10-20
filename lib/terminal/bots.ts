/**
 * Terminal Bots panel — pure view model.
 *
 * The terminal does not own bot state. This module turns the payload the
 * server already produced (`/api/bot-studio/deployments` + per-bot detail)
 * into the rows the panel renders, so every decision — which lifecycle action
 * is legal, which tone a state gets, whether the panel can render at all — is
 * a pure function testable without React, network or a broker.
 *
 * Rules baked in here:
 *   · a lifecycle action is offered ONLY when the authoritative state machine
 *     (`lib/bot-studio/lifecycle`) has a legal path to that intent;
 *   · a bot the server marked ineligible can never show an enabled Start;
 *   · stopping or pausing never implies closing positions;
 *   · an execution is only "confirmed" when the execution record is filled.
 */

import type {
    BotDeployment,
    BotDeploymentSummary,
    BotExecutionStatus,
    BotLifecycleState,
    BotOpenPosition,
} from "@/lib/bot-studio/types";
import { STATE_LABELS, transitionPath } from "@/lib/bot-studio/lifecycle";
import type { StatusTone } from "@/components/ui/status-badge";

/* ── panel-level states ───────────────────────────────────────────────────── */

export type BotsPanelState =
    | "signed-out"
    | "no-access"
    | "loading"
    | "no-account"
    | "error"
    | "empty"
    | "ready";

export interface BotsPanelInput {
    hasSession: boolean;
    /** The bot endpoints refused this session (Pro / Bot Studio entitlement). */
    accessDenied: boolean;
    /** A trading account (and therefore a gateway identity) is connected. */
    hasAccount: boolean;
    loading: boolean;
    error: string | null;
    count: number;
}

/**
 * Resolves which panel body to render.
 *
 * `no-account` is deliberately distinct from `empty`: the user may own bots
 * but nothing can execute without a connected MT5 account, and saying
 * "no bots" there would be a lie.
 */
export function resolveBotsPanelState(input: BotsPanelInput): BotsPanelState {
    if (!input.hasSession) return "signed-out";
    if (input.accessDenied) return "no-access";
    if (input.loading && input.count === 0) return "loading";
    if (input.error && input.count === 0) return "error";
    // With bots present the panel still lists them (read-only when the gateway
    // is gone); the missing account only decides what an EMPTY panel says.
    if (input.count === 0) return input.hasAccount ? "empty" : "no-account";
    return "ready";
}

/* ── lifecycle intents ────────────────────────────────────────────────────── */

export type BotActionId = "start" | "pause" | "stop";

/** User intent → the lifecycle state the route resolves a legal path to. */
export function botActionTargetState(action: BotActionId): BotLifecycleState {
    switch (action) {
        case "start":
            return "running";
        case "pause":
            return "paused";
        case "stop":
            return "stopped";
    }
}

export interface BotActions {
    start: boolean;
    pause: boolean;
    stop: boolean;
}

/**
 * States in which the bot is already executing (live or simulated).
 *
 * A "start" on one of these is a no-op that would look like a duplicate
 * submission, so it is never offered.
 */
const ALREADY_ACTIVE_STATES: ReadonlySet<BotLifecycleState> = new Set<BotLifecycleState>([
    "running",
    "paper",
]);

/**
 * States in which the bot is already moving to its next state.
 *
 * A competing action here would either duplicate the transition in flight or
 * race it, so the panel offers nothing while a transition is pending.
 */
const TRANSITIONAL_STATES: ReadonlySet<BotLifecycleState> = new Set<BotLifecycleState>([
    "starting",
    "pausing",
    "stopping",
]);

/**
 * States in which a bot is (or was) active and can therefore be halted.
 *
 * A bot that never ran (`draft`, `validating`, `ready`, `backtesting`) has
 * nothing to stop. The state machine would still reach `stopped` from those
 * states — but only through `error`, which would mislabel a healthy, never-
 * started bot as broken.
 */
const STOPPABLE_STATES: ReadonlySet<BotLifecycleState> = new Set<BotLifecycleState>([
    "starting",
    "running",
    "pausing",
    "paused",
    "paper",
    "error",
]);

/**
 * Which lifecycle actions are legal from `state`.
 *
 * Uses the canonical state machine rather than a second copy of the rules, and
 * excludes the current state (a "start" on a running bot is a no-op that would
 * otherwise look like a duplicate submission).
 */
export function botActions(state: BotLifecycleState): BotActions {
    const moving = TRANSITIONAL_STATES.has(state);
    return {
        start:
            !moving &&
            !ALREADY_ACTIVE_STATES.has(state) &&
            transitionPath(state, "running") !== null,
        pause:
            !moving &&
            state !== "paused" &&
            transitionPath(state, "paused") !== null,
        stop: STOPPABLE_STATES.has(state) && transitionPath(state, "stopped") !== null,
    };
}

/* ── presentation ─────────────────────────────────────────────────────────── */

const STATE_TONES: Record<BotLifecycleState, StatusTone> = {
    draft: "neutral",
    validating: "pending",
    ready: "neutral",
    backtesting: "info",
    paper: "info",
    starting: "pending",
    running: "live",
    pausing: "pending",
    paused: "warning",
    stopping: "pending",
    stopped: "offline",
    error: "negative",
};

export function botStateTone(state: BotLifecycleState): StatusTone {
    return STATE_TONES[state] ?? "neutral";
}

export function botStateLabel(state: BotLifecycleState): string {
    return STATE_LABELS[state] ?? state;
}

/** `DEMO` / `LIVE`, straight from the deployment record. Never inferred. */
export function botModeLabel(mode: BotDeployment["accountMode"]): "DEMO" | "LIVE" {
    return mode === "live" ? "LIVE" : "DEMO";
}

export function formatSignedUsd(value: number | null | undefined): string {
    // `Number(null)` is 0 — a missing amount must read as "unknown", never as
    // a confident "$0.00".
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/** Short, honest age label. `null` timestamp is "never", not "0s ago". */
export function relativeAgeLabel(now: number, timestamp: number | null | undefined): string {
    if (!timestamp || !Number.isFinite(timestamp)) return "never";
    const diff = Math.max(0, now - Number(timestamp));
    if (diff < 5_000) return "just now";
    if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Tone for an execution status.
 *
 * `filled` is the only confirmed outcome. `uncertain` is explicitly NOT
 * success: the gateway could neither confirm nor reject the order.
 */
export function executionStatusTone(status: BotExecutionStatus | string | null | undefined): StatusTone {
    switch (status) {
        case "filled":
            return "positive";
        case "rejected_by_broker":
        case "failed":
            return "negative";
        case "uncertain":
            return "warning";
        case "cancelled":
        case "expired":
            return "offline";
        case "acknowledged":
        case "submitted":
        case "executed_pending_sync":
            return "pending";
        default:
            return "neutral";
    }
}

export function executionStatusLabel(status: BotExecutionStatus | string | null | undefined): string {
    if (!status) return "—";
    return String(status).replace(/_/g, " ");
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

export interface BotRowView {
    id: string;
    name: string;
    strategyName: string | null;
    symbol: string | null;
    timeframe: string | null;
    state: BotLifecycleState;
    stateLabel: string;
    stateTone: StatusTone;
    mode: "DEMO" | "LIVE";
    openPositions: number;
    floatingPnl: number;
    performance: BotDeploymentSummary["performance"];
    lastExecutionAt: number | null;
    lastExecutionStatus: BotExecutionStatus | null;
    eligibility: BotDeploymentSummary["eligibility"];
    /** Legal lifecycle actions, further gated by eligibility for `start`. */
    actions: BotActions;
    /**
     * True when a start is legal for the bot's state — regardless of whether
     * it may actually execute. The panel shows the button (disabled, with a
     * reason) instead of silently hiding it.
     */
    startAvailable: boolean;
    /** Set when a start is refused, so the button can explain itself. */
    startBlockedReason: string | null;
    account: string;
}

/**
 * Builds one row.
 *
 * `start` additionally requires eligibility: a legal transition is not the same
 * thing as an executable one (gateway offline, live disabled, strategy drift).
 */
export function botRowView(
    deployment: BotDeployment,
    summary: BotDeploymentSummary | undefined
): BotRowView {
    const actions = botActions(deployment.runtimeState);
    const eligibility = summary?.eligibility ?? {
        eligible: true,
        code: "eligible" as const,
        reason: null,
        warning: false,
    };
    const canStart = actions.start && eligibility.eligible;

    return {
        id: deployment.id,
        name: summary?.strategyName || deployment.strategyId,
        strategyName: summary?.strategyName ?? null,
        symbol: summary?.symbol ?? null,
        timeframe: summary?.timeframe ?? null,
        state: deployment.runtimeState,
        stateLabel: botStateLabel(deployment.runtimeState),
        stateTone: botStateTone(deployment.runtimeState),
        mode: botModeLabel(deployment.accountMode),
        openPositions: summary?.openPositions ?? 0,
        floatingPnl: summary?.floatingPnl ?? 0,
        performance: summary?.performance ?? null,
        lastExecutionAt: summary?.lastExecutionAt ?? null,
        lastExecutionStatus: summary?.lastExecutionStatus ?? null,
        eligibility,
        actions: { start: canStart, pause: actions.pause, stop: actions.stop },
        startAvailable: actions.start,
        startBlockedReason: canStart ? null : actions.start ? eligibility.reason : null,
        account: deployment.mt5Account,
    };
}

export interface BotsHeaderSummary {
    total: number;
    running: number;
    paused: number;
    openPositions: number;
    floatingPnl: number;
}

export function summariseBots(rows: BotRowView[]): BotsHeaderSummary {
    return rows.reduce<BotsHeaderSummary>(
        (acc, row) => {
            acc.total += 1;
            if (row.state === "running") acc.running += 1;
            if (row.state === "paused") acc.paused += 1;
            acc.openPositions += row.openPositions;
            acc.floatingPnl += row.floatingPnl;
            return acc;
        },
        { total: 0, running: 0, paused: 0, openPositions: 0, floatingPnl: 0 }
    );
}

/* ── gateway reachability ─────────────────────────────────────────────────── */

// Re-exported so the panel and its tests read reachability from one rule
// (`lib/trading/gateway/health`), never a second copy of the 90s window.
export { GATEWAY_FRESH_MS, isGatewayConnected as gatewayConnected } from "@/lib/trading/gateway/health";

/* ── positions / executions for the expanded row ──────────────────────────── */

export interface BotPositionRow {
    ticket: string;
    symbol: string;
    side: "BUY" | "SELL";
    volume: number;
    openPrice: number;
    currentPrice: number;
    profit: number;
}

export function botPositionRows(positions: BotOpenPosition[] | null | undefined): BotPositionRow[] {
    if (!Array.isArray(positions)) return [];
    return positions
        .filter((p) => p && typeof p === "object" && String(p.ticket ?? "") !== "")
        .map((p) => ({
            ticket: String(p.ticket),
            symbol: String(p.symbol || ""),
            side: String(p.type).toUpperCase() === "SELL" ? "SELL" : "BUY",
            volume: Number(p.volume) || 0,
            openPrice: Number(p.openPrice) || 0,
            currentPrice: Number(p.currentPrice) || 0,
            profit: Number(p.profit) || 0,
        }));
}
