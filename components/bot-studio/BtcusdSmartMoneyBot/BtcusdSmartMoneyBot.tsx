"use client";

/**
 * BTCUSD Smart Money scalper — ready-made bot card.
 *
 * The card is thin: all decision logic lives in
 * `lib/bot-studio/scalping/smart-money.ts` and runs on CLOSED M1 candles from
 * the platform's shared chart engine (no second market feed). When the bot is
 * running and a new M1 bar closes, the SMC confluence is evaluated once:
 *
 *   sweep → FVG retest → discount/premium, with an ATR-buffered stop and an
 *   R:R-checked target. No setup means no order.
 *
 * Execution goes through the Unified Trading API exactly like every other
 * surface; the status shown is the server's verbatim outcome. The bot never
 * simulates a fill, never fabricates a price, and refuses to stack beyond
 * `maxPositions` or to enter on a spread above the configured cap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    ArrowDownRight,
    ArrowUpRight,
    Bot,
    ChevronDown,
    ChevronUp,
    Play,
    Settings,
    Square,
    Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLiveCandles } from "@/hooks/useLiveCandles";
import { isSymbolMarketOpen } from "@/lib/ai-signals/sessions-filter";
import { executeUnified, newClientRequestId } from "@/lib/trading/unified/client";
import {
    BTCUSD_SMART_MONEY_DEFAULTS,
    evaluateSmartMoneySetup,
    type SmartMoneyScalpingConfig,
    type SmartMoneySetup,
} from "@/lib/bot-studio/scalping/smart-money";

const SYMBOL = "BTCUSD";
const LOT = 0.01;

function fmtPrice(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(ts: number | null): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

/** A real broker position as mirrored by the gateway (never client-invented). */
export interface BtcusdBrokerPosition {
    ticket: string;
    symbol: string;
    side: "BUY" | "SELL";
    volume: number;
    entry: number;
    currentPrice: number;
    profit: number;
    sl: number;
    tp: number;
    openedAt: number;
}

/** One broker execution report (fill or rejection) for this bot's symbol. */
export interface BtcusdBrokerReport {
    id: string;
    symbol: string;
    status: string;
    message: string;
    ticket?: string;
    at: number;
}

interface BtcusdSmartMoneyBotProps {
    token?: string | null;
    accountId?: string;
    /** All positions on the selected account; this bot filters to its symbol. */
    positions?: BtcusdBrokerPosition[];
    /** Recent broker execution reports, newest first. */
    brokerReports?: BtcusdBrokerReport[];
    onStatusChange?: (running: boolean) => void;
    className?: string;
}

