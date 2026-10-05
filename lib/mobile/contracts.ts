/**
 * Phase 11 — canonical cross-device contracts.
 *
 * THIS FILE IS THE ONLY PLACE mobile/responsive/PWA state is described. Desktop
 * web, PWA and any native client all speak these types. There is deliberately no
 * `MobileWorkspace`, `MobilePreference` or `MobileSignal` anywhere in the repo:
 * the *client* differs, the *contract* does not.
 *
 * What lives here:
 *   §1  Sync envelope        — versioning, timestamps, device attribution
 *   §2  Workspace state      — what the user is looking at
 *   §3  User preferences     — durable preferences across devices
 *   §4  Freshness / transport— LIVE | DELAYED | STALE | OFFLINE | RECONNECTING
 *   §5  Deep links           — canonical route construction + parsing
 *   §6  Live-order safety    — the fail-closed gate contract
 *
 * Pure module: no I/O, no Firebase, no React. Everything here is unit-testable
 * without a network, which is how the Phase 11 test suite exercises it.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { WorkspaceId } from "@/lib/terminal/types";

// ─────────────────────────────────────────────────────────────────────────────
// §1  Sync envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every client identifies itself with a stable, non-identifying device id.
 *
 * This is generated locally on first launch and stored in device-local storage.
 * It is NOT a hardware identifier, contains no IMEI/IDFA/advertising id, and is
 * never derived from anything the user did not install the app for. It exists
 * only so a conflict can be resolved deterministically and so an admin can see
 * "3 active devices" without knowing who they belong to.
 */
export interface DeviceInfo {
    deviceId: string;
    /** Which client surface wrote the change. */
    platform: DevicePlatform;
    /** Short human label, e.g. "iPhone · App Store". Never contains PII. */
    label: string;
    /** Installed app / bundle version, e.g. "1.4.2". `web` for the browser client. */
    appVersion: string;
    /** OS version string, e.g. "iOS 18.2". Reported only, never used for logic. */
    osVersion: string;
    /** Last time this device successfully synced. Server-maintained. */
    lastSeenAt?: number;
}

export type DevicePlatform = "web" | "ios" | "android" | "pwa" | "unknown";

/**
 * A revisioned record envelope.
 *
 * The contract is intentionally explicit about ordering. `revision` is a
 * monotonic integer bumped by the server on every accepted write, so two devices
 * can compare orderings without trusting their clocks. `updatedAt` is wall-clock
 * and is only ever a *tiebreak* — two devices with skewed clocks must still agree
 * on the winner.
 */
export interface SyncEnvelope<T> {
    revision: number;
    updatedAt: number;
    updatedByDevice: string;
    updatedByPlatform: DevicePlatform;
    data: T;
}

/** Why a merge produced the value it produced. Surfaced in the sync debugger. */
export type MergeOutcome = "local" | "remote" | "identical" | "merged";

export interface MergeResult<T> {
    /** The winning data after the merge. */
    data: T;
    /** The winning envelope. */
    envelope: SyncEnvelope<T>;
    /** Per-key outcomes, for the sync inspector and for conflict telemetry. */
    conflicts: FieldConflict[];
}

