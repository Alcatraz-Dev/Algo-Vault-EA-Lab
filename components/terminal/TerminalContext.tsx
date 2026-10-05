"use client";

/**
 * TerminalContext — the one canonical workspace context (Phase 5 §6).
 *
 * Symbol, timeframe, watchlist, panels, intelligence mode, chat state and the
 * active workspace live HERE and nowhere else. Every terminal panel reads
 * them; every symbol change flows through `setSymbol`, so switching
 * XAUUSD → EURUSD updates the watchlist, chart, intelligence rail, event feed,
 * account panel and chat context in the same commit.
 *
 * Persistence: localStorage only (Phase 5 §5). Nothing here is written to the
 * backend — panel sizes and chat visibility are transient UI preferences.
 *
 * `focus` implements event → chart navigation (§32): an event carries its own
 * symbol/timeframe/timestamp, and `requestChartFocus` publishes a fresh
 * request that the chart workspace consumes.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import {
    TERMINAL_STORAGE_KEY,
    addSymbol as addSymbolOp,
    applyWorkspacePreset,
    decodeTerminalState,
    defaultTerminalState,
    encodeTerminalState,
    isSupportedSymbol,
    isTimeframe,
    removeSymbol as removeSymbolOp,
    reorderSymbol as reorderSymbolOp,
    toggleFavorite as toggleFavoriteOp,
    workspaceLayerHints,
} from "@/lib/terminal/state";
import type {
    AccountMode,
    ChartFocusRequest,
    IntelligenceMode,
    PanelId,
    TerminalState,
    WorkspaceId,
} from "@/lib/terminal/types";
import type { ChartTarget } from "@/lib/terminal/events";

export interface TerminalContextValue {
    state: TerminalState;
    /** Hydrated from storage. False during the SSR/first client render. */
    hydrated: boolean;
    /* symbol / timeframe */
    setSymbol: (symbol: string) => void;
    setTimeframe: (tf: string) => void;
    /* workspace */
    setWorkspace: (id: WorkspaceId) => void;
    layerHints: Record<string, boolean> | undefined;
    /* panels */
    setPanelVisible: (id: PanelId, visible: boolean) => void;
    setPanelSize: (id: PanelId, size: number) => void;
    togglePanel: (id: PanelId) => void;
    /* intelligence + chat + account */
    setIntelligenceMode: (mode: IntelligenceMode) => void;
    setChatOpen: (open: boolean) => void;
    setAccountMode: (mode: AccountMode) => void;
    /* watchlist */
    addToWatchlist: (symbol: string, group?: string) => void;
    removeFromWatchlist: (symbol: string) => void;
    reorderWatchlist: (symbol: string, index: number) => void;
    toggleFavorite: (symbol: string) => void;
    /* event → chart navigation */
    focus: ChartFocusRequest | null;
    requestChartFocus: (target: ChartTarget) => void;
    resetWorkspace: () => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function useTerminal(): TerminalContextValue {
    const ctx = useContext(TerminalContext);
    if (!ctx) throw new Error("useTerminal must be used inside <TerminalProvider>");
    return ctx;
}

/** Read-only access for components that must not re-render on every change. */
export function useTerminalState(): TerminalState {
    return useTerminal().state;
}

let focusSeq = 0;

