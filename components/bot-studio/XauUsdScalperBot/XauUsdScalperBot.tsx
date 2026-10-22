"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { onValue, ref, getDatabase } from "firebase/database";
import { onAuthStateChanged, getAuth } from "firebase/auth";
import type { XauUsdScalpingConfig } from "@/lib/bot-studio/scalping";
import { XAUUSD_SCALPING_DEFAULTS } from "@/lib/bot-studio/scalping";
import { XauUsdScalperBotCard } from "./XauUsdScalperBotCard";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot } from "lucide-react";

type BotStatus = "idle" | "running" | "paused" | "error";

interface XauUsdScalperBotProps {
    /** Unique key when mounting multiple instances. */
    botId?: string;
    /** Initial config; defaults to the scalping defaults. */
    initialConfig?: Partial<XauUsdScalpingConfig>;
    /** Whether the bot is deployed/attached to an MT5 account. */
    deployed?: boolean;
    /** Signal when the parent wants to force a status refresh. */
    refreshKey?: number;
    className?: string;
    /** Called when the user toggles the bot on/off. Receives the next desired
     *  running state. The parent owns the persistence/activation decision. */
    onToggle?: (running: boolean) => void | Promise<void>;
    /** Called when the user clicks "Deploy to MT5" and the bot is not yet
     *  attached to an account. */
    onDeploy?: () => void;
    /** Optional override of the runtime status — when provided, the card shows
     *  this rather than querying RTDB (useful for server-driven status). */
    serverStatus?: {
        status: BotStatus;
        signalCount: number;
        executionCount: number;
        lastTickAt?: number;
        lastSignalAt?: number;
        lastExecutionAt?: number;
        errorReason?: string | null;
    } | null;
}

export function XauUsdScalperBot({
    botId = "default",
    initialConfig = {},
    deployed = false,
    refreshKey = 0,
    className,
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

    const unsubRef = useRef<(() => void) | null>(null);

    // The effective running state is either the server's view or the local one.
    const running = localRunning || serverStatus?.status === "running" || false;

    const effectiveStatus: BotStatus = serverStatus?.status ?? localStatus;
    const effectiveSignalCount = serverStatus?.signalCount ?? signalCount;
    const effectiveExecutionCount = serverStatus?.executionCount ?? executionCount;
    const effectiveLastTickAt = serverStatus?.lastTickAt ?? lastTickAt;
    const effectiveLastSignalAt = serverStatus?.lastSignalAt ?? lastSignalAt;
    const effectiveLastExecutionAt = serverStatus?.lastExecutionAt ?? lastExecutionAt;
    const effectiveErrorReason = serverStatus?.errorReason ?? errorReason;

    // Re-initialize RTDB listener when the bot id or auth changes.
    useEffect(() => {
        let mounted = true;

        const wire = async () => {
            const auth = getAuth();
            const db = getDatabase();

            await new Promise<void>((resolve) => {
                const authUnsub = onAuthStateChanged(auth, (user) => {
                    if (!user || !mounted) {
                        resolve();
                        return;
                    }
                    // Cancel any previous listener.
                    if (unsubRef.current) {
                        unsubRef.current();
                        unsubRef.current = null;
                    }

                    const path = `bot_scalpers/${botId}`;
                    const r = ref(db, path);

                    unsubRef.current = onValue(r, (snap) => {
                        if (!mounted) return;
                        const val = snap.val();
                        if (!val || typeof val !== "object") {
                            setLocalStatus("idle");
                            setSignalCount(0);
                            setExecutionCount(0);
                            setLastTickAt(undefined);
                            setLastSignalAt(undefined);
                            setLastExecutionAt(undefined);
                            setErrorReason(null);
                            return;
                        }
                        setLocalStatus((val.status as BotStatus) ?? "idle");
                        setSignalCount(Number(val.signalCount ?? 0));
                        setExecutionCount(Number(val.executionCount ?? 0));
                        setLastTickAt(
                            val.lastTickAt != null ? Number(val.lastTickAt) : undefined,
                        );
                        setLastSignalAt(
                            val.lastSignalAt != null ? Number(val.lastSignalAt) : undefined,
                        );
                        setLastExecutionAt(
                            val.lastExecutionAt != null ? Number(val.lastExecutionAt) : undefined,
                        );
                        setErrorReason(
                            val.errorReason != null ? String(val.errorReason) : null,
                        );
                    });

                    resolve();
                });
            });
        };

        wire();

        return () => {
            mounted = false;
            if (unsubRef.current) {
                unsubRef.current();
                unsubRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [botId, refreshKey]);

    const handleConfigChange = useCallback(
        (next: XauUsdScalpingConfig) => {
            setConfig(next);
        },
        [],
    );

    const handleToggle = useCallback(
        (nextRunning: boolean) => {
            setLocalRunning(nextRunning);
            setLocalStatus(nextRunning ? "running" : "idle");
            if (onToggle) {
                void onToggle(nextRunning);
            }
        },
        [onToggle],
    );

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
                                    XAUUSD M1 Scalper
                                    {deployed ? (
                                        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                                            · deployed
                                        </span>
                                    ) : null}
                                </CardTitle>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
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
                    onToggle={handleToggle}
                    onDeploy={deployed ? undefined : onDeploy}
                    onConfigChange={handleConfigChange}
                />
            </CardContent>
        </Card>
    );
}
