"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserBot } from "@/lib/bots";
import { auth } from "@/lib/firebase";
import { BotStudioBotCard } from "@/components/bot-studio/BotStudioBotCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeployedItem {
    id: string;
    source: "bot" | "deployment";
    name: string;
    description: string;
    direction: "long" | "short";
    symbol?: string;
    timeframe?: string;
    accountId?: string;
    mt5Account?: string;
    magicNumber?: string;
}

interface BotStudioListProps {
    currentPrice?: number;
    hasToken?: boolean;
    authToken?: string;
    accountId?: string;
    className?: string;
    /** Live running-state updates from deployed bot cards → trading page chart badge. */
    onStatusChange?: (running: boolean) => void;
}

export function BotStudioList({
    currentPrice,
    hasToken,
    authToken,
    accountId,
    className,
    onStatusChange,
}: BotStudioListProps) {
    const [bots, setBots] = useState<DeployedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadBots = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
                setBots([]);
                setError("Not authenticated — sign in to see deployed bots.");
                return;
            }

            const [botsRes, depRes] = await Promise.all([
                fetch("/api/bots", { headers: { Authorization: `Bearer ${token}` } }),
                fetch("/api/bots/deployments", { headers: { Authorization: `Bearer ${token}` } }),
            ]);

            const botsData = (await botsRes.json()) as {
                success?: boolean;
                bots?: UserBot[];
                error?: string;
            };
            if (!botsRes.ok || !botsData.success) {
                throw new Error(botsData.error || "Failed to load bots.");
            }

            const userBots: DeployedItem[] = (botsData.bots || []).map((b) => ({
                id: `BOT-${b.id}`,
                source: "bot" as const,
                name: b.name || `Bot ${b.id.slice(-8)}`,
                description: b.description || "MT5 gateway bot",
                direction: "long",
                symbol: b.symbol ?? undefined,
                timeframe: b.timeframe ?? undefined,
                accountId: b.mt5Account && b.mt5Account !== "default" ? b.mt5Account : undefined,
                mt5Account: b.mt5Account && b.mt5Account !== "default" ? b.mt5Account : undefined,
                magicNumber: b.magicNumber ?? undefined,
            }));

            const depData = (await depRes.json()) as {
                success?: boolean;
                deployments?: DeployedItem[];
                error?: string;
            };
            if (!depRes.ok || !depData.success) {
                throw new Error(depData.error || "Failed to load deployments.");
            }

            const deployments: DeployedItem[] = (depData.deployments || []).map((d) => ({
                ...d,
                source: "deployment" as const,
                accountId: d.mt5Account && d.mt5Account !== "default" ? d.mt5Account : undefined,
                mt5Account: d.mt5Account && d.mt5Account !== "default" ? d.mt5Account : undefined,
                magicNumber: d.magicNumber,
            }));

            // ── Deduplicate by id: UserBots (prefixed BOT-) take priority ──
            const byId = new Map<string, DeployedItem>();
            for (const d of deployments) byId.set(d.id, d);
            for (const b of userBots) byId.set(b.id, b);
            setBots(Array.from(byId.values()));
        } catch (err) {
            console.error("[BotStudioList] load failed:", err);
            setError(err instanceof Error ? err.message : "Failed to load bots.");
            setBots([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadBots();
        setRefreshing(false);
    };

    const handleDelete = async (botId: string, source: "bot" | "deployment") => {
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("Not authenticated");
            const endpoint = source === "deployment" ? `/api/bots/deployments/${botId}` : `/api/bots/${botId.replace(/^BOT-/, "")}`;
            const res = await fetch(endpoint, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (await res.json()) as { success?: boolean; error?: string };
            if (!res.ok) throw new Error(data.error || "Failed to delete bot.");
            setBots((prev) => prev.filter((b) => b.id !== botId));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete bot.");
        }
    };

    const handleEdit = async (
        botId: string,
        source: "bot" | "deployment",
        updates: Partial<{
            name: string;
            symbol: string;
            timeframe: string;
            magicNumber: string;
            commentFilter: string;
            description: string;
            mt5Account: string;
        }>,
    ) => {
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("Not authenticated");
            const endpoint = source === "deployment" ? `/api/bots/deployments/${botId}` : `/api/bots/${botId.replace(/^BOT-/, "")}`;
            const res = await fetch(endpoint, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(updates),
            });
            const data = (await res.json()) as { success?: boolean; error?: string };
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to update bot.");
            setError(null);
            await loadBots();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update bot.");
        }
    };

    useEffect(() => {
        void loadBots();
    }, [loadBots]);

    if (loading && bots.length === 0) {
        return (
            <Card className={cn("border border-border bg-card", className)}>
                <CardHeader className="px-3 py-2.5">
                    <CardTitle className="text-xs font-semibold leading-tight">
                        Deployed Bots
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 px-3 py-10">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground text-xs">
                        <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                        <span>{error ? error : "Loading deployed bots…"}</span>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className={cn("space-y-2.5", className)}>
            {error && !loading && bots.length === 0 && (
                <div className="rounded border border-negative/30 bg-negative-muted px-3 py-2 text-[10px] text-negative-foreground">
                    {error}
                </div>
            )}
            <Card className="border border-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between px-3 py-2.5">
                    <CardTitle className="text-xs font-semibold leading-tight">
                        Deployed Bots
                    </CardTitle>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={refreshing}
                        onClick={handleRefresh}
                        className={cn(
                            "h-6 px-1.5 [10px] gap-1",
                            refreshing ? "opacity-70" : "",
                        )}
                    >
                        <RefreshCw className={refreshing ? "animate-spin" : ""} size={10} />
                        {refreshing ? "Refreshing" : "Refresh"}
                    </Button>
                </CardHeader>
                <CardContent className="pt-0 px-3 pb-3">
                    {bots.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-muted-foreground text-xs">
                            <Bot className="size-5 opacity-40" />
                            <p>No deployed bots yet.</p>
                            <p className="text-[9px] opacity-60">
                                Connect an MT5 EA or deploy a strategy from Bot Studio to see it here.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {bots.map((bot) => (
                                    <BotStudioBotCard
                                    key={bot.id}
                                    template={{
                                        id: bot.id,
                                        name: bot.name,
                                        description: bot.description,
                                        direction: bot.direction,
                                        symbol: bot.symbol,
                                        timeframe: bot.timeframe,
                                        accountId: bot.accountId,
                                        magicNumber: bot.magicNumber,
                                    }}
                                    currentPrice={currentPrice}
                                    hasToken={hasToken}
                                    authToken={authToken}
                                    accountId={
                                        (bot.accountId && bot.accountId !== "default" ? bot.accountId : null) ??
                                        (accountId && accountId !== "default" ? accountId : undefined)
                                    }
                                    onDelete={(id) => handleDelete(id, bot.source)}
                                    onEdit={(id, updates) => handleEdit(id, bot.source, updates)}
                                    onRunningChange={onStatusChange}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