export interface FieldConflict {
    key: string;
    outcome: MergeOutcome;
    localRevision: number;
    remoteRevision: number;
    /** Human-readable reason, e.g. "newer revision" / "equal revision, device id tiebreak". */
    reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// §2  Workspace state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The user's *view context*: what chart, what symbol, what layers, what panels.
 *
 * This is the object a user expects to follow them from desktop to phone. It
 * carries no market data and no trading state — it only points at it. That
 * separation is why a stale workspace is never mistaken for a stale price.
 */
export interface WorkspaceState {
    /** Which terminal layout is active. One of the canonical presets. */
    activeWorkspace: WorkspaceId;
    /** Selected instrument, e.g. "XAUUSD". `null` means "not chosen yet". */
    selectedSymbol: string | null;
    /** Selected timeframe on the primary chart. */
    selectedTimeframe: Timeframe;
    /** Which symbol the primary chart is focused on, when it differs from the watchlist selection. */
    chartSymbol: string | null;
    /** Chart presentation preferences that are not per-symbol. */
    chartLayout: ChartLayoutState;
    /** Indicator configuration, keyed by stable indicator id. */
    indicatorConfig: Record<string, IndicatorConfigState>;
    /** User-drawn objects, keyed by symbol so desktop and mobile agree. */
    drawings: Record<string, DrawingObjectState[]>;
    /** Watchlists, ordered. Order is user-controlled and therefore synced. */
    watchlists: Watchlist[];
    /** Which Smart Money / analytics layers are visible. */
    layers: Record<string, boolean>;
    /** Panel visibility + sizes, keyed by canonical panel id. */
    panels: Record<string, PanelStateRecord>;
    /** Terminal preferences that are not panel layout. */
    terminal: TerminalPreferences;
}

export interface ChartLayoutState {
    /** Visible candle count in the viewport. */
    barsVisible: number;
    /** How far the viewport is scrolled back from the right edge, in bars. */
    offsetBars: number;
    chartType: "candles" | "bars" | "line" | "area" | "heikinashi";
    showGrid: boolean;
    showCrosshair: boolean;
    showVolume: boolean;
    /** Right price axis visible. */
    showPriceScale: boolean;
    /** Bottom time axis visible. */
    showTimeScale: boolean;
}

export interface IndicatorConfigState {
    id: string;
    enabled: boolean;
    /** Symbol-scoped indicators should carry their symbol; global ones omit it. */
    symbol?: string;
    timeframe?: Timeframe;
    params: Record<string, number | string | boolean>;
}

export interface PanelStateRecord {
    visible: boolean;
    /** Relative weight. The shell normalises; only ratios are meaningful. */
    size: number;
}

export interface TerminalPreferences {
    /** Which intelligence rail is active. */
    intelligenceMode: string;
    /** Chat panel open. */
    chatOpen: boolean;
    /** Ordering of intelligence sub-views. */
    railOrder: string[];
}

/**
 * A drawing object in MARKET coordinates.
 *
 * This is the contract that keeps a desktop trend line identical on a phone.
 * `points` are (timeMs, price) pairs — the same coordinate space the chart
 * engine's `barIndexForTime` and price scale consume. A mobile client must never
 * persist pixel coordinates; there is no field here for them.
 */
export interface DrawingObjectState {
    id: string;
    /** One of the canonical drawing tool ids. Unknown tools are preserved, not dropped. */
    type: string;
    symbol: string;
    points: Array<{ time: number; price: number }>;
    /** Optional text annotation payload. */
    text?: string;
    style: {
        color: string;
        width: number;
        lineStyle: "solid" | "dashed" | "dotted";
        fill?: string;
        extendLeft?: boolean;
        extendRight?: boolean;
    };
    /** Epoch ms the object was created, used for deterministic tiebreaks. */
    createdAt: number;
    updatedAt: number;
    /** Last device to touch this object. */
    updatedByDevice?: string;
}

export interface Watchlist {
    id: string;
    name: string;
    symbols: string[];
    /** Position within the watchlist rail. User-controlled, therefore synced. */
    order: number;
    updatedAt: number;
    updatedByDevice?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// §3  User preferences
// ─────────────────────────────────────────────────────────────────────────────

/** Durable preferences. Synced separately from workspace so a new device can
 *  render in the right theme before the workspace is known. */
export interface UserPreferences {
    theme: "dark" | "light" | "system";
    language: string;
    /** Default timeframe for a fresh chart. */
    defaultTimeframe: Timeframe;
    /** Symbols starred anywhere in the product. */
    favoriteSymbols: string[];
    /** Markets the user actually trades. Drives the mobile command center ordering. */
    preferredMarkets: string[];
    /** Notification routing. */
    notifications: NotificationPreferences;
    /** Chart preferences that are not workspace-scoped. */
    chart: {
        theme: "dark" | "light";
        fontSize: "small" | "medium" | "large";
        showWatermark: boolean;
        crosshairMode: "normal" | "magnet";
    };
    /** Set true once the user has been asked; guards re-prompting. */
    onboardingSeen?: boolean;
}

export interface NotificationPreferences {
    enabled: boolean;
    price: boolean;
    indicator: boolean;
    smartMoney: boolean;
    setup: boolean;
    strategy: boolean;
    risk: boolean;
    position: boolean;
    research: boolean;
    system: boolean;
    /**
     * Collapse several events on the same symbol/timeframe into one grouped
     * notification. This is the anti-spam switch.
     */
    grouping: boolean;
    /** Quiet hours in minutes from local midnight. Both bounds may be absent. */
    quietHours?: { startMinute: number; endMinute: number };
    /** Minimum seconds between two notifications in the same group. */
    cooldownSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  Freshness & transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The five states a trader must be able to see at a glance.
 *
 * `LIVE` is the only state in which a live order may be submitted. `DELAYED` is
 * live data that is running behind. `STALE` is data that stopped updating.
 * `OFFLINE` means no transport. `RECONNECTING` means a transport is being
 * re-established. Anything not `LIVE` fails the gate in §6.
 */
export type DataFreshness = "live" | "delayed" | "stale" | "offline" | "reconnecting";

export interface FreshnessDescriptor {
    freshness: DataFreshness;
    /** Epoch ms of the newest datum represented by the view. */
    dataTimestamp: number;
    /** Epoch ms the client computed this descriptor. */
    evaluatedAt: number;
    /** Where the numbers came from, e.g. "twelvedata" or "cache". Never a secret. */
    source: string;
    /** True when the value shown came from a local cache rather than the wire. */
    fromCache: boolean;
    /** Set when the feed itself reports a delay (e.g. exchange latency). */
    providerDelayMs?: number;
}

export const FRESHNESS_LABEL: Record<DataFreshness, string> = {
    live: "LIVE",
    delayed: "DELAYED",
    stale: "STALE",
    offline: "OFFLINE",
    reconnecting: "RECONNECTING",
};

// ─────────────────────────────────────────────────────────────────────────────
// §5  Deep links
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical deep-link routes.
 *
 * Every notification, email, share link and push payload resolves to one of
 * these. They are constructed by `buildDeepLink` and parsed by `parseDeepLink`,
 * so a route can never drift between the sender and the receiver.
 */
export type DeepLinkTarget =
    | { kind: "terminal"; symbol: string; timeframe?: Timeframe }
    | { kind: "setup"; setupId: string }
    | { kind: "alert"; alertId: string }
    | { kind: "research"; researchId: string }
    | { kind: "strategy"; strategyId: string }
    | { kind: "journal"; entryId: string }
    | { kind: "position"; positionId: string }
    | { kind: "terminal-home" };

/** Where a deep link should land when the surface is a phone. */
export type DeepLinkSurface = "desktop" | "mobile" | "universal";

/** A parsed deep link: the route plus the auth context needed to honour it. */
export interface DeepLink {
    target: DeepLinkTarget;
    surface: DeepLinkSurface;
    /**
     * Path to navigate to *after* authentication, when the user is signed out.
     * Always an internal absolute path — never an arbitrary URL, so this cannot
     * be used as an open redirect.
     */
    returnTo: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  Live-order safety
// ─────────────────────────────────────────────────────────────────────────────

export type TradingMode = "paper" | "live";

/**
 * The result of the pre-submit gate. Live orders FAIL CLOSED: any `blocker`
 * present means the order is not submitted. Paper orders may proceed with
 * blockers present, provided the UI labels the cached state honestly.
 */
export interface OrderSafetyEvaluation {
    allowed: boolean;
    /** Hard blockers. Present ⇒ `allowed` is false for live mode. */
    blockers: OrderSafetyBlocker[];
    /** Non-blocking warnings worth showing, e.g. "price is 4s old". */
    warnings: string[];
    /** Echo of the fully-resolved intent, so the UI cannot drift from what is submitted. */
    resolved: ResolvedLiveOrder;
}

export type OrderSafetyBlocker =
    | "STALE_MARKET_DATA"
    | "OFFLINE"
    | "UNKNOWN_FRESHNESS"
    | "MISSING_QUOTE"
    | "MISSING_ACCOUNT"
    | "ACCOUNT_IDENTITY_MISMATCH"
    | "MISSING_SYMBOL"
    | "MISSING_QUANTITY"
    | "MISSING_STOP_LOSS"
    | "INVALID_STOP_LOSS"
    | "INVALID_PRICE"
    | "BROKER_NOT_CONNECTED"
    | "RISK_REJECTED"
    | "KILL_SWITCH_ACTIVE";

export interface ResolvedLiveOrder {
    mode: TradingMode;
    accountId: string | null;
    /** Human label of the account, so the trader sees WHICH account. */
    accountLabel: string | null;
    symbol: string;
    side: "BUY" | "SELL";
    orderType: "MARKET" | "LIMIT" | "STOP";
    quantity: number | null;
    /** null for MARKET entries. */
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    /** Currency value of the risk if the stop is hit, computed server-side. */
    estimatedRisk: number | null;
    /** The decision code from the canonical risk engine, when it ran. */
    riskDecisionCode: string | null;
    /** Epoch ms the price used for the estimate was captured. */
    priceTimestamp: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CHART_LAYOUT: ChartLayoutState = {
    barsVisible: 160,
    offsetBars: 0,
    chartType: "candles",
    showGrid: true,
    showCrosshair: true,
    showVolume: true,
    showPriceScale: true,
    showTimeScale: true,
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
    enabled: true,
    price: true,
    indicator: true,
    smartMoney: true,
    setup: true,
    strategy: true,
    risk: true,
    position: true,
    research: true,
    system: true,
    grouping: true,
    cooldownSeconds: 300,
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
    theme: "system",
    language: "en",
    defaultTimeframe: "M15",
    favoriteSymbols: [],
    preferredMarkets: [],
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    chart: {
        theme: "dark",
        fontSize: "medium",
        showWatermark: true,
        crosshairMode: "normal",
    },
};

export function emptyWorkspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
    return {
        activeWorkspace: "day-trading",
        selectedSymbol: null,
        selectedTimeframe: "M15",
        chartSymbol: null,
        chartLayout: { ...DEFAULT_CHART_LAYOUT },
        indicatorConfig: {},
        drawings: {},
        watchlists: [],
        layers: {},
        panels: {},
        terminal: { intelligenceMode: "structure", chatOpen: false, railOrder: [] },
        ...overrides,
    };
}

export function isTradingMode(value: unknown): value is TradingMode {
    return value === "paper" || value === "live";
}

export function isDataFreshness(value: unknown): value is DataFreshness {
    return (
        value === "live" ||
        value === "delayed" ||
        value === "stale" ||
        value === "offline" ||
        value === "reconnecting"
    );
}
