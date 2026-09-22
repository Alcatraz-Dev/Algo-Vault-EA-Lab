"use client";

import { useState } from "react";
import Link from "next/link";
import {
    GitBranch,
    Sparkles,
    Play,
    FileText,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Trash2,
    Copy,
    Edit,
    ChevronDown,
    ChevronUp,
    Search,
    Filter,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";
import { useEffect } from "react";
import { WorkflowDefinition, AgentStatus } from "@/lib/agents/types";

const STATUS_TONES: Record<AgentStatus, "positive" | "negative" | "info" | "warning" | "expired" | "connected"> = {
    draft: "info",
    testing: "warning",
    active: "positive",
    paused: "warning",
    disabled: "negative",
    deprecated: "expired",
};

export default function AdminWorkflowsPage() {
    const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        const workflowsRef = ref(database, "workflows");
        const unsubscribe = onValue(
            workflowsRef,
            (snapshot) => {
                const data = snapshot.val() as Record<string, WorkflowDefinition> | null;
                if (!data) {
                    setWorkflows([]);
                    setLoading(false);
                    return;
                }
                const list = Object.values(data).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                setWorkflows(list);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsubscribe();
    }, []);

    const filtered = workflows.filter((w) => {
        const matchesSearch = !search ||
            w.name?.toLowerCase().includes(search.toLowerCase()) ||
            w.description?.toLowerCase().includes(search.toLowerCase()) ||
            w.id?.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = filterStatus === "all" || w.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    return (
        <AdminShell
            title="Workflow Definitions"
            subtitle="Manage multi-agent workflows that power the Intelligence Engine."
        >
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full max-w-md">
                    <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search workflows..."
                        className="w-full rounded-xl border border-border/30 bg-muted py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs outline-none"
                    >
                        <option value="all">All Statuses</option>
                        {(["draft", "testing", "active", "paused", "disabled", "deprecated"] as AgentStatus[]).map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <Link
                        href="/admin/intelligence/studio"
                        className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                        <Sparkles size={13} />
                        AI Studio
                    </Link>
                </div>
            </div>

            {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-40 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/30 bg-muted/50 px-6 py-20 text-center">
                    <GitBranch size={40} className="mx-auto text-muted-foreground" />
                    <h3 className="mt-3 text-lg font-medium">No workflows found</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters or search query.</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((workflow) => (
                        <WorkflowCard
                            key={workflow.id}
                            workflow={workflow}
                            isExpanded={expanded === workflow.id}
                            onToggle={() => setExpanded(expanded === workflow.id ? null : workflow.id)}
                        />
                    ))}
                </div>
            )}
        </AdminShell>
    );
}

function WorkflowCard({
    workflow,
    isExpanded,
    onToggle,
}: {
    workflow: WorkflowDefinition;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const stepCount = workflow.steps?.length || 0;
    const parallelGroups = workflow.steps?.filter((s) => s.mode === "parallel").length || 0;

    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden transition hover:border-border/50">
            <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                            <GitBranch size={20} className="text-emerald-300" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <Link
                                    href={`/admin/intelligence/workflows/${workflow.id}`}
                                    className="text-sm font-semibold text-foreground transition hover:text-emerald-300 truncate"
                                >
                                    {workflow.name}
                                </Link>
                                <StatusBadge tone={STATUS_TONES[workflow.status]} label={workflow.status} />
                            </div>
                            <p className="mt-1 max-w-xl text-xs text-muted-foreground truncate">{workflow.description}</p>
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>v{workflow.version}</span>
                                <span className="text-muted-foreground/30">•</span>
                                <span>Trigger: {workflow.trigger}</span>
                                <span className="text-muted-foreground/30">•</span>
                                <span>Steps: {stepCount}</span>
                                {parallelGroups > 0 && (
                                    <>
                                        <span className="text-muted-foreground/30">•</span>
                                        <span>Parallel groups: {parallelGroups}</span>
                                    </>
                                )}
                                <span className="text-muted-foreground/30">•</span>
                                <span>Timeout: {Math.round((workflow.timeoutMs || 0) / 1000)}s</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onToggle}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5 transition hover:bg-muted/10"
                    >
                        {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                    </button>
                </div>

                {isExpanded && (
                    <div className="mt-4 rounded-xl border border-border/30 bg-muted/30 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                            <DetailRow label="ID" value={workflow.id} copyable />
                            <DetailRow label="Created" value={workflow.createdAt ? new Date(workflow.createdAt).toLocaleString() : "—"} />
                            <DetailRow label="Updated" value={workflow.updatedAt ? new Date(workflow.updatedAt).toLocaleString() : "—"} />
                            <DetailRow label="Created By" value={workflow.createdBy || "admin"} />
                            <DetailRow
                                label="Required Permissions"
                                value={workflow.requiredPermissions?.join(", ") || "none"}
                            />
                            <DetailRow
                                label="Notification"
                                value={workflow.notification?.method === "auto" ? `${workflow.notification.channels.join(", ")}` : "none"}
                            />
                            <DetailRow
                                label="Critic Required"
                                value={workflow.notification?.requiresCritic ? "yes" : "no"}
                            />
                            <DetailRow
                                label="On Critic Conflict"
                                value={workflow.notification?.onCriticConflict || "—"}
                            />
                        </div>
                        <div className="mt-4">
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Steps</h5>
                            <div className="space-y-2">
                                {workflow.steps?.map((step, idx) => (
                                    <div
                                        key={step.id}
                                        className="flex items-center gap-2 text-xs p-2 rounded-lg bg-background/50"
                                    >
                                        <span className="font-mono text-muted-foreground/50">{idx + 1}.</span>
                                        <span className="font-medium">{step.id}</span>
                                        <span className="text-muted-foreground/30">|</span>
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                                            {step.mode}
                                        </span>
                                        {step.mode === "sequential" && (
                                            <span className="text-muted-foreground">→ {step.agent}</span>
                                        )}
                                        {step.mode === "parallel" && (
                                            <span className="text-muted-foreground">→ {step.agents?.join(", ")}</span>
                                        )}
                                        {step.dependsOn?.length && (
                                            <span className="text-muted-foreground/50 ml-auto">depends: {step.dependsOn.join(", ")}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {workflow.branches?.length && (
                            <div className="mt-4">
                                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Branches</h5>
                                <div className="space-y-2">
                                    {workflow.branches?.map((branch) => (
                                        <div
                                            key={branch.id}
                                            className="text-xs p-2 rounded-lg bg-background/50"
                                        >
                                            <span className="font-medium">{branch.label || branch.id}</span>
                                            <span className="text-muted-foreground ml-2">if {branch.source} {branch.operator} {branch.value}</span>
                                            <span className="text-muted-foreground ml-2">→ {branch.action}</span>
                                            {branch.target && (
                                                <span className="text-muted-foreground ml-2">→ {branch.target}</span>
                                            )}
                                            <span className="text-muted-foreground/50 ml-2">({branch.reason})</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="mt-4 flex items-center gap-2">
                            <Link
                                href={`/admin/intelligence/workflows/${workflow.id}`}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                            >
                                <Edit size={13} />
                                Edit
                            </Link>
                            <Link
                                href={`/api/agents/workflows/${workflow.id}`}
                                target="_blank"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                            >
                                <Copy size={13} />
                                Copy API
                            </Link>
                            <Link
                                href={`/admin/intelligence/sandbox?workflow=${workflow.id}`}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                            >
                                <Play size={13} />
                                Test in Sandbox
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function DetailRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
            <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background/50 px-2 py-1 rounded text-foreground break-all">{value}</code>
                {copyable && (
                    <button
                        onClick={() => navigator.clipboard.writeText(value)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/5 transition hover:bg-muted/10"
                        title="Copy"
                    >
                        <Copy size={12} className="text-muted-foreground" />
                    </button>
                )}
            </div>
        </div>
    );
}