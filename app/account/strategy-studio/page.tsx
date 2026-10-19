"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Code2, Layers, Pencil, Copy, Rocket, RefreshCw } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { auth } from "@/lib/firebase";
import type { BotStrategy, BotDeployment } from "@/lib/bot-studio/types";
import { STATE_LABELS } from "@/lib/bot-studio/lifecycle";

type Tab = "deployments" | "strategies";

async function getAuthHeaders(): Promise<Record<string, string>> {
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

/** Fetches strategies and deployments. A field is undefined when its request failed, so the caller keeps the previous list. */
async function fetchBotStudioData(): Promise<{
    strategies?: BotStrategy[];
    deployments?: BotDeployment[];
}> {
    const headers = await getAuthHeaders();
    const [stratRes, depRes] = await Promise.all([
        fetch("/api/bot-studio/strategies", { headers }),
        fetch("/api/bot-studio/deployments", { headers }),
    ]);
    const result: { strategies?: BotStrategy[]; deployments?: BotDeployment[] } = {};
    if (stratRes.ok) {
        const sData = await stratRes.json();
        if (sData.ok) result.strategies = sData.strategies || [];
    }
    if (depRes.ok) {
        const dData = await depRes.json();
        if (dData.ok) result.deployments = dData.deployments || [];
    }
    return result;
}

const TAB_BASE =
    "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring";

function SkeletonRows() {
    return (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
            {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-muted/50" />
            ))}
        </div>
    );
}

