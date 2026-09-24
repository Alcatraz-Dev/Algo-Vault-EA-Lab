"use client";

import { useState, useMemo } from "react";
import { Plus, FlaskConical, Trophy, Play, Pause, Archive, MoreVertical } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { Select } from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { NoticeBanner } from "@/components/growth/admin/NoticeBanner";
import { fmtDate, fmtNumber } from "@/components/growth/admin/format";
import { EXPERIMENT_STATUSES, EXPERIMENT_MIN_SAMPLE_SIZE, EXPERIMENT_MIN_UPLIFT_PCT } from "@/lib/growth/constants";

type ExperimentRow = {
    id?: string;
    name: string;
    description?: string;
    hypothesis?: string;
    metric?: string;
    startAt?: number;
    endAt?: number;
    state: string;
    results?: {
        impressionsA?: number;
        impressionsB?: number;
        conversionsA?: number;
        conversionsB?: number;
        winner?: "A" | "B" | "INCONCLUSIVE";
    };
    variants?: Array<{ id: string; label: string; settings?: Record<string, unknown> }>;
    createdAt?: number;
    updatedAt?: number;
};

export default function AdminGrowthExperimentsPage() {
    const experiments = useAdminFetch<ExperimentRow[]>("/api/growth/experiments");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState<ExperimentRow | null>(null);
    const [busy, setBusy] = useState(false);
    const [busyAction, setBusyAction] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 5000);
    };

    const filtered = useMemo(() => {
        let rows = experiments.data || [];
        if (query.trim()) {
            const q = query.trim().toLowerCase();
            rows = rows.filter((e) => e.name.toLowerCase().includes(q) || (e.hypothesis || "").toLowerCase().includes(q));
        }
        if (statusFilter) rows = rows.filter((e) => e.state === statusFilter);
        return rows;
    }, [experiments.data, query, statusFilter]);

    const byState = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const e of experiments.data || []) counts[e.state || "DRAFT"] = (counts[e.state || "DRAFT"] || 0) + 1;
        return counts;
    }, [experiments.data]);

    const runAction = async (id: string, action: "start" | "stop" | "archive") => {
        if (busyAction) return;
        setBusyAction(`${action}:${id}`);
        try {
            await adminFetch<{ ok: boolean }>("/api/growth/experiments/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, action }),
            });
            flash("ok", `Experiment ${action === "start" ? "started" : action === "stop" ? "stopped" : "archived"}.`);
            experiments.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Action failed.");
        } finally {
            setBusyAction(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setBusy(true);
        const formData = new FormData(e.currentTarget);
        const name = formData.get("name") as string;
        const hypothesis = formData.get("hypothesis") as string;
        const metric = (formData.get("metric") as string) || "CTR";
        const variantA = formData.get("variantA") as string;
        const variantB = formData.get("variantB") as string;

        if (!name.trim() || !hypothesis.trim()) {
            flash("error", "Name and hypothesis are required.");
            setBusy(false);
            return;
        }

        try {
            await adminFetch<{ id: string }>("/api/growth/experiments/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    hypothesis: hypothesis.trim(),
                    metric,
                    variants: [
                        { id: "A", label: variantA || "Control", settings: {} },
                        { id: "B", label: variantB || "Variant B", settings: {} },
                    ],
                }),
            });
            flash("ok", "Experiment created.");
            setCreateOpen(false);
            experiments.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Could not create experiment.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Experiments"
                subtitle="A/B experiments evaluated by the growth engine from real recorded metrics."
                actions={
                    <>
                        <RefreshButton onRefresh={experiments.refresh} loading={experiments.loading} />
                        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                            <Plus />
                            New experiment
                        </Button>
                    </>
                }
            />

            {notice && <NoticeBanner variant={notice.kind === "ok" ? "success" : "error"}>{notice.text}</NoticeBanner>}

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1 sm:max-w-xs">
                    <FlaskConical size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        aria-label="Search experiments"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search experiments…"
                        className="pl-8"
                    />
                </div>
                <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All statuses</option>
                    {EXPERIMENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </Select>
                <span className="ml-auto text-xs text-muted-foreground">{filtered.length} experiment(s)</span>
            </div>

            {experiments.loading ? (
                <div className="space-y-2" role="status" aria-label="Loading experiments">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14" />
                    ))}
                </div>
            ) : experiments.error ? (
                <ErrorState
                    title="Couldn't load experiments"
                    description={experiments.error}
                    action={<Button type="button" variant="outline" onClick={experiments.refresh}>Retry</Button>}
                />
            ) : !experiments.data || experiments.data.length === 0 ? (
                <EmptyState
                    icon={<FlaskConical size={18} />}
                    title="No experiments yet"
                    description="Create an A/B experiment to test different variants of your campaigns. When results are in, the winning variant is determined from real recorded metrics."
                    action={
                        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                            <Plus />
                            Create experiment
                        </Button>
                    }
                />
            ) : (
                <>
                    <div className="mb-4 flex flex-wrap gap-1.5">
                        {Object.entries(byState).map(([state, count]) => (
                            <span key={state} className="inline-flex items-center gap-1.5 text-xs">
                                <GrowthStatusBadge kind="experiment" value={state} />
                                <span className="text-muted-foreground">{count}</span>
                            </span>
                        ))}
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border">
                        <Table className="min-w-[860px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Metric</TableHead>
                                    <TableHead>State</TableHead>
                                    <TableHead>Period</TableHead>
                                    <TableHead>Variants</TableHead>
                                    <TableHead>Result</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map((e) => (
                                    <TableRow key={e.id || e.name}>
                                        <TableCell>
                                            <span
                                                className="cursor-pointer font-medium text-foreground hover:text-primary"
                                                onClick={() => setDetailOpen(e)}
                                            >
                                                {e.name}
                                            </span>
                                            <br />
                                            {e.hypothesis && <span className="max-w-md truncate text-xs text-muted-foreground">{e.hypothesis}</span>}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{e.metric || "—"}</TableCell>
                                        <TableCell>
                                            <GrowthStatusBadge kind="experiment" value={e.state} />
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {fmtDate(e.startAt)} – {fmtDate(e.endAt)}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {e.variants?.map((v) => v.label).join(" vs ") || "A vs B"}
                                        </TableCell>
                                        <TableCell>
                                            {e.results?.winner ? (
                                                <span className="inline-flex items-center gap-1.5 text-xs">
                                                    {e.results.winner === "INCONCLUSIVE" ? (
                                                        <span className="text-muted-foreground">Inconclusive</span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 font-medium text-positive-foreground">
                                                            <Trophy size={12} /> Variant {e.results.winner} won
                                                        </span>
                                                    )}
                                                    <span className="text-muted-foreground">
                                                        ({fmtNumber(e.results.conversionsA ?? 0)} vs {fmtNumber(e.results.conversionsB ?? 0)} conversions)
                                                    </span>
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger>
                                                    <Button type="button" variant="ghost" size="xs">
                                                        <MoreVertical size={14} />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => setDetailOpen(e)}>
                                                        View details
                                                    </DropdownMenuItem>
                                                    {e.state === "DRAFT" && (
                                                        <DropdownMenuItem onSelect={() => void runAction(e.id || "", "start")}>
                                                            <Play size={14} className="mr-1" /> Start
                                                        </DropdownMenuItem>
                                                    )}
                                                    {e.state === "RUNNING" && (
                                                        <DropdownMenuItem onSelect={() => void runAction(e.id || "", "stop")}>
                                                            <Pause size={14} className="mr-1" /> Stop
                                                        </DropdownMenuItem>
                                                    )}
                                                    {e.state === "COMPLETED" && (
                                                        <DropdownMenuItem onSelect={() => void runAction(e.id || "", "archive")}>
                                                            <Archive size={14} className="mr-1" /> Archive
                                                        </DropdownMenuItem>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="rounded-lg border border-border bg-card p-4">
                        <h2 className="mb-2 text-sm font-medium text-foreground">How winning is determined</h2>
                        <p className="text-xs text-muted-foreground">
                            A winner is declared only when an experiment has at least <b>{EXPERIMENT_MIN_SAMPLE_SIZE}</b> impressions per
                            variant and one variant shows a minimum <b>{EXPERIMENT_MIN_UPLIFT_PCT}%</b> relative uplift. Until
                            both thresholds are met, the result stays <b>INCONCLUSIVE</b>.
                        </p>
                    </div>
                </>
            )}

            {/* Create dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-md md:max-w-xl lg:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Create experiment</DialogTitle>
                        <DialogDescription>
                            Define two variants and let the growth engine evaluate them from real recorded metrics.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <FormField label="Experiment name" htmlFor="exp-name" required>
                            <Input id="exp-name" name="name" placeholder="e.g. Homepage hero A/B test" required disabled={busy} />
                        </FormField>
                        <FormField label="Hypothesis" htmlFor="exp-hypothesis" required description="What change are you testing and why?">
                            <Input id="exp-hypothesis" name="hypothesis" placeholder="Changing the hero headline to X will increase CTR by 10%" required disabled={busy} />
                        </FormField>
                        <FormField label="Target metric" htmlFor="exp-metric">
                            <Select id="exp-metric" name="metric" defaultValue="CTR" disabled={busy}>
                                <option value="CTR">Click-through rate</option>
                                <option value="CVR">Conversion rate</option>
                                <option value="REVENUE">Revenue per visitor</option>
                                <option value="RETENTION">7-day retention</option>
                            </Select>
                        </FormField>
                        <FormField label="Variant A (Control)" htmlFor="exp-variant-a" required>
                            <Input id="exp-variant-a" name="variantA" placeholder="e.g. Current headline" required disabled={busy} />
                        </FormField>
                        <FormField label="Variant B" htmlFor="exp-variant-b" required>
                            <Input id="exp-variant-b" name="variantB" placeholder="e.g. New headline" required disabled={busy} />
                        </FormField>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={busy}>
                                {busy ? "Creating…" : "Create experiment"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Detail dialog */}
            {detailOpen && (
                <ExperimentDetailDialog
                    experiment={detailOpen}
                    open={detailOpen !== null}
                    onClose={() => setDetailOpen(null)}
                    onAction={runAction}
                    busyAction={busyAction}
                />
            )}
        </div>
    );
}

function ExperimentDetailDialog({
    experiment,
    open,
    onClose,
    onAction,
    busyAction,
}: {
    experiment: ExperimentRow;
    open: boolean;
    onClose: () => void;
    onAction: (id: string, action: "start" | "stop" | "archive") => void;
    busyAction: string | null;
}) {
    const variantData = [
        {
            name: experiment.variants?.[0]?.label || "Variant A",
            impressions: experiment.results?.impressionsA || 0,
            conversions: experiment.results?.conversionsA || 0,
            color: "hsl(var(--primary))",
        },
        {
            name: experiment.variants?.[1]?.label || "Variant B",
            impressions: experiment.results?.impressionsB || 0,
            conversions: experiment.results?.conversionsB || 0,
            color: "hsl(var(--chart-2))",
        },
    ];

    const winnerLabel = experiment.results?.winner
        ? experiment.results.winner === "INCONCLUSIVE"
            ? "Inconclusive"
            : `Variant ${experiment.results.winner} won`
        : "No winner yet";

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl md:max-w-4xl lg:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{experiment.name}</DialogTitle>
                    <DialogDescription>{experiment.hypothesis}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <GrowthStatusBadge kind="experiment" value={experiment.state} />
                        <span className="text-xs text-muted-foreground">Metric: {experiment.metric || "CTR"}</span>
                        <span className="text-xs text-muted-foreground">
                            Period: {fmtDate(experiment.startAt)} – {fmtDate(experiment.endAt)}
                        </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded border border-border bg-muted/30 p-2 text-center">
                            <p className="text-xs text-muted-foreground">Total impressions</p>
                            <p className="text-lg font-semibold text-foreground">
                                {fmtNumber((experiment.results?.impressionsA || 0) + (experiment.results?.impressionsB || 0))}
                            </p>
                        </div>
                        <div className="rounded border border-border bg-muted/30 p-2 text-center">
                            <p className="text-xs text-muted-foreground">Total conversions</p>
                            <p className="text-lg font-semibold text-foreground">
                                {fmtNumber((experiment.results?.conversionsA || 0) + (experiment.results?.conversionsB || 0))}
                            </p>
                        </div>
                        <div className="rounded border border-border bg-muted/30 p-2 text-center">
                            <p className="text-xs text-muted-foreground">Winner</p>
                            <p className="text-lg font-semibold text-foreground">{winnerLabel}</p>
                        </div>
                    </div>

                    <div className="h-[200px]">
                        <ResponsiveContainer>
                            <BarChart data={variantData} layout="vertical" margin={{ left: 80 }}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                                <XAxis type="number" tick={{ fontSize: 10 }} />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                                    formatter={(value: unknown) => [fmtNumber(Number(value)), "Value"]}
                                />
                                <Legend />
                                <Bar dataKey="impressions" fill="hsl(var(--accent))" name="Impressions" radius={[0, 4, 4, 0]} />
                                <Bar dataKey="conversions" fill="hsl(var(--primary))" name="Conversions" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        A winner is declared only when each variant has at least {EXPERIMENT_MIN_SAMPLE_SIZE} impressions
                        and one variant shows a minimum {EXPERIMENT_MIN_UPLIFT_PCT}% relative uplift. Until both
                        thresholds are met, the result stays inconclusive.
                    </p>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onClose()} disabled={busyAction !== null}>
                        Close
                    </Button>
                    {experiment.state === "DRAFT" && (
                        <Button
                            type="button"
                            onClick={() => onAction(experiment.id || "", "start")}
                            disabled={busyAction !== null}
                        >
                            <Play size={14} /> Start
                        </Button>
                    )}
                    {experiment.state === "RUNNING" && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onAction(experiment.id || "", "stop")}
                            disabled={busyAction !== null}
                        >
                            <Pause size={14} /> Stop
                        </Button>
                    )}
                    {experiment.state === "COMPLETED" && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onAction(experiment.id || "", "archive")}
                            disabled={busyAction !== null}
                        >
                            <Archive size={14} /> Archive
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
