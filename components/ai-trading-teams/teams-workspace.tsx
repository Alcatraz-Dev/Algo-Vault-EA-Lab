"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Boxes,
    Bot,
    FileSearch,
    Layers,
    Loader2,
    Lock,
    Plus,
    Settings2,
    Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAITeamsAccess } from "./use-ai-teams-access";
import { TeamsList, TemplatesGrid } from "./teams-list";
import { TeamBuilder } from "./team-builder";
import { AgentLibrary } from "./agent-library";
import { TeamRunsView } from "./runs-view";
import { TeamMemoryView } from "./memory-view";
import { WhatAreAITeams } from "./what-is";
import { TeamGraph } from "./team-graph";
import { teamsApi, TeamsApiError } from "./api";
import { BUILTIN_TEAM_AGENTS } from "@/lib/ai-trading-teams/agent-library";
import type { AITradingTeam, TeamTemplate } from "@/lib/ai-trading-teams/types";

type Tab = "teams" | "create" | "library" | "runs" | "templates" | "settings";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "teams", label: "My Teams", icon: Boxes },
    { id: "create", label: "Create Team", icon: Plus },
    { id: "library", label: "Agent Library", icon: Bot },
    { id: "runs", label: "Team Runs", icon: FileSearch },
    { id: "templates", label: "Templates", icon: Layers },
    { id: "settings", label: "Settings", icon: Settings2 },
];

/** Header facts the surrounding shell (AppShell / AccountShell) needs for its title row. */
export type AITeamsHeaderInfo = {
    authLoading: boolean;
    isPro: boolean;
    canRun: boolean;
};

export const INITIAL_HEADER_INFO: AITeamsHeaderInfo = {
    authLoading: true,
    isPro: false,
    canRun: false,
};

/** Small badge rendered on the same line as the page title. */
export function teamsEyebrow({ authLoading, isPro }: AITeamsHeaderInfo): React.ReactNode {
    if (authLoading) return null;
    return isPro ? (
        <Badge className="bg-primary text-primary-foreground hover:bg-primary/90">Pro</Badge>
    ) : (
        <Badge variant="outline">Free preview</Badge>
    );
}

export function teamsSubtitle({ authLoading, canRun }: AITeamsHeaderInfo): string {
    if (authLoading) return "Loading…";
    return canRun
        ? "Your private digital trading research desk"
        : "Preview the feature · Pro required to run analyses";
}

/**
 * AITeamsWorkspace — the full AI Trading Teams experience (teams, builder,
 * agent library, runs, templates, settings) without any page shell, so it can
 * mount inside AppShell (/ai-trading-teams) or AccountShell
 * (/account/ai-trading-teams).
 */
