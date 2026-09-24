"use client";

import { useMemo, useState } from "react";
import { Coins, Handshake, Pencil, Plus, RefreshCw, Save, Star, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
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
import { FormField, FormError } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtCurrency, fmtNumber } from "@/components/growth/admin/format";
import {
    AFFILIATE_CATEGORIES,
    AFFILIATE_CATEGORY_LABELS,
    COMMISSION_MODELS,
    COMMISSION_MODEL_LABELS,
    PLACEMENT_TYPES,
    PLACEMENT_LABELS,
    PlacementType,
} from "@/lib/growth/constants";

type OfferRow = {
    id?: string;
    name: string;
    provider?: string;
    category: string;
    description?: string;
    url: string;
    trackingUrl?: string;
    commissionModel: string;
    commissionAmount: number;
    currency?: string;
    disclosure: string;
    placement?: string;
    relevanceTags?: string[];
    recommendationRules?: string;
    active: boolean;
    featured?: boolean;
    clicks?: number;
    conversions?: number;
    createdAt?: number;
};

type RevenuePayload = {
    affiliate: number;
    total: number;
};

type FormState = {
    name: string;
    provider: string;
    category: string;
    description: string;
    url: string;
    trackingUrl: string;
    commissionModel: string;
    commissionAmount: string;
    currency: string;
    disclosure: string;
    placement: string;
    relevanceTags: string;
    recommendationRules: string;
    active: boolean;
    featured: boolean;
};

const blankForm: FormState = {
    name: "",
    provider: "",
    category: "TRADING_TOOL",
    description: "",
    url: "",
    trackingUrl: "",
    commissionModel: "PERCENTAGE",
    commissionAmount: "",
    currency: "USD",
    disclosure: "",
    placement: "",
    relevanceTags: "",
    recommendationRules: "",
    active: true,
    featured: false,
};

