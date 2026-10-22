"use client";

import { useCallback, useRef, useState } from "react";
import type { XauUsdScalpingConfig } from "@/lib/bot-studio/scalping";
import { XAUUSD_SCALPING_DEFAULTS } from "@/lib/bot-studio/scalping";
import { XauUsdScalperBot } from "@/components/bot-studio/XauUsdScalperBot";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Bot, Play, TrendingUp } from "lucide-react";

type BotStatus = "idle" | "running" | "paused" | "error";

interface BotListPanelProps {
    /** When true, the panel shows the bot card. */
    showBot?: boolean;
    /** Initial scalping config; merged with defaults. */
    initialConfig?: Partial<XauUsdScalpingConfig>;
    /** Whether the bot is deployed to an MT5 account. */
    deployed?: boolean;
    /** Optional server-driven status override. */
    serverStatus?: {
        status: BotStatus;
        signalCount: number;
        executionCount: number;
        lastTickAt?: number;
        lastSignalAt?: number;
        lastExecutionAt?: number;
        errorReason?: string | null;
    } | null;
    /** Called when the user toggles the bot on/off. */
    onToggle?: (running: boolean) => void;
    /** Called when the user clicks Deploy. */
    onDeploy?: () => void;
    className?: string;
}

export function BotListPanel({
    showBot = true,
    initialConfig = {},
    deployed = false,
    serverStatus,
    onToggle,
    onDeploy,
    className,
}: BotListPanelProps) {
    const [localStartCount, setLocalStartCount] = useState(0);
    const [localExecutionCount, setLocalExecutionCount] = useState(0);

    const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [demoRunning, setDemoRunning] = useState(false);

    const demoToggle = useCallback(() => {
        if (demoIntervalRef.current) {
            clearInterval(demoIntervalRef.current);
            demoIntervalRef.current = null;
            setDemoRunning(false);
            return;
        }
        setDemoRunning(true);
        demoIntervalRef.current = setInterval(() => {
            setLocalStartCount((c) => c + 1);
            if (Math.random() < 0.6) {
                setLocalExecutionCount((c) => c + 1);
            }
        }, 8000);
    }, []);

    const status: BotStatus =
        serverStatus?.status ?? (demoRunning ? "running" : "idle");

    const signalCount =
        serverStatus?.signalCount ?? (demoRunning ? localStartCount : 0);
    const executionCount =
        serverStatus?.executionCount ?? (demoRunning ? localExecutionCount : 0);

    const lastTickAt =
        serverStatus?.lastTickAt ?? (demoRunning ? Date.now() : undefined);
    const lastSignalAt =
        serverStatus?.lastSignalAt ?? (demoRunning ? Date.now() : undefined);
    const lastExecutionAt =
        serverStatus?.lastExecutionAt ?? (demoRunning ? Date.now() : undefined);

    if (!showBot) {
        return null;
    }

    return (
        <Card className={cn("overflow-hidden", className)}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Bot className="size-4" />
                            </div>
                            <div className="min-w-0">
                                <CardTitle className="text-sm font-semibold leading-tight">
                                    Bot List
                                </CardTitle>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">
                                        XAUUSD · M1
                                    </span>
                                    {deployed ? (
                                        <span className="inline-flex items-center rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                                            deployed
                                        </span>
                                    ) : null}
                                    {demoRunning ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                                            <span className="size-1.5 rounded-full bg-positive animate-pulse" />
                                            demo mode
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {onDeploy && !deployed && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onDeploy}
                                className="text-xs h-7 px-2"
                            >
                                Deploy
                            </Button>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={demoToggle}
                        >
                            {demoRunning ? (
                                <span className="flex items-center gap-1">
                                    <span className="size-1.5 rounded-full bg-positive animate-pulse" />
                                    Stop demo
                                </span>
                            ) : (
                                <span className="flex items-center gap-1">
                                    <Play className="size-3" />
                                    Start demo
                                </span>
                            )}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <XauUsdScalperBot
                    botId="panel"
                    initialConfig={initialConfig}
                    deployed={deployed}
                    refreshKey={serverStatus ? serverStatus.lastTickAt ?? 0 : 0}
                    serverStatus={serverStatus}
                    onToggle={onToggle}
                    onDeploy={onDeploy}
                />
                <Separator />
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <TrendingUp className="size-3" />
                        <span className="font-mono tabular-nums">
                            TP1 {initialConfig.tp1Pips ?? XAUUSD_SCALPING_DEFAULTS.tp1Pips}p
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <TrendingUp className="size-3" />
                        <span className="font-mono tabular-nums">
                            TP2 {initialConfig.tp2Pips ?? XAUUSD_SCALPING_DEFAULTS.tp2Pips}p
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="size-3" />
                        <span className="font-mono tabular-nums">
                            SL {initialConfig.slPips ?? XAUUSD_SCALPING_DEFAULTS.slPips}p
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="size-3" />
                        <span className="font-mono tabular-nums">
                            spread ≤ {initialConfig.maxSpreadPoints ?? XAUUSD_SCALPING_DEFAULTS.maxSpreadPoints}pts
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="size-3" />
                        <span className="font-mono tabular-nums">
                            magic {initialConfig.magicNumber ?? XAUUSD_SCALPING_DEFAULTS.magicNumber}
                        </span>
                    </div>
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                    Scalps XAUUSD on the M1 chart. After TP1 is hit, the runner
                    keeps the balance open to TP2; SL stays in place for the full
                    position. The bot skips signals when the spread exceeds the
                    configured spread ceiling.
                </div>
            </CardContent>
        </Card>
    );
}