export function AITeamsWorkspace({
    onHeaderInfo,
}: {
    onHeaderInfo?: (info: AITeamsHeaderInfo) => void;
}) {
    const { user, authLoading, isPro, flags, canRun, library, refreshLibrary, loadingLibrary } =
        useAITeamsAccess();
    const router = useRouter();
    const [tab, setTab] = useState<Tab>(() => {
        if (typeof window === "undefined") return "teams";
        const initial = new URLSearchParams(window.location.search).get("tab") as Tab | null;
        return initial && TABS.some((t) => t.id === initial) ? initial : "teams";
    });
    const [teams, setTeams] = useState<AITradingTeam[]>([]);
    const [loadingTeams, setLoadingTeams] = useState(true);
    const [actionError, setActionError] = useState<string | null>(null);

    useEffect(() => {
        onHeaderInfo?.({ authLoading, isPro, canRun });
    }, [onHeaderInfo, authLoading, isPro, canRun]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        window.history.replaceState(null, "", url.toString());
    }, [tab]);

    useEffect(() => {
        let cancelled = false;
        const loadTeams = async () => {
            if (!user || !canRun) {
                setTeams([]);
                setLoadingTeams(false);
                return;
            }
            try {
                const data = await teamsApi<{ teams: AITradingTeam[] }>("");
                if (!cancelled) setTeams(data.teams ?? []);
            } catch {
                if (!cancelled) setTeams([]);
            } finally {
                if (!cancelled) setLoadingTeams(false);
            }
        };
        void loadTeams();
        return () => {
            cancelled = true;
        };
    }, [user, canRun]);

    const deleteTeam = useCallback(
        async (teamId: string) => {
            setActionError(null);
            try {
                await teamsApi(`/?teamId=${teamId}`, { method: "DELETE" });
                setTeams((current) => current.filter((t) => t.id !== teamId));
            } catch (err) {
                setActionError(err instanceof TeamsApiError ? err.message : "Failed to delete team.");
            }
        },
        [],
    );

    const useTemplate = useCallback(
        async (template: TeamTemplate) => {
            if (!canRun) {
                setTab("teams");
                return;
            }
            setActionError(null);
            try {
                const created = await teamsApi<{ id: string }>("/", {
                    method: "POST",
                    body: { name: template.name, templateId: template.id },
                });
                router.push(`/ai-trading-teams/${created.id}`);
            } catch (err) {
                setActionError(err instanceof TeamsApiError ? err.message : "Failed to create from template.");
            }
        },
        [canRun, router],
    );

    const agents = library?.agents ?? BUILTIN_TEAM_AGENTS;
    const templates = library?.templates ?? [];

    const exampleStates = useMemo(() => {
        const states: Record<string, "idle"> = {};
        for (const agent of BUILTIN_TEAM_AGENTS) states[agent.id] = "idle";
        return states;
    }, []);

    return (
        <div className="space-y-4">
            {!flags.aiTeamsEnabled ? (
                <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-warning">
                    AI Trading Teams is currently disabled by feature flag (AI_TRADING_TEAMS_ENABLED).
                </div>
            ) : null}

            {!isPro && !authLoading ? (
                <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="max-w-2xl">
                            <h2 className="flex items-center gap-2 text-lg font-bold">
                                <Sparkles className="size-5 text-primary" /> AI Trading Teams is a Pro feature
                            </h2>
                            <p className="mt-1.5 text-sm text-muted-foreground">
                                Assemble Market Regime, Smart Money, Technical, Quant, Risk, Contrarian and Chief Analyst
                                agents into a collaborative research desk that runs on AlgoVault’s deterministic market
                                intelligence. You can explore the example desk below; running real analyses requires Pro.
                            </p>
                            <Link href="/pricing" className="mt-3 inline-block">
                                <Button size="sm">Upgrade to Pro</Button>
                            </Link>
                        </div>
                        <div className="w-full max-w-md">
                            <p className="mb-1 text-center text-micro font-semibold tracking-widest text-muted-foreground uppercase">
                                Example team
                            </p>
                            <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                                <TeamGraph
                                    agents={BUILTIN_TEAM_AGENTS}
                                    states={exampleStates}
                                    onSelect={() => undefined}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            <WhatAreAITeams compact={Boolean(isPro)} />

            {actionError ? (
                <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {actionError}
                </p>
            ) : null}

            {/* Tabs */}
            <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" role="tablist" aria-label="AI Trading Teams sections">
                {TABS.map((item) => {
                    const Icon = item.icon;
                    const active = tab === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(item.id)}
                            className={
                                active
                                    ? "flex shrink-0 items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm"
                                    : "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                            }
                        >
                            <Icon className="size-3.5" />
                            {item.label}
                        </button>
                    );
                })}
            </div>

            {/* Content */}
            {tab === "teams" ? (
                loadingTeams || authLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        <span className="ml-2 text-xs">Loading teams…</span>
                    </div>
                ) : canRun ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-semibold tracking-tight">My AI Trading Teams</h2>
                            <Button size="sm" onClick={() => setTab("create")}>
                                <Plus className="size-3.5" /> Create Team
                            </Button>
                        </div>
                        <TeamsList
                            teams={teams}
                            agents={agents}
                            loading={loadingTeams}
                            canRun={canRun}
                            onDelete={deleteTeam}
                            onCreate={() => setTab("create")}
                        />
                    </div>
                ) : (
                    <EmptyState
                        icon={<Lock className="size-5" />}
                        title="Pro required"
                        description="Upgrade to Pro to create teams, run analyses and persist team runs."
                        action={
                            <Link href="/pricing">
                                <Button size="sm">Upgrade to Pro</Button>
                            </Link>
                        }
                    />
                )
            ) : null}

            {tab === "create" ? (
                canRun ? (
                    <TeamBuilder agents={agents} templates={templates} />
                ) : (
                    <EmptyState
                        icon={<Lock className="size-5" />}
                        title="Team Builder requires Pro"
                        description="Upgrade to Pro to create and customize AI Trading Teams."
                        action={
                            <Link href="/pricing">
                                <Button size="sm">Upgrade to Pro</Button>
                            </Link>
                        }
                    />
                )
            ) : null}

            {tab === "library" ? (
                loadingLibrary ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                    </div>
                ) : (
                    <AgentLibrary
                        agents={agents}
                        canCreateCustom={canRun && flags.customAgentsEnabled}
                        onAgentCreated={() => void refreshLibrary()}
                    />
                )
            ) : null}

            {tab === "runs" ? (
                canRun ? (
                    <TeamRunsView />
                ) : (
                    <EmptyState
                        icon={<Lock className="size-5" />}
                        title="Run history requires Pro"
                        description="Team runs, their evidence and setup states are persisted for Pro users."
                    />
                )
            ) : null}

            {tab === "templates" ? (
                templates.length === 0 && loadingLibrary ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold tracking-tight">Team templates</h2>
                                <p className="text-xs text-muted-foreground">
                                    Editable starting points published by AlgoVault and admins.
                                </p>
                            </div>
                            <StatusBadge tone="info" label={`${templates.length} templates`} />
                        </div>
                        <TemplatesGrid templates={templates} onUse={useTemplate} />
                    </div>
                )
            ) : null}

            {tab === "settings" ? (
                <div className="space-y-4">
                    <section className="rounded-xl border border-border/60 bg-card/60 p-4">
                        <h2 className="text-sm font-semibold">Feature flags & entitlement</h2>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                            <li className="flex items-center gap-2">
                                AI_TRADING_TEAMS_ENABLED
                                <StatusBadge tone={flags.aiTeamsEnabled ? "positive" : "negative"} label={flags.aiTeamsEnabled ? "on" : "off"} />
                            </li>
                            <li className="flex items-center gap-2">
                                AI_CUSTOM_AGENTS_ENABLED
                                <StatusBadge tone={flags.customAgentsEnabled ? "positive" : "negative"} label={flags.customAgentsEnabled ? "on" : "off"} />
                            </li>
                            <li className="flex items-center gap-2">
                                Subscription
                                <StatusBadge tone={isPro ? "positive" : "warning"} label={isPro ? "Pro" : "Free"} />
                            </li>
                        </ul>
                        <p className="mt-3 text-micro leading-relaxed text-muted-foreground">
                            Entitlement is enforced server-side on every run; UI hiding is never the control.
                        </p>
                    </section>

                    <section className="rounded-xl border border-border/60 bg-card/60 p-4">
                        <h2 className="text-sm font-semibold">Team memory</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Structured memory is stored per team. Pick a team to review or edit it.
                        </p>
                        {teams.length === 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">No teams yet.</p>
                        ) : (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {teams.map((team) => (
                                    <div key={team.id} className="rounded border border-border/60 p-2">
                                        <p className="text-xs font-medium">{team.name}</p>
                                        <div className="mt-1">
                                            <TeamMemoryView teamId={team.id} canRun={canRun} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="rounded-xl border border-border/60 bg-card/60 p-4 text-xs leading-relaxed text-muted-foreground">
                        <h2 className="mb-1 text-sm font-semibold text-foreground">Disclaimer</h2>
                        AlgoVault AI Trading Teams provide analytical and research assistance only. Outputs are
                        research observations based on the data available at the run timestamp — not financial
                        advice, and not guaranteed or certain outcomes.
                    </section>
                </div>
            ) : null}
        </div>
    );
}
