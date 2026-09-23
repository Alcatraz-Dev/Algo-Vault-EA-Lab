"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, Pause, Play, Pencil, Plus, Search } from "lucide-react";
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
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import {
    CampaignFormDialog,
    type CampaignFormRow,
    type CampaignFormValues,
} from "@/components/growth/admin/CampaignFormDialog";
import { fmtDate } from "@/components/growth/admin/format";
import { CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_STATUSES, CHANNEL_LABELS } from "@/lib/growth/constants";

type Campaign = CampaignFormRow & { createdAt: number; budget?: number };

export default function AdminCampaignsPage() {
    const campaigns = useAdminFetch<Campaign[]>("/api/growth/campaigns");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [objective, setObjective] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Campaign | null>(null);
    const [busy, setBusy] = useState(false);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 5000);
    };

    const filtered = useMemo(() => {
        let rows = campaigns.data || [];
        if (query.trim()) {
            const q = query.trim().toLowerCase();
            rows = rows.filter((c) => c.name.toLowerCase().includes(q));
        }
        if (status) rows = rows.filter((c) => (c.status || "DRAFT") === status);
        if (objective) rows = rows.filter((c) => c.objective === objective);
        return rows;
    }, [campaigns.data, query, status, objective]);

    const runAction = async (id: string, action: "pause" | "resume" | "archive") => {
        if (busyAction) return;
        setBusyAction(`${action}:${id}`);
        try {
            await adminFetch<{ ok: boolean }>("/api/growth/campaigns/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, id }),
            });
            flash("ok", `Campaign ${action === "archive" ? "archived" : action === "pause" ? "paused" : "resumed"}.`);
            campaigns.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Action failed.");
        } finally {
            setBusyAction(null);
        }
    };

    const submitForm = async (values: CampaignFormValues) => {
        setBusy(true);
        try {
            const payload = {
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
            };
            await adminFetch<{ ok?: boolean; id?: string }>("/api/growth/campaigns/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editing ? { action: "update", id: editing.id, data: payload } : { action: "create", data: payload }),
            });
            setModalOpen(false);
            setEditing(null);
            flash("ok", editing ? "Campaign updated." : "Campaign created.");
            campaigns.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Could not save campaign.");
        } finally {
            setBusy(false);
        }
    };

    const openCreate = () => {
        setEditing(null);
        setModalOpen(true);
    };
    const openEdit = (c: Campaign) => {
        setEditing(c);
        setModalOpen(true);
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Campaigns"
                subtitle="Plan, run and track growth campaigns."
                actions={
                    <>
                        <RefreshButton onRefresh={campaigns.refresh} loading={campaigns.loading} />
                        <Button type="button" size="sm" onClick={openCreate}>
                            <Plus />
                            New campaign
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
                        aria-label="Search campaigns"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search campaigns…"
                        className="pl-8"
                    />
                </div>
                <select
                    aria-label="Filter by status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                    <option value="">All statuses</option>
                    {CAMPAIGN_STATUSES.map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Filter by objective"
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                    <option value="">All objectives</option>
                    {Object.entries(CAMPAIGN_OBJECTIVE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </select>
                <span className="ml-auto text-xs text-muted-foreground">{filtered.length} campaign(s)</span>
            </div>

            {campaigns.loading ? (
                <div className="space-y-2" role="status" aria-label="Loading campaigns">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-12" />
                    ))}
                </div>
            ) : campaigns.error ? (
                <ErrorState
                    title="Couldn't load campaigns"
                    description={campaigns.error}
                    action={<Button type="button" variant="outline" onClick={campaigns.refresh}>Retry</Button>}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<MegaphoneIcon />}
                    title={query || status || objective ? "No campaigns match your filters" : "No campaigns yet"}
                    description={
                        query || status || objective
                            ? "Clear the filters or create a new campaign."
                            : "Create your first growth campaign and it will show up here with its performance."
                    }
                    action={
                        !(query || status || objective) ? (
                            <Button type="button" size="sm" onClick={openCreate}>
                                <Plus />
                                Create campaign
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Objective</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Channels</TableHead>
                                <TableHead>Start</TableHead>
                                <TableHead>End</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell>
                                        <Link href={`/admin/growth/campaigns/${c.id}`} className="font-medium text-foreground hover:text-primary">
                                            {c.name}
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {c.objective ? CAMPAIGN_OBJECTIVE_LABELS[c.objective as keyof typeof CAMPAIGN_OBJECTIVE_LABELS] || c.objective : "—"}
                                    </TableCell>
                                    <TableCell>
                                        <GrowthStatusBadge kind="campaign" value={c.status || "DRAFT"} />
                                    </TableCell>
                                    <TableCell className="max-w-48">
                                        <div className="flex flex-wrap gap-1">
                                            {(c.channels || []).map((ch) => (
                                                <span key={ch} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                    {CHANNEL_LABELS[ch as keyof typeof CHANNEL_LABELS] || ch}
                                                </span>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{fmtDate(c.startDate || c.startAt)}</TableCell>
                                    <TableCell className="text-muted-foreground">{fmtDate(c.endDate || c.endAt)}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-1">
                                            {c.status === "ACTIVE" && (
                                                <Button type="button" variant="outline" size="xs" disabled={busyAction !== null} onClick={() => void runAction(c.id, "pause")} data-action="pause">
                                                    <Pause />
                                                    Pause
                                                </Button>
                                            )}
                                            {(c.status === "PAUSED" || c.status === "DRAFT") && (
                                                <Button type="button" variant="outline" size="xs" disabled={busyAction !== null} onClick={() => void runAction(c.id, "resume")}>
                                                    <Play />
                                                    Resume
                                                </Button>
                                            )}
                                            {!["COMPLETED", "ARCHIVED"].includes(c.status || "") && (
                                                <Button type="button" variant="outline" size="xs" disabled={busyAction !== null} onClick={() => void runAction(c.id, "archive")}>
                                                    <Archive />
                                                    Archive
                                                </Button>
                                            )}
                                            <Button type="button" variant="ghost" size="xs" onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`}>
                                                <Pencil />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-medium text-foreground">What status changes do</h2>
                <p className="text-xs text-muted-foreground">
                    <b>Pause</b> stops the campaign from being picked up by the growth engine; <b>Resume</b> sets it back to active;{" "}
                    <b>Archive</b> closes it permanently. Every action is recorded server-side with your identity in the audit trail.
                </p>
            </div>

            <CampaignFormDialog
                open={modalOpen}
                onOpenChange={(o) => {
                    if (!o) setEditing(null);
                    setModalOpen(o);
                }}
                campaign={editing}
                busy={busy}
                onSubmit={submitForm}
            />
        </div>
    );
}

function MegaphoneIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3 11 18-5v12L3 14v-3z" />
            <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
    );
}