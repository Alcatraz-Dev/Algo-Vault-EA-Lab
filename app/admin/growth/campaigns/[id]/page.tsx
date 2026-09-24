"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
    Archive,
    ArrowLeft,
    BarChart3,
    FileText,
    ListChecks,
    Pause,
    Play,
    Plus,
    Sparkles,
    Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
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
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { CampaignFormDialog, type CampaignFormRow, type CampaignFormValues } from "@/components/growth/admin/CampaignFormDialog";
import { fmtCurrency, fmtDate, fmtRelative } from "@/components/growth/admin/format";
import {
    CAMPAIGN_OBJECTIVE_LABELS,
    CHANNEL_LABELS,
    CONTENT_TYPE_LABELS,
    CONTENT_TYPES,
    MARKETING_TASK_STATES,
    PLACEMENT_LABELS,
} from "@/lib/growth/constants";

type Campaign = CampaignFormRow & { createdAt?: number; budget?: number; ownerName?: string };

type TaskRow = { id: string; title: string; topic: string; type: string; state: string; channels: string[]; campaignId?: string; updatedAt?: number; rejectReason?: string };

type RevenueEntry = { id?: string; type: string; amount: number; currency?: string; recordedAt: number; estimated?: boolean; campaignId?: string };

type RevenuePayload = { entries: RevenueEntry[] };

type AuditRow = { id?: string; actor: string; action: string; targetType?: string; targetId?: string; detail?: Record<string, unknown>; createdAt: number };

type OfferRow = { id: string; name: string };

