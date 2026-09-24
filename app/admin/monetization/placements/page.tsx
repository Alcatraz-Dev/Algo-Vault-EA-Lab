"use client";

import { useMemo, useState } from "react";
import { Eye, MousePointer, Pencil, Plus, Save, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { FormField, FormError, FormSuccess } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtDate, fmtDateTime } from "@/components/growth/admin/format";
import { PLACEMENT_LABELS, PLACEMENT_TYPES, PlacementType, PREMIUM_AD_MODES } from "@/lib/growth/constants";

type PlacementRow = {
    id?: string;
    key: PlacementType;
    name: string;
    description?: string;
    frequencyCap?: { type?: string; limit?: number };
    priority: number;
    targetingRules?: {
        countries?: string[];
        devices?: string[];
        premium?: { mode?: string; reductionRatio?: number };
        loggedOutOnly?: boolean;
    };
    active: boolean;
    startAt?: number;
    endAt?: number;
    maxAds?: number;
    createdAt?: number;
};

type FormState = {
    key: string;
    name: string;
    description: string;
    priority: string;
    freqType: string;
    freqLimit: string;
    countries: string;
    devices: string;
    premiumMode: string;
    reductionRatio: string;
    loggedOutOnly: boolean;
    startAt: string;
    endAt: string;
    maxAds: string;
    active: boolean;
};

const blankForm: FormState = {
    key: PLACEMENT_TYPES[0],
    name: "",
    description: "",
    priority: "50",
    freqType: "",
    freqLimit: "",
    countries: "",
    devices: "",
    premiumMode: "SHOW",
    reductionRatio: "0.5",
    loggedOutOnly: false,
    startAt: "",
    endAt: "",
    maxAds: "",
    active: true,
};