export default function AccountBotStudioPage() {
    const [strategies, setStrategies] = useState<BotStrategy[]>([]);
    const [deployments, setDeployments] = useState<BotDeployment[]>([]);
    const [activeTab, setActiveTab] = useState<Tab>("deployments");
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchBotStudioData();
            if (data.strategies) setStrategies(data.strategies);
            if (data.deployments) setDeployments(data.deployments);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load Bot Studio data");
        } finally {
            setLoading(false);
        }
    };

    // Initial load. Its state writes happen in promise callbacks, so the effect
    // does not trigger cascading renders; the cancel flag drops stale results.
    useEffect(() => {
        let cancelled = false;
        fetchBotStudioData()
            .then((data) => {
                if (cancelled) return;
                if (data.strategies) setStrategies(data.strategies);
                if (data.deployments) setDeployments(data.deployments);
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load Bot Studio data");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const startRename = (strategyId: string, currentName: string) => {
        setActionError(null);
        setRenameId(strategyId);
        setRenameValue(currentName);
    };

    const cancelRename = () => {
        setRenameId(null);
        setRenameValue("");
    };

    const handleRename = async (strategyId: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        setActionLoading(`rename-${strategyId}`);
        setActionError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ name: trimmed }),
            });
            if (!res.ok) {
                const err = await res.json();
                setActionError(`Rename failed: ${err.error}`);
            }
            await loadData();
        } catch (e) {
            setActionError(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
            setRenameId(null);
            setRenameValue("");
        }
    };

    const handleDuplicate = async (strategyId: string) => {
        setActionLoading(`dup-${strategyId}`);
        setActionError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, {
                method: "POST",
                headers,
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                const err = await res.json();
                setActionError(`Duplicate failed: ${err.error}`);
            }
            await loadData();
        } catch (e) {
            setActionError(`Duplicate failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const formatDate = (ts: number) => new Date(ts).toLocaleString();

    const renderStrategies = () => {
        if (strategies.length === 0) {
            return (
                <EmptyState
                    icon={<Layers className="h-5 w-5" />}
                    title="No strategies yet"
                    description="Write an AvScript or build one visually. Saved strategies appear here."
                    action={
                        <Button size="sm" render={<Link href="/account/strategy-studio/editor" />}>
                            <Code2 />
                            New AvScript
                        </Button>
                    }
                />
            );
        }
        return (
            <ul className="space-y-3">
                {strategies.map((strat) => {
                    const busy = actionLoading === `rename-${strat.id}` || actionLoading === `dup-${strat.id}`;
                    return (
                        <li key={strat.id}>
                            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 flex-1">
                                    {renameId === strat.id ? (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                value={renameValue}
                                                onChange={(e) => setRenameValue(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        if (renameValue.trim() && renameValue.trim() !== strat.name) {
                                                            void handleRename(strat.id, renameValue);
                                                        }
                                                    }
                                                    if (e.key === "Escape") cancelRename();
                                                }}
                                                className="h-8 text-sm"
                                                placeholder="Strategy name"
                                                autoFocus
                                            />
                                            <Button
                                                size="sm"
                                                disabled={busy || !renameValue.trim() || renameValue.trim() === strat.name}
                                                onClick={() => handleRename(strat.id, renameValue)}
                                            >
                                                Save
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={cancelRename} disabled={busy}>
                                                Cancel
                                            </Button>
                                        </div>
                                    ) : (
                                        <h3 className="truncate text-sm font-semibold text-foreground">{strat.name}</h3>
                                    )}
                                    <p className="font-numeric mt-0.5 text-xs text-muted-foreground">
                                        Updated {formatDate(strat.updatedAt)}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" render={<Link href={`/account/strategy-studio/editor?id=${strat.id}`} />}>
                                        <Code2 />
                                        Edit
                                    </Button>
                                    <Button variant="outline" size="sm" render={<Link href={`/account/strategy-studio/builder?id=${strat.id}`} />}>
                                        <Layers />
                                        Builder
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy}
                                        onClick={() => startRename(strat.id, strat.name)}
                                    >
                                        <Pencil />
                                        {actionLoading === `rename-${strat.id}` ? "Renaming…" : "Rename"}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy}
                                        onClick={() => handleDuplicate(strat.id)}
                                    >
                                        <Copy />
                                        {actionLoading === `dup-${strat.id}` ? "Duplicating…" : "Duplicate"}
                                    </Button>
                                </div>
                            </Card>
                        </li>
                    );
                })}
            </ul>
        );
    };

    const renderDeployments = () => {
        if (deployments.length === 0) {
            return (
                <EmptyState
                    icon={<Rocket className="h-5 w-5" />}
                    title="No deployments yet"
                    description="Deploy a saved strategy to run it on a demo or live account."
                />
            );
        }
        return (
            <ul className="space-y-3">
                {deployments.map((d) => (
                    <li key={d.id}>
                        <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <h3 className="font-numeric truncate text-sm font-semibold text-foreground">{d.id}</h3>
                                <p className="mt-0.5 text-xs text-muted-foreground">Runtime state</p>
                            </div>
                            <StatusBadge tone="neutral" label={STATE_LABELS[d.runtimeState]} />
                        </Card>
                    </li>
                ))}
            </ul>
        );
    };

    const tabs: { id: Tab; label: string; count: number }[] = [
        { id: "deployments", label: "Deployments", count: deployments.length },
        { id: "strategies", label: "Strategies", count: strategies.length },
    ];

    return (
        <AccountShell
            title="AlgoVault Bot Studio"
            subtitle="Create, test, and deploy trading strategies."
            headerActions={
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                    <RefreshCw className={loading ? "animate-spin" : ""} />
                    Refresh
                </Button>
            }
        >
            <div className="mx-auto max-w-5xl space-y-6 p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div
                        role="tablist"
                        aria-label="Bot Studio sections"
                        className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted/40 p-1"
                    >
                        {tabs.map((tab) => {
                            const selected = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    role="tab"
                                    id={`tab-${tab.id}`}
                                    aria-selected={selected}
                                    aria-controls={`panel-${tab.id}`}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`${TAB_BASE} ${
                                        selected
                                            ? "bg-card text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {tab.label}
                                    <span className="font-numeric ml-2 text-xs text-muted-foreground">{tab.count}</span>
                                </button>
                            );
                        })}
                    </div>

                    {activeTab === "strategies" && (
                        <div className="flex gap-2">
                            <Button size="sm" render={<Link href="/account/strategy-studio/editor" />}>
                                <Code2 />
                                New AvScript
                            </Button>
                            <Button variant="outline" size="sm" render={<Link href="/account/strategy-studio/builder" />}>
                                <Layers />
                                Visual builder
                            </Button>
                        </div>
                    )}
                </div>

                {error && (
                    <ErrorState
                        title="Couldn't load Bot Studio"
                        description={error}
                        action={
                            <Button variant="outline" size="sm" onClick={loadData}>
                                <RefreshCw />
                                Try again
                            </Button>
                        }
                    />
                )}

                {actionError && !error && (
                    <div role="alert" className="rounded-lg border border-negative/30 bg-negative-muted p-3 text-xs text-negative">
                        {actionError}
                    </div>
                )}

                <div
                    role="tabpanel"
                    id={`panel-${activeTab}`}
                    aria-labelledby={`tab-${activeTab}`}
                >
                    {loading ? (
                        <SkeletonRows />
                    ) : error ? null : activeTab === "strategies" ? (
                        renderStrategies()
                    ) : (
                        renderDeployments()
                    )}
                </div>
            </div>
        </AccountShell>
    );
}
