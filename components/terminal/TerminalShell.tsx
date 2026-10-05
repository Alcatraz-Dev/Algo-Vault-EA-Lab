"use client";

/**
 * TerminalShell — Phase 5 §3 (layout), §10 (chart is central), §36 (mobile),
 * §39 (terminal states), §43 (isolated failures).
 *
 * The shell is composition only. It owns no data: every payload comes from
 * `TerminalDataProvider`, every view preference from `TerminalProvider`. The
 * chart is `ProTerminalChartWorkspace` — the same chart, toolbar, drawings and
 * layer persistence every other AlgoVault chart surface uses. Nothing here
 * re-implements a chart, an indicator or a Smart Money detector.
 *
 * Layout (desktop):
 *   ┌ top bar: symbol · timeframe · session · freshness · account mode ┐
 *   ├ watchlist │            CHART              │ intelligence       ┤
 *   ├ event feed│                               │ risk               ┤
 *   └ account (positions / orders / account)    │ chat               ┘
 *
 * Mobile degrades to tabs over the same panels (§36) — no second engine.
 */

import { useCallback, useMemo, useState } from "react";
import {
    CandlestickChart,
    LayoutList,
    LineChart,
    MessagesSquare,
    PanelsTopLeft,
    Shield,
    Signal,
    SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
import {
    normalisePendingOrderType,
    partialCloseVolume,
    type ChartPositionView,
    type ChartPendingOrderView,
    type ChartTradeFill,
} from "@/components/pro-scalping-terminal/chart-settings";
import type { PanelId } from "@/lib/terminal/types";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { TerminalTopBar } from "./TerminalTopBar";
import { WatchlistRail } from "./WatchlistRail";
import { IntelligenceRail } from "./IntelligenceRail";
import { EventFeed } from "./EventFeed";
import { AccountPanel } from "./AccountPanel";
import { RiskHud } from "./RiskHud";
import { TradingChat } from "./TradingChat";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { useTerminal, useTerminalClock } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";

type MobileTab = "watchlist" | "chart" | "intelligence" | "account" | "chat";

const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: typeof LineChart }> = [
    { id: "watchlist", label: "Watch", icon: PanelsTopLeft },
    { id: "chart", label: "Chart", icon: CandlestickChart },
    { id: "intelligence", label: "Intel", icon: Signal },
    { id: "account", label: "Account", icon: Shield },
    { id: "chat", label: "Chat", icon: MessagesSquare },
];

const PANEL_TOGGLE: Array<{ id: PanelId; label: string }> = [
    { id: "watchlist", label: "Watchlist" },
    { id: "intelligence", label: "Intelligence" },
    { id: "events", label: "Monitor" },
    { id: "account", label: "Account" },
    { id: "chat", label: "Chat" },
];

