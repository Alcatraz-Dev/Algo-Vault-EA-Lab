"use client";

import { useMemo, useState } from "react";
import { Play, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { NoticeBanner } from "@/components/growth/admin/NoticeBanner";
import { fmtDateTime, fmtRelative } from "@/components/growth/admin/format";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from "@/lib/growth/constants";

type WorkflowRow = {
    id: string;
    workflowId?: string;
    name?: string;
    status?: string;
    step?: string;
    createdAt?: number;
    updatedAt?: number;
    actor?: string;
    input?: { topic?: string; objective?: string; type?: string; tone?: string };
};

type RunResult = {
    executionId?: string;
    workflowId?: string;
    status?: string;
    error?: string;
};

const TONES = ["professional", "friendly", "educational", "promotional", "bold", "casual"];

const STEP_LABELS: Record<string, string> = {
    research: "Research",
    content: "Content",
    seo: "SEO",
    social: "Social",
    compliance: "Compliance",
    campaign: "Campaign",
    publisher: "Publisher",
    analytics: "Analytics",
    optimization: "Optimization",
    report: "Report",
};

/** Status tone mapping for workflow executions (queued/running/completed/failed). */
function WorkflowStatus({ status }: { status?: string }) {
    const s = (status || "queued").toUpperCase();
    const cls =
        s === "COMPLETED"
            ? "border-success/30 bg-success/10 text-success-foreground"
            : s === "FAILED"
              ? "border-destructive/30 bg-destructive/10 text-destructive-foreground"
              : s === "RUNNING"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-muted/40 text-muted-foreground";
    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
            {status || "queued"}
        </span>
    );
}

export default function GrowthWorkflows() {
    const { data, loading, error, refresh } = useAdminFetch<{ workflows: WorkflowRow[] }>("/api/growth/workflows");

    const [form, setForm] = useState({ topic: "", objective: "", type: "SEO_ARTICLE", tone: "professional" });
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState<RunResult | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 6000);
    };

    const workflows = useMemo(
        () => [...(data?.workflows || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
        [data]
    );

    const runWorkflow = async () => {
        if (running) return;
        if (!form.topic.trim() || !form.objective.trim()) {
            flash("error", "Topic and objective are required.");
            return;
        }
        setRunning(true);
        try {
            const result = await adminFetch<RunResult>("/api/growth/workflows", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    topic: form.topic.trim(),
                    objective: form.objective.trim(),
                    type: form.type,
                    tone: form.tone,
                }),
            });
            setRunResult(result);
            flash("ok", `Workflow queued (${result.status || "queued"}).`);
            refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Could not run workflow.");
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Workflows"
                subtitle="Sequential AI agent pipeline — research to report, run from a topic and objective."
                actions={<RefreshButton onRefresh={refresh} loading={loading} />}
            />

            {notice && <NoticeBanner variant={notice.kind === "ok" ? "success" : "error"}>{notice.text}</NoticeBanner>}

            {/* Run a workflow */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-1 text-sm font-medium text-foreground">Run a content workflow</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                    Queues an execution of the growth content pipeline (Research → Content → SEO → Social → Compliance → Campaign → Publisher →
                    Analytics → Optimization → Report). Executions show up below.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Topic" htmlFor="wf-topic" required>
                        <Input
                            id="wf-topic"
                            value={form.topic}
                            onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                            placeholder="e.g. Algorithmic trading education"
                        />
                    </FormField>
                    <FormField label="Objective" htmlFor="wf-objective" required>
                        <Input
                            id="wf-objective"
                            value={form.objective}
                            onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
                            placeholder="e.g. awareness"
                        />
                    </FormField>
                    <FormField label="Content type" htmlFor="wf-type">
                        <Select id="wf-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                            {CONTENT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {CONTENT_TYPE_LABELS[t]}
                                </option>
                            ))}
                        </Select>
                    </FormField>
                    <FormField label="Tone" htmlFor="wf-tone">
                        <Select id="wf-tone" value={form.tone} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))}>
                            {TONES.map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </Select>
                    </FormField>
                </div>
                <div className="mt-4 flex items-center gap-2">
                    <Button type="button" size="sm" disabled={running || !form.topic.trim() || !form.objective.trim()} onClick={() => void runWorkflow()}>
                        {running ? "Queuing…" : <><Play /> Run workflow</>}
                    </Button>
                    {runResult?.executionId && (
                        <span className="text-xs text-muted-foreground">
                            Latest: <span className="font-mono">{runResult.executionId}</span>
                        </span>
                    )}
                </div>
            </div>

            {/* Pipeline definition */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <WorkflowIcon size={14} className="text-muted-foreground" />
                    Pipeline stages
                </h2>
                <ol className="flex flex-wrap gap-1.5">
                    {Object.values(STEP_LABELS).map((label, i) => (
                        <li key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {i > 0 && <span aria-hidden className="text-muted-foreground/50">→</span>}
                            <span className="rounded border border-border bg-muted/40 px-2 py-0.5">{label}</span>
                        </li>
                    ))}
                </ol>
            </div>

            {/* Executions */}
            {loading ? (
                <div className="space-y-2" role="status" aria-label="Loading workflows">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12" />
                    ))}
                </div>
            ) : error ? (
                <ErrorState
                    title="Couldn't load workflows"
                    description={error}
                    action={<Button type="button" variant="outline" onClick={refresh}>Retry</Button>}
                />
            ) : workflows.length === 0 ? (
                <EmptyState
                    icon={<WorkflowIcon size={18} />}
                    title="No workflow executions yet"
                    description="Run a workflow above — the execution will appear here with its status and current step."
                />
            ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                    <Table className="min-w-[620px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Workflow</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Step</TableHead>
                                <TableHead>Input</TableHead>
                                <TableHead>Created</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {workflows.map((w) => (
                                <TableRow key={w.id}>
                                    <TableCell className="max-w-56">
                                        <p className="truncate font-medium text-foreground">{w.name || w.workflowId || w.id}</p>
                                        <p className="font-mono text-xs text-muted-foreground">{w.id}</p>
                                    </TableCell>
                                    <TableCell>
                                        <WorkflowStatus status={w.status} />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {w.step ? STEP_LABELS[w.step] || w.step : "—"}
                                    </TableCell>
                                    <TableCell className="max-w-48 text-muted-foreground">
                                        <p className="truncate" title={w.input?.topic}>{w.input?.topic || "—"}</p>
                                        <p className="text-xs">{w.input?.objective || ""} {w.input?.type || ""}</p>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground" title={fmtDateTime(w.createdAt)}>
                                        {fmtRelative(w.createdAt)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}