const inputCls =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export default function AdminCampaignDetailPage() {
    const params = useParams<{ id: string }>();
    const id = params.id;

    const campaignFetch = useAdminFetch<Campaign[]>("/api/growth/campaigns");
    const tasks = useAdminFetch<TaskRow[]>("/api/growth/content");
    const revenue = useAdminFetch<RevenuePayload>("/api/growth/revenue");
    const offers = useAdminFetch<OfferRow[]>("/api/growth/affiliates");
    const audit = useAdminFetch<AuditRow[]>(`/api/growth/audit?targetId=${encodeURIComponent(id)}`, [id]);

    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [genOpen, setGenOpen] = useState(false);
    const [genForm, setGenForm] = useState({ type: "X_POST", topic: "", tone: "" });
    const [genChannels, setGenChannels] = useState<string[]>([]);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const campaign = useMemo(() => (campaignFetch.data || []).find((c) => c.id === id) || null, [campaignFetch.data, id]);

    const contentForCampaign = useMemo(
        () => (tasks.data || []).filter((t) => (t.campaignId || "") === id || t.campaignId === campaign?.id),
        [tasks.data, id, campaign]
    );
    const revenueForCampaign = useMemo(
        () => (revenue.data?.entries || []).filter((e) => (e.campaignId || "") === id),
        [revenue.data, id]
    );
    const offerNames = useMemo(() => new Map((offers.data || []).map((o) => [o.id, o.name])), [offers.data]);

    const taskStateCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const t of contentForCampaign) counts[t.state] = (counts[t.state] || 0) + 1;
        return counts;
    }, [contentForCampaign]);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 5000);
    };

    const runCampaignAction = async (action: "pause" | "resume" | "archive") => {
        if (busyAction) return;
        setBusyAction(action);
        try {
            await adminFetch<{ ok: boolean }>("/api/growth/campaigns/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, id }),
            });
            flash("ok", `Campaign ${action === "archive" ? "archived" : action === "pause" ? "paused" : "resumed"}.`);
            campaignFetch.refresh();
            audit.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Action failed.");
        } finally {
            setBusyAction(null);
        }
    };

    const saveEdit = async (values: CampaignFormValues) => {
        setBusyAction("edit");
        try {
            await adminFetch<{ ok?: boolean }>("/api/growth/campaigns/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "update",
                    id,
                    data: {
                        name: values.name.trim(),
                        objective: values.objective,
                        status: values.status,
                        startDate: values.startDate || undefined,
                        endDate: values.endDate || undefined,
                        channels: values.channels,
                        audience: values.audienceCountries.trim()
                            ? { countries: values.audienceCountries.split(",").map((s) => s.trim()).filter(Boolean) }
                            : undefined,
                        contentStrategy: {
                            topics: values.contentTopics.split(",").map((s) => s.trim()).filter(Boolean),
                            tone: values.tone.trim() || undefined,
                        },
                        affiliateOffers: values.affiliateOfferIds.length ? values.affiliateOfferIds : undefined,
                        monetizationPlacements: values.placements.length ? values.placements : undefined,
                    },
                }),
            });
            setEditOpen(false);
            flash("ok", "Campaign updated.");
            campaignFetch.refresh();
            audit.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Could not save campaign.");
        } finally {
            setBusyAction(null);
        }
    };

    const generateContent = async () => {
        if (busyAction) return;
        if (!genForm.topic.trim()) {
            flash("error", "A topic is required to generate content.");
            return;
        }
        setBusyAction("generate");
        try {
            const selectedChannels = genChannels.length ? genChannels : campaign?.channels || [];
            if (selectedChannels.length === 0) {
                flash("error", "Select at least one channel (or add channels to the campaign).");
                return;
            }
            const out = await adminFetch<{ taskId: string; generated?: { ok: boolean; error?: string; blockedByCompliance?: boolean } }>(
                "/api/growth/content/manage",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "create",
                        type: genForm.type,
                        topic: genForm.topic.trim(),
                        channels: selectedChannels,
                        tone: genForm.tone.trim() || undefined,
                        campaignId: id,
                        generateNow: true,
                    }),
                }
            );
            const generated = out.generated;
            if (generated && !generated.ok) {
                flash("error", generated.error || "Content generation failed.");
            } else if (generated?.blockedByCompliance) {
                flash("error", "Content was blocked by the compliance review.");
            } else {
                flash("ok", "Content draft created and generated — review it in Content.");
            }
            setGenOpen(false);
            tasks.refresh();
            audit.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Could not generate content.");
        } finally {
            setBusyAction(null);
        }
    };

    const analyzeCampaign = async () => {
        if (busyAction) return;
        setBusyAction("analyze");
        try {
            const periodStart = campaign?.startDate || campaign?.startAt || Date.now() - 30 * 86_400_000;
            const out = await adminFetch<{ ok: boolean; result?: { summary?: string } }>("/api/growth/cron/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job: "analysis", payload: { periodStart, periodEnd: Date.now() } }),
            });
            flash("ok", out.result?.summary || "Analysis snapshot recorded.");
            audit.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Analysis failed.");
        } finally {
            setBusyAction(null);
        }
    };

    if (campaignFetch.loading || tasks.loading || revenue.loading) {
        return (
            <div className="space-y-4" role="status" aria-label="Loading campaign">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-28" />
                <div className="grid gap-4 lg:grid-cols-2">
                    <Skeleton className="h-48" />
                    <Skeleton className="h-48" />
                </div>
            </div>
        );
    }

    if (campaignFetch.error) {
        return (
            <ErrorState
                title="Couldn't load campaign"
                description={campaignFetch.error}
                action={<Button type="button" variant="outline" onClick={campaignFetch.refresh}>Retry</Button>}
            />
        );
    }

    if (!campaign) {
        return (
            <EmptyState
                title="Campaign not found"
                description="The campaign may have been deleted or the link is wrong."
                action={
                    <Button type="button" variant="outline" size="sm" render={<Link href="/admin/growth/campaigns" />}>
                        Back to campaigns
                    </Button>
                }
            />
        );
    }

    const status = campaign.status || "DRAFT";
    const channelList = campaign.channels || [];

    return (
        <div className="space-y-6">
            <Link href="/admin/growth/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
                <ArrowLeft size={15} />
                Back to campaigns
            </Link>

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

            <PageHeader
                title={campaign.name}
                subtitle={
                    campaign.objective
                        ? CAMPAIGN_OBJECTIVE_LABELS[campaign.objective as keyof typeof CAMPAIGN_OBJECTIVE_LABELS] || campaign.objective
                        : "Campaign"
                }
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={busyAction !== null}>
                            Edit
                        </Button>
                        {status === "ACTIVE" && (
                            <Button type="button" variant="outline" size="sm" disabled={busyAction !== null} onClick={() => void runCampaignAction("pause")}>
                                {busyAction === "pause" ? "Pausing…" : <><Pause /> Pause</>}
                            </Button>
                        )}
                        {(status === "PAUSED" || status === "DRAFT") && (
                            <Button type="button" variant="outline" size="sm" disabled={busyAction !== null} onClick={() => void runCampaignAction("resume")}>
                                {busyAction === "resume" ? "Resuming…" : <><Play /> Resume</>}
                            </Button>
                        )}
                        {!["COMPLETED", "ARCHIVED"].includes(status) && (
                            <Button type="button" variant="outline" size="sm" disabled={busyAction !== null} onClick={() => void runCampaignAction("archive")}>
                                {busyAction === "archive" ? "Archiving…" : <><Archive /> Archive</>}
                            </Button>
                        )}
                        <Button type="button" variant="outline" size="sm" disabled={busyAction !== null} onClick={() => setGenOpen(true)}>
                            <Sparkles />
                            Generate content
                        </Button>
                        <Button type="button" size="sm" disabled={busyAction !== null} onClick={() => void analyzeCampaign()}>
                            {busyAction === "analyze" ? "Analyzing…" : <><BarChart3 /> Analyze</>}
                        </Button>
                    </div>
                }
            />

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Overview */}
                <section className="rounded-lg border border-border bg-card p-4 lg:col-span-1">
                    <h2 className="mb-3 text-sm font-medium text-foreground">Overview</h2>
                    <dl className="space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">Status</dt>
                            <dd><GrowthStatusBadge kind="campaign" value={status} /></dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">Start</dt>
                            <dd className="text-foreground">{fmtDate(campaign.startDate || campaign.startAt)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">End</dt>
                            <dd className="text-foreground">{fmtDate(campaign.endDate || campaign.endAt)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">Budget</dt>
                            <dd className="font-semibold text-foreground">{campaign.budget ? fmtCurrency(campaign.budget) : "—"}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">Owner</dt>
                            <dd className="text-foreground">{campaign.ownerName || "—"}</dd>
                        </div>
                    </dl>
                    <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Channels</h3>
                    <div className="flex flex-wrap gap-1.5">
                        {channelList.length === 0 ? (
                            <span className="text-xs text-muted-foreground">None selected</span>
                        ) : (
                            channelList.map((ch) => (
                                <span key={ch} className="rounded border border-border px-2 py-0.5 text-xs text-foreground">
                                    {CHANNEL_LABELS[ch as keyof typeof CHANNEL_LABELS] || ch}
                                </span>
                            ))
                        )}
                    </div>
                    {(campaign.audience?.countries?.length || 0) > 0 && (
                        <>
                            <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Target countries</h3>
                            <p className="text-xs text-foreground">{campaign.audience?.countries?.join(", ")}</p>
                        </>
                    )}
                    {(campaign.affiliateOffers?.length || 0) > 0 && (
                        <>
                            <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Affiliate offers</h3>
                            <ul className="space-y-1 text-xs text-foreground">
                                {campaign.affiliateOffers?.map((oid) => (
                                    <li key={oid}>
                                        {offerNames.get(oid) || <span className="text-muted-foreground">{oid.slice(0, 8)}…</span>}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    {(campaign.monetizationPlacements?.length || 0) > 0 && (
                        <>
                            <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Monetization placements</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {campaign.monetizationPlacements?.map((p) => (
                                    <span key={p} className="rounded border border-border px-2 py-0.5 text-xs text-foreground">
                                        {PLACEMENT_LABELS[p as keyof typeof PLACEMENT_LABELS] || p}
                                    </span>
                                ))}
                            </div>
                        </>
                    )}
                </section>

                {/* Content + revenue */}
                <div className="space-y-6 lg:col-span-2">
                    <section className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <FileText size={15} className="text-muted-foreground" /> Content
                            </h2>
                            <span className="text-xs text-muted-foreground">{contentForCampaign.length} task(s)</span>
                        </div>
                        {contentForCampaign.length === 0 ? (
                            <EmptyState
                                compact
                                icon={<FileText size={16} />}
                                title="No content yet"
                                description="Generate content from this campaign to seed the pipeline."
                                action={
                                    <Button type="button" size="sm" variant="outline" onClick={() => setGenOpen(true)}>
                                        <Plus /> Generate content
                                    </Button>
                                }
                            />
                        ) : (
                            <>
                                <div className="mb-3 flex flex-wrap gap-1.5">
                                    {MARKETING_TASK_STATES.map((st) => {
                                        const n = taskStateCounts[st] || 0;
                                        if (n === 0) return null;
                                        return (
                                            <span key={st} className="inline-flex items-center gap-1.5">
                                                <GrowthStatusBadge kind="task" value={st} />
                                                <span className="text-xs text-muted-foreground">{n}</span>
                                            </span>
                                        );
                                    })}
                                </div>
                                <ul className="space-y-2">
                                    {contentForCampaign.slice(0, 8).map((t) => (
                                        <li key={t.id} className="flex items-center justify-between gap-2 border-b border-border/50 pb-2 text-xs last:border-0 last:pb-0">
                                            <Link href="/admin/growth/content" className="truncate font-medium text-foreground hover:text-primary">
                                                {t.title || t.topic}
                                            </Link>
                                            <span className="shrink-0 text-muted-foreground">{CONTENT_TYPE_LABELS[t.type as keyof typeof CONTENT_TYPE_LABELS] || t.type}</span>
                                            <GrowthStatusBadge kind="task" value={t.state} />
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>

                    <section className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <Wallet size={15} className="text-muted-foreground" /> Revenue
                            </h2>
                            <span className="text-xs text-muted-foreground">Recorded for this campaign</span>
                        </div>
                        {revenueForCampaign.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                No revenue entries are attributed to this campaign yet. Revenue is only shown from real recorded entries.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {[...revenueForCampaign]
                                    .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
                                    .map((e, i) => (
                                        <li key={e.id || i} className="flex items-center justify-between gap-2 border-b border-border/50 pb-2 text-xs last:border-0">
                                            <span className="inline-flex items-center gap-2">
                                                <GrowthStatusBadge kind="revenue" value={e.type} />
                                                {e.estimated && <span className="rounded bg-warning-muted px-1.5 py-0.5 text-xs text-warning-foreground">estimate</span>}
                                            </span>
                                            <span className="text-muted-foreground">{fmtRelative(e.recordedAt)}</span>
                                            <span className="font-semibold text-foreground">{fmtCurrency(e.amount, e.currency)}</span>
                                        </li>
                                    ))}
                            </ul>
                        )}
                    </section>

                    <section className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <ListChecks size={15} className="text-muted-foreground" /> Activity
                            </h2>
                            <span className="text-xs text-muted-foreground">{audit.data?.length || 0} event(s)</span>
                        </div>
                        {audit.loading ? (
                            <div className="space-y-2" role="status" aria-label="Loading activity">
                                <Skeleton className="h-8" />
                                <Skeleton className="h-8" />
                                <Skeleton className="h-8" />
                            </div>
                        ) : audit.error ? (
                            <p className="text-xs text-destructive">{audit.error}</p>
                        ) : !audit.data || audit.data.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No activity recorded for this campaign yet.</p>
                        ) : (
                            <ul className="max-h-72 space-y-2 overflow-y-auto">
                                {audit.data.map((a, i) => (
                                    <li key={a.id || i} className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 text-xs last:border-0">
                                        <span className="text-muted-foreground">{a.action}</span>
                                        <span className="text-muted-foreground">{fmtRelative(a.createdAt)}</span>
                                        <span className="shrink-0 text-muted-foreground">{a.actor}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            </div>

            <CampaignFormDialog open={editOpen} onOpenChange={setEditOpen} campaign={campaign} busy={busyAction === "edit"} onSubmit={saveEdit} />

            <Dialog open={genOpen} onOpenChange={setGenOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Generate content</DialogTitle>
                        <DialogDescription>
                            Creates a marketing task for this campaign and runs the AI content pipeline immediately. The draft lands in{" "}
                            <Link className="underline" href="/admin/growth/content">Content</Link> for review.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <FormField label="Content type" htmlFor="gen-type" required>
                            <select id="gen-type" className={inputCls} value={genForm.type} onChange={(e) => setGenForm((f) => ({ ...f, type: e.target.value }))}>
                                {CONTENT_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                        {CONTENT_TYPE_LABELS[t]}
                                    </option>
                                ))}
                            </select>
                        </FormField>
                        <FormField label="Topic" htmlFor="gen-topic" required description="The subject the pipeline researches and writes about.">
                            <Input
                                id="gen-topic"
                                value={genForm.topic}
                                onChange={(e) => setGenForm((f) => ({ ...f, topic: e.target.value }))}
                                placeholder="e.g. Risk management for leveraged trading"
                            />
                        </FormField>
                        <FormField label="Tone" htmlFor="gen-tone">
                            <Input id="gen-tone" value={genForm.tone} onChange={(e) => setGenForm((f) => ({ ...f, tone: e.target.value }))} placeholder="professional, factual" />
                        </FormField>
                        <FormField label="Channels" description="Defaults to the campaign's channels.">
                            <div className="flex flex-wrap gap-1.5">
                                {(campaign.channels || []).map((ch) => {
                                    const on = genChannels.includes(ch);
                                    return (
                                        <button
                                            key={ch}
                                            type="button"
                                            aria-pressed={on}
                                            onClick={() =>
                                                setGenChannels(on ? genChannels.filter((x) => x !== ch) : [...genChannels, ch])
                                            }
                                            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                                                on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {CHANNEL_LABELS[ch as keyof typeof CHANNEL_LABELS] || ch}
                                        </button>
                                    );
                                })}
                            </div>
                        </FormField>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setGenOpen(false)} disabled={busyAction === "generate"}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={busyAction === "generate"} onClick={() => void generateContent()}>
                            {busyAction === "generate" ? "Generating…" : "Generate"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}