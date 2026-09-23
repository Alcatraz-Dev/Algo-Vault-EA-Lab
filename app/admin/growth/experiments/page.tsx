"use client";

import { useMemo } from "react";
import { FlaskConical, Trophy } from "lucide-react";
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
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtDate, fmtNumber } from "@/components/growth/admin/format";

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
    createdAt?: number;
};

export default function AdminGrowthExperimentsPage() {
    const experiments = useAdminFetch<ExperimentRow[]>("/api/growth/experiments");

    const byState = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const e of experiments.data || []) counts[e.state || "DRAFT"] = (counts[e.state || "DRAFT"] || 0) + 1;
        return counts;
    }, [experiments.data]);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Experiments"
                subtitle="A/B experiments evaluated by the growth engine from real recorded metrics."
                actions={<RefreshButton onRefresh={experiments.refresh} loading={experiments.loading} />}
            />

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
                    description="Experiments are created and evaluated by the growth engine (AI workflows or the API). When one exists, its variants and result appear here — a winner is only shown when the real metrics favour it."
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
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Metric</TableHead>
                                    <TableHead>State</TableHead>
                                    <TableHead>Period</TableHead>
                                    <TableHead>Result</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {experiments.data.map((e) => (
                                    <TableRow key={e.id || e.name}>
                                        <TableCell>
                                            <p className="font-medium text-foreground">{e.name}</p>
                                            {e.hypothesis && <p className="max-w-md truncate text-[11px] text-muted-foreground">{e.hypothesis}</p>}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{e.metric || "—"}</TableCell>
                                        <TableCell>
                                            <GrowthStatusBadge kind="experiment" value={e.state} />
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {fmtDate(e.startAt)} – {fmtDate(e.endAt)}
                                        </TableCell>
                                        <TableCell>
                                            {e.results?.winner ? (
                                                <span className="inline-flex items-center gap-1.5 text-xs">
                                                    {e.results.winner === "INCONCLUSIVE" ? (
                                                        <span className="text-muted-foreground">Inconclusive</span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 font-medium text-success-foreground">
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
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </>
            )}
        </div>
    );
}