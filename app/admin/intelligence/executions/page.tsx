"use client";

import { useState } from "react";
import Link from "next/link";
import {
    Play,
    ChevronDown,
    ChevronUp,
    Search,
    Filter,
    Loader2,
    Clock,
    CheckCircle2,
    XCircle,
    AlertCircle,
    FileText,
    Copy,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { onValue, ref, query, orderByChild, limitToLast } from "firebase/database";
import { database } from "@/lib/firebase";
import { useEffect } from "react";
import { WorkflowExecutionRecord, ExecutionOutcome } from "@/lib/agents/types";

const OUTCOME_TONES: Record<ExecutionOutcome, "positive" | "negative" | "info" | "warning" | "expired" | "connected"> = {
    running: "info",
    success: "positive",
    failed: "negative",
    aborted: "warning",
    partial: "warning",
};

export default function AdminExecutionsPage() {
    const [executions, setExecutions] = useState<WorkflowExecutionRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        const executionsRef = query(ref(database, "workflowExecutions"), orderByChild("startedAt"), limitToLast(200));
        const unsubscribe = onValue(
            executionsRef,
            (snapshot) => {
                const data = snapshot.val() as Record<string, WorkflowExecutionRecord> | null;
                if (!data) {
                    setExecutions([]);
                    setLoading(false);
                    return;
                }
                const list = Object.values(data)
                    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
                setExecutions(list);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsubscribe();
    }, []);

    const filtered = executions.filter((e) => {
        const matchesSearch = !search ||
            e.workflowId?.toLowerCase().includes(search.toLowerCase()) ||
            e.id?.toLowerCase().includes(search.toLowerCase()) ||
            e.userId?.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = filterStatus === "all" || e.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    return (
        <AdminShell
            title="Workflow Executions"
            subtitle="Monitor all workflow executions across the Intelligence Engine."
        >
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full max-w-md">
                    <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search executions..."
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
                        {(["running", "success", "failed", "aborted", "partial"] as ExecutionOutcome[]).map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-24 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/30 bg-muted/50 px-6 py-20 text-center">
                    <Play size={40} className="mx-auto text-muted-foreground" />
                    <h3 className="mt-3 text-lg font-medium">No executions found</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters or search query.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filtered.map((execution) => (
                        <ExecutionRow
                            key={execution.id}
                            execution={execution}
                            isExpanded={expanded === execution.id}
                            onToggle={() => setExpanded(expanded === execution.id ? null : execution.id)}
                        />
                    ))}
                </div>
            )}
        </AdminShell>
    );
}

function ExecutionRow({
    execution,
    isExpanded,
    onToggle,
}: {
    execution: WorkflowExecutionRecord;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const duration = execution.durationMs ? `${Math.round(execution.durationMs / 1000)}s` : "—";
    const started = execution.startedAt ? new Date(execution.startedAt).toLocaleString() : "—";

    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden transition hover:border-border/50">
            <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-4 flex-1">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                            <Play size={20} className={execution.status === "success" ? "text-emerald-300" : execution.status === "failed" ? "text-red-300" : "text-violet-300"} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                    href={`/admin/intelligence/executions/${execution.id}`}
                                    className="text-sm font-mono text-foreground transition hover:text-violet-300 truncate"
                                >
                                    {execution.id}
                                </Link>
                                <StatusBadge tone={OUTCOME_TONES[execution.status]} label={execution.status} />
                                {execution.testOnly && (
                                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                        Test
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 max-w-xl text-xs text-muted-foreground truncate">Workflow: {execution.workflowId} v{execution.workflowVersion}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                <span><Clock size={11} className="inline" /> Started: {started}</span>
                                <span>Duration: {duration}</span>
                                <span>Steps: {execution.stepsCompleted}/{execution.stepsTotal}</span>
                                <span>Agents: {execution.agentsRun}</span>
                                <span>AI Calls: {execution.aiCalls}</span>
                                <span>Cost: ${execution.estimatedCostUsd?.toFixed(4) || "0.0000"}</span>
                                {execution.userId && <span>User: {execution.userId.slice(0, 8)}…</span>}
                                {execution.trigger !== "manual" && <span>Trigger: {execution.trigger}</span>}
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
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                            <DetailRow label="Execution ID" value={execution.id} copyable />
                            <DetailRow label="Workflow" value={`${execution.workflowId} v${execution.workflowVersion}`} />
                            <DetailRow label="Status" value={execution.status} />
                            <DetailRow label="Trigger" value={execution.trigger} />
                            <DetailRow label="Started" value={started} />
                            <DetailRow label="Finished" value={execution.finishedAt ? new Date(execution.finishedAt).toLocaleString() : "—"} />
                            <DetailRow label="Duration" value={duration} />
                            <DetailRow label="AI Calls" value={String(execution.aiCalls)} />
                            <DetailRow label="Est. Cost" value={`$${execution.estimatedCostUsd?.toFixed(4) || "0.0000"}`} />
                            <DetailRow label="User ID" value={execution.userId || "—"} copyable />
                            <DetailRow label="Test Only" value={execution.testOnly ? "yes" : "no"} />
                        </div>
                        {execution.errors?.length && (
                            <div className="mt-4">
                                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Errors</h5>
                                <div className="space-y-1">
                                    {execution.errors.map((err, i) => (
                                        <div key={i} className="text-xs p-2 rounded-lg bg-red-500/10 text-red-300">{err}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {execution.finalOutput && (
                            <div className="mt-4">
                                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Final Output</h5>
                                <div className="flex items-center gap-2">
                                    <pre className="flex-1 text-xs bg-background/50 p-3 rounded text-foreground whitespace-pre-wrap line-clamp-6 overflow-auto max-h-64">
                                        {JSON.stringify(execution.finalOutput, null, 2)}
                                    </pre>
                                    <button
                                        onClick={() => navigator.clipboard.writeText(JSON.stringify(execution.finalOutput, null, 2))}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/5 transition hover:bg-muted/10"
                                        title="Copy JSON"
                                    >
                                        <Copy size={12} className="text-muted-foreground" />
                                    </button>
                                </div>
                            </div>
                        )}
                        {execution.notifyDecision && (
                            <div className="mt-4">
                                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Notification Decision</h5>
                                <div className="grid gap-2 md:grid-cols-2">
                                    <DetailRow label="Warranted" value={execution.notifyDecision.warranted ? "yes" : "no"} />
                                    <DetailRow label="Delivered" value={execution.notifyDecision.delivered ? "yes" : "no"} />
                                    <DetailRow label="Reason" value={execution.notifyDecision.reason} />
                                    <DetailRow label="Channels" value={execution.notifyDecision.channels?.join(", ") || "—"} />
                                    <DetailRow label="Blocked By" value={execution.notifyDecision.blockedBy || "—"} />
                                </div>
                            </div>
                        )}
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