export function TerminalProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<TerminalState>(() => defaultTerminalState());
    const [hydrated, setHydrated] = useState(false);
    const [focus, setFocus] = useState<ChartFocusRequest | null>(null);

    // Hydrate once on mount — never during SSR, so the server HTML and the
    // first client render agree (no hydration mismatch on the active symbol).
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot localStorage hydration: the read must happen on the client after mount, and the state it produces is the persisted workspace itself. */
    useEffect(() => {
        let next = defaultTerminalState();
        try {
            const raw = window.localStorage.getItem(TERMINAL_STORAGE_KEY);
            if (raw) next = decodeTerminalState(raw);
        } catch {
            // Storage disabled — defaults are still a valid workspace.
        }
        setState(next);
        setHydrated(true);
    }, []);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Persist on every change after hydration.
    useEffect(() => {
        if (!hydrated) return;
        try {
            window.localStorage.setItem(TERMINAL_STORAGE_KEY, encodeTerminalState(state));
        } catch {
            // Private mode / quota — the session keeps working in memory.
        }
    }, [state, hydrated]);

    const setSymbol = useCallback((symbol: string) => {
        if (!isSupportedSymbol(symbol)) return;
        setState((prev) =>
            prev.symbol === symbol
                ? prev
                : {
                      ...prev,
                      symbol,
                      // Keep the active symbol reachable from the rail.
                      watchlist: prev.watchlist.includes(symbol) ? prev.watchlist : [symbol, ...prev.watchlist].slice(0, 40),
                  }
        );
    }, []);

    const setTimeframe = useCallback((tf: string) => {
        if (!isTimeframe(tf)) return;
        setState((prev) => (prev.timeframe === tf ? prev : { ...prev, timeframe: tf }));
    }, []);

    const setWorkspace = useCallback((id: WorkspaceId) => {
        setState((prev) => (prev.workspace === id ? prev : applyWorkspacePreset(prev, id)));
    }, []);

    const setPanelVisible = useCallback((id: PanelId, visible: boolean) => {
        setState((prev) => {
            const current = prev.panels[id];
            if (!current || current.visible === visible) return prev;
            return { ...prev, panels: { ...prev.panels, [id]: { ...current, visible } } };
        });
    }, []);

    const setPanelSize = useCallback((id: PanelId, size: number) => {
        if (!Number.isFinite(size) || size <= 0 || size > 10) return;
        setState((prev) => {
            const current = prev.panels[id];
            if (!current) return prev;
            return { ...prev, panels: { ...prev.panels, [id]: { ...current, size } } };
        });
    }, []);

    const togglePanel = useCallback((id: PanelId) => {
        setState((prev) => {
            const current = prev.panels[id];
            if (!current) return prev;
            return { ...prev, panels: { ...prev.panels, [id]: { ...current, visible: !current.visible } } };
        });
    }, []);

    const setIntelligenceMode = useCallback((mode: IntelligenceMode) => {
        setState((prev) => (prev.intelligenceMode === mode ? prev : { ...prev, intelligenceMode: mode }));
    }, []);

    const setChatOpen = useCallback((open: boolean) => {
        setState((prev) => (prev.chatOpen === open ? prev : { ...prev, chatOpen: open }));
    }, []);

    const setAccountMode = useCallback((mode: AccountMode) => {
        setState((prev) => (prev.accountMode === mode ? prev : { ...prev, accountMode: mode }));
    }, []);

    const addToWatchlist = useCallback((symbol: string, group?: string) => {
        setState((prev) => addSymbolOp(prev, symbol, group));
    }, []);

    const removeFromWatchlist = useCallback((symbol: string) => {
        setState((prev) => removeSymbolOp(prev, symbol));
    }, []);

    const reorderWatchlist = useCallback((symbol: string, index: number) => {
        setState((prev) => reorderSymbolOp(prev, symbol, index));
    }, []);

    const toggleFavorite = useCallback((symbol: string) => {
        setState((prev) => toggleFavoriteOp(prev, symbol));
    }, []);

    const requestChartFocus = useCallback((target: ChartTarget) => {
        focusSeq += 1;
        setFocus({
            seq: focusSeq,
            symbol: (isSupportedSymbol(target.symbol) ? target.symbol : "XAUUSD") as SupportedSymbol,
            timeframe: (isTimeframe(target.timeframe) ? target.timeframe : "M5") as Timeframe,
            time: target.time,
            ...(typeof target.price === "number" ? { price: target.price } : {}),
            label: target.label,
        });
        // The symbol/timeframe the event belongs to become the terminal's —
        // that is what makes the whole workspace follow the click (§32).
        setState((prev) => {
            const next: TerminalState = {
                ...prev,
                symbol: isSupportedSymbol(target.symbol) ? target.symbol : prev.symbol,
                timeframe: isTimeframe(target.timeframe) ? target.timeframe : prev.timeframe,
            };
            if (!next.watchlist.includes(next.symbol)) {
                next.watchlist = [next.symbol, ...next.watchlist].slice(0, 40);
            }
            return next;
        });
    }, []);

    const resetWorkspace = useCallback(() => {
        setState((prev) => applyWorkspacePreset(defaultTerminalState(), prev.workspace));
    }, []);

    const layerHints = useMemo(() => workspaceLayerHints(state.workspace), [state.workspace]);

    const value = useMemo<TerminalContextValue>(
        () => ({
            state,
            hydrated,
            setSymbol,
            setTimeframe,
            setWorkspace,
            layerHints,
            setPanelVisible,
            setPanelSize,
            togglePanel,
            setIntelligenceMode,
            setChatOpen,
            setAccountMode,
            addToWatchlist,
            removeFromWatchlist,
            reorderWatchlist,
            toggleFavorite,
            focus,
            requestChartFocus,
            resetWorkspace,
        }),
        [
            state,
            hydrated,
            setSymbol,
            setTimeframe,
            setWorkspace,
            layerHints,
            setPanelVisible,
            setPanelSize,
            togglePanel,
            setIntelligenceMode,
            setChatOpen,
            setAccountMode,
            addToWatchlist,
            removeFromWatchlist,
            reorderWatchlist,
            toggleFavorite,
            focus,
            requestChartFocus,
            resetWorkspace,
        ]
    );

    return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

/* ── shared clock ─────────────────────────────────────────────────────────── */

/**
 * One clock for every freshness read-out in the terminal. Kept out of the
 * state object so a 1s tick cannot re-persist the workspace.
 */
export function useTerminalClock(intervalMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());
    const ref = useRef(now);
    useEffect(() => {
        const id = setInterval(() => {
            const t = Date.now();
            ref.current = t;
            setNow(t);
        }, intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

/**
 * Freshness classification shared by every panel (Phase 5 §38).
 *
 * `liveWithinMs` is each source's own expected cadence — quotes poll every
 * ~10s, the analysis pipeline every ~30s. Calling a 30s-old analysis "stale"
 * would be theatre; calling a 5-minute-old quote "live" would be a lie.
 */
export function freshness(
    lastUpdated: number | null,
    now: number,
    liveWithinMs = 15_000
): {
    status: "live" | "stale" | "disconnected" | "loading";
    ageMs: number | null;
    label: string;
} {
    if (lastUpdated === null) return { status: "loading", ageMs: null, label: "Loading" };
    const ageMs = Math.max(0, now - lastUpdated);
    if (ageMs <= liveWithinMs) return { status: "live", ageMs, label: `Updated ${(ageMs / 1000).toFixed(1)}s ago` };
    if (ageMs <= 120_000) return { status: "stale", ageMs, label: `Updated ${Math.round(ageMs / 1000)}s ago` };
    return { status: "stale", ageMs, label: `Updated ${Math.round(ageMs / 60_000)}m ago` };
}
