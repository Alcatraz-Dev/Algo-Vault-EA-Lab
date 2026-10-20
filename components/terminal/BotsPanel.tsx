"use client";

/**
 * BotsPanel — AlgoVault bots inside the Terminal.
 *
 * Integration only: it reads the deployment records the runtime writes and
 * calls the existing authorized lifecycle route. It never evaluates a strategy,
 * schedules a tick, places an order or touches the command queue.
 *
 * Layout is deliberately terminal-dense: one header strip, one line per bot,
 * detail only for the bot the user opened. The chart keeps its space and the
 * whole panel collapses to a single row when the account has no bots.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
    Bot as BotIcon,
    ChevronDown,
    ChevronRight,
    Loader2,
    Lock,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Square,
    TriangleAlert,
    WifiOff,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/loading-state";
import { useTerminal } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";
import { useBotsData } from "./BotsData";
import {
    botPositionRows,
    botRowView,
    executionStatusLabel,
    executionStatusTone,
    formatSignedUsd,
    gatewayConnected,
    relativeAgeLabel,
    resolveBotsPanelState,
    summariseBots,
    type BotActionId,
} from "@/lib/terminal/bots";

const BOT_STUDIO_HREF = "/account/strategy-studio";

function GatewayChip({ now }: { now: number }) {
    const data = useTerminalData();
    const account = data.account;
    if (!account) {
        return (
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1 py-px text-[10px] leading-none text-muted-foreground">
                <WifiOff className="size-2.5" aria-hidden="true" />
                NO ACCOUNT
            </span>
        );
    }
    const connected = gatewayConnected(
        { status: account.status, lastHeartbeatAt: account.lastHeartbeatAt },
        now
    );
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded border px-1 py-px font-numeric text-[10px] leading-none",
                connected
                    ? "border-positive/40 bg-positive/10 text-positive"
                    : "border-warning/40 bg-warning/10 text-warning"
            )}
            title={connected ? "MT5 gateway heartbeat is current." : "No recent MT5 gateway heartbeat — bots cannot execute."}
        >
            {connected ? null : <WifiOff className="size-2.5" aria-hidden="true" />}
            {account.mt5Account}
            <span className="text-muted-foreground">·</span>
            {connected ? "GATEWAY LIVE" : "GATEWAY OFFLINE"}
        </span>
    );
}

export function BotsPanel({ now }: { now: number }) {
    const data = useTerminalData();
    const { state } = useTerminal();
    const bots = useBotsData();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [confirmStopId, setConfirmStopId] = useState<string | null>(null);

    const rows = useMemo(
        () => bots.deployments.map((deployment) => botRowView(deployment, bots.summaries[deployment.id])),
        [bots.deployments, bots.summaries]
    );
    const totals = useMemo(() => summariseBots(rows), [rows]);

    const panelState = resolveBotsPanelState({
        hasSession: Boolean(data.uid),
        accessDenied: bots.accessDenied,
        hasAccount: Boolean(data.account),
        loading: bots.loading,
        error: bots.error,
        count: rows.length,
    });

    const acting = bots.actingBotId !== null;

    const runAction = (botId: string, action: BotActionId) => {
        if (acting) return; // duplicate-click guard (the provider also guards)
        setConfirmStopId(null);
        void bots.act(botId, action);
    };

    const toggleDetail = (botId: string) => {
        const next = expandedId === botId ? null : botId;
        setExpandedId(next);
        if (next) void bots.loadDetail(next);
    };

    return (
        <section
            className="flex min-w-0 flex-col rounded-lg border border-border bg-card"
            aria-label="Bots"
            data-terminal-panel="bots"
        >
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1.5">
                <BotIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-micro font-semibold text-foreground">Bots</h2>
                {rows.length > 0 ? (
                    <>
                        <span className="font-numeric text-micro text-muted-foreground">
                            {totals.running}/{totals.total} running
                        </span>
                        {totals.openPositions > 0 ? (
                            <span className="font-numeric text-micro text-muted-foreground">
                                · {totals.openPositions} open
                            </span>
                        ) : null}
                        {totals.floatingPnl !== 0 ? (
                            <span
                                className={cn(
                                    "font-numeric text-micro",
                                    totals.floatingPnl >= 0 ? "text-positive" : "text-negative"
                                )}
                            >
                                {formatSignedUsd(totals.floatingPnl)} float
                            </span>
                        ) : null}
                    </>
                ) : null}

                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <GatewayChip now={now} />
                    {state.accountMode !== "unknown" ? (
                        <span
                            className={cn(
                                "rounded border px-1 py-px text-[10px] leading-none tracking-wide",
                                state.accountMode === "live"
                                    ? "border-negative/40 bg-negative-muted text-negative-foreground"
                                    : "border-info/40 bg-info-muted text-info-foreground"
                            )}
                        >
                            {state.accountMode === "live" ? "LIVE" : "PAPER"}
                        </span>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Refresh bots"
                        onClick={bots.refresh}
                    >
                        <RefreshCw className={cn(bots.loading && "animate-spin")} aria-hidden="true" />
                    </Button>
                    <Link
                        href={BOT_STUDIO_HREF}
                        className="text-micro text-primary underline-offset-4 hover:underline"
                    >
                        Bot Studio
                    </Link>
                </span>
            </header>

            {bots.actionError ? (
                <div className="flex items-start gap-2 border-b border-warning/30 bg-warning-muted px-2 py-1 text-micro text-warning-foreground">
                    <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{bots.actionError}</span>
                    <button
                        type="button"
                        onClick={bots.clearActionError}
                        className="shrink-0 rounded px-1 text-muted-foreground transition hover:text-foreground"
                        aria-label="Dismiss bot error"
                    >
                        ×
                    </button>
                </div>
            ) : null}

            {panelState === "signed-out" ? (
                <PanelNote icon={<Lock className="size-3.5" />} title="Sign in to control bots">
                    Bot execution is tied to your account and MT5 gateway.{" "}
                    <Link href="/login?redirect=/account/terminal" className="text-primary underline-offset-4 hover:underline">
                        Sign in
                    </Link>
                </PanelNote>
            ) : null}

            {panelState === "no-access" ? (
                <PanelNote icon={<Lock className="size-3.5" />} title="Bot Studio access required">
                    Bot deployment and lifecycle control are available on Bot Studio plans.{" "}
                    <Link href={BOT_STUDIO_HREF} className="text-primary underline-offset-4 hover:underline">
                        Open Bot Studio
                    </Link>
                </PanelNote>
            ) : null}

            {panelState === "loading" ? (
                <div className="flex flex-col gap-1.5 p-2" aria-busy="true" aria-label="Loading bots">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex items-center gap-2">
                            <Skeleton className="h-3.5 w-16" />
                            <Skeleton className="h-3.5 w-28" />
                            <Skeleton className="ml-auto h-3.5 w-20" />
                        </div>
                    ))}
                </div>
            ) : null}

            {panelState === "error" ? (
                <div className="flex items-center gap-2 px-2 py-2 text-micro">
                    <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-muted-foreground">
                        {bots.error ?? "Bots could not be loaded."}
                    </span>
                    <Button type="button" variant="outline" size="xs" onClick={bots.refresh}>
                        Retry
                    </Button>
                </div>
            ) : null}

            {panelState === "no-account" ? (
                <PanelNote icon={<WifiOff className="size-3.5" />} title="No MT5 account connected">
                    Bots can only execute through the AlgoVault gateway.{" "}
                    <Link href="/account/trading-access" className="text-primary underline-offset-4 hover:underline">
                        Connect an account
                    </Link>
                </PanelNote>
            ) : null}

            {panelState === "empty" ? (
                <PanelNote icon={<BotIcon className="size-3.5" />} title="No bots deployed yet">
                    Deploy a strategy in Bot Studio and it appears here with live state, positions and executions.{" "}
                    <Link href={BOT_STUDIO_HREF} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                        <Plus className="size-3" aria-hidden="true" /> Create a bot
                    </Link>
                </PanelNote>
            ) : null}

            {rows.length > 0 ? (
                <ul className="flex max-h-[16rem] min-w-0 flex-col divide-y divide-border/60 overflow-y-auto">
                    {rows.map((row) => {
                        const expanded = expandedId === row.id;
                        const detail = bots.detailFor(row.id);
                        const positions = botPositionRows(detail?.positions);
                        const executing = bots.actingBotId === row.id;
                        return (
                            <li key={row.id} className="min-w-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
                                    <StatusBadge
                                        tone={row.stateTone}
                                        label={row.stateLabel}
                                        dot
                                        pulse={row.state === "running"}
                                        className="h-4 rounded-sm px-1.5 text-[10px] leading-none"
                                    />
                                    <span className="min-w-0 truncate text-micro font-medium text-foreground">
                                        {row.name}
                                    </span>
                                    <span className="font-numeric text-micro text-muted-foreground">
                                        {row.symbol ?? "—"} · {row.timeframe ?? "—"}
                                    </span>
                                    <span
                                        className={cn(
                                            "rounded border px-1 py-px text-[10px] leading-none",
                                            row.mode === "LIVE"
                                                ? "border-negative/40 bg-negative-muted text-negative-foreground"
                                                : "border-info/40 bg-info-muted text-info-foreground"
                                        )}
                                    >
                                        {row.mode}
                                    </span>
                                    {row.openPositions > 0 ? (
                                        <span className="font-numeric text-micro text-muted-foreground">
                                            {row.openPositions} open
                                        </span>
                                    ) : null}
                                    {row.lastExecutionAt ? (
                                        <span className="font-numeric text-micro text-muted-foreground">
                                            exec {relativeAgeLabel(now, row.lastExecutionAt)}
                                        </span>
                                    ) : null}

                                    <span className="ml-auto flex items-center gap-1">
                                        {row.startAvailable ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="xs"
                                                disabled={acting || !row.actions.start}
                                                title={row.startBlockedReason ?? "Start this bot"}
                                                aria-label={`Start ${row.name}`}
                                                onClick={() => runAction(row.id, "start")}
                                            >
                                                {executing ? (
                                                    <Loader2 className="animate-spin" aria-hidden="true" />
                                                ) : (
                                                    <Play aria-hidden="true" />
                                                )}
                                                Start
                                            </Button>
                                        ) : null}
                                        {row.actions.pause ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="xs"
                                                disabled={acting}
                                                title="Stop new entries — open positions stay open"
                                                aria-label={`Pause ${row.name}`}
                                                onClick={() => runAction(row.id, "pause")}
                                            >
                                                <Pause aria-hidden="true" />
                                                Pause
                                            </Button>
                                        ) : null}
                                        {row.actions.stop ? (
                                            confirmStopId === row.id ? (
                                                <>
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="xs"
                                                        disabled={acting}
                                                        onClick={() => runAction(row.id, "stop")}
                                                    >
                                                        Confirm stop
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="xs"
                                                        onClick={() => setConfirmStopId(null)}
                                                    >
                                                        Cancel
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="xs"
                                                    disabled={acting}
                                                    title="Stop the bot. Open positions are NOT closed."
                                                    aria-label={`Stop ${row.name}`}
                                                    onClick={() => setConfirmStopId(row.id)}
                                                >
                                                    <Square aria-hidden="true" />
                                                    Stop
                                                </Button>
                                            )
                                        ) : null}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-expanded={expanded}
                                            aria-label={`${expanded ? "Hide" : "Show"} ${row.name} details`}
                                            onClick={() => toggleDetail(row.id)}
                                        >
                                            {expanded ? (
                                                <ChevronDown aria-hidden="true" />
                                            ) : (
                                                <ChevronRight aria-hidden="true" />
                                            )}
                                        </Button>
                                    </span>
                                </div>

                                {row.eligibility.reason ? (
                                    <p
                                        className={cn(
                                            "px-2 pb-1 text-[10px] leading-none",
                                            row.eligibility.warning ? "text-warning" : "text-muted-foreground"
                                        )}
                                    >
                                        {row.eligibility.reason}
                                    </p>
                                ) : null}

                                {expanded ? (
                                    <div className="flex flex-col gap-2 bg-muted/30 px-2 pb-2 pt-1">
                                        {bots.detailLoadingFor === row.id && !detail ? (
                                            <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
                                                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                                                Loading bot detail…
                                            </p>
                                        ) : null}

                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-numeric text-micro text-muted-foreground">
                                            <span>signals {detail?.deployment.signalCount ?? "—"}</span>
                                            <span>executions {detail?.deployment.executionCount ?? "—"}</span>
                                            <span>rejections {detail?.deployment.rejectionCount ?? "—"}</span>
                                            <span>trades {row.performance?.totalTrades ?? 0}</span>
                                            <span>win {row.performance ? `${row.performance.winRate}%` : "—"}</span>
                                            <span
                                                className={cn(
                                                    (row.performance?.totalPnl ?? 0) >= 0
                                                        ? "text-positive"
                                                        : "text-negative"
                                                )}
                                            >
                                                P/L {formatSignedUsd(row.performance?.totalPnl ?? 0)}
                                            </span>
                                            <span>bot {row.account}</span>
                                        </div>

                                        <div>
                                            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                                                Open positions
                                            </p>
                                            {positions.length === 0 ? (
                                                <p className="text-micro text-muted-foreground">
                                                    No open positions attributed to this bot.
                                                </p>
                                            ) : (
                                                <ul className="flex flex-col gap-0.5">
                                                    {positions.map((p) => (
                                                        <li
                                                            key={p.ticket}
                                                            className="flex items-center gap-2 font-numeric text-micro"
                                                        >
                                                            <span className="text-muted-foreground">#{p.ticket}</span>
                                                            <span className="uppercase">{p.symbol}</span>
                                                            <span
                                                                className={cn(
                                                                    p.side === "BUY" ? "text-positive" : "text-negative"
                                                                )}
                                                            >
                                                                {p.side}
                                                            </span>
                                                            <span>{p.volume}</span>
                                                            <span className="text-muted-foreground">
                                                                {p.openPrice} → {p.currentPrice}
                                                            </span>
                                                            <span
                                                                className={cn(
                                                                    "ml-auto",
                                                                    p.profit >= 0 ? "text-positive" : "text-negative"
                                                                )}
                                                            >
                                                                {formatSignedUsd(p.profit)}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        <div>
                                            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                                                Recent executions
                                            </p>
                                            {(detail?.executions ?? []).length === 0 ? (
                                                <p className="text-micro text-muted-foreground">
                                                    No execution attempts recorded.
                                                </p>
                                            ) : (
                                                <ul className="flex flex-col gap-0.5">
                                                    {(detail?.executions ?? []).slice(0, 3).map((execution) => (
                                                        <li
                                                            key={execution.id}
                                                            className="flex items-center gap-2 font-numeric text-micro"
                                                        >
                                                            <StatusBadge
                                                                tone={executionStatusTone(execution.status)}
                                                                label={executionStatusLabel(execution.status)}
                                                                className="h-4 rounded-sm px-1.5 text-[10px] leading-none"
                                                            />
                                                            <span className="uppercase">{execution.symbol}</span>
                                                            <span>{execution.direction}</span>
                                                            <span className="text-muted-foreground">
                                                                {execution.mt5Ticket ? `#${execution.mt5Ticket}` : "no ticket"}
                                                            </span>
                                                            <span className="ml-auto text-muted-foreground">
                                                                {relativeAgeLabel(now, execution.createdAt)}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        <p className="text-[10px] leading-4 text-muted-foreground">
                                            Pausing or stopping a bot only stops new entries — its open positions stay
                                            open and are still managed on the account.
                                        </p>

                                        <div className="flex items-center gap-2">
                                            <Button variant="outline" size="xs" render={<Link href={`${BOT_STUDIO_HREF}/deployments/${row.id}`} />}>
                                                Full bot detail
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                onClick={() => void bots.loadDetail(row.id)}
                                            >
                                                Reload
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            ) : null}

            {panelState === "ready" && !gatewayConnected(
                data.account ? { status: data.account.status, lastHeartbeatAt: data.account.lastHeartbeatAt } : null,
                now
            ) ? (
                <p className="flex items-center gap-1.5 border-t border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
                    <WifiOff className="size-3" aria-hidden="true" />
                    The MT5 gateway is offline — bots are visible but cannot execute until it reconnects.
                </p>
            ) : null}
        </section>
    );
}

function PanelNote({
    icon,
    title,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1 px-2 py-3">
            <p className="flex items-center gap-1.5 text-micro font-medium text-foreground">
                <span className="text-muted-foreground" aria-hidden="true">
                    {icon}
                </span>
                {title}
            </p>
            <p className="text-micro leading-4 text-muted-foreground">{children}</p>
        </div>
    );
}
