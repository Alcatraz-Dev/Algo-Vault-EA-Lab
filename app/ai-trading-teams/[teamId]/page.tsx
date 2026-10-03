"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAITeamsAccess } from "@/components/ai-trading-teams/use-ai-teams-access";
import { TeamWorkspace } from "@/components/ai-trading-teams/workspace";
import { teamsApi, TeamsApiError } from "@/components/ai-trading-teams/api";
import type { AITradingTeam } from "@/lib/ai-trading-teams/types";

export default function AITradingTeamWorkspacePage() {
    const params = useParams<{ teamId: string }>();
    const searchParams = useSearchParams();
    const teamId = params?.teamId ?? "";
    const { user, authLoading, isPro, canRun, library, loadingLibrary, libraryError } = useAITeamsAccess();

    const [team, setTeam] = useState<AITradingTeam | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const initialRunId = searchParams?.get("run") ?? null;

    const loadTeam = useCallback(async () => {
        if (!teamId || !canRun) return;
        const data = await teamsApi<{ team: AITradingTeam }>(`/${teamId}`);
        return data.team;
    }, [teamId, canRun]);

    useEffect(() => {
        let cancelled = false;
        const fetchTeam = async () => {
            if (!teamId || !canRun) {
                setLoading(false);
                return;
            }
            try {
                const team = await loadTeam();
                if (!cancelled && team) {
                    setTeam(team);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof TeamsApiError ? err.message : "Failed to load team.");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void fetchTeam();
        return () => {
            cancelled = true;
        };
    }, [teamId, canRun, loadTeam]);

    const navGroups: NavGroup[] = useMemo(
        () =>
            APP_NAV.map((group) => ({
                ...group,
                items: group.items.map((item) =>
                    item.href === "/ai-trading-teams" && !isPro ? { ...item, badge: "PRO" } : item,
                ),
            })),
        [isPro],
    );

    const agents = useMemo(() => {
        if (!team || !library) return [];
        const byId = new Map(library.agents.map((a) => [a.id, a]));
        const resolved = team.agentIds.map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a));
        // The Chief Analyst always participates in synthesis.
        if (!resolved.some((a) => a.id === "chief-analyst")) {
            const chief = byId.get("chief-analyst");
            if (chief) resolved.push(chief);
        }
        return resolved;
    }, [team, library]);

    if (authLoading || loading || loadingLibrary) {
        return (
            <AppShell navGroups={navGroups} title="AI Trading Team" subtitle="Loading workspace…">
                <div className="flex items-center justify-center py-24 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="ml-2 text-xs">Loading workspace…</span>
                </div>
            </AppShell>
        );
    }

    if (!canRun) {
        return (
            <AppShell navGroups={navGroups} title="AI Trading Team" subtitle="Pro required">
                <EmptyState
                    icon={<Lock className="size-5" />}
                    title="AI Trading Teams is a Pro feature"
                    description="Upgrade to Pro to open team workspaces and run collaborative analyses."
                    action={
                        <Link href="/pricing">
                            <Button size="sm">Upgrade to Pro</Button>
                        </Link>
                    }
                />
            </AppShell>
        );
    }

    if (error || !team) {
        return (
            <AppShell navGroups={navGroups} title="AI Trading Team" subtitle="Not found">
                <EmptyState
                    title="Team not found"
                    description={error ?? "This team does not exist or you do not have access to it."}
                    action={
                        <Link href="/ai-trading-teams">
                            <Button size="sm" variant="outline">Back to teams</Button>
                        </Link>
                    }
                />
            </AppShell>
        );
    }

    return (
        <AppShell
            navGroups={navGroups}
            title={team.name}
            subtitle={`${team.config.market} · ${team.config.style} · ${team.config.behavior}`}
            eyebrow={<Badge variant="outline">v{team.version}</Badge>}
            maxWidth="max-w-[1600px]"
        >
            {libraryError ? (
                <p className="mb-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {libraryError}
                </p>
            ) : null}
            <TeamWorkspace
                team={team}
                agents={agents}
                canRun={canRun}
                isAuthenticated={Boolean(user)}
                uid={user?.uid ?? null}
                initialRunId={initialRunId}
            />
        </AppShell>
    );
}