function toLocalInput(ms?: number): string {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminPlacementsPage() {
    const placements = useAdminFetch<PlacementRow[]>("/api/growth/placements");
    const [q, setQ] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<PlacementRow | null>(null);
    const [form, setForm] = useState<FormState>(blankForm);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
    const [previewing, setPreviewing] = useState<PlacementRow | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 5000);
    };

    const filtered = useMemo(() => {
        let rows = placements.data || [];
        if (q.trim()) {
            const needle = q.trim().toLowerCase();
            rows = rows.filter((p) => (p.name || "").toLowerCase().includes(needle) || (p.key || "").toLowerCase().includes(needle));
        }
        return rows;
    }, [placements.data, q]);

    const openCreate = () => {
        setEditing(null);
        setForm(blankForm);
        setErr(null);
        setSuccess(null);
        setDialogOpen(true);
    };

    const openEdit = (p: PlacementRow) => {
        setEditing(p);
        setForm({
            key: p.key,
            name: p.name || "",
            description: p.description || "",
            priority: String(p.priority ?? 50),
            freqType: p.frequencyCap?.type || "",
            freqLimit: p.frequencyCap?.limit != null ? String(p.frequencyCap.limit) : "",
            countries: (p.targetingRules?.countries || []).join(", "),
            devices: (p.targetingRules?.devices || []).join(", "),
            premiumMode: p.targetingRules?.premium?.mode || "SHOW",
            reductionRatio: p.targetingRules?.premium?.reductionRatio != null ? String(p.targetingRules.premium.reductionRatio) : "0.5",
            loggedOutOnly: !!p.targetingRules?.loggedOutOnly,
            startAt: toLocalInput(p.startAt),
            endAt: toLocalInput(p.endAt),
            maxAds: p.maxAds != null ? String(p.maxAds) : "",
            active: p.active,
        });
        setErr(null);
        setSuccess(null);
        setDialogOpen(true);
    };

    const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

    const validate = (): string | null => {
        if (!form.name.trim()) return "Name is required.";
        const priority = Number(form.priority);
        if (!Number.isFinite(priority) || priority < 0 || priority > 100) return "Priority must be between 0 and 100.";
        if (form.freqType && !form.freqLimit.trim()) return "Frequency cap limit is required when a cap type is selected.";
        if (form.freqLimit && (!Number.isFinite(Number(form.freqLimit)) || Number(form.freqLimit) < 1)) return "Frequency cap limit must be a positive number.";
        if (form.premiumMode === "REDUCED") {
            const r = Number(form.reductionRatio);
            if (!Number.isFinite(r) || r < 0 || r > 1) return "Reduction ratio must be between 0 and 1.";
        }
        if (form.startAt && form.endAt && new Date(form.endAt).getTime() <= new Date(form.startAt).getTime()) {
            return "End date must be after start date.";
        }
        if (form.maxAds && (!Number.isFinite(Number(form.maxAds)) || Number(form.maxAds) < 1)) return "Max ads must be a positive number.";
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
                key: form.key,
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                priority: Number(form.priority),
                active: form.active,
                frequencyCap: form.freqType
                    ? { type: form.freqType, limit: Number(form.freqLimit) }
                    : undefined,
                targetingRules: {
                    countries: form.countries.split(",").map((s) => s.trim()).filter(Boolean),
                    devices: form.devices.split(",").map((s) => s.trim()).filter(Boolean),
                    premium: {
                        mode: form.premiumMode,
                        ...(form.premiumMode === "REDUCED" ? { reductionRatio: Number(form.reductionRatio) } : {}),
                    },
                    loggedOutOnly: form.loggedOutOnly,
                },
                startAt: form.startAt ? new Date(form.startAt).getTime() : undefined,
                endAt: form.endAt ? new Date(form.endAt).getTime() : undefined,
                maxAds: form.maxAds ? Number(form.maxAds) : undefined,
            };
            if (editing?.id) {
                await adminFetch("/api/growth/placements/manage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "update", id: editing.id, data: payload }),
                });
                flash("ok", "Placement updated.");
            } else {
                await adminFetch("/api/growth/placements/manage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "create", data: payload }),
                });
                flash("ok", "Placement created.");
            }
            setDialogOpen(false);
            placements.refresh();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not save placement.");
        } finally {
            setBusy(false);
        }
    };

    const toggleActive = async (p: PlacementRow) => {
        if (!p.id) return;
        try {
            await adminFetch("/api/growth/placements/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "update", id: p.id, data: { active: !p.active } }),
            });
            flash("ok", p.active ? "Placement paused." : "Placement enabled.");
            placements.refresh();
        } catch (e) {
            flash("error", e instanceof Error ? e.message : "Could not update placement.");
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Placements"
                subtitle="Where ads can appear. Frequency caps, targeting rules and availability."
                actions={
                    <>
                        <RefreshButton onRefresh={placements.refresh} loading={placements.loading} />
                        <Button type="button" size="sm" onClick={openCreate}>
                            <Plus /> New placement
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
                <input
                    aria-label="Search placements"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search name or key…"
                    className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <span className="ml-auto text-xs text-muted-foreground">{filtered.length} placement(s)</span>
            </div>

            {placements.loading ? (
                <div className="space-y-2" role="status" aria-label="Loading placements">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-14" />
                    ))}
                </div>
            ) : placements.error ? (
                <ErrorState
                    title="Couldn't load placements"
                    description={placements.error}
                    action={<Button type="button" variant="outline" onClick={placements.refresh}>Retry</Button>}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<MousePointer size={18} />}
                    title={q ? "No placements match" : "No placements yet"}
                    description={
                        q
                            ? "Try another search term."
                            : "Placements define where ads may render (e.g. sidebar, inline, footer). Create the first one to start configuring your ad inventory."
                    }
                    action={!q ? <Button type="button" size="sm" onClick={openCreate}><Plus /> New placement</Button> : undefined}
                />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <Table className="min-w-[800px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Placement</TableHead>
                                <TableHead>Priority</TableHead>
                                <TableHead>Frequency cap</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Dates</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((p) => (
                                <TableRow key={p.id || p.key}>
                                    <TableCell>
                                        <p className="font-medium text-foreground">{p.name}</p>
                                        {p.description && <p className="max-w-xs truncate text-xs text-muted-foreground">{p.description}</p>}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-xs normal-case">
                                            {PLACEMENT_LABELS[p.key as PlacementType] || p.key}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{p.priority}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {p.frequencyCap ? `${p.frequencyCap.type} · ${p.frequencyCap.limit}` : "—"}
                                    </TableCell>
                                    <TableCell>
                                        <GrowthStatusBadge kind="placement" value={p.active ? "ACTIVE" : "INACTIVE"} />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {p.startAt || p.endAt ? `${p.startAt ? fmtDate(p.startAt) : "…"} – ${p.endAt ? fmtDate(p.endAt) : "…"}` : "Always"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button type="button" variant="ghost" size="xs" onClick={() => setPreviewing(p)} aria-label={`Preview ${p.name}`}>
                                                <Eye />
                                            </Button>
                                            <Button type="button" variant="ghost" size="xs" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                                                <Pencil />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                onClick={() => void toggleActive(p)}
                                                aria-label={p.active ? `Pause ${p.name}` : `Enable ${p.name}`}
                                            >
                                                {p.active ? <Square /> : <Save />}
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Create / edit dialog */}
            <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o && !busy) setDialogOpen(false); }}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing ? `Edit ${editing.name}` : "New placement"}</DialogTitle>
                        <DialogDescription>
                            Placement configuration is read by the live placement engine. Priority is 0–100 (higher wins).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {err && <FormError>{err}</FormError>}
                        {success && <FormSuccess>{success}</FormSuccess>}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Name *" htmlFor="pl-name">
                                <input id="pl-name" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Sidebar banner" />
                            </FormField>
                            <FormField label="Placement key" htmlFor="pl-key">
                                <select id="pl-key" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.key} onChange={(e) => set({ key: e.target.value })} disabled={!!editing}>
                                    {PLACEMENT_TYPES.map((k) => (
                                        <option key={k} value={k}>{PLACEMENT_LABELS[k]}</option>
                                    ))}
                                </select>
                            </FormField>
                        </div>
                        <FormField label="Description" htmlFor="pl-desc">
                            <textarea id="pl-desc" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Where this slot appears" />
                        </FormField>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Priority (0–100)" htmlFor="pl-prio">
                                <input id="pl-prio" type="number" min={0} max={100} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.priority} onChange={(e) => set({ priority: e.target.value })} />
                            </FormField>
                            <FormField label="Max ads per page" htmlFor="pl-maxads">
                                <input id="pl-maxads" type="number" min={0} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.maxAds} onChange={(e) => set({ maxAds: e.target.value })} placeholder="Unlimited" />
                            </FormField>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Frequency cap type" htmlFor="pl-freqtype">
                                <select id="pl-freqtype" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.freqType} onChange={(e) => set({ freqType: e.target.value })}>
                                    <option value="">No cap</option>
                                    <option value="PER_SESSION">Per session</option>
                                    <option value="PER_DAY">Per day</option>
                                </select>
                            </FormField>
                            <FormField label="Cap limit" htmlFor="pl-freqlimit">
                                <input id="pl-freqlimit" type="number" min={1} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.freqLimit} onChange={(e) => set({ freqLimit: e.target.value })} placeholder="e.g. 3" disabled={!form.freqType} />
                            </FormField>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Premium handling" htmlFor="pl-premium">
                                <select id="pl-premium" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.premiumMode} onChange={(e) => set({ premiumMode: e.target.value })}>
                                    {PREMIUM_AD_MODES.map((m) => (
                                        <option key={m} value={m}>{m === "SHOW" ? "Show ads to premium too" : m === "REDUCED" ? "Reduced frequency" : "Hide from premium"}</option>
                                    ))}
                                </select>
                            </FormField>
                            {form.premiumMode === "REDUCED" ? (
                                <FormField label="Reduction ratio (0–1)" htmlFor="pl-ratio">
                                    <input id="pl-ratio" type="number" min={0} max={1} step={0.05} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.reductionRatio} onChange={(e) => set({ reductionRatio: e.target.value })} />
                                </FormField>
                            ) : (
                                <FormField label="Targeting" htmlFor="pl-countries">
                                    <input id="pl-countries" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.countries} onChange={(e) => set({ countries: e.target.value })} placeholder="Countries, comma separated" />
                                </FormField>
                            )}
                        </div>
                        {form.premiumMode !== "REDUCED" && (
                            <FormField label="Devices" htmlFor="pl-devices">
                                <input id="pl-devices" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.devices} onChange={(e) => set({ devices: e.target.value })} placeholder="Devices, comma separated" />
                            </FormField>
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField label="Start" htmlFor="pl-start">
                                <input id="pl-start" type="datetime-local" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.startAt} onChange={(e) => set({ startAt: e.target.value })} />
                            </FormField>
                            <FormField label="End" htmlFor="pl-end">
                                <input id="pl-end" type="datetime-local" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.endAt} onChange={(e) => set({ endAt: e.target.value })} />
                            </FormField>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-foreground">
                            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} className="h-3.5 w-3.5" />
                            Active (available to the placement engine)
                        </label>
                        <label className="flex items-center gap-2 text-xs text-foreground">
                            <input type="checkbox" checked={form.loggedOutOnly} onChange={(e) => set({ loggedOutOnly: e.target.checked })} className="h-3.5 w-3.5" />
                            Only show to logged-out visitors
                        </label>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={busy} onClick={() => void save()}>
                            {busy ? "Saving…" : editing ? "Save changes" : "Create placement"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Preview dialog */}
            <Dialog open={previewing !== null} onOpenChange={(o) => { if (!o) setPreviewing(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Placement preview</DialogTitle>
                        <DialogDescription>
                            Configuration summary — actual ad render is decided by the live placement engine at runtime.
                        </DialogDescription>
                    </DialogHeader>
                    {previewing && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
                                <div>
                                    <p className="font-medium text-foreground">{previewing.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {PLACEMENT_LABELS[previewing.key as PlacementType] || previewing.key} · priority {previewing.priority}
                                    </p>
                                </div>
                                <GrowthStatusBadge kind="placement" value={previewing.active ? "ACTIVE" : "INACTIVE"} />
                            </div>
                            <dl className="space-y-1.5 text-xs">
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Frequency cap</dt>
                                    <dd className="text-foreground">{previewing.frequencyCap ? `${previewing.frequencyCap.type} ×${previewing.frequencyCap.limit}` : "None"}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Premium handling</dt>
                                    <dd className="text-foreground">{previewing.targetingRules?.premium?.mode || "SHOW"}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Countries</dt>
                                    <dd className="text-foreground">{previewing.targetingRules?.countries?.length ? previewing.targetingRules.countries.join(", ") : "All"}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Logged-out only</dt>
                                    <dd className="text-foreground">{previewing.targetingRules?.loggedOutOnly ? "Yes" : "No"}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Schedule</dt>
                                    <dd className="text-foreground">
                                        {previewing.startAt || previewing.endAt
                                            ? `${previewing.startAt ? fmtDateTime(previewing.startAt) : "now"} → ${previewing.endAt ? fmtDateTime(previewing.endAt) : "open"}`
                                            : "Always"}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}