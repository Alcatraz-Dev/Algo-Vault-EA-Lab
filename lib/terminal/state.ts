/**
 * Terminal state — Phase 5 §5 / §6 / §8.
 *
 * Everything here is a pure function over `TerminalState`. Persistence is
 * expressed as `encode`/`decode` so the React layer decides *where* the bytes
 * go (localStorage today; nothing here is written to backend storage, because
 * panel sizes and chat visibility are transient UI state — Phase 5 §5).
 *
 * `sanitizeTerminalState` is the single gate for anything read back from
 * storage: it only ever accepts values the data layer actually serves, so a
 * hand-edited or stale blob can never put `GOLD` or `M13` into the terminal.
 */

import { SUPPORTED_SYMBOLS, TIMEFRAME_LABELS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";
import { isWorkspaceId, WORKSPACE_PRESET_BY_ID, normalisedPanels } from "./workspaces";
import {
    INTELLIGENCE_MODES,
    PANEL_IDS,
    type AccountMode,
    type IntelligenceMode,
    type PanelId,
    type PanelState,
    type TerminalState,
    type WorkspaceId,
} from "./types";

export const TERMINAL_STORAGE_KEY = "algovault.terminal.state.v1";
export const TERMINAL_STATE_VERSION = 1 as const;

/* ── symbol catalogue / groups ────────────────────────────────────────────── */

export const WATCHLIST_GROUP_IDS = ["Favorites", "Forex", "Metals", "Indices", "Crypto", "Stocks", "Custom"] as const;
export type WatchlistGroupId = (typeof WATCHLIST_GROUP_IDS)[number];

const GROUP_OF: Record<string, WatchlistGroupId> = {};
for (const s of SUPPORTED_SYMBOLS) {
    if (s === "XAUUSD" || s === "XAGUSD") GROUP_OF[s] = "Metals";
    else if (s === "US30" || s === "NAS100" || s === "SPX500" || s === "SPY" || s === "QQQ" || s === "DXY") GROUP_OF[s] = "Indices";
    else if (["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOGEUSD", "BNBUSD", "LTCUSD", "DOTUSD"].includes(s)) GROUP_OF[s] = "Crypto";
    else if (["AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "COIN"].includes(s)) GROUP_OF[s] = "Stocks";
    else GROUP_OF[s] = "Forex";
}

export function groupOfSymbol(symbol: string): WatchlistGroupId {
    return GROUP_OF[symbol] ?? "Custom";
}

/** Built-in group membership. `Favorites` and `Custom` are user-managed. */
export function defaultWatchlistGroups(): Record<string, string[]> {
    const groups: Record<string, string[]> = {};
    for (const g of WATCHLIST_GROUP_IDS) groups[g] = [];
    for (const s of SUPPORTED_SYMBOLS) groups[groupOfSymbol(s)].push(s);
    return groups;
}

export function isSupportedSymbol(value: unknown): value is SupportedSymbol {
    return typeof value === "string" && (SUPPORTED_SYMBOLS as readonly string[]).includes(value);
}

export function isTimeframe(value: unknown): value is Timeframe {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(TIMEFRAME_LABELS, value);
}

/* ── defaults ─────────────────────────────────────────────────────────────── */

const DEFAULT_SYMBOL: SupportedSymbol = "XAUUSD";
const DEFAULT_TIMEFRAME: Timeframe = "M5";
const DEFAULT_WATCHLIST: string[] = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"];

function defaultPanels(): Record<PanelId, PanelState> {
    const out = {} as Record<PanelId, PanelState>;
    for (const id of PANEL_IDS) out[id] = { visible: id !== "monitor", size: 1 };
    return out;
}

export function defaultTerminalState(): TerminalState {
    return {
        version: TERMINAL_STATE_VERSION,
        workspace: "day-trading",
        symbol: DEFAULT_SYMBOL,
        timeframe: DEFAULT_TIMEFRAME,
        watchlist: [...DEFAULT_WATCHLIST],
        watchlistGroups: defaultWatchlistGroups(),
        favorites: ["XAUUSD"],
        panels: defaultPanels(),
        intelligenceMode: "structure",
        chatOpen: true,
        accountMode: "unknown",
    };
}

/* ── sanitising ───────────────────────────────────────────────────────────── */

function sanitizeStringArray(value: unknown, allow: (v: string) => boolean, max: number): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !allow(item)) continue;
        if (out.includes(item)) continue;
        out.push(item);
        if (out.length >= max) break;
    }
    return out;
}

