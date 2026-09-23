"use client";

import { useMemo, useState } from "react";
import {
    CalendarClock,
    CheckCircle2,
    Eye,
    FileText,
    Pause,
    Plus,
    RefreshCw,
    Search,
    Send,
    ShieldCheck,
    XCircle,
} from "lucide-react";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fromInputDateTime, fmtDateTime, fmtRelative, toInputDateTime } from "@/components/growth/admin/format";
import {
    CHANNEL_LABELS,
    CHANNEL_TYPES,
    CONTENT_TYPE_LABELS,
    CONTENT_TYPES,
    MARKETING_TASK_STATES,
    MARKETING_TASK_STATE_LABELS,
} from "@/lib/growth/constants";

type TaskRow = {
    id: string;
    type: string;
    title?: string;
    topic: string;
    channels: string[];
    campaignId?: string;
    state: string;
    approvalRequired?: boolean;
    createdAt?: number;
    updatedAt?: number;
    scheduledAt?: number;
    rejectReason?: string;
    reviewNotes?: string;
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

type CampaignRow = { id: string; name: string; status?: string };
type ChannelStatus = { type: string; state: string; reason?: string };

const inputCls =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export default function AdminGrowthContentPage() {
    const tasks = useAdminFetch<TaskRow[]>("/api/growth/content");
    const campaigns = useAdminFetch<CampaignRow[]>("/api/growth/campaigns");
    const channelStatus = useAdminFetch<ChannelStatus[]>("/api/growth/channels/status");

    const [query, setQuery] = useState("");
    const [state, setState] = useState("");
    const [channel, setChannel] = useState("");
    const [campaignId, setCampaignId] = useState("");

    const [createOpen, setCreateOpen] = useState(false);
    const [createForm, setCreateForm] = useState({ type: "X_POST", topic: "", channel: "", campaignId: "", tone: "", generateNow: true });
    const [createChannels, setCreateChannels] = useState<string[]>([]);

    const [preview, setPreview] = useState<TaskRow | null>(null);
    const [publishTask, setPublishTask] = useState<TaskRow | null>(null);
    const [publishChannel, setPublishChannel] = useState("");
    const [rejectTask, setRejectTask] = useState<TaskRow | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    const [scheduleTask, setScheduleTask] = useState<TaskRow | null>(null);
    const [scheduleAt, setScheduleAt] = useState("");

    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 6000);
    };
    const refreshAll = () => {
        tasks.refresh();
        campaigns.refresh();
        channelStatus.refresh();
    };

    const channelByName = useMemo(() => new Map((channelStatus.data || []).map((c) => [c.type, c])), [channelStatus.data]);

    const filtered = useMemo(() => {
        let rows = tasks.data || [];
        if (query.trim()) {
            const q = query.trim().toLowerCase();
            rows = rows.filter((t) => (t.title || t.topic).toLowerCase().includes(q));
        }
        if (state) rows = rows.filter((t) => t.state === state);
        if (channel) rows = rows.filter((t) => t.channels.includes(channel));
        if (campaignId) rows = rows.filter((t) => t.campaignId === campaignId);
        return rows;
    }, [tasks.data, query, state, channel, campaignId]);

    const action = async (kind: string, taskId: string, body: Record<string, unknown>) => {
        if (busyAction) return;
        setBusyAction(`${kind}:${taskId}`);
        try {
            await adminFetch<{ ok: boolean; reason?: string }>("/api/growth/content/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...body, taskId, action: kind }),
            });
            flash("ok", "Content updated.");
            tasks.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Action failed.");
        } finally {
            setBusyAction(null);
        }
    };

    const createContent = async () => {
        if (busyAction) return;
        if (!createForm.topic.trim()) {
            flash("error", "A topic is required.");
            return;
        }
        const channels = createChannels.length ? createChannels : createForm.channel ? [createForm.channel] : [];
        if (channels.length === 0) {
            flash("error", "Select at least one channel.");
            return;
        }
        setBusyAction("create");
        try {
            await adminFetch<{ taskId: string }>("/api/growth/content/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create",
                    type: createForm.type,
                    topic: createForm.topic.trim(),
                    channels,
                    tone: createForm.tone.trim() || undefined,
                    campaignId: createForm.campaignId || undefined,
                    generateNow: createForm.generateNow,
                }),
            });
            flash("ok", createForm.generateNow ? "Content draft created and generated." : "Content draft created.");
            setCreateOpen(false);
            setCreateForm({ type: "X_POST", topic: "", channel: "", campaignId: "", tone: "", generateNow: true });
            setCreateChannels([]);
            tasks.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Could not create content.");
        } finally {
            setBusyAction(null);
        }
    };

    const publish = async () => {
        if (!publishTask || !publishChannel) return;
        if (busyAction) return;
        setBusyAction("publish");
        try {
            const res = await fetch("/api/growth/content/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "publish", taskId: publishTask.id, channel: publishChannel }),
            });
            const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
            if (!res.ok || body.ok !== true) {
                flash("error", body.reason || "Publish failed.");
            } else {
                flash("ok", `Published to ${CHANNEL_LABELS[publishChannel as keyof typeof CHANNEL_LABELS] || publishChannel}.`);
            }
            setPublishTask(null);
            setPublishChannel("");
            tasks.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Publish failed.");
        } finally {
            setBusyAction(null);
        }
    };

    const publishChannelOptions = useMemo(() => (publishTask?.channels || []), [publishTask]);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Content"
                subtitle="AI-generated marketing content, approval and publishing."
                actions={
                    <>
                        <RefreshButton onRefresh={refreshAll} loading={tasks.loading} />
                        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                            <Plus />
                            New content
                        </Button>
                    </>
                }
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
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        aria-label="Search content"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search title or topic…"
                        className="pl-8"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <select aria-label="Filter by state" value={state} onChange={(e) => setState(e.target.value)} className={inputCls}>
                        <option value="">All states</option>
                        {MARKETING_TASK_STATES.map((s) => (
                            <option key={s} value={s}>
                                {MARKETING_TASK_STATE_LABELS[s]}
                            </option>
                        ))}
                    </select>
                    <select aria-label="Filter by channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
                        <option value="">All channels</option>
                        {CHANNEL_TYPES.map((c) => (
                            <option key={c} value={c}>
                                {CHANNEL_LABELS[c]}
                            </option>
                        ))}
                    </select>
                    <select aria-label="Filter by campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={inputCls}>
                        <option value="">All campaigns</option>
                        {(campaigns.data || []).map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">{filtered.length} task(s)</span>
            </div>

            {tasks.loading ? (
                <div className="space-y-2" role="status" aria-label="Loading content">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-12" />
                    ))}
                </div>
            ) : tasks.error ? (
                <ErrorState
                    title="Couldn't load content"
                    description={tasks.error}
                    action={<Button type="button" variant="outline" onClick={refreshAll}>Retry</Button>}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<FileText size={18} />}
                    title={query || state || channel || campaignId ? "No content matches your filters" : "No content yet"}
                    description={
                        query || state || channel || campaignId
                            ? "Clear the filters or create new content."
                            : "Generate marketing content from the AI pipeline. Drafts land here for review, approval and publishing."
                    }
                    action={
                        !(query || state || channel || campaignId) ? (
                            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                                <Plus />
                                Create content
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Title / topic</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Channels</TableHead>
                                <TableHead>State</TableHead>
                                <TableHead>Compliance</TableHead>
                                <TableHead>Updated</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((t) => {
                                const blocked = t.state === "FAILED" && (t.rejectReason || "").toLowerCase().includes("compliance");
                                const complianceOk = t.compliance?.passed;
                                return (
                                    <TableRow key={t.id}>
                                        <TableCell className="max-w-56">
                                            <p className="truncate font-medium text-foreground">{t.title || t.topic}</p>
                                            {t.scheduledAt ? (
                                                <p className="text-[10px] text-muted-foreground">scheduled {fmtDateTime(t.scheduledAt)}</p>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {CONTENT_TYPE_LABELS[t.type as keyof typeof CONTENT_TYPE_LABELS] || t.type}
                                        </TableCell>
                                        <TableCell className="max-w-40">
                                            <div className="flex flex-wrap gap-1">
                                                {(t.channels || []).map((c) => (
                                                    <span key={c} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                        {CHANNEL_LABELS[c as keyof typeof CHANNEL_LABELS] || c}
                                                    </span>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <GrowthStatusBadge kind="task" value={t.state} pulse={t.state === "GENERATING"} />
                                        </TableCell>
                                        <TableCell>
                                            {blocked ? (
                                                <span className="inline-flex items-center gap-1 text-xs text-destructive">
                                                    <XCircle size={12} /> Blocked
                                                </span>
                                            ) : complianceOk === true ? (
                                                <span className="inline-flex items-center gap-1 text-xs text-success-foreground">
                                                    <CheckCircle2 size={12} /> Passed
                                                </span>
                                            ) : t.state === "READY_FOR_REVIEW" || t.state === "APPROVED" ? (
                                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                    <ShieldCheck size={12} /> Reviewed
                                                </span>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{fmtRelative(t.updatedAt || t.createdAt)}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-end gap-1">
                                                <Button type="button" variant="ghost" size="xs" onClick={() => setPreview(t)} aria-label="Preview content">
                                                    <Eye />
                                                </Button>
                                                {(t.state === "DRAFT" || t.state === "FAILED") && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="xs"
                                                        disabled={busyAction !== null}
                                                        onClick={() => void action("generate", t.id, {})}
                                                    >
                                                        <RefreshCw /> Generate
                                                    </Button>
                                                )}
                                                {t.state === "READY_FOR_REVIEW" && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="xs"
                                                        disabled={busyAction !== null}
                                                        onClick={() => void action("approve", t.id, {})}
                                                    >
                                                        <CheckCircle2 /> Approve
                                                    </Button>
                                                )}
                                                {t.state === "APPROVED" && (
                                                    <Button type="button" variant="outline" size="xs" disabled={busyAction !== null} onClick={() => {
                                                        setScheduleTask(t);
                                                        setScheduleAt(toInputDateTime(Date.now() + 86_400_000));
                                                    }}>
                                                        <CalendarClock /> Schedule
                                                    </Button>
                                                )}
                                                {(t.state === "APPROVED" || t.state === "SCHEDULED") && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="xs"
                                                        disabled={busyAction !== null}
                                                        onClick={() => {
                                                            setPublishTask(t);
                                                            setPublishChannel(t.channels[0] || "");
                                                        }}
                                                    >
                                                        <Send /> Publish
                                                    </Button>
                                                )}
                                                {["DRAFT", "READY_FOR_REVIEW", "APPROVED"].includes(t.state) && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="xs"
                                                        disabled={busyAction !== null}
                                                        onClick={() => {
                                                            setRejectTask(t);
                                                            setRejectReason("");
                                                        }}
                                                        aria-label="Reject content"
                                                    >
                                                        <XCircle />
                                                    </Button>
                                                )}
                                                {t.state === "REJECTED" && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="xs"
                                                        disabled={busyAction !== null}
                                                        onClick={() => void action("resetToDraft", t.id, {})}
                                                    >
                                                        <Pause /> Back to draft
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-medium text-foreground">Publishing rules</h2>
                <p className="text-xs text-muted-foreground">
                    Content is only publishable after approval (<b>APPROVED</b> or <b>SCHEDULED</b>). Publish actually sends the content through the
                    configured channel adapter — when a channel has no credentials it reports <b>NOT_CONFIGURED</b> and nothing is published. Every
                    publish is idempotent: a task is never published twice to the same channel.
                </p>
            </div>

            {/* Create dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New content</DialogTitle>
                        <DialogDescription>Creates a marketing task, then optionally runs the AI pipeline immediately.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <FormField label="Type" htmlFor="ct-type" required>
                            <select id="ct-type" className={inputCls} value={createForm.type} onChange={(e) => setCreateForm((f) => ({ ...f, type: e.target.value }))}>
                                {CONTENT_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                        {CONTENT_TYPE_LABELS[t]}
                                    </option>
                                ))}
                            </select>
                        </FormField>
                        <FormField label="Topic" htmlFor="ct-topic" required>
                            <Input id="ct-topic" value={createForm.topic} onChange={(e) => setCreateForm((f) => ({ ...f, topic: e.target.value }))} placeholder="e.g. Trend following basics" />
                        </FormField>
                        <FormField label="Channels" required>
                            <div className="flex flex-wrap gap-1.5">
                                {CHANNEL_TYPES.map((c) => {
                                    const on = createChannels.includes(c);
                                    return (
                                        <button
                                            key={c}
                                            type="button"
                                            aria-pressed={on}
                                            onClick={() => setCreateChannels(on ? createChannels.filter((x) => x !== c) : [...createChannels, c])}
                                            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                                                on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {CHANNEL_LABELS[c]}
                                        </button>
                                    );
                                })}
                            </div>
                        </FormField>
                        <FormField label="Campaign" htmlFor="ct-campaign" description="Optional link to a campaign.">
                            <select id="ct-campaign" className={inputCls} value={createForm.campaignId} onChange={(e) => setCreateForm((f) => ({ ...f, campaignId: e.target.value }))}>
                                <option value="">No campaign</option>
                                {(campaigns.data || []).map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </FormField>
                        <FormField label="Tone" htmlFor="ct-tone">
                            <Input id="ct-tone" value={createForm.tone} onChange={(e) => setCreateForm((f) => ({ ...f, tone: e.target.value }))} placeholder="professional" />
                        </FormField>
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                            <input
                                type="checkbox"
                                checked={createForm.generateNow}
                                onChange={(e) => setCreateForm((f) => ({ ...f, generateNow: e.target.checked }))}
                            />
                            Generate now (run the AI pipeline immediately)
                        </label>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={busyAction === "create"}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={busyAction === "create"} onClick={() => void createContent()}>
                            {busyAction === "create" ? "Creating…" : "Create"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Preview dialog */}
            <Dialog open={preview !== null} onOpenChange={(o) => { if (!o) setPreview(null); }}>
                <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{preview?.title || preview?.topic}</DialogTitle>
                        <DialogDescription>
                            {preview ? `${CONTENT_TYPE_LABELS[preview.type as keyof typeof CONTENT_TYPE_LABELS] || preview.type} · ${(preview.channels || []).join(", ")}` : ""}
                        </DialogDescription>
                    </DialogHeader>
                    {preview && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-1.5">
                                <GrowthStatusBadge kind="task" value={preview.state} />
                            </div>
                            {(preview.rejectReason || "").includes("Compliance block") && (
                                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive-foreground">
                                    <b>Blocked by compliance:</b> {preview.rejectReason}
                                </div>
                            )}
                            {preview.reviewNotes && (
                                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                                    <b>Review notes:</b> {preview.reviewNotes}
                                </div>
                            )}
                            {preview.compliance && (
                                <div className="rounded-md border border-border p-3 text-xs">
                                    <p className="mb-1 font-medium text-foreground">Compliance review</p>
                                    <p className="text-muted-foreground">
                                        Status: {preview.compliance.passed ? "Passed" : "Not passed"} · Risk disclosure{" "}
                                        {preview.compliance.riskDisclosureRequired ? (preview.compliance.riskDisclosurePresent ? "present" : "MISSING") : "not required"}
                                    </p>
                                    {(preview.compliance.flags || []).length > 0 && (
                                        <ul className="mt-2 space-y-1 text-muted-foreground">
                                            {(preview.compliance.flags || []).map((f, i) => (
                                                <li key={i} className="text-foreground">
                                                    {f}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                            <div className="space-y-2">
                                {Object.entries(preview.generatedContent || {}).map(([channel, block]) => (
                                    <div key={channel} className="rounded-md border border-border p-3">
                                        <p className="mb-1 text-xs font-medium text-foreground">{CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS] || channel}</p>
                                        <p className="text-xs whitespace-pre-wrap text-foreground">{block.value}</p>
                                    </div>
                                ))}
                                {Object.keys(preview.generatedContent || {}).length === 0 && (
                                    <p className="text-xs text-muted-foreground">No generated content yet — run Generate first.</p>
                                )}
                            </div>
                            {(preview.publish || []).length > 0 && (
                                <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
                                    <b className="text-foreground">Published:</b>{" "}
                                    {preview.publish?.map((p) => `${CHANNEL_LABELS[p.channel as keyof typeof CHANNEL_LABELS] || p.channel} · ${fmtDateTime(p.publishedAt)}`).join("; ")}
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Publish dialog */}
            <Dialog open={publishTask !== null} onOpenChange={(o) => { if (!o) { setPublishTask(null); setPublishChannel(""); } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Publish content</DialogTitle>
                        <DialogDescription>
                            Sends the approved content through the real channel adapter. If the channel has no credentials you will see
                            NOT_CONFIGURED and nothing is published.
                        </DialogDescription>
                    </DialogHeader>
                    <FormField label="Channel" htmlFor="pub-channel" required>
                        <select id="pub-channel" className={inputCls} value={publishChannel} onChange={(e) => setPublishChannel(e.target.value)}>
                            {publishChannelOptions.map((c) => (
                                <option key={c} value={c}>
                                    {CHANNEL_LABELS[c as keyof typeof CHANNEL_LABELS] || c}
                                    {channelByName.get(c)?.state === "CONFIGURED" ? " · configured" : " · not configured"}
                                </option>
                            ))}
                        </select>
                    </FormField>
                    {publishChannel && (
                        <p className="text-xs text-muted-foreground">
                            Channel state:{" "}
                            <GrowthStatusBadge kind="channel" value={channelByName.get(publishChannel)?.state || "NOT_CONFIGURED"} />
                            {channelByName.get(publishChannel)?.reason ? ` — ${channelByName.get(publishChannel)?.reason}` : ""}
                        </p>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => { setPublishTask(null); setPublishChannel(""); }} disabled={busyAction === "publish"}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={busyAction === "publish" || !publishChannel} onClick={() => void publish()}>
                            {busyAction === "publish" ? "Publishing…" : "Publish"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Schedule dialog */}
            <Dialog open={scheduleTask !== null} onOpenChange={(o) => { if (!o) setScheduleTask(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Schedule publishing</DialogTitle>
                        <DialogDescription>Marks the task as scheduled for the target time (state SCHEDULED).</DialogDescription>
                    </DialogHeader>
                    <FormField label="Schedule time" htmlFor="sched-at" required>
                        <Input id="sched-at" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                    </FormField>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setScheduleTask(null)} disabled={busyAction !== null}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={busyAction !== null || !fromInputDateTime(scheduleAt)}
                            onClick={() => {
                                if (!scheduleTask) return;
                                const ts = fromInputDateTime(scheduleAt);
                                if (ts <= Date.now()) {
                                    flash("error", "Pick a time in the future.");
                                    return;
                                }
                                void action("schedule", scheduleTask.id, { scheduledAt: ts });
                                setScheduleTask(null);
                            }}
                        >
                            Schedule
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reject dialog */}
            <Dialog open={rejectTask !== null} onOpenChange={(o) => { if (!o) setRejectTask(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reject content</DialogTitle>
                        <DialogDescription>Add a reason — it is stored on the task and keeps the feedback loop honest.</DialogDescription>
                    </DialogHeader>
                    <FormField label="Reason" htmlFor="reject-reason" required>
                        <textarea
                            id="reject-reason"
                            rows={3}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                            placeholder="e.g. Claims not backed by the data."
                        />
                    </FormField>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setRejectTask(null)} disabled={busyAction !== null}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={busyAction !== null || !rejectReason.trim()}
                            onClick={() => {
                                if (!rejectTask) return;
                                void action("reject", rejectTask.id, { reason: rejectReason.trim() });
                                setRejectTask(null);
                            }}
                        >
                            Reject
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}