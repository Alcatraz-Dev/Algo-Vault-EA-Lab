"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { XauUsdScalpingConfig } from "@/lib/bot-studio/scalping";
import { XAUUSD_SCALPING_DEFAULTS, pipsToPrice, deriveLevels } from "@/lib/bot-studio/scalping";
import { XauUsdScalperBotCard } from "./XauUsdScalperBotCard";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { executeUnified, newClientRequestId } from "@/lib/trading/unified/client";
import { isSymbolMarketOpen } from "@/lib/ai-signals/sessions-filter";
import { Bot } from "lucide-react";

type BotStatus = "idle" | "running" | "paused" | "error";

interface XauUsdScalperBotProps {
    botId?: string;
    initialConfig?: Partial<XauUsdScalpingConfig>;
    deployed?: boolean;
    refreshKey?: number;
    className?: string;
    currentPrice?: number;
    hasToken?: boolean;
    accountId?: string;
    onPositionChange?: (position: {
        ticket: string;
        symbol: string;
        type: "BUY" | "SELL";
        volume: number;
        openPrice: number;
        currentPrice: number;
        sl: number;
        tp: number;
        profit: number;
        swap: number;
        magic: number;
        openedAt: number;
    } | null) => void;
    onToggle?: (running: boolean, reason?: string) => void | Promise<void>;
    onDeploy?: () => void;
    serverStatus?: {
        status: BotStatus;
        signalCount: number;
        executionCount: number;
        lastTickAt?: number;
        lastSignalAt?: number;
        lastExecutionAt?: number;
        errorReason?: string | null;
        currentPosition?: {
            ticket: string;
            side: "BUY" | "SELL";
            volume: number;
            entry: number;
            sl: number;
            tp1: number;
            tp2: number;
            openAt: number;
        } | null;
        recentTrades?: Array<{
            id: string;
            side: "BUY" | "SELL";
            entry: number;
            exit?: number;
            pnl?: number;
            tpLevel: 1 | 2 | "sl";
            status: "open" | "win" | "loss" | "sl";
            openedAt: number;
        }>;
    } | null;
}

type BotTrade = {
    id: string;
    side: "BUY" | "SELL";
    entry: number;
    exit?: number;
    pnl?: number;
    tpLevel: 1 | 2 | "sl";
    status: "open" | "win" | "loss" | "sl";
    openedAt: number;
};

let tokenRef: string | null = null;

// Stable token setter that the trading page imports and calls once auth is
// ready. Keeps the auth token in a module-level ref so the M1 tick loop
// can submit orders through /api/trading/orders.
export function setToken(t: string | null) {
    tokenRef = t;
}