function sanitizePanels(value: unknown, fallback: Record<PanelId, PanelState>): Record<PanelId, PanelState> {
    const out: Record<PanelId, PanelState> = { ...fallback };
    if (!value || typeof value !== "object") return out;
    const raw = value as Record<string, unknown>;
    for (const id of PANEL_IDS) {
        const p = raw[id];
        if (!p || typeof p !== "object") continue;
        const { visible, size } = p as { visible?: unknown; size?: unknown };
        const base = fallback[id];
        out[id] = {
            visible: typeof visible === "boolean" ? visible : base.visible,
            size: typeof size === "number" && Number.isFinite(size) && size > 0 && size <= 10 ? size : base.size,
        };
    }
    // The chart is never optional: without it this is not a trading terminal.
    out.chart = { ...out.chart, visible: true };
    return out;
}

function sanitizeGroups(value: unknown): Record<string, string[]> {
    const groups = defaultWatchlistGroups();
    if (!value || typeof value !== "object") return groups;
    const raw = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(raw)) {
        const name = key.trim().slice(0, 32);
        if (!name) continue;
        const symbols = sanitizeStringArray(val, isSupportedSymbol, 60);
        // Built-ins keep their catalogue contents; custom groups only carry
        // symbols the data layer serves.
        if (!(name in groups)) groups[name] = symbols;
        else groups[name] = Array.from(new Set([...groups[name], ...symbols]));
    }
    return groups;
}

/**
 * Accepts anything and returns a state that is valid by construction.
 * Unknown/corrupt fields fall back to defaults rather than throwing — a
 * half-written localStorage blob must never white-screen the terminal.
 */
export function sanitizeTerminalState(raw: unknown): TerminalState {
    const def = defaultTerminalState();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def;
    const src = raw as Record<string, unknown>;

    const workspace: WorkspaceId = isWorkspaceId(src.workspace) ? src.workspace : def.workspace;
    const symbol = isSupportedSymbol(src.symbol) ? src.symbol : def.symbol;
    const timeframe = isTimeframe(src.timeframe) ? src.timeframe : def.timeframe;

    const watchlist = sanitizeStringArray(src.watchlist, isSupportedSymbol, 40);
    const favorites = sanitizeStringArray(src.favorites, isSupportedSymbol, 40);

    const intelligenceMode: IntelligenceMode =
        typeof src.intelligenceMode === "string" && (INTELLIGENCE_MODES as readonly string[]).includes(src.intelligenceMode)
            ? (src.intelligenceMode as IntelligenceMode)
            : def.intelligenceMode;

    const accountMode: AccountMode =
        src.accountMode === "paper" || src.accountMode === "live" || src.accountMode === "unknown"
            ? src.accountMode
            : def.accountMode;

    return {
        version: TERMINAL_STATE_VERSION,
        workspace,
        symbol,
        timeframe,
        // The active watchlist always contains the active symbol, otherwise
        // selecting a symbol from outside the list desyncs the rail.
        watchlist: watchlist.length > 0 ? Array.from(new Set([symbol, ...watchlist])).slice(0, 40) : [symbol],
        watchlistGroups: sanitizeGroups(src.watchlistGroups),
        favorites,
        panels: sanitizePanels(src.panels, def.panels),
        intelligenceMode,
        chatOpen: typeof src.chatOpen === "boolean" ? src.chatOpen : def.chatOpen,
        accountMode,
    };
}

/* ── encode / decode ──────────────────────────────────────────────────────── */

export function encodeTerminalState(state: TerminalState): string {
    try {
        return JSON.stringify(state);
    } catch {
        return JSON.stringify(defaultTerminalState());
    }
}