const normalizeSymbol = (value: string): string =>
    String(value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();

export function BtcusdSmartMoneyBot({
    token,
    accountId,
    positions = [],
    brokerReports = [],
    onStatusChange,
    className,
}: BtcusdSmartMoneyBotProps) {
    const [config, setConfig] = useState<SmartMoneyScalpingConfig>(BTCUSD_SMART_MONEY_DEFAULTS);
    const [running, setRunning] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [spread, setSpread] = useState<number | null>(null);
    const [lastSignalAt, setLastSignalAt] = useState<number | null>(null);
    const [lastOutcome, setLastOutcome] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [signalCount, setSignalCount] = useState(0);
    const [orderCount, setOrderCount] = useState(0);

    const { candles, quality } = useLiveCandles(SYMBOL, "M1");
    const price = candles.length > 0 ? candles[candles.length - 1].close : null;

    // The broker may name Bitcoin differently from the platform feed. Orders
    // and position matching use the configured broker symbol.
    const brokerSymbol = config.brokerSymbol.trim().toUpperCase() || SYMBOL;
    const brokerKey = normalizeSymbol(brokerSymbol);
    const brokerPositions = useMemo(
        () => positions.filter((p) => normalizeSymbol(p.symbol).startsWith(brokerKey)),
        [positions, brokerKey]
    );
    const openPositions = brokerPositions.length;
    const lastBrokerReport = useMemo(
        () =>
            brokerReports.find((r) =>
                normalizeSymbol(r.symbol).startsWith(brokerKey)
            ) ?? null,
        [brokerReports, brokerKey]
    );

    // The engine's newest candle is still forming — decisions only use closed
    // bars so a live tick can never trigger an entry on an unfinished bar.
    const closedCandles = useMemo(() => candles.slice(0, -1), [candles]);
    const closedBar = closedCandles.length > 0 ? closedCandles[closedCandles.length - 1] : null;

    const setup = useMemo<SmartMoneySetup | null>(
        () => evaluateSmartMoneySetup(closedCandles, config),
        [closedCandles, config]
    );

    const lastBarRef = useRef<number | null>(null);
    const inFlightRef = useRef(false);
    const canTrade = Boolean(token && accountId);

    const refreshSpread = useCallback(async (): Promise<number | null> => {
        try {
            const res = await fetch(
                `/api/analytics/watchlist?symbols=${SYMBOL}`,
                { cache: "no-store" }
            );
            if (!res.ok) return null;
            const body = (await res.json()) as {
                quotes?: Record<string, { spread?: number }>;
            };
            const next = body.quotes?.[SYMBOL]?.spread;
            const value = typeof next === "number" && Number.isFinite(next) ? next : null;
            setSpread(value);
            return value;
        } catch {
            return null;
        }
    }, []);

    const submitSetup = useCallback(
        async (next: SmartMoneySetup, origin: "auto" | "manual") => {
            if (!token || !accountId) {
                setError("Sign in and select an MT5 account to trade.");
                return;
            }
            if (inFlightRef.current) return;
            inFlightRef.current = true;
            setSubmitting(true);
            setError(null);

            try {
                const result = await executeUnified(
                    {
                        accountId,
                        clientRequestId: newClientRequestId("btc-smc"),
                        executionType: "PLACE_ORDER",
                        symbol: brokerSymbol,
                        side: next.direction === "long" ? "BUY" : "SELL",
                        volume: LOT,
                        kind: "MARKET",
                        price: next.entry,
                        stopLoss: next.sl,
                        takeProfit: next.tp,
                        source: "btcusd-smart-money",
                    },
                    token
                );

                const filled =
                    result.status === "SUCCEEDED" || result.status === "EXECUTED_PENDING_SYNC";
                setOrderCount((n) => (filled ? n + 1 : n));
                // A filled manual test consumes the bar too, so the auto entry
                // cannot stack a second position on the same closed candle.
                if (filled && closedBar) lastBarRef.current = closedBar.timestamp;
                setLastOutcome(
                    `${origin === "manual" ? "Manual" : "Auto"} ${next.direction} · ${result.status}` +
                        (result.filledPrice ? ` @ ${fmtPrice(result.filledPrice)}` : "") +
                        (result.providerRef ? ` · ticket ${result.providerRef}` : "") +
                        (result.error?.message && !filled ? ` · ${result.error.message}` : "")
                );
                if (!filled) {
                    setError(result.error?.message ?? `Order ${result.status.toLowerCase()}.`);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Execution request failed.");
            } finally {
                inFlightRef.current = false;
                setSubmitting(false);
            }
        },
        [token, accountId, brokerSymbol, closedBar]
    );

    // Auto entry: one evaluation per newly closed M1 bar while running.
    useEffect(() => {
        if (!running) return;
        if (!closedBar) return;
        if (lastBarRef.current === closedBar.timestamp) return;
        lastBarRef.current = closedBar.timestamp;

        // Deferred so the effect body never calls setState synchronously.
        void Promise.resolve().then(async () => {
            if (!config.enabled || !canTrade) return;
            if (!isSymbolMarketOpen(SYMBOL)) {
                setError("Market closed for BTCUSD — bot sleeping.");
                return;
            }
            if (openPositions >= config.maxPositions) return;

            const liveSpread = await refreshSpread();
            if (liveSpread !== null && liveSpread > config.maxSpreadUsd) {
                setError(
                    `Spread ${liveSpread.toFixed(2)} > cap ${config.maxSpreadUsd.toFixed(2)} — skipped.`
                );
                return;
            }

            const next = evaluateSmartMoneySetup(closedCandles, config);
            if (!next) return;
            setSignalCount((n) => n + 1);
            setLastSignalAt(Date.now());
            await submitSetup(next, "auto");
        });
    }, [
        running,
        closedBar,
        closedCandles,
        config,
        canTrade,
        openPositions,
        refreshSpread,
        submitSetup,
    ]);

    const toggleRunning = useCallback(() => {
        const next = !running;
        setRunning(next);
        onStatusChange?.(next);
        if (next) {
            lastBarRef.current = null;
            setError(null);
            void refreshSpread();
        }
    }, [running, onStatusChange, refreshSpread]);

    const patchConfig = useCallback((patch: Partial<SmartMoneyScalpingConfig>) => {
        setConfig((prev) => ({ ...prev, ...patch }));
    }, []);

    const statusLabel = !canTrade
        ? "no auth"
        : running
          ? "running"
          : "stopped";
    const statusTone = !canTrade
        ? "text-warning bg-warning/10 border-warning/30"
        : running
          ? "text-positive bg-positive/10 border-positive/30"
          : "text-muted-foreground bg-muted/60 border-border";

    return (
        <Card className={cn("overflow-hidden", className)}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <Bot className="size-4.5" />
                        </span>
                        <div className="min-w-0">
                            <CardTitle className="flex items-center gap-2 text-sm font-semibold leading-tight">
                                BTCUSD Smart Money Scalper
                                {running ? (
                                    <span className="size-1.5 rounded-full bg-positive animate-pulse" />
                                ) : null}
                            </CardTitle>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                                    {SYMBOL} · M1
                                </span>
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                                    SMC
                                </span>
                                {brokerKey !== normalizeSymbol(SYMBOL) ? (
                                    <span
                                        className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground"
                                        title="Symbol name sent to the MT5 account"
                                    >
                                        MT5 {brokerSymbol}
                                    </span>
                                ) : null}
                                <span className={cn("rounded-full border px-2 py-0.5 font-medium", statusTone)}>
                                    {statusLabel}
                                </span>
                                <span className="font-numeric text-muted-foreground">
                                    magic {config.magicNumber}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                            type="button"
                            size="sm"
                            variant={running ? "outline" : "default"}
                            onClick={toggleRunning}
                            disabled={!canTrade}
                            className="h-7 px-2 text-xs"
                            title={
                                canTrade
                                    ? undefined
                                    : "An authenticated MT5 account is required to run the bot"
                            }
                        >
                            {running ? (
                                <span className="flex items-center gap-1">
                                    <Square className="size-3" /> Stop
                                </span>
                            ) : (
                                <span className="flex items-center gap-1">
                                    <Play className="size-3" /> Start
                                </span>
                            )}
                        </Button>
                        <button
                            type="button"
                            onClick={() => setConfigOpen((o) => !o)}
                            aria-expanded={configOpen}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        >
                            <Settings className="size-3" />
                            {configOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        </button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-2.5">
                {/* Live market strip */}
                <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Price</div>
                        <div className="font-numeric text-xs font-semibold tabular-nums text-foreground">
                            {fmtPrice(price)}
                        </div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            Spread est.
                        </div>
                        <div className="font-numeric text-xs font-semibold tabular-nums text-foreground">
                            {spread === null ? "—" : spread.toFixed(2)}
                        </div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">M1 feed</div>
                        <div className="font-numeric text-xs font-semibold tabular-nums text-foreground">
                            {quality === "market_closed" ? "closed" : quality || "—"}
                        </div>
                    </div>
                </div>

                {/* Current setup */}
                {setup ? (
                    <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                                className={cn(
                                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold",
                                    setup.direction === "long"
                                        ? "bg-positive/10 text-positive"
                                        : "bg-negative/10 text-negative"
                                )}
                            >
                                {setup.direction === "long" ? (
                                    <ArrowUpRight className="size-3" />
                                ) : (
                                    <ArrowDownRight className="size-3" />
                                )}
                                {setup.direction.toUpperCase()}
                            </span>
                            <span className="font-numeric tabular-nums text-foreground">
                                E {fmtPrice(setup.entry)}
                            </span>
                            <span className="font-numeric tabular-nums text-negative">
                                SL {fmtPrice(setup.sl)}
                            </span>
                            <span className="font-numeric tabular-nums text-positive">
                                TP {fmtPrice(setup.tp)}
                            </span>
                            <span className="font-numeric tabular-nums text-muted-foreground">
                                R:R {setup.riskReward.toFixed(2)}
                            </span>
                        </div>
                        <ul className="space-y-0.5 text-[10px] leading-4 text-muted-foreground">
                            {setup.reasons.map((reason) => (
                                <li key={reason}>· {reason}</li>
                            ))}
                        </ul>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-muted-foreground">
                                0.01 lots · stop beyond the swept extreme
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!canTrade || submitting}
                                onClick={() => void submitSetup(setup, "manual")}
                                className="h-6 gap-1 px-2 text-[10px]"
                            >
                                <Zap className="size-3" />
                                Test trade
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
                        No qualifying setup on the last closed M1 bar. The bot needs all three
                        confluences: a liquidity sweep, an FVG retest and a discount/premium entry.
                    </div>
                )}

                {/* Outcome / error */}
                {lastOutcome ? (
                    <p className="font-numeric text-[10px] leading-4 text-muted-foreground">
                        Last order: {lastOutcome}
                    </p>
                ) : null}
                {error ? (
                    <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[10px] leading-4 text-warning">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        <span className="min-w-0">{error}</span>
                    </p>
                ) : null}

                {/* Stats */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>
                        Signals <span className="font-numeric text-foreground">{signalCount}</span>
                    </span>
                    <span>
                        Orders <span className="font-numeric text-foreground">{orderCount}</span>
                    </span>
                    <span>
                        Open BTCUSD <span className="font-numeric text-foreground">{openPositions}</span>
                    </span>
                    <span>
                        Last signal{" "}
                        <span className="font-numeric text-foreground">{fmtTime(lastSignalAt)}</span>
                    </span>
                </div>

                {/* Broker truth — what the MT5 account actually holds. The
                    gateway mirror is the only source here; nothing is assumed
                    from a submitted order. */}
                <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-wider text-muted-foreground">
                        <span>MT5 account · {brokerSymbol}</span>
                        <span className="font-numeric">
                            {openPositions} open
                        </span>
                    </div>
                    {openPositions > 0 ? (
                        <ul className="space-y-1">
                            {brokerPositions.map((p) => (
                                <li
                                    key={p.ticket}
                                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]"
                                >
                                    <span
                                        className={cn(
                                            "rounded px-1 py-0.5 font-semibold",
                                            p.side === "BUY"
                                                ? "bg-positive/10 text-positive"
                                                : "bg-negative/10 text-negative"
                                        )}
                                    >
                                        {p.side}
                                    </span>
                                    <span className="font-numeric text-foreground">{p.volume} lots</span>
                                    <span className="font-numeric text-muted-foreground">
                                        @ {fmtPrice(p.entry)}
                                    </span>
                                    <span
                                        className={cn(
                                            "font-numeric font-semibold",
                                            p.profit >= 0 ? "text-positive" : "text-negative"
                                        )}
                                    >
                                        {p.profit >= 0 ? "+" : "−"}${Math.abs(p.profit).toFixed(2)}
                                    </span>
                                    <span className="font-numeric text-muted-foreground">
                                        SL {fmtPrice(p.sl)} · TP {fmtPrice(p.tp)} · #{p.ticket}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-[10px] leading-4 text-muted-foreground">
                            No {brokerSymbol} position on the MT5 account. A filled entry
                            appears here after the gateway&apos;s next snapshot (~30s).
                        </p>
                    )}
                    {lastBrokerReport ? (
                        <p className="text-[10px] leading-4 text-muted-foreground">
                            Last MT5 report{" "}
                            <span className="font-numeric text-foreground">
                                {lastBrokerReport.status}
                            </span>
                            {lastBrokerReport.ticket ? ` · #${lastBrokerReport.ticket}` : ""}
                            {lastBrokerReport.message ? ` · ${lastBrokerReport.message}` : ""}{" "}
                            <span className="font-numeric">
                                {fmtTime(lastBrokerReport.at)}
                            </span>
                        </p>
                    ) : null}
                </div>

                {/* Config */}
                {configOpen ? (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                        <div className="grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Broker symbol
                                </span>
                                <Input
                                    type="text"
                                    value={config.brokerSymbol}
                                    onChange={(e) =>
                                        patchConfig({ brokerSymbol: e.target.value })
                                    }
                                    placeholder="BTCUSD"
                                    className="h-7 text-xs"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Direction
                                </span>
                                <select
                                    value={config.direction}
                                    onChange={(e) =>
                                        patchConfig({
                                            direction: e.target.value as SmartMoneyScalpingConfig["direction"],
                                        })
                                    }
                                    className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/50"
                                >
                                    <option value="both">Both</option>
                                    <option value="long">Long only</option>
                                    <option value="short">Short only</option>
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Min R:R
                                </span>
                                <Input
                                    type="number"
                                    min={1}
                                    step={0.1}
                                    value={config.minRiskReward}
                                    onChange={(e) =>
                                        patchConfig({ minRiskReward: Number(e.target.value) || 1 })
                                    }
                                    className="h-7 text-xs"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Sweep lookback
                                </span>
                                <Input
                                    type="number"
                                    min={5}
                                    step={1}
                                    value={config.sweepLookback}
                                    onChange={(e) =>
                                        patchConfig({ sweepLookback: Number(e.target.value) || 20 })
                                    }
                                    className="h-7 text-xs"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Spread cap (USD)
                                </span>
                                <Input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={config.maxSpreadUsd}
                                    onChange={(e) =>
                                        patchConfig({ maxSpreadUsd: Number(e.target.value) || 0 })
                                    }
                                    className="h-7 text-xs"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Max positions
                                </span>
                                <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={config.maxPositions}
                                    onChange={(e) =>
                                        patchConfig({ maxPositions: Math.max(1, Number(e.target.value) || 1) })
                                    }
                                    className="h-7 text-xs"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Magic number
                                </span>
                                <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={config.magicNumber}
                                    onChange={(e) =>
                                        patchConfig({ magicNumber: Number(e.target.value) || 70002 })
                                    }
                                    className="h-7 text-xs"
                                />
                            </label>
                        </div>
                        <label className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5">
                            <span className="text-[10px] text-muted-foreground">
                                Enabled (stop still halts entries)
                            </span>
                            <input
                                type="checkbox"
                                checked={config.enabled}
                                onChange={(e) => patchConfig({ enabled: e.target.checked })}
                                className="size-3.5 accent-primary"
                            />
                        </label>
                        <p className="text-[10px] leading-4 text-muted-foreground">
                            Deterministic SMC rules on closed M1 bars: sweep of the {config.sweepLookback}-bar
                            extreme, FVG retest, discount/premium entry. Stop beyond the sweep with a{" "}
                            {config.atrPeriod}-bar ATR buffer; target at the range extreme or the R:R
                            distance. Rule-based, not a guarantee of profit. Orders are sent to MT5
                            as “{brokerSymbol}” — use the exact name your broker lists for Bitcoin
                            (check Market Watch in MetaTrader), otherwise the broker rejects the order
                            as “Symbol not found”.
                        </p>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
