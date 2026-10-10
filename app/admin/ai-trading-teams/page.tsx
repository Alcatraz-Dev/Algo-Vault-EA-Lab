"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Activity,
    AlertTriangle,
    Bot,
    Clock,
    Gauge,
    Layers,
    Loader2,
    Plus,
    Trash2,
    TrendingUp,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { adminTeamsApi, TeamsApiError } from "@/components/ai-trading-teams/api";
import type { MonitoringSnapshot } from "@/lib/ai-trading-teams/monitoring";
import type { TeamTemplate } from "@/lib/ai-trading-teams/types";

/**
 * Admin → AI Trading Teams (spec §19/§21/§22).
 *
 * Monitoring dashboard (runs, latency, agent usage, error rate, data modes,
 * recent failures, product events) + official team template publishing.
 * Provider token/cost metrics intentionally stay in the EXISTING
 * AI usage dashboard — no duplicate accounting here.
 */
export default function AdminAITradingTeamsPage() {
    const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
    const [templates, setTemplates] = useState<TeamTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showTemplateForm, setShowTemplateForm] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [templateDraft, setTemplateDraft] = useState({
        name: "",
        description: "",
        market: "XAUUSD",
        style: "scalping",
        entryTimeframe: "M5",
        confirmationTimeframe: "M15",
        contextTimeframe: "H1",
        riskProfile: "balanced",
        behavior: "risk-first",
        agentIds: "market-regime,smart-money,price-action,liquidity,risk-manager,contrarian,chief-analyst",
    });

    const fetchSnapshot = useCallback(async () => {
        const [monitoring, templateData] = await Promise.all([
            adminTeamsApi<MonitoringSnapshot>("/ai-trading-teams"),
            adminTeamsApi<{ templates: TeamTemplate[] }>("/ai-trading-teams?view=templates"),
        ]);
        return { monitoring, templates: templateData.templates ?? [] };
    }, []);

    const load = useCallback(async () => {
        const { monitoring, templates: templateList } = await fetchSnapshot();
        setSnapshot(monitoring);
        setTemplates(templateList);
    }, [fetchSnapshot]);

    useEffect(() => {
        let cancelled = false;
        const bootstrap = async () => {
            try {
                const { monitoring, templates: templateList } = await fetchSnapshot();
                if (cancelled) return;
                setSnapshot(monitoring);
                setTemplates(templateList);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof TeamsApiError ? err.message : "Failed to load monitoring data.");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, [fetchSnapshot]);

    const publishTemplate = useCallback(async () => {
        try {
            await adminTeamsApi("/ai-trading-teams", {
                method: "POST",
                body: {
                    name: templateDraft.name,
                    description: templateDraft.description,
                    config: {
                        market: templateDraft.market,
                        style: templateDraft.style,
                        entryTimeframe: templateDraft.entryTimeframe,
                        confirmationTimeframe: templateDraft.confirmationTimeframe,
                        contextTimeframe: templateDraft.contextTimeframe,
                        riskProfile: templateDraft.riskProfile,
                        behavior: templateDraft.behavior,
                    },
                    agentIds: templateDraft.agentIds.split(",").map((s) => s.trim()).filter(Boolean),
                },
            });
            setMessage("Template published.");
            setShowTemplateForm(false);
            await load();
        } catch (err) {
            setMessage(err instanceof TeamsApiError ? err.message : "Failed to publish template.");
        }
    }, [templateDraft, load]);

    const deleteTemplate = useCallback(
        async (templateId: string) => {
            try {
                await adminTeamsApi(`/ai-trading-teams?templateId=${templateId}`, { method: "DELETE" });
                setTemplates((current) => current.filter((t) => t.id !== templateId));
            } catch (err) {
                setMessage(err instanceof TeamsApiError ? err.message : "Failed to delete template.");
            }
        },
        [],
    );

    return (
        <AdminShell
            title="AI Trading Teams"
            subtitle="Official templates and execution monitoring"
        >
            <div className="space-y-6">
                {message ? (
                    <p className="rounded border border-border bg-muted/40 px-3 py-2 text-xs">{message}</p>
                ) : null}

                {/* ── Monitoring ─────────────────────────────────────── */}
                <section>
                    <SectionHeader
                        title="AI Monitoring"
                        description="Team run health, agent usage and failure analysis"
                        icon={<Gauge className="size-4" />}
                        action={
                            <Button size="xs" variant="outline" onClick={() => void load()}>
                                Refresh
                            </Button>
                        }
                    />
                    {loading ? (
                        <div className="flex justify-center py-12 text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                        </div>
                    ) : error ? (
                        <p className="mt-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                            {error}
                        </p>
                    ) : snapshot ? (
                        <div className="mt-3 space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <MetricCard icon={<Activity className="size-4 text-primary" />} label="Active runs" value={String(snapshot.runs.active)} sub={`${snapshot.runs.queued} queued`} />
                                <MetricCard icon={<TrendingUp className="size-4 text-positive" />} label="Completed" value={String(snapshot.runs.completed)} sub={`${snapshot.runs.partial} partial`} />
                                <MetricCard icon={<AlertTriangle className="size-4 text-destructive" />} label="Failed" value={String(snapshot.runs.failed)} sub={`${snapshot.runs.cancelled} cancelled`} />
                                <MetricCard icon={<Clock className="size-4 text-info" />} label="Avg duration" value={`${(snapshot.runs.avgDurationMs / 1000).toFixed(1)}s`} sub={`${Math.round(snapshot.runs.successRate * 100)}% full success`} />
                            </div>

                            <div className="grid gap-3 lg:grid-cols-3">
                                <div className="rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
                                    <SectionHeader title="Agent usage" icon={<Bot className="size-4" />} />
                                    {snapshot.agents.length === 0 ? (
                                        <p className="mt-2 text-xs text-muted-foreground">No agent executions recorded yet.</p>
                                    ) : (
                                        <div className="mt-2 overflow-x-auto">
                                            <table className="w-full min-w-[520px] text-left text-xs">
                                                <thead className="text-micro tracking-wide text-muted-foreground uppercase">
                                                    <tr>
                                                        <th className="py-1.5 pr-3">Agent</th>
                                                        <th className="py-1.5 pr-3">Runs</th>
                                                        <th className="py-1.5 pr-3">Completed</th>
                                                        <th className="py-1.5 pr-3">Failed</th>
                                                        <th className="py-1.5 pr-3">Error rate</th>
                                                        <th className="py-1.5 pr-3">Avg duration</th>
                                                        <th className="py-1.5">Avg conf</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {snapshot.agents.slice(0, 12).map((agent) => (
                                                        <tr key={agent.agentId} className="border-t border-border/50">
                                                            <td className="py-1.5 pr-3 font-medium">{agent.name}</td>
                                                            <td className="py-1.5 pr-3 tabular-nums">{agent.runs}</td>
                                                            <td className="py-1.5 pr-3 tabular-nums text-positive">{agent.completed}</td>
                                                            <td className="py-1.5 pr-3 tabular-nums text-destructive">{agent.failed}</td>
                                                            <td className="py-1.5 pr-3 tabular-nums">
                                                                <StatusBadge
                                                                    tone={agent.errorRate > 0.2 ? "negative" : agent.errorRate > 0 ? "warning" : "positive"}
                                                                    label={`${Math.round(agent.errorRate * 100)}%`}
                                                                />
                                                            </td>
                                                            <td className="py-1.5 pr-3 tabular-nums">{(agent.avgDurationMs / 1000).toFixed(1)}s</td>
                                                            <td className="py-1.5 tabular-nums">{Math.round(agent.avgConfidence * 100)}%</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="rounded-lg border border-border/60 bg-card p-4">
                                        <SectionHeader title="Data modes" />
                                        <ul className="mt-2 space-y-1 text-xs">
                                            {Object.entries(snapshot.dataModes).map(([mode, count]) => (
                                                <li key={mode} className="flex items-center justify-between">
                                                    <Badge variant="outline" className="text-micro">{mode.toUpperCase()}</Badge>
                                                    <span className="tabular-nums">{count}</span>
                                                </li>
                                            ))}
                                            {Object.keys(snapshot.dataModes).length === 0 ? (
                                                <li className="text-muted-foreground">No runs yet.</li>
                                            ) : null}
                                        </ul>
                                    </div>
                                    <div className="rounded-lg border border-border/60 bg-card p-4">
                                        <SectionHeader title="Product events" />
                                        <ul className="mt-2 space-y-1 text-xs">
                                            {snapshot.events.slice(0, 8).map((event) => (
                                                <li key={event.type} className="flex items-center justify-between">
                                                    <span className="text-muted-foreground">{event.type}</span>
                                                    <span className="tabular-nums">{event.count}</span>
                                                </li>
                                            ))}
                                            {snapshot.events.length === 0 ? (
                                                <li className="text-muted-foreground">No events recorded.</li>
                                            ) : null}
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-lg border border-border/60 bg-card p-4">
                                <SectionHeader title="Recent failures" icon={<AlertTriangle className="size-4" />} />
                                {snapshot.recentFailures.length === 0 ? (
                                    <p className="mt-2 text-xs text-muted-foreground">No failed or partial runs in the sampled window.</p>
                                ) : (
                                    <ul className="mt-2 space-y-1 text-xs">
                                        {snapshot.recentFailures.map((failure) => (
                                            <li key={failure.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 px-2 py-1.5">
                                                <span>
                                                    {new Date(failure.startedAt).toLocaleString()} · {failure.teamName}
                                                </span>
                                                <span className="flex items-center gap-2">
                                                    <StatusBadge tone={failure.status === "failed" ? "negative" : "warning"} label={failure.status} />
                                                    <span className="text-muted-foreground">user {failure.userId.slice(0, 8)}…</span>
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <p className="mt-3 text-micro text-muted-foreground">
                                    AI provider usage, tokens and estimated cost are tracked by the existing AI usage
                                    system under source <code className="rounded bg-muted px-1">agent / ai-trading-team/*</code>.
                                </p>
                            </div>
                        </div>
                    ) : null}
                </section>

                {/* ── Templates ─────────────────────────────────────── */}
                <section>
                    <SectionHeader
                        title="AI Team Templates"
                        description="Official, editable team templates published to all Pro users"
                        icon={<Layers className="size-4" />}
                        action={
                            <Button size="xs" onClick={() => setShowTemplateForm((v) => !v)}>
                                <Plus className="size-3.5" /> New template
                            </Button>
                        }
                    />

                    {showTemplateForm ? (
                        <div className="mt-3 rounded-lg border border-border/60 bg-card p-4">
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Field label="Name">
                                    <input
                                        value={templateDraft.name}
                                        onChange={(e) => setTemplateDraft((d) => ({ ...d, name: e.target.value }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                                    />
                                </Field>
                                <Field label="Market">
                                    <input
                                        value={templateDraft.market}
                                        onChange={(e) => setTemplateDraft((d) => ({ ...d, market: e.target.value }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                                    />
                                </Field>
                                <Field label="Style">
                                    <select
                                        value={templateDraft.style}
                                        onChange={(e) => setTemplateDraft((d) => ({ ...d, style: e.target.value }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
                                    >
                                        {["scalping", "intraday", "swing", "position", "research"].map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Entry TF">
                                    <input value={templateDraft.entryTimeframe} onChange={(e) => setTemplateDraft((d) => ({ ...d, entryTimeframe: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring" />
                                </Field>
                                <Field label="Confirmation TF">
                                    <input value={templateDraft.confirmationTimeframe} onChange={(e) => setTemplateDraft((d) => ({ ...d, confirmationTimeframe: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring" />
                                </Field>
                                <Field label="Context TF">
                                    <input value={templateDraft.contextTimeframe} onChange={(e) => setTemplateDraft((d) => ({ ...d, contextTimeframe: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring" />
                                </Field>
                                <Field label="Risk profile">
                                    <select
                                        value={templateDraft.riskProfile}
                                        onChange={(e) => setTemplateDraft((d) => ({ ...d, riskProfile: e.target.value }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
                                    >
                                        {["conservative", "balanced", "aggressive"].map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Behavior">
                                    <select
                                        value={templateDraft.behavior}
                                        onChange={(e) => setTemplateDraft((d) => ({ ...d, behavior: e.target.value }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
                                    >
                                        {["consensus", "evidence-weighted", "risk-first", "research-first"].map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Agent ids (comma separated)">
                                    <input
                                        value={templateDraft.agentIds}
                                        onChange={(e) => setTemplateDraft((d) => ({ ...d, agentIds: e.target.value }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                                    />
                                </Field>
                                <Field label="Description">
                                    <input
                                        value={templateDraft.description}
                                        onChange={(e) => setTemplateDraft((d) => ({ ...d, description: e.target.value }))}
                                        className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                                    />
                                </Field>
                            </div>
                            <div className="mt-3 flex gap-2">
                                <Button size="sm" onClick={() => void publishTemplate()} disabled={templateDraft.name.length < 3}>
                                    Publish template
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setShowTemplateForm(false)}>
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {templates.length === 0 ? (
                        <EmptyState compact title="No templates" description="Publish an official team template to seed Pro users with a starting desk." />
                    ) : (
                        <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {templates.map((template) => (
                                <li key={template.id} className="rounded-lg border border-border/60 bg-card p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-sm font-semibold">{template.name}</p>
                                            <p className="text-micro text-muted-foreground">{template.description}</p>
                                        </div>
                                        <Badge variant={template.scope === "admin" ? "secondary" : "outline"} className="text-micro">
                                            {template.scope}
                                        </Badge>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        <Badge variant="outline" className="text-micro">{template.config.market}</Badge>
                                        <Badge variant="outline" className="text-micro capitalize">{template.config.style}</Badge>
                                        <Badge variant="outline" className="text-micro capitalize">{template.config.behavior}</Badge>
                                        <Badge variant="outline" className="text-micro">{template.agentIds.length} agents</Badge>
                                    </div>
                                    {template.scope === "admin" ? (
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            className="mt-2"
                                            onClick={() => void deleteTemplate(template.id)}
                                        >
                                            <Trash2 className="size-3.5" /> Delete
                                        </Button>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}

function MetricCard({
    icon,
    label,
    value,
    sub,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub?: string;
}) {
    return (
        <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center justify-between">
                <span className="text-micro text-muted-foreground">{label}</span>
                {icon}
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            {sub ? <p className="text-micro text-muted-foreground">{sub}</p> : null}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-micro text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}
