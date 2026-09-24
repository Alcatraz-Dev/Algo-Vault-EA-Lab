"use client";

import { useState, useMemo } from "react";
import { CheckCircle2, ChevronRight, Eye, FileText, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtRelative } from "@/components/growth/admin/format";
import { CONTENT_TYPE_LABELS } from "@/lib/growth/constants";

type TaskRow = {
    id: string;
    type: string;
    title?: string;
    topic: string;
    channels: string[];
    campaignId?: string;
    state: string;
    approvalRequired?: boolean;
    createdBy?: string;
    createdAt?: number;
    updatedAt?: number;
    rejectReason?: string;
    generatedContent?: Record<string, { format?: string; value?: string }>;
    compliance?: {
        passed?: boolean;
        flags?: string[];
        riskDisclosureRequired?: boolean;
        riskDisclosurePresent?: boolean;
    };
    publish?: { channel: string; externalId?: string; publishedAt: number; url?: string }[];
    publishAttempts?: { channel: string; at: number; ok: boolean; status?: string; error?: string }[];
};

type ApprovalRow = {
    id?: string;
    taskId: string;
    decision: "APPROVED" | "REJECTED";
    approvedBy: string;
    comment?: string;
    decidedAt: number;
};

const inputCls =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export default function AdminApprovalsPage() {
    const approvalsData = useAdminFetch<{ tasks: TaskRow[]; approvals: ApprovalRow[] }>("/api/growth/approvals");
    const [query, setQuery] = useState("");
    const [preview, setPreview] = useState<TaskRow | null>(null);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 5000);
    };

    const refreshAll = () => {
        approvalsData.refresh();
    };

    const pendingTasks = useMemo(() => (approvalsData.data?.tasks || []).filter((t) => t.state === "READY_FOR_REVIEW"), [approvalsData.data]);
    const history = useMemo(() => approvalsData.data?.approvals || [], [approvalsData.data]);

    const filteredPending = useMemo(() => {
        let rows = pendingTasks;
        if (query.trim()) {
            const q = query.trim().toLowerCase();
            rows = rows.filter((t) => (t.title || t.topic).toLowerCase().includes(q));
        }
        return rows;
    }, [pendingTasks, query]);

    const filteredHistory = useMemo(() => {
        let rows = history;
        if (query.trim()) {
            const q = query.trim().toLowerCase();
            rows = rows.filter((t) => t.taskId.toLowerCase().includes(q) || t.approvedBy.toLowerCase().includes(q));
        }
        return rows;
    }, [history, query]);

    const approve = async (taskId: string) => {
        if (busyAction) return;
        setBusyAction(`approve:${taskId}`);
        try {
            await adminFetch<{ ok: boolean }>("/api/growth/content/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "approve", taskId }),
            });
            flash("ok", "Content approved.");
            approvalsData.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Approval failed.");
        } finally {
            setBusyAction(null);
        }
    };

    const reject = async (taskId: string, reason: string) => {
        if (busyAction) return;
        setBusyAction(`reject:${taskId}`);
        try {
            await adminFetch<{ ok: boolean }>("/api/growth/content/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reject", taskId, reason }),
            });
            flash("ok", "Content rejected.");
            approvalsData.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Rejection failed.");
        } finally {
            setBusyAction(null);
        }
    };

    const openReject = (task: TaskRow) => {
        const reason = prompt("Rejection reason (required):");
        if (reason?.trim()) {
            reject(task.id, reason.trim());
        }
    };

    if (approvalsData.loading) {
        return (
            <div className="space-y-6" role="status" aria-label="Loading approvals">
                <PageHeader title="Approvals" subtitle="Review queue for marketing content awaiting human decision." />
                <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12" />
                    ))}
                </div>
            </div>
        );
    }

    if (approvalsData.error) {
        return (
            <ErrorState
                title="Couldn't load approvals"
                description={approvalsData.error}
                action={<Button type="button" variant="outline" onClick={refreshAll}>Retry</Button>}
            />
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Approvals"
                subtitle="Review queue for marketing content awaiting human decision."
                actions={<RefreshButton onRefresh={refreshAll} loading={approvalsData.loading} />}
            />

            {notice && (
                <div
                    role="status"
                    className={`rounded-md border px-3 py-2 text-xs ${
                        notice.kind === "ok"
                            ? "border-success/30 bg-success/10 text-success-foreground"
                            : "border-destructive/30 bg-destructive/10 text-destructive-foreground"
                    }`}
                >
                    {notice.text}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1 sm:max-w-xs">
                    <FileText size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        aria-label="Search approvals"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search title or topic…"
                        className={inputCls + " pl-8"}
                    />
                </div>
                <span className="ml-auto text-xs text-muted-foreground">
                    {filteredPending.length} pending · {filteredHistory.length} historical
                </span>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
                {/* Pending queue */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">Pending review ({filteredPending.length})</h2>
                        <span className="text-xs text-muted-foreground">Tasks in READY_FOR_REVIEW state</span>
                    </div>

                    {filteredPending.length === 0 ? (
                        <EmptyState
                            icon={<ShieldAlert size={18} />}
                            title={query ? "No tasks match your search" : "No pending approvals"}
                            description={
                                query
                                    ? "Clear the search to see all pending tasks."
                                    : "All marketing content is either drafted, approved, or published. Nothing is waiting for review right now."
                            }
                        />
                    ) : (
                        <div className="space-y-2">
                            {filteredPending.map((t) => (
                                <ApprovalCard
                                    key={t.id}
                                    task={t}
                                    onPreview={() => setPreview(t)}
                                    onApprove={() => approve(t.id)}
                                    onReject={() => openReject(t)}
                                    busy={busyAction === `approve:${t.id}` || busyAction === `reject:${t.id}`}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* History sidebar */}
                <aside className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">Recent decisions ({filteredHistory.length})</h2>
                    </div>
                    <div className="rounded-lg border border-border bg-card overflow-hidden">
                        {filteredHistory.length === 0 ? (
                            <div className="p-6 text-center text-xs text-muted-foreground">
                                No approval history yet. Decisions will appear here after review.
                            </div>
                        ) : (
                            <ul className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
                                {filteredHistory.slice(0, 20).map((a, i) => (
                                    <li key={a.id || i} className="p-3 hover:bg-muted/30 transition">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-xs text-muted-foreground">{a.taskId.slice(0, 12)}…</span>
                                            <span
                                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                                    a.decision === "APPROVED"
                                                        ? "bg-success/10 text-success-foreground"
                                                        : "bg-destructive/10 text-destructive-foreground"
                                                }`}
                                            >
                                                {a.decision === "APPROVED" ? (
                                                    <>
                                                        <CheckCircle2 size={10} />
                                                        Approved
                                                    </>
                                                ) : (
                                                    <>
                                                        <XCircle size={10} />
                                                        Rejected
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">{a.approvedBy}</p>
                                        {a.comment && <p className="mt-1 text-xs text-foreground line-clamp-1">&ldquo;{a.comment}&rdquo;</p>}
                                        <p className="mt-1 text-xs text-muted-foreground">{fmtRelative(a.decidedAt)}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="rounded-lg border border-border bg-card p-4">
                        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Rules</h3>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                            <li>• Only tasks in <b>READY_FOR_REVIEW</b> appear in the queue.</li>
                            <li>• <b>Approve</b> moves the task to APPROVED — it can then be scheduled or published.</li>
                            <li>• <b>Reject</b> requires a reason; the task returns to REJECTED with the note.</li>
                            <li>• All decisions are logged in the audit trail with your identity.</li>
                        </ul>
                    </div>
                </aside>
            </div>

            {/* Preview dialog */}
            <div className="fixed inset-0 z-50" style={{ display: preview ? "block" : "none" }}>
                <div className="fixed inset-0 bg-black/50" onClick={() => setPreview(null)} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl max-h-[85vh] rounded-lg border border-border bg-card overflow-y-auto">
                        <div className="sticky top-0 flex items-center justify-between border-b border-border px-4 py-3 bg-card/95 backdrop-blur">
                            <div>
                                <h3 className="font-medium text-foreground">{preview?.title || preview?.topic}</h3>
                                <p className="text-xs text-muted-foreground">
                                    {CONTENT_TYPE_LABELS[preview?.type as keyof typeof CONTENT_TYPE_LABELS] || preview?.type} · {(
                                        preview?.channels || []
                                    ).join(", ")}
                                </p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                                <ChevronRight size={18} className="rotate-180" />
                            </Button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div className="flex flex-wrap gap-1.5">
                                <GrowthStatusBadge kind="task" value={preview?.state || "READY_FOR_REVIEW"} />
                            </div>
                            {preview?.rejectReason && (
                                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive-foreground">
                                    <b>Blocked by compliance:</b> {preview.rejectReason}
                                </div>
                            )}
                            {preview?.compliance && (
                                <div className="rounded-md border border-border p-3 text-xs">
                                    <p className="mb-1 font-medium text-foreground">Compliance review</p>
                                    <p className="text-muted-foreground">
                                        Status: {preview.compliance.passed ? "Passed" : "Not passed"} · Risk disclosure{" "}
                                        {preview.compliance.riskDisclosureRequired
                                            ? preview.compliance.riskDisclosurePresent
                                                ? "present"
                                                : "MISSING"
                                            : "not required"}
                                    </p>
                                    {(preview.compliance.flags || []).length > 0 && (
                                        <ul className="mt-2 space-y-1 text-muted-foreground">
                                            {(preview.compliance.flags || []).map((f, i) => (
                                                <li key={i} className="text-foreground">{f}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                            <div className="space-y-2">
                                {Object.entries(preview?.generatedContent || {}).map(([channel, block]) => (
                                    <div key={channel} className="rounded-md border border-border p-3">
                                        <p className="mb-1 text-xs font-medium text-foreground">{channel}</p>
                                        <p className="text-xs whitespace-pre-wrap text-foreground">{block.value}</p>
                                    </div>
                                ))}
                                {Object.keys(preview?.generatedContent || {}).length === 0 && (
                                    <p className="text-xs text-muted-foreground">No generated content yet.</p>
                                )}
                            </div>
                        </div>
                        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border px-4 py-3 bg-card/95 backdrop-blur">
                            <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                                Close
                            </Button>
                            {preview?.state === "READY_FOR_REVIEW" && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busyAction !== null}
                                        onClick={() => {
                                            approve(preview!.id);
                                            setPreview(null);
                                        }}
                                    >
                                        {busyAction?.startsWith("approve:") ? "Approving…" : <><CheckCircle2 size={14} /> Approve</>}
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        disabled={busyAction !== null}
                                        onClick={() => {
                                            openReject(preview!);
                                            setPreview(null);
                                        }}
                                    >
                                        {busyAction?.startsWith("reject:") ? "Rejecting…" : <><XCircle size={14} /> Reject</>}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ApprovalCard({
    task,
    onPreview,
    onApprove,
    onReject,
    busy,
}: {
    task: TaskRow;
    onPreview: () => void;
    onApprove: () => void;
    onReject: () => void;
    busy: boolean;
}) {
    const blocked = task.state === "FAILED" && (task.rejectReason || "").toLowerCase().includes("compliance");
    const complianceOk = task.compliance?.passed;

    return (
        <div className="rounded-lg border border-border bg-card p-3 transition hover:bg-muted/30">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">{task.title || task.topic}</span>
                        <span className="text-xs text-muted-foreground">{CONTENT_TYPE_LABELS[task.type as keyof typeof CONTENT_TYPE_LABELS] || task.type}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{task.topic}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <FileText size={10} /> {task.channels.join(", ")}
                        </span>
                        {task.campaignId && (
                            <span className="text-muted-foreground">Campaign: {task.campaignId.slice(0, 8)}…</span>
                        )}
                        <span className="text-muted-foreground">Updated {fmtRelative(task.updatedAt || task.createdAt)}</span>
                    </div>
                    {blocked && (
                        <p className="mt-2 text-xs text-destructive">Blocked by compliance: {task.rejectReason}</p>
                    )}
                    {complianceOk === true && (
                        <p className="mt-2 text-xs text-success-foreground">Compliance review passed.</p>
                    )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="ghost" size="xs" onClick={onPreview} aria-label="Preview">
                        <Eye size={14} />
                    </Button>
                    <Button
                        variant="outline"
                        size="xs"
                        disabled={busy}
                        onClick={onApprove}
                    >
                        <CheckCircle2 size={12} />
                        <span className="hidden sm:inline">Approve</span>
                    </Button>
                    <Button
                        variant="destructive"
                        size="xs"
                        disabled={busy}
                        onClick={onReject}
                    >
                        <XCircle size={12} />
                        <span className="hidden sm:inline">Reject</span>
                    </Button>
                </div>
            </div>
        </div>
    );
}