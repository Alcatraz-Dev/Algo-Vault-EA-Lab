"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowUpRight, Boxes, Layers, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { AgentAvatar } from "./agent-visual";
import type { TeamAgentDefinition, AITradingTeam, TeamTemplate } from "@/lib/ai-trading-teams/types";

/** “My Teams” grid — the home section of AI Trading Teams. */
export function TeamsList({
    teams,
    agents,
    loading,
    canRun,
    onDelete,
    onCreate,
}: {
    teams: AITradingTeam[];
    agents: TeamAgentDefinition[];
    loading: boolean;
    canRun: boolean;
    onDelete?: (teamId: string) => void;
    /** Opens the builder in place instead of navigating to /ai-trading-teams?tab=create. */
    onCreate?: () => void;
}) {
    const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

    if (!loading && teams.length === 0) {
        return (
            <EmptyState
                icon={<Boxes className="size-5" />}
                title="No AI Trading Teams yet"
                description="Assemble a private digital research desk: market regime, smart money, technical, quant, risk and a Chief Analyst working from the same AlgoVault intelligence."
                action={
                    onCreate ? (
                        <button type="button" onClick={onCreate} className={buttonVariants({ size: "sm" })}>
                            <Plus className="size-3.5" /> Create your first team
                        </button>
                    ) : (
                        <Link href="/ai-trading-teams?tab=create" className={buttonVariants({ size: "sm" })}>
                            <Plus className="size-3.5" /> Create your first team
                        </Link>
                    )
                }
            />
        );
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((team) => {
                const members = team.agentIds
                    .map((id) => agentById.get(id))
                    .filter((a): a is TeamAgentDefinition => Boolean(a))
                    .slice(0, 6);
                return (
                    <article
                        key={team.id}
                        className="group relative flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-primary/40"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <Link
                                    href={`/ai-trading-teams/${team.id}`}
                                    className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary"
                                >
                                    <span className="truncate">{team.name}</span>
                                    <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                                </Link>
                                <p className="mt-0.5 text-micro text-muted-foreground">
                                    {team.description?.slice(0, 90) || "Collaborative AI research desk"}
                                </p>
                            </div>
                            <StatusBadge tone={team.status === "active" ? "active" : "neutral"} label={team.status} />
                        </div>

                        <div className="flex flex-wrap gap-1 text-micro">
                            <Badge variant="outline">{team.config.market}</Badge>
                            <Badge variant="outline">{team.config.entryTimeframe}/{team.config.confirmationTimeframe}/{team.config.contextTimeframe}</Badge>
                            <Badge variant="outline" className="capitalize">{team.config.style}</Badge>
                            <Badge variant="secondary" className="capitalize">{team.config.behavior}</Badge>
                        </div>

                        <div className="flex items-center gap-1">
                            {members.map((agent) => (
                                <span key={agent.id} title={agent.name}>
                                    <AgentAvatar visualType={agent.visualType} state="idle" size={30} />
                                </span>
                            ))}
                            {team.agentIds.length > members.length ? (
                                <span className="ml-1 text-micro text-muted-foreground">+{team.agentIds.length - members.length}</span>
                            ) : null}
                        </div>

                        <div className="mt-auto flex items-center justify-between border-t border-border/50 pt-2.5">
                            <span className="text-micro text-muted-foreground">
                                v{team.version} · updated {new Date(team.updatedAt).toLocaleDateString()}
                            </span>
                            <div className="flex items-center gap-1">
                                {onDelete ? (
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Delete ${team.name}`}
                                        onClick={() => onDelete(team.id)}
                                    >
                                        <Trash2 className="size-3.5 text-muted-foreground" />
                                    </Button>
                                ) : null}
                                <Link
                                    href={`/ai-trading-teams/${team.id}`}
                                    className={buttonVariants({ variant: "outline", size: "xs" })}
                                >
                                    {canRun ? "Open desk" : "View"}
                                </Link>
                            </div>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}

/** Built-in + admin team templates. */
export function TemplatesGrid({
    templates,
    onUse,
}: {
    templates: TeamTemplate[];
    onUse?: (template: TeamTemplate) => void;
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
                <article key={template.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">{template.name}</h3>
                        <Badge variant={template.scope === "admin" ? "secondary" : "outline"} className="text-micro">
                            {template.scope === "admin" ? "official" : "built-in"}
                        </Badge>
                    </div>
                    <p className="text-micro leading-snug text-muted-foreground">{template.description}</p>
                    <div className="flex flex-wrap gap-1 text-micro">
                        <Badge variant="outline">{template.config.market}</Badge>
                        <Badge variant="outline" className="capitalize">{template.config.style}</Badge>
                        <Badge variant="outline" className="capitalize">{template.config.riskProfile}</Badge>
                        <Badge variant="secondary" className="capitalize">{template.config.behavior}</Badge>
                    </div>
                    <p className="text-micro text-muted-foreground">
                        <Layers className="mr-1 inline size-3" />
                        {template.agentIds.length} agents · {template.config.entryTimeframe}/{template.config.confirmationTimeframe}/{template.config.contextTimeframe}
                    </p>
                    {onUse ? (
                        <Button variant="outline" size="xs" className="mt-auto self-start" onClick={() => onUse(template)}>
                            Use template
                        </Button>
                    ) : null}
                </article>
            ))}
        </div>
    );
}