export function decodeTerminalState(raw: string | null | undefined): TerminalState {
    if (!raw) return defaultTerminalState();
    try {
        return sanitizeTerminalState(JSON.parse(raw));
    } catch {
        return defaultTerminalState();
    }
}

/* ── workspace transitions ────────────────────────────────────────────────── */

/**
 * Apply a preset without discarding what the user chose elsewhere: symbol,
 * watchlist, favourites and groups survive; only the view definition and the
 * preset's default timeframe/mode are replaced.
 */
export function applyWorkspacePreset(state: TerminalState, workspace: WorkspaceId): TerminalState {
    const preset = WORKSPACE_PRESET_BY_ID[workspace];
    if (!preset) return state;
    return {
        ...state,
        workspace: preset.id,
        timeframe: preset.defaultTimeframe,
        intelligenceMode: preset.defaultIntelligenceMode,
        chatOpen: preset.chatOpen,
        panels: normalisedPanels(preset),
    };
}

/** Chart layer hints for the active workspace (applied only as a base). */
export function workspaceLayerHints(workspace: WorkspaceId): Record<string, boolean> | undefined {
    return WORKSPACE_PRESET_BY_ID[workspace]?.layers;
}

/* ── watchlist operations (Phase 5 §8) ────────────────────────────────────── */

export function addSymbol(state: TerminalState, symbol: string, group = "Custom"): TerminalState {
    if (!isSupportedSymbol(symbol) || state.watchlist.includes(symbol)) return state;
    const groups = { ...state.watchlistGroups };
    const target = groups[group] ?? [];
    if (!target.includes(symbol)) groups[group] = [...target, symbol];
    return { ...state, watchlist: [...state.watchlist, symbol].slice(0, 40), watchlistGroups: groups };
}

export function removeSymbol(state: TerminalState, symbol: string): TerminalState {
    const next = state.watchlist.filter((s) => s !== symbol);
    // Never empty the rail and never orphan the active symbol.
    const watchlist = next.length > 0 ? next : [state.symbol];
    const groups = Object.fromEntries(
        Object.entries(state.watchlistGroups).map(([k, v]) => [k, v.filter((s) => s !== symbol)])
    ) as Record<string, string[]>;
    const favorites = state.favorites.filter((s) => s !== symbol);
    return {
        ...state,
        watchlist,
        watchlistGroups: groups,
        favorites,
        symbol:
            state.symbol === symbol && isSupportedSymbol(watchlist[0])
                ? watchlist[0]
                : state.symbol,
    };
}

/** Move `symbol` to `index` within the active watchlist (drag reorder). */
export function reorderSymbol(state: TerminalState, symbol: string, index: number): TerminalState {
    const from = state.watchlist.indexOf(symbol);
    if (from < 0) return state;
    const to = Math.max(0, Math.min(state.watchlist.length - 1, Math.floor(index)));
    if (to === from) return state;
    const next = [...state.watchlist];
    next.splice(from, 1);
    next.splice(to, 0, symbol);
    return { ...state, watchlist: next };
}

export function toggleFavorite(state: TerminalState, symbol: string): TerminalState {
    if (!isSupportedSymbol(symbol)) return state;
    const has = state.favorites.includes(symbol);
    const favorites = has ? state.favorites.filter((s) => s !== symbol) : [...state.favorites, symbol];
    return {
        ...state,
        favorites,
        watchlistGroups: { ...state.watchlistGroups, Favorites: favorites },
    };
}

/** Symbols matching `query`, preserving catalogue order. Never fuzzy-guesses. */
export function searchSymbols(query: string, groups: Record<string, string[]>): string[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const list of Object.values(groups)) {
        for (const s of list) {
            if (s.includes(q) && !seen.has(s)) {
                seen.add(s);
                out.push(s);
            }
        }
    }
    return out;
}

/** Symbols of a group, with `Favorites` resolved from state. */
export function symbolsOfGroup(state: TerminalState, group: string): string[] {
    if (group === "Favorites") return state.favorites;
    return state.watchlistGroups[group] ?? [];
}
