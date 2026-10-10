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
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
import {
    normalisePendingOrderType,
    tradeFillFromExecution,
    type ChartPositionView,
    type ChartPendingOrderView,
    type ChartTradeFill,
} from "@/components/pro-scalping-terminal/chart-settings";
import {
    executeUnified,
    newClientRequestId,
    type UnifiedExecutePayload,
} from "@/lib/trading/unified/client";
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
    // the SAME execution-log → fill mapping the account trading page uses
    // (failed/rejected attempts never draw; the chart still filters by the
    // active symbol). Empty only when the terminal truly has no fills.
    const chartHistory = useMemo<ChartTradeFill[]>(
        () =>
            data.executionLogs
                .filter(
                    (l) =>
                        !l.errorCode &&
                        Number.isFinite(l.executionPrice) &&
                        l.executionPrice > 0
                )
                .slice(0, 200)
                .flatMap((l) => {
                    const fill = tradeFillFromExecution({
                        id: l.clientOrderId,
                        action: l.action,
                        executedAt: l.executedAt || l.createdAt,
                        price: l.executionPrice,
                        symbol: l.symbol,
                        volume: l.volume,
                        profit: null,
                    });
                    return fill ? [fill] : [];
                }),
        [data.executionLogs]
    );

    const tradingLocked = data.risk?.status === "HALTED";
    const authToken = data.token;
    const hasAccount = !!data.account;

    // Fail closed: no session, no account, or a halted risk engine means the
    // terminal cannot move money (Phase 5 §20 / §27).
    const [actionError, setActionError] = useState<string | null>(null);
    // Ticket the user selected by clicking a position line on the chart —
    // surfaced by the host (the chart only emits the identifier).
    const [selectedPositionTicket, setSelectedPositionTicket] = useState<string | null>(null);

    /**
     * Every mutation goes through the Unified Trading API
     * (`POST /api/trading/execute` → UnifiedTradingService) and reports its
     * real outcome. The legacy `/api/trading/orders` queue is no longer used
     * by the terminal. Percentage partial close is a share of the position's
     * CURRENT VOLUME — computed and re-validated server-side (min lot / lot
     * step aware), never derived from profit.
     */
    const act = useCallback(
        async (
            payload: Omit<UnifiedExecutePayload, "clientRequestId">,
            describe: string
        ): Promise<boolean> => {
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
                const result = await executeUnified(
                    { ...payload, clientRequestId: newClientRequestId("pt") },
                    authToken
                );
                if (result.status === "EXECUTED_PENDING_SYNC") {
                    setActionError(`${describe}: executed on the broker — position syncs on the next account snapshot.`);
                }
                return true;
            } catch (error) {
                setActionError(`${describe}: ${error instanceof Error ? error.message : "execution failed."}`);
                return false;
            }
        },
        [authToken, hasAccount, tradingLocked]
    );

    const positions = data.positions;

    const handleClosePercent = useCallback(
        (ticket: string, percent: number) => {
            const pos = positions.find((p) => p.ticket === ticket);
            if (!pos) {
                setActionError(`Position ${ticket} is no longer open.`);
                return;
            }
            if (percent >= 100) {
                void act(
                    { accountId: data.account!.accountId, executionType: "CLOSE_POSITION", positionId: ticket },
                    `Close ${pos.symbol} position`
                );
                return;
            }
            void act(
                {
                    accountId: data.account!.accountId,
                    executionType: "PARTIAL_CLOSE",
                    positionId: ticket,
                    percentage: percent,
                },
                `Partial close ${percent}% of ${pos.symbol}`
            );
        },
        [positions, act, data.account]
    );

    const handleCancelOrder = useCallback(
        (ticket: string) =>
            void act(
                { accountId: data.account!.accountId, executionType: "CANCEL_ORDER", orderId: ticket },
                "Cancel order"
            ),
        [act, data.account]
    );

    const visible = (id: PanelId) => state.panels[id]?.visible !== false;

    /**
     * SL/TP drag commit from the chart: merge the dragged stop with the
     * position's other current stop and run it through the SAME frozen
     * Unified Trading path the account page uses (MODIFY_POSITION). The chart
     * itself never executes anything.
     */
    const handleModifyPositionStops = useCallback(
        (ticket: string, stops: { stopLoss?: number | null; takeProfit?: number | null }) => {
            if (!data.account) {
                setActionError("No trading account is linked to this terminal.");
                return;
            }
            const pos = positions.find((p) => p.ticket === ticket);
            if (!pos) {
                setActionError(`Position ${ticket} is no longer open.`);
                return;
            }
            const stopLoss = stops.stopLoss ?? (pos.sl > 0 ? pos.sl : null);
            const takeProfit = stops.takeProfit ?? (pos.tp > 0 ? pos.tp : null);
            void act(
                {
                    accountId: data.account.accountId,
                    executionType: "MODIFY_POSITION",
                    positionId: ticket,
                    stopLoss: stopLoss !== null && stopLoss > 0 ? stopLoss : null,
                    takeProfit: takeProfit !== null && takeProfit > 0 ? takeProfit : null,
                },
                `Modify stops for ${pos.symbol}`
            );
        },
        [positions, act, data.account]
    );

    /**
     * Position click from the chart: host-side selection only — make sure the
     * account panel is visible and show which ticket the chart picked. No
     * execution behavior is invented here.
     */
    const handlePositionSelect = useCallback(
        (ticket: string) => {
            setSelectedPositionTicket(ticket);
            if (!visible("account")) togglePanel("account");
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [state.panels, togglePanel]
    );

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
                    onPositionSelect={handlePositionSelect}
                    onModifyPositionStops={handleModifyPositionStops}
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
            handlePositionSelect,
            handleModifyPositionStops,
            setSymbol,
            setTimeframe,
            focus,
        ]
    );


    // Surface the persisted workspace honestly before the panels mount.
    if (!hydrated) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center rounded-lg border border-border bg-card">
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
                <span className="hidden text-micro text-muted-foreground md:inline">
                    One workspace — symbol, timeframe and intelligence mode are shared by every panel.
                </span>
            </div>

            {panelsOpen ? (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2">
                    <LayoutList className="size-3.5 text-muted-foreground" />
                    {PANEL_TOGGLE.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePanel(p.id)}
                            aria-pressed={visible(p.id)}
                            className={cn(
                                "rounded border px-2 py-1 text-micro font-medium transition",
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
            <div className="flex gap-1 rounded-lg border border-border bg-card p-1 xl:hidden" role="tablist" aria-label="Terminal sections">
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
                                "flex-1 rounded-md px-2 py-1.5 text-micro font-medium transition",
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
                    {selectedPositionTicket ? (
                        <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                            <span>
                                Position{" "}
                                <span className="font-numeric font-semibold text-foreground">{selectedPositionTicket}</span>{" "}
                                selected on the chart — manage it in the account panel below.
                            </span>
                            <button
                                type="button"
                                onClick={() => setSelectedPositionTicket(null)}
                                className="ml-auto rounded border border-border px-1.5 py-0.5 text-micro transition hover:bg-muted"
                            >
                                Dismiss
                            </button>
                        </p>
                    ) : null}
                    {actionError ? (
                        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning dark:text-warning">
                            {actionError}
                        </p>
                    ) : null}
                    {visible("account") ? <AccountPanel /> : null}
                </main>

                <aside className="flex min-w-0 flex-col gap-3">
                    <RiskHud />
                    {visible("intelligence") ? <IntelligenceRail now={now} /> : null}
                    {visible("chat") && state.chatOpen ? <TradingChat now={now} /> : null}
                    {visible("chat") && !state.chatOpen ? (
                        <button
                            type="button"
                            className="rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted"
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
                {mobileTab === "account" ? (
                    <>
                        {actionError ? (
                            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning dark:text-warning">
                                {actionError}
                            </p>
                        ) : null}
                        <AccountPanel />
                    </>
                ) : null}
                {mobileTab === "chat" ? <TradingChat now={now} /> : null}
            </div>

            <p className="text-micro leading-4 text-muted-foreground">
                Chart, indicators, Smart Money overlays, signals and trade levels come from AlgoVault engines; account
                and positions come from your connected gateway account; risk status is produced by the canonical Risk
                Engine. Market data freshness is shown in the header — when a source is stale or missing it says so.
                Nothing on this screen is simulated unless the account badge reads PAPER. Not financial advice.
            </p>
        </div>
    );
}