export function XauUsdScalperBot({
    botId = "default",
    initialConfig = {},
    deployed = false,
    refreshKey = 0,
    className,
    currentPrice,
    hasToken,
    accountId,
    onPositionChange,
    onToggle,
    onDeploy,
    serverStatus,
}: XauUsdScalperBotProps) {
    const [config, setConfig] = useState<XauUsdScalpingConfig>(() => ({
        ...XAUUSD_SCALPING_DEFAULTS,
        ...initialConfig,
    }));
    const [localRunning, setLocalRunning] = useState(false);
    const [localStatus, setLocalStatus] = useState<BotStatus>("idle");
    const [signalCount, setSignalCount] = useState(0);
    const [executionCount, setExecutionCount] = useState(0);
    const [lastTickAt, setLastTickAt] = useState<number | undefined>(undefined);
    const [lastSignalAt, setLastSignalAt] = useState<number | undefined>(undefined);
    const [lastExecutionAt, setLastExecutionAt] = useState<number | undefined>(undefined);
    const [errorReason, setErrorReason] = useState<string | null>(null);

    const [currentPosition, setCurrentPosition] = useState<{
        ticket: string;
        side: "BUY" | "SELL";
        volume: number;
        entry: number;
        sl: number;
        tp1: number;
        tp2: number;
        openAt: number;
    } | null>(null);
    const [recentTrades, setRecentTrades] = useState<BotTrade[]>([]);

    const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const openPositionRef = useRef<{
        ticket: string;
        side: "BUY" | "SELL";
        volume: number;
        entry: number;
        sl: number;
        tp1: number;
        tp2: number;
        openAt: number;
    } | null>(null);
    const recentTradesRef = useRef<BotTrade[]>([]);
    const pendingCloseRef = useRef<Set<string>>(new Set());
    const tickCountRef = useRef(0);
    const currentPriceRef = useRef<number | null>(null);

    useEffect(() => {
        currentPriceRef.current = currentPrice != null && currentPrice > 0 ? currentPrice : null;
    }, [currentPrice]);

    const running = localRunning || serverStatus?.status === "running" || false;
    const effectiveStatus: BotStatus = serverStatus?.status ?? localStatus;
    const effectiveSignalCount = serverStatus?.signalCount ?? signalCount;
    const effectiveExecutionCount = serverStatus?.executionCount ?? executionCount;
    const effectiveLastTickAt = serverStatus?.lastTickAt ?? lastTickAt;
    const effectiveLastSignalAt = serverStatus?.lastSignalAt ?? lastSignalAt;
    const effectiveLastExecutionAt = serverStatus?.lastExecutionAt ?? lastExecutionAt;
    const effectiveErrorReason = serverStatus?.errorReason ?? errorReason;

    const effectiveCurrentPosition = useMemo(
        () => serverStatus?.currentPosition ?? currentPosition,
        [serverStatus?.currentPosition, currentPosition],
    );
    const effectiveRecentTrades = useMemo(
        () => serverStatus?.recentTrades ?? recentTrades,
        [serverStatus?.recentTrades, recentTrades],
    );

    const submitOrder = useCallback(
        async (order: {
            accountId: string;
            clientOrderId: string;
            symbol: string;
            action: "BUY" | "SELL" | "BUY_LIMIT" | "SELL_LIMIT" | "CLOSE" | "PARTIAL_CLOSE";
            volume: number;
            price?: number;
            sl?: number;
            tp?: number;
            positionId?: string;
        }) => {
            const token = tokenRef;
            if (!token) return { ok: false, error: "no auth token" };

            const executionType =
                order.action === "PARTIAL_CLOSE" ? "PARTIAL_CLOSE"
                    : order.action === "CLOSE" ? "CLOSE_POSITION"
                    : "PLACE_ORDER";

            const side: "BUY" | "SELL" | undefined =
                order.action === "BUY" || order.action === "BUY_LIMIT"
                    ? "BUY"
                    : order.action === "SELL" || order.action === "SELL_LIMIT"
                    ? "SELL"
                    : undefined;

            if (executionType === "PLACE_ORDER" && !isSymbolMarketOpen(order.symbol)) {
                return { ok: false, error: `Market closed for ${order.symbol} — scalper sleeping` };
            }

            try {
                const result = await executeUnified(
                    {
                        accountId: order.accountId,
                        clientRequestId: order.clientOrderId,
                        executionType,
                        symbol: order.symbol,
                        side,
                        volume: executionType === "PARTIAL_CLOSE" ? undefined : order.volume,
                        percentage: executionType === "PARTIAL_CLOSE" ? 50 : undefined,
                        positionId: order.positionId,
                        kind: "MARKET",
                        price: order.price ?? null,
                        stopLoss: order.sl ?? null,
                        takeProfit: order.tp ?? null,
                        source: "xauusd-bot",
                    },
                    token,
                );

                const ok = result.status === "SUCCEEDED" || result.status === "EXECUTED_PENDING_SYNC";
                return {
                    ok,
                    body: { success: ok },
                    status: 200,
                };
            } catch (err) {
                return {
                    ok: false,
                    error: err instanceof Error ? err.message : "execution error",
                };
            }
        },
        [],
    );

    const startBot = useCallback(async () => {
        if (!tokenRef) {
            setErrorReason("not authenticated — wait for token");
            setLocalStatus("error");
            return false;
        }
        setLocalRunning(true);
        setLocalStatus("running");
        setErrorReason(null);
        tickCountRef.current = 0;
        if (tickTimerRef.current) {
            clearInterval(tickTimerRef.current);
        }
        tickTimerRef.current = setInterval(async () => {
            if (!running) return;
            if (!isSymbolMarketOpen("XAUUSD")) {
                setErrorReason("Market closed — scalper sleeping");
                setLastTickAt(Date.now());
                return;
            }
            tickCountRef.current += 1;
            const warmUp = config.warmUpCandles;
            if (tickCountRef.current <= warmUp) {
                setLastTickAt(Date.now());
                return;
            }

            const now = Date.now();
            const livePrice = currentPriceRef.current;
            const basePrice = livePrice != null && livePrice > 0
                ? livePrice
                : 2650 + (tickCountRef.current % 40) * 0.15 - 3;
            const ask = basePrice + 0.05;
            const bid = basePrice - 0.05;
            const spreadPoints = Math.round((ask - bid) / 0.01);

            setLastTickAt(now);
            setLastExecutionAt(now);

            if (spreadPoints > config.maxSpreadPoints) {
                setErrorReason(`spread ${spreadPoints}pts > cap ${config.maxSpreadPoints}pts — skipped`);
                setTimeout(() => setErrorReason(null), 2500);
                return;
            }

            const alreadyOpen = openPositionRef.current != null;
            if (alreadyOpen && config.maxPositions <= 1) {
                const pos = openPositionRef.current!;
                const currentPrice = pos.side === "BUY" ? ask : bid;
                const pnl = pos.side === "BUY"
                    ? (currentPrice - pos.entry) * pos.volume * 100
                    : (pos.entry - currentPrice) * pos.volume * 100;

                const tp1Hit = pos.side === "BUY"
                    ? currentPrice >= pos.tp1
                    : currentPrice <= pos.tp1;
                if (tp1Hit && !pendingCloseRef.current.has(pos.ticket)) {
                    pendingCloseRef.current.add(pos.ticket);
                    const halfVolume = +(pos.volume * 0.5).toFixed(2);
                    const closeResult = await submitOrder({
                        accountId: accountId || "",
                        clientOrderId: `BOT-TP1-${pos.ticket}-${Date.now()}`,
                        symbol: "XAUUSD",
                        action: "PARTIAL_CLOSE",
                        volume: halfVolume,
                        price: currentPrice,
                        sl: 0,
                        tp: 0,
                        positionId: pos.ticket,
                    });
                    if (closeResult.ok) {
                        setExecutionCount((c) => c + 1);
                        setLastExecutionAt(Date.now());
                        setRecentTrades((prev) =>
                            prev.map((t) =>
                                t.id === pos.ticket
                                    ? {
                                          ...t,
                                          exit: currentPrice,
                                          pnl: +(pnl * 0.5).toFixed(2),
                                          tpLevel: 1,
                                          status: "win",
                                      }
                                    : t,
                            ),
                        );
                        openPositionRef.current = {
                            ...pos,
                            volume: pos.volume - halfVolume,
                        };
                        setCurrentPosition({
                            ticket: pos.ticket,
                            side: pos.side,
                            volume: pos.volume - halfVolume,
                            entry: pos.entry,
                            sl: pos.sl,
                            tp1: pos.tp1,
                            tp2: pos.tp2,
                            openAt: pos.openAt,
                        });
                    }
                    setTimeout(() => pendingCloseRef.current.delete(pos.ticket), 500);
                }

                const tp2Hit = pos.side === "BUY"
                    ? currentPrice >= pos.tp2
                    : currentPrice <= pos.tp2;
                if (tp2Hit && !pendingCloseRef.current.has(`${pos.ticket}-tp2`)) {
                    pendingCloseRef.current.add(`${pos.ticket}-tp2`);
                    const closeResult = await submitOrder({
                        accountId: accountId || "",
                        clientOrderId: `BOT-TP2-${pos.ticket}-${Date.now()}`,
                        symbol: "XAUUSD",
                        action: "CLOSE",
                        volume: pos.volume,
                        price: currentPrice,
                        sl: 0,
                        tp: 0,
                        positionId: pos.ticket,
                    });
                    if (closeResult.ok) {
                        setExecutionCount((c) => c + 1);
                        setLastExecutionAt(Date.now());
                        const fullPnl = pos.side === "BUY"
                            ? (currentPrice - pos.entry) * pos.volume * 100
                            : (pos.entry - currentPrice) * pos.volume * 100;
                        setRecentTrades((prev) =>
                            prev.map((t) =>
                                t.id === pos.ticket
                                    ? {
                                          ...t,
                                          exit: currentPrice,
                                          pnl: +fullPnl.toFixed(2),
                                          tpLevel: 2,
                                          status: fullPnl >= 0 ? "win" : "loss",
                                      }
                                    : t,
                            ),
                        );
                        openPositionRef.current = null;
                        setCurrentPosition(null);
                    }
                    setTimeout(() => pendingCloseRef.current.delete(`${pos.ticket}-tp2`), 500);
                }

                const slHit = pos.side === "BUY"
                    ? currentPrice <= pos.sl
                    : currentPrice >= pos.sl;
                if (slHit && !pendingCloseRef.current.has(`${pos.ticket}-sl`)) {
                    pendingCloseRef.current.add(`${pos.ticket}-sl`);
                    const closeResult = await submitOrder({
                        accountId: accountId || "",
                        clientOrderId: `BOT-SL-${pos.ticket}-${Date.now()}`,
                        symbol: "XAUUSD",
                        action: "CLOSE",
                        volume: pos.volume,
                        price: currentPrice,
                        sl: 0,
                        tp: 0,
                        positionId: pos.ticket,
                    });
                    if (closeResult.ok) {
                        setExecutionCount((c) => c + 1);
                        setLastExecutionAt(Date.now());
                        const fullPnl = pos.side === "BUY"
                            ? (currentPrice - pos.entry) * pos.volume * 100
                            : (pos.entry - currentPrice) * pos.volume * 100;
                        setRecentTrades((prev) =>
                            prev.map((t) =>
                                t.id === pos.ticket
                                    ? {
                                          ...t,
                                          exit: currentPrice,
                                          pnl: +fullPnl.toFixed(2),
                                          tpLevel: "sl",
                                          status: "sl",
                                      }
                                    : t,
                            ),
                        );
                        openPositionRef.current = null;
                        setCurrentPosition(null);
                    }
                    setTimeout(() => pendingCloseRef.current.delete(`${pos.ticket}-sl`), 500);
                }

                if (openPositionRef.current != null) {
                    setCurrentPosition({
                        ticket: pos.ticket,
                        side: pos.side,
                        volume: pos.volume,
                        entry: pos.entry,
                        sl: pos.sl,
                        tp1: pos.tp1,
                        tp2: pos.tp2,
                        openAt: pos.openAt,
                    });
                }
                return;
            }

            if (!config.enabled) return;

            const signalChance = 0.15;
            if (Math.random() < signalChance) {
                const side: "BUY" | "SELL" = config.direction === "long" ? "BUY" : "SELL";
                const entry = side === "BUY" ? ask : bid;
                const { tp1, tp2, sl } = deriveLevels(entry, config.tp1Pips, config.tp2Pips, config.slPips, config.direction);
                const volume = 0.01;

                const ticket = `BOT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
                const orderResult = await submitOrder({
                    accountId: accountId || "",
                    clientOrderId: `BOT-ENTRY-${ticket}`,
                    symbol: "XAUUSD",
                    action: side,
                    volume,
                    price: entry,
                    sl,
                    tp: tp1,
                });

                if (orderResult.ok) {
                    setSignalCount((c) => c + 1);
                    setExecutionCount((c) => c + 1);
                    setLastSignalAt(Date.now());
                    setLastExecutionAt(Date.now());
                    const newPos = {
                        ticket,
                        side,
                        volume,
                        entry,
                        sl,
                        tp1,
                        tp2,
                        openAt: Date.now(),
                    };
                    openPositionRef.current = newPos;
                    setCurrentPosition(newPos);
                    setRecentTrades((prev) => [
                        {
                            id: ticket,
                            side,
                            entry,
                            tpLevel: 1,
                            status: "open",
                            openedAt: Date.now(),
                        },
                        ...prev.slice(0, 49),
                    ]);
                } else {
                    setErrorReason(`order rejected: ${JSON.stringify(orderResult.body)}`);
                    setTimeout(() => setErrorReason(null), 3000);
                }

                setLastTickAt(Date.now());
                setLastExecutionAt(Date.now());
            }
        }, 60000);
        return true;
    }, [config, running, submitOrder, accountId]);

    const stopBot = useCallback(() => {
        setLocalRunning(false);
        setLocalStatus("idle");
        if (tickTimerRef.current) {
            clearInterval(tickTimerRef.current);
            tickTimerRef.current = null;
        }
        setErrorReason("bot stopped");
        setTimeout(() => setErrorReason(null), 2500);
    }, []);

    const handleToggle = useCallback(
        (nextRunning: boolean, reason?: string) => {
            if (nextRunning) {
                void startBot();
            } else {
                stopBot();
            }
            if (onToggle) {
                void onToggle(nextRunning, reason);
            }

            return () => {
                tickTimerRef.current = null;
            };
        },
        [startBot, stopBot, onToggle],
    );

    const handleConfigChange = useCallback(
        (next: XauUsdScalpingConfig) => {
            setConfig(next);
        },
        [],
    );

    const handleTestTrade = useCallback(() => {
        const entry = currentPriceRef.current;
        if (!tokenRef) {
            setErrorReason("not authenticated — wait for token");
            setTimeout(() => setErrorReason(null), 3000);
            return;
        }
        if (!entry || entry <= 0) {
            setErrorReason("no live price — wait for market data");
            setTimeout(() => setErrorReason(null), 3000);
            return;
        }
        const { tp1, tp2, sl } = deriveLevels(entry, config.tp1Pips, config.tp2Pips, config.slPips, config.direction);
        const side: "BUY" | "SELL" = config.direction === "long" ? "BUY" : "SELL";
        const ticket = `TEST-${Date.now()}`;
        const volume = 0.01;
        void submitOrder({
            accountId: accountId || "",
            clientOrderId: `BOT-TEST-${ticket}`,
            symbol: "XAUUSD",
            action: side,
            volume,
            price: entry,
            sl,
            tp: tp1,
        }).then((res) => {
            if (!res.ok) {
                setErrorReason(`test order rejected: ${JSON.stringify(res.body)}`);
                setTimeout(() => setErrorReason(null), 3000);
                return;
            }
            const newPos = { ticket, side, volume, entry, sl, tp1, tp2, openAt: Date.now() };
            openPositionRef.current = newPos;
            setCurrentPosition(newPos);
            setRecentTrades((prev) => [{ id: ticket, side, entry, tpLevel: 1, status: "open", openedAt: Date.now() }, ...prev.slice(0, 49)]);
            setSignalCount((c) => c + 1);
            setExecutionCount((c) => c + 1);
            setLastSignalAt(Date.now());
            setLastExecutionAt(Date.now());
        });
    }, [config, submitOrder, accountId]);

    useEffect(() => {
        return () => {
            if (tickTimerRef.current) {
                clearInterval(tickTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!effectiveCurrentPosition) {
            onPositionChange?.(null);
            return;
        }
        onPositionChange?.({
            ticket: effectiveCurrentPosition.ticket,
            symbol: "XAUUSD",
            type: effectiveCurrentPosition.side,
            volume: effectiveCurrentPosition.volume,
            openPrice: effectiveCurrentPosition.entry,
            currentPrice: effectiveCurrentPosition.entry,
            sl: effectiveCurrentPosition.sl,
            tp: effectiveCurrentPosition.tp1,
            profit: 0,
            swap: 0,
            magic: config.magicNumber,
            openedAt: effectiveCurrentPosition.openAt,
        });
    }, [effectiveCurrentPosition, onPositionChange, config]);
    return (
        <Card className={cn("overflow-hidden", className)}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Bot className="size-4.5" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <CardTitle className="text-sm font-semibold leading-tight">
                                        XAUUSD M1 Scalper
                                        {deployed ? (
                                            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                                                · deployed
                                            </span>
                                        ) : null}
                                    </CardTitle>
                                    {running && (
                                        <span className="size-1.5 rounded-full bg-positive animate-pulse" />
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px]">
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">
                                        XAUUSD · M1
                                    </span>
                                    {config.enabled ? (
                                        <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                                            enabled
                                        </span>
                                    ) : (
                                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                            disabled
                                        </span>
                                    )}
                                    {running ? (
                                        <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                                            running
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {!deployed && onDeploy && (
                            <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted"
                                onClick={onDeploy}
                            >
                                Deploy to MT5
                            </button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <XauUsdScalperBotCard
                    config={config}
                    running={running}
                    signalCount={effectiveSignalCount}
                    executionCount={effectiveExecutionCount}
                    lastTickAt={effectiveLastTickAt}
                    lastSignalAt={effectiveLastSignalAt}
                    lastExecutionAt={effectiveLastExecutionAt}
                    errorReason={effectiveErrorReason}
                    status={effectiveStatus}
                    currentPosition={effectiveCurrentPosition}
                    currentPrice={currentPrice}
                    recentTrades={effectiveRecentTrades}
                    onToggle={handleToggle}
                    onDeploy={deployed ? undefined : onDeploy}
                    onTestTrade={handleTestTrade}
                    onConfigChange={handleConfigChange}
                    hasToken={hasToken}
                />                </CardContent>
        </Card>
    );
}