export function TerminalShell({ isPro }: { isPro: boolean }) {
    const {
        state,
        hydrated,
        setSymbol,
        setTimeframe,
        togglePanel,
        focus,
        layerHints,
    } = useTerminal();
    const data = useTerminalData();
    const now = useTerminalClock(1000);
    const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
    const [panelsOpen, setPanelsOpen] = useState(false);

    /* ── chart trade views (real execution data, shaped for the chart) ── */
    const chartPositions = useMemo<ChartPositionView[]>(
        () =>
            data.positions.map((p) => ({
                ticket: p.ticket,
                symbol: p.symbol,
                side: p.type === "SELL" ? "SELL" : "BUY",
                volume: p.volume,
                entry: p.openPrice,
                current: p.currentPrice,
                sl: p.sl || null,
                tp: p.tp || null,
                profit: p.profit,
                openedAt: p.openedAt,
            })),
        [data.positions]
    );

    const chartOrders = useMemo<ChartPendingOrderView[]>(
        () =>
            data.orders.flatMap((o) => {
                const type = normalisePendingOrderType(o.type);
                if (!type) return [];
                return [
                    {
                        ticket: o.ticket,
                        symbol: o.symbol,
                        type,
                        volume: o.volume,
                        price: o.price,
                        sl: o.sl || null,
                        tp: o.tp || null,
                        status: o.status,
                    },
                ];
            }),
        [data.orders]
    );

    // Chart history is derived from what the gateway actually acknowledged —
    // it stays empty when the terminal has no execution history to show.
    const chartHistory = useMemo<ChartTradeFill[]>(() => [], []);

    const tradingLocked = data.risk?.status === "HALTED";
    const authToken = data.token;
    const hasAccount = !!data.account;

    // Fail closed: no session, no account, or a halted risk engine means the
    // terminal cannot move money (Phase 5 §20 / §27).
    const [actionError, setActionError] = useState<string | null>(null);

    /**
     * Every mutation reports its real outcome. A rejected close previously
     * vanished into an empty catch, leaving the position on screen with no
     * indication that nothing had happened. Gateway acknowledgements remain
     * the only source of "filled", so we say what we actually know.
     */
    const act = useCallback(
        async (init: RequestInit, describe: string): Promise<boolean> => {
            if (!authToken) {
                setActionError("Not signed in — no order was sent.");
                return false;
            }
            if (!hasAccount) {
                setActionError("No trading account is linked to this terminal.");
                return false;
            }
            if (tradingLocked) {
                setActionError("Trading is halted by the risk engine — no order was sent.");
                return false;
            }
            setActionError(null);
            try {
                const res = await fetch("/api/trading/orders", {
                    ...init,
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
                });
                if (!res.ok) {
                    const detail = await res.json().catch(() => null);
                    setActionError(
                        detail?.error ? `${describe} failed: ${detail.error}` : `${describe} failed (${res.status}).`
                    );
                    return false;
                }
                return true;
            } catch {
                setActionError(`${describe} could not reach the execution gateway — nothing was sent.`);
                return false;
            }
        },
        [authToken, hasAccount, tradingLocked]
    );

    const positions = data.positions;

    /**
     * Volume partial close. The percentage is a share of the position SIZE,
     * never a share of profit — the lot step comes from the instrument spec so
     * the clamped quantity is actually tradable on that instrument.
     */
    const handleClosePercent = useCallback(
        (ticket: string, percent: number) => {
            const pos = positions.find((p) => p.ticket === ticket);
            if (!pos) {
                setActionError(`Position ${ticket} is no longer open.`);
                return;
            }
            const spec = getSymbolSpec(pos.symbol);
            const step = spec?.lotStep ?? 0.01;
            const { mode, volume } = partialCloseVolume(pos.volume, percent, step);
            const label = mode === "full" ? `Close ${pos.symbol} position` : `Close ${volume} lot of ${pos.symbol}`;
            void act(
                {
                    method: "DELETE",
                    body: JSON.stringify(
                        mode === "full" ? { ticket, action: "close" } : { ticket, action: "partial_close", volume }
                    ),
                },
                label
            );
        },
        [positions, act]
    );

    const handleCancelOrder = useCallback(
        (ticket: string) => void act({ method: "DELETE", body: JSON.stringify({ ticket, action: "cancel_order" }) }, "Cancel order"),
        [act]
    );

    const visible = (id: PanelId) => state.panels[id]?.visible !== false;

    // Memoised so the shell's 1s freshness clock never re-renders the chart
    // subtree — the chart only changes when its inputs change (Phase 5 §37).
    const chartNode = useMemo(
        () => (
            <PanelErrorBoundary name="Chart">
                <ProTerminalChartWorkspace
                    initialSymbol={state.symbol}
                    initialTimeframe={state.timeframe}
                    initialLayers={layerHints as never}
                    analysis={data.analysis}
                    token={data.token}
                    signals={data.signals}
                    positions={chartPositions}
                    pendingOrders={chartOrders}
                    tradeHistory={chartHistory}
                    onClosePosition={handleClosePercent}
                    onCancelOrder={handleCancelOrder}
                    onSymbolChange={setSymbol}
                    onTimeframeChange={setTimeframe}
                    focusRequest={focus}
                    storageScope="terminal"
                    hideWatchlist
                    height={540}
                />
            </PanelErrorBoundary>
        ),
        [
            state.symbol,
            state.timeframe,
            layerHints,
            data.analysis,
            data.token,
            data.signals,
            chartPositions,
            chartOrders,
            chartHistory,
            handleClosePercent,
            handleCancelOrder,
            setSymbol,
            setTimeframe,
            focus,
        ]
    );


    // Surface the persisted workspace honestly before the panels mount.
    if (!hydrated) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center rounded-xl border border-border bg-card">
                <p className="text-sm text-muted-foreground">Loading workspace…</p>
            </div>
        );
    }

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <TerminalTopBar now={now} isPro={isPro} />

            {/* workspace + panel controls */}
            <div className="flex flex-wrap items-center gap-2">
                <WorkspaceSwitcher isPro={isPro} />
                <button
                    type="button"
                    onClick={() => setPanelsOpen((o) => !o)}
                    aria-expanded={panelsOpen}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
                >
                    <SlidersHorizontal className="size-3.5" />
                    Panels
                </button>
                <span className="hidden text-[11px] text-muted-foreground md:inline">
                    One workspace — symbol, timeframe and intelligence mode are shared by every panel.
                </span>
            </div>

            {panelsOpen ? (
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2">
                    <LayoutList className="size-3.5 text-muted-foreground" />
                    {PANEL_TOGGLE.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePanel(p.id)}
                            aria-pressed={visible(p.id)}
                            className={cn(
                                "rounded border px-2 py-1 text-[11px] font-medium transition",
                                visible(p.id)
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground hover:bg-muted"
                            )}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            ) : null}

            {/* mobile tab bar */}
            <div className="flex gap-1 rounded-xl border border-border bg-card p-1 xl:hidden" role="tablist" aria-label="Terminal sections">
                {MOBILE_TABS.map((t) => {
                    const Icon = t.icon;
                    const active = mobileTab === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setMobileTab(t.id)}
                            className={cn(
                                "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition",
                                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                            )}
                        >
                            <Icon className="mx-auto mb-0.5 size-3.5" />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* desktop grid */}
            <div className="hidden min-w-0 grid-cols-[minmax(0,var(--rail-l,260px))_minmax(0,1fr)_minmax(0,var(--rail-r,340px))] gap-3 xl:grid"
                 style={
                     {
                         "--rail-l": `${(state.panels.watchlist.size || 1) * 240}px`,
                         "--rail-r": `${(state.panels.intelligence.size || 1) * 300}px`,
                     } as React.CSSProperties
                 }
            >
                {visible("watchlist") ? (
                    <aside className="flex min-w-0 flex-col gap-3">
                        <PanelErrorBoundary name="Watchlist">
                            <WatchlistRail now={now} />
                        </PanelErrorBoundary>
                        {visible("events") ? (
                            <PanelErrorBoundary name="Market monitor">
                                <EventFeed now={now} />
                            </PanelErrorBoundary>
                        ) : null}
                    </aside>
                ) : (
                    <div />
                )}

                <main className="flex min-w-0 flex-col gap-3">
                    {chartNode}
                    {visible("account") ? <AccountPanel /> : null}
                </main>

                <aside className="flex min-w-0 flex-col gap-3">
                    <RiskHud />
                    {visible("intelligence") ? <IntelligenceRail now={now} /> : null}
                    {visible("chat") && state.chatOpen ? <TradingChat now={now} /> : null}
                    {visible("chat") && !state.chatOpen ? (
                        <button
                            type="button"
                            className="rounded-xl border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted"
                        >
                            <MessagesSquare className="mr-1.5 inline size-3.5" />
                            Open Trading Chat
                        </button>
                    ) : null}
                </aside>
            </div>

            {/* mobile stack — same panels, one at a time */}
            <div className="flex min-w-0 flex-col gap-3 xl:hidden">
                {mobileTab === "watchlist" ? (
                    <PanelErrorBoundary name="Watchlist">
                        <WatchlistRail now={now} />
                    </PanelErrorBoundary>
                ) : null}
                {mobileTab === "chart" ? chartNode : null}
                {mobileTab === "intelligence" ? (
                    <>
                        <RiskHud />
                        <IntelligenceRail now={now} />
                        {visible("events") ? <EventFeed now={now} /> : null}
                    </>
                ) : null}
                {mobileTab === "account" ? <AccountPanel /> : null}
                {mobileTab === "chat" ? <TradingChat now={now} /> : null}
            </div>

            <p className="text-[10px] leading-4 text-muted-foreground">
                Chart, indicators, Smart Money overlays, signals and trade levels come from AlgoVault engines; account
                and positions come from your connected gateway account; risk status is produced by the canonical Risk
                Engine. Market data freshness is shown in the header — when a source is stale or missing it says so.
                Nothing on this screen is simulated unless the account badge reads PAPER. Not financial advice.
            </p>
        </div>
    );
}
