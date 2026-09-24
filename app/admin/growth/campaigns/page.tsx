"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, Megaphone, Pause, Play, Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { Select } from "@/components/ui/select";
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
import { ConfirmDialog } from "@/components/growth/admin/ConfirmDialog";
import { NoticeBanner } from "@/components/growth/admin/NoticeBanner";
import {
    CampaignFormDialog,
    type CampaignFormValues,
    type CampaignFormRow,
} from "@/components/growth/admin/CampaignFormDialog";
import { fmtDate, fmtCurrency } from "@/components/growth/admin/format";
import { CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_STATUSES, CHANNEL_LABELS } from "@/lib/growth/constants";
import { ctr, roas } from "@/lib/growth/metrics";

type Campaign = {
    id: string;
    name: string;
    objective?: string;
    status?: string;
    channels?: string[];
    startDate?: number;
    endDate?: number;
    createdAt: number;
    campaignId?: string;
    budget?: number;
    spent?: number;
    impressions?: number;
    clicks?: number;
    conversions?: number;
    revenue?: number;
};

type CampaignPerformance = {
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
};

export default function AdminCampaignsPage() {
    const campaigns = useAdminFetch<Campaign[]>("/api/growth/campaigns");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [objective, setObjective] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Campaign | null>(null);
    const [busy, setBusy] = useState(false);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [confirmState, setConfirmState] = useState<{ action: "archive" | "pause" | "resume" | null; campaign: Campaign | null }>({
        action: null,
        campaign: null,
    });
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

    const handleConfirmAction = async () => {
        if (!confirmState.campaign || !confirmState.action) return;
        const { id, action } = { id: confirmState.campaign.id, action: confirmState.action };
        await runAction(id, action);
        setConfirmState({ action: null, campaign: null });
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

    const confirmArchive = (c: Campaign) => {
        setConfirmState({ action: "archive", campaign: c });
    };

    const getCtr = (c: Campaign): string => {
        const result = ctr(c.clicks || 0, c.impressions || 0);
        if (!result || result.insufficient) return "—";
        return `${result.value.toFixed(2)}%`;
    };

    const getRoas = (c: Campaign): string => {
        const result = roas(c.revenue || 0, c.spent || 0);
        if (result === null) return "—";
        return `${result.toFixed(1)}x`;
    };

    const budgetProgress = (c: Campaign): number => {
        if (!c.budget || c.budget <= 0) return 0;
        return Math.min(((c.spent || 0) / c.budget) * 100, 100);
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

            {notice && <NoticeBanner variant={notice.kind === "ok" ? "success" : "error"}>{notice.text}</NoticeBanner>}

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
                <Select
                    aria-label="Filter by status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                >
                    <option value="">All statuses</option>
                    {CAMPAIGN_STATUSES.map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </Select>
                <Select
                    aria-label="Filter by objective"
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                >
                    <option value="">All objectives</option>
                    {Object.entries(CAMPAIGN_OBJECTIVE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </Select>
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
                    icon={<Megaphone size={18} />}
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
                                <TableHead>Budget</TableHead>
                                <TableHead>Performance</TableHead>
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
                                        {c.campaignId && (
                                            <span className="ml-2 text-xs text-muted-foreground">#{c.campaignId}</span>
                                        )}
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
                                    <TableCell>
                                        {c.budget ? (
                                            <div className="flex flex-col gap-1">
                                                <span className="text-sm font-medium text-foreground">{fmtCurrency(c.budget)}</span>
                                                {c.spent !== undefined && (
                                                    <>
                                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                                            <div
                                                                className="h-full bg-primary transition-all"
                                                                style={{ width: `${budgetProgress(c)}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">
                                                            {fmtCurrency(c.spent)} of {fmtCurrency(c.budget)} spent
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs">CTR: {getCtr(c)}</span>
                                            <span className="text-xs">ROAS: {getRoas(c)}</span>
                                            <span className="text-xs">Conversions: {c.conversions ? String(c.conversions) : "—"}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{fmtDate(c.startDate || (c as any).startAt)}</TableCell>
                                    <TableCell className="text-muted-foreground">{fmtDate(c.endDate || (c as any).endAt)}</TableCell>
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
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="xs"
                                                    disabled={busyAction !== null}
                                                    onClick={() => void confirmArchive(c)}
                                                >
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

            <ConfirmDialog
                open={confirmState.action !== null && confirmState.campaign !== null}
                onOpenChange={(o) => !o && setConfirmState({ action: null, campaign: null })}
                title={`Archive "${confirmState.campaign?.name}"?`}
                description="This will archive the campaign. You can unarchive it later from the filters."
                confirmLabel="Archive"
                destructive
                busy={busyAction !== null}
                onConfirm={handleConfirmAction}
            />

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