const inputCls = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export default function AdminAffiliatePage() {
    const offers = useAdminFetch<OfferRow[]>("/api/growth/affiliates");
    const revenue = useAdminFetch<RevenuePayload>("/api/growth/revenue");
    const [q, setQ] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<OfferRow | null>(null);
    const [form, setForm] = useState<FormState>(blankForm);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
    const [reconciling, setReconciling] = useState(false);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 6000);
    };

    const filtered = useMemo(() => {
        let rows = offers.data || [];
        if (q.trim()) {
            const needle = q.trim().toLowerCase();
            rows = rows.filter((o) => (o.name || "").toLowerCase().includes(needle) || (o.provider || "").toLowerCase().includes(needle) || (o.category || "").toLowerCase().includes(needle));
        }
        return rows;
    }, [offers.data, q]);

    const stats = useMemo(() => {
        const rows = offers.data || [];
        return {
            total: rows.length,
            active: rows.filter((o) => o.active).length,
            clicks: rows.reduce((acc, o) => acc + Number(o.clicks || 0), 0),
            conversions: rows.reduce((acc, o) => acc + Number(o.conversions || 0), 0),
            featured: rows.filter((o) => o.featured).length,
        };
    }, [offers.data]);

    const openCreate = () => {
        setEditing(null);
        setForm(blankForm);
        setErr(null);
        setDialogOpen(true);
    };

    const openEdit = (o: OfferRow) => {
        setEditing(o);
        setForm({
            name: o.name || "",
            provider: o.provider || "",
            category: o.category || "TRADING_TOOL",
            description: o.description || "",
            url: o.url || "",
            trackingUrl: o.trackingUrl || "",
            commissionModel: o.commissionModel || "PERCENTAGE",
            commissionAmount: o.commissionAmount != null ? String(o.commissionAmount) : "",
            currency: o.currency || "USD",
            disclosure: o.disclosure || "",
            placement: o.placement || "",
            relevanceTags: (o.relevanceTags || []).join(", "),
            recommendationRules: o.recommendationRules || "",
            active: o.active,
            featured: !!o.featured,
        });
        setErr(null);
        setDialogOpen(true);
    };

    const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

    const validate = (): string | null => {
        if (!form.name.trim()) return "Name is required.";
        if (!/^https?:\/\/.+/i.test(form.url.trim())) return "Public URL must be a valid http(s) URL.";
        if (form.trackingUrl.trim() && !/^https?:\/\/.+/i.test(form.trackingUrl.trim())) return "Tracking URL must be a valid http(s) URL.";
        const amount = Number(form.commissionAmount);
        if (!form.commissionAmount.trim() || !Number.isFinite(amount) || amount <= 0) return "Commission amount must be a positive number.";
        if (!form.disclosure.trim()) return "Disclosure is required — compliance rule for affiliate placements.";
        return null;
    };

    const save = async () => {
        if (busy) return;
        const problem = validate();
        if (problem) {
            setErr(problem);
            return;
        }
        setErr(null);
        setBusy(true);
        try {
            const payload = {
                name: form.name.trim(),
                provider: form.provider.trim() || undefined,
                category: form.category,
                description: form.description.trim() || undefined,
                url: form.url.trim(),
                trackingUrl: form.trackingUrl.trim() || undefined,
                commissionModel: form.commissionModel,
                commissionAmount: Number(form.commissionAmount),
                currency: form.currency,
                disclosure: form.disclosure.trim(),
                placement: form.placement || undefined,
                relevanceTags: form.relevanceTags.split(",").map((s) => s.trim()).filter(Boolean),
                recommendationRules: form.recommendationRules.trim() || undefined,
                active: form.active,
                featured: form.featured,
            };
            if (editing?.id) {
                await adminFetch("/api/growth/affiliates/manage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "update", id: editing.id, data: payload }),
                });
                flash("ok", "Offer updated.");
            } else {
                await adminFetch("/api/growth/affiliates/manage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "create", data: payload }),
                });
                flash("ok", "Offer created.");
            }
            setDialogOpen(false);
            offers.refresh();
            revenue.refresh();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not save offer.");
        } finally {
            setBusy(false);
        }
    };

    const toggleActive = async (o: OfferRow) => {
        if (!o.id) return;
        try {
            await adminFetch("/api/growth/affiliates/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "update", id: o.id, data: { active: !o.active } }),
            });
            flash("ok", o.active ? "Offer paused." : "Offer enabled.");
            offers.refresh();
        } catch (e) {
            flash("error", e instanceof Error ? e.message : "Could not update offer.");
        }
    };

    const reconcile = async () => {
        if (reconciling) return;
        setReconciling(true);
        try {
            const result = await adminFetch<{ ok?: boolean; result?: { summary?: string }; error?: string }>("/api/growth/cron/affiliates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job: "affiliates", payload: {} }),
            });
            if (result.error) {
                flash("error", result.error);
            } else {
                flash("ok", result.result?.summary || "Affiliate counters reconciled from real events.");
            }
            offers.refresh();
            revenue.refresh();
        } catch (e) {
            flash("error", e instanceof Error ? e.message : "Reconciliation failed.");
        } finally {
            setReconciling(false);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Affiliate"
                subtitle="Affiliate offers, their counters and reconciliation."
                actions={
                    <>
                        <Button type="button" size="sm" variant="outline" disabled={reconciling} onClick={() => void reconcile()}>
                            <RefreshCw /> {reconciling ? "Reconciling…" : "Reconcile counters"}
                        </Button>
                        <RefreshButton onRefresh={() => { offers.refresh(); revenue.refresh(); }} loading={offers.loading || revenue.loading} />
                        <Button type="button" size="sm" onClick={openCreate}>
                            <Plus /> New offer
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

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                <MetricCard label="Offers" value={fmtNumber(stats.total)} icon={<Handshake size={16} />} />
                <MetricCard label="Active" value={fmtNumber(stats.active)} icon={<Save size={16} />} />
                <MetricCard label="Clicks (recorded)" value={fmtNumber(stats.clicks)} icon={<Coins size={16} />} />
                <MetricCard label="Conversions" value={fmtNumber(stats.conversions)} icon={<Coins size={16} />} />
                <MetricCard label="Featured" value={fmtNumber(stats.featured)} icon={<Star size={16} />} />
                <MetricCard label="Affiliate revenue" value={fmtCurrency(revenue.data?.affiliate ?? 0)} icon={<Coins size={16} />} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <input
                    aria-label="Search offers"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search offers…"
                    className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <span className="ml-auto text-xs text-muted-foreground">{filtered.length} offer(s)</span>
            </div>

            {offers.loading ? (
                <div className="space-y-2" role="status" aria-label="Loading offers">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14" />
                    ))}
                </div>
            ) : offers.error ? (
                <ErrorState
                    title="Couldn't load affiliate offers"
                    description={offers.error}
                    action={<Button type="button" variant="outline" onClick={offers.refresh}>Retry</Button>}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<Handshake size={18} />}
                    title={q ? "No offers match" : "No affiliate offers yet"}
                    description={
                        q
                            ? "Try another search term."
                            : "Create offers for trading tools, VPS, brokers and more. The AI recommends offers by relevance to the reader’s intent — never by commission."
                    }
                    action={!q ? <Button type="button" size="sm" onClick={openCreate}><Plus /> New offer</Button> : undefined}
                />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <Table className="min-w-[720px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Offer</TableHead>
                                <TableHead>Commission</TableHead>
                                <TableHead>Clicks / Conv.</TableHead>
                                <TableHead>Placement</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((o) => (
                                <TableRow key={o.id || o.name}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium text-foreground">{o.name}</p>
                                            {o.featured && <Star size={12} className="text-warning" aria-label="Featured" />}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {AFFILIATE_CATEGORY_LABELS[o.category as keyof typeof AFFILIATE_CATEGORY_LABELS] || o.category}
                                            {o.provider ? ` · ${o.provider}` : ""}
                                        </p>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-xs normal-case">
                                            {COMMISSION_MODEL_LABELS[o.commissionModel as keyof typeof COMMISSION_MODEL_LABELS] || o.commissionModel}
                                        </Badge>
                                        <p className="mt-1 text-xs text-foreground">{fmtCurrency(o.commissionAmount, o.currency || "USD")}</p>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {fmtNumber(o.clicks ?? 0)} / {fmtNumber(o.conversions ?? 0)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {o.placement ? PLACEMENT_LABELS[o.placement as PlacementType] || o.placement : "—"}
                                    </TableCell>
                                    <TableCell>
                                        <GrowthStatusBadge kind="offer" value={o.active ? "ACTIVE" : "INACTIVE"} />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button type="button" variant="ghost" size="xs" onClick={() => openEdit(o)} aria-label={`Edit ${o.name}`}>
                                                <Pencil />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                onClick={() => void toggleActive(o)}
                                                aria-label={o.active ? `Pause ${o.name}` : `Enable ${o.name}`}
                                            >
                                                {o.active ? <Square /> : <Save />}
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
                <h2 className="mb-2 text-sm font-medium text-foreground">Attribution policy</h2>
                <p className="text-xs text-muted-foreground">
                    Counters shown here are reconciled from real click and conversion events (use <b>Reconcile counters</b> to recompute them from
                    source events). The AI recommendation pipeline selects offers by relevance tags and recommendation rules — commission is never used
                    as a ranking factor.
                </p>
            </div>

            {/* Create / edit dialog */}
            <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o && !busy) setDialogOpen(false); }}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing ? `Edit ${editing.name}` : "New affiliate offer"}</DialogTitle>
                        <DialogDescription>
                            The disclosure field is required — it is part of the affiliate compliance rules for placements.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {err && <FormError>{err}</FormError>}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Name *" htmlFor="af-name">
                                <input id="af-name" className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="5% off hosting" />
                            </FormField>
                            <FormField label="Provider" htmlFor="af-provider">
                                <input id="af-provider" className={inputCls} value={form.provider} onChange={(e) => set({ provider: e.target.value })} placeholder="Partner name" />
                            </FormField>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Category" htmlFor="af-category">
                                <select id="af-category" className={inputCls} value={form.category} onChange={(e) => set({ category: e.target.value })}>
                                    {AFFILIATE_CATEGORIES.map((c) => (
                                        <option key={c} value={c}>{AFFILIATE_CATEGORY_LABELS[c]}</option>
                                    ))}
                                </select>
                            </FormField>
                            <FormField label="Placement" htmlFor="af-placement">
                                <select id="af-placement" className={inputCls} value={form.placement} onChange={(e) => set({ placement: e.target.value })}>
                                    <option value="">Automatic</option>
                                    {PLACEMENT_TYPES.map((p) => (
                                        <option key={p} value={p}>{PLACEMENT_LABELS[p]}</option>
                                    ))}
                                </select>
                            </FormField>
                        </div>
                        <FormField label="Description" htmlFor="af-desc">
                            <textarea id="af-desc" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What the reader gets" />
                        </FormField>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Public URL *" htmlFor="af-url">
                                <input id="af-url" className={inputCls} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
                            </FormField>
                            <FormField label="Tracking URL" htmlFor="af-track">
                                <input id="af-track" className={inputCls} value={form.trackingUrl} onChange={(e) => set({ trackingUrl: e.target.value })} placeholder="https://partner/tag?id=…" />
                            </FormField>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-3">
                            <FormField label="Commission model" htmlFor="af-model">
                                <select id="af-model" className={inputCls} value={form.commissionModel} onChange={(e) => set({ commissionModel: e.target.value })}>
                                    {COMMISSION_MODELS.map((m) => (
                                        <option key={m} value={m}>{COMMISSION_MODEL_LABELS[m]}</option>
                                    ))}
                                </select>
                            </FormField>
                            <FormField label="Amount *" htmlFor="af-amount">
                                <input id="af-amount" type="number" min={0} step="0.01" className={inputCls} value={form.commissionAmount} onChange={(e) => set({ commissionAmount: e.target.value })} placeholder="10" />
                            </FormField>
                            <FormField label="Currency" htmlFor="af-currency">
                                <input id="af-currency" className={inputCls} value={form.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} placeholder="USD" />
                            </FormField>
                        </div>
                        <FormField label="Disclosure *" htmlFor="af-disclosure">
                            <textarea id="af-disclosure" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" rows={2} value={form.disclosure} onChange={(e) => set({ disclosure: e.target.value })} placeholder="e.g. If you sign up through this link, we may earn a commission." />
                        </FormField>
                        <FormField label="Relevance tags" htmlFor="af-tags">
                            <input id="af-tags" className={inputCls} value={form.relevanceTags} onChange={(e) => set({ relevanceTags: e.target.value })} placeholder="vps, hosting, low-latency" />
                        </FormField>
                        <FormField label="Recommendation rules (AI)" htmlFor="af-rules">
                            <textarea id="af-rules" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" rows={2} value={form.recommendationRules} onChange={(e) => set({ recommendationRules: e.target.value })} placeholder="e.g. Only recommend when the reader mentions latency" />
                        </FormField>
                        <label className="flex items-center gap-2 text-xs text-foreground">
                            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} className="h-3.5 w-3.5" />
                            Active
                        </label>
                        <label className="flex items-center gap-2 text-xs text-foreground">
                            <input type="checkbox" checked={form.featured} onChange={(e) => set({ featured: e.target.checked })} className="h-3.5 w-3.5" />
                            Featured (highlighted in affiliate placements)
                        </label>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={busy} onClick={() => void save()}>
                            {busy ? "Saving…" : editing ? "Save changes" : "Create offer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}