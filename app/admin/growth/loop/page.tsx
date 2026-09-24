"use client";

import { useMemo, useState } from "react";
import { Activity, RefreshCw, ScanSearch, ShieldCheck, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { NoticeBanner } from "@/components/growth/admin/NoticeBanner";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { fmtRelative } from "@/components/growth/admin/format";
import type { GrowthOpportunity } from "@/lib/growth/opportunities/types";

/**
 * The growth loop runs detect → qualify → decide → execute pipeline →
 * measure → optimize, sequentially, against REAL stored data only. Policy
 * mode is enforced server-side by the loop runner (lib/growth/loop/runner.ts);
 * the client only ever reads the results — it never simulates or fabricates.
 */
const PIPELINE_STAGES = [
    "Research",
    "Content",
    "SEO",
    "Social",
    "Compliance",
    "Campaign",
    "Publisher",
    "Analytics",
    "Optimization",
    "Report",
];

/** Server-enforced default policy (lib/growth/policies/types.ts). */
const POLICY_FACTS = [
    { label: "Mode", value: "APPROVAL (server-enforced)" },
    { label: "Max runs / day", value: "3" },
    { label: "Compliance gate", value: "Required before publish" },
    { label: "Auto-publish", value: "Disabled" },
    { label: "Auto campaign creation", value: "Enabled" },
    { label: "Cooldown (dedup)", value: "24h" },
];

type ScanResponse = {
    opportunities: GrowthOpportunity[];
    feedback?: { analyticsAvailable?: boolean; unavailableSources?: string[] };
    count?: number;
    source?: string;
};

export default function LoopPage() {
    const { data, loading, error, refresh } = useAdminFetch<ScanResponse>("/api/growth/opportunities");
    const [scanning, setScanning] = useState(false);
    const [scannedAt, setScannedAt] = useState<number | null>(null);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 6000);
    };

    const runScan = async () => {
        if (scanning) return;
        setScanning(true);
        try {
            const result = await adminFetch<ScanResponse>("/api/growth/opportunities");
            setScannedAt(Date.now());
            flash("ok", `Scan complete — ${result.count ?? result.opportunities.length} opportunity(ies) detected from stored data.`);
            refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Scan failed.");
        } finally {
            setScanning(false);
        }
    };

    const opportunityCount = useMemo(() => data?.count ?? data?.opportunities?.length ?? 0, [data]);
    const activeCount = useMemo(
        () => (data?.opportunities || []).filter((o) => o.status === "RUNNING" || o.status === "QUEUED").length,
        [data]
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Growth Loop"
                subtitle="Continuous autonomous growth engine — status, policy and the real data it scans."
                actions={
                    <>
                        <RefreshButton onRefresh={refresh} loading={loading} />
                        <Button type="button" size="sm" disabled={scanning} onClick={() => void runScan()}>
                            {scanning ? <><RefreshCw className="animate-spin" /> Scanning…</> : <><ScanSearch /> Scan opportunities</>}
                        </Button>
                    </>
                }
            />

            {notice && <NoticeBanner variant={notice.kind === "ok" ? "success" : "error"}>{notice.text}</NoticeBanner>}

            {/* Live scan stats */}
            {loading && !data ? (
                <div className="grid gap-4 sm:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-24" />
                    ))}
                </div>
            ) : error ? (
                <ErrorState
                    title="Couldn't reach the engine"
                    description={error}
                    action={<Button type="button" variant="outline" onClick={refresh}>Retry</Button>}
                />
            ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg border border-border bg-card p-4">
                        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            <Activity size={10} /> Detected opportunities
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">{opportunityCount}</p>
                        <p className="text-xs text-muted-foreground">
                            {activeCount > 0 ? `${activeCount} active/queued` : "none in flight"} · last scan{" "}
                            {scannedAt ? fmtRelative(scannedAt) : "—"}
                        </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4">
                        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            <ShieldCheck size={10} /> Policy mode
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">APPROVAL</p>
                        <p className="text-xs text-muted-foreground">default, enforced server-side by the loop runner</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4">
                        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            <WorkflowIcon size={10} /> Detection source
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">Stored data</p>
                        <p className="text-xs text-muted-foreground">
                            content · events · placements · revenue · metrics{data?.feedback?.analyticsAvailable === false ? " · (some sources unavailable)" : ""}
                        </p>
                    </div>
                </div>
            )}

            {/* Policy details */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-medium text-foreground">Current policy</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {POLICY_FACTS.map((f) => (
                        <div key={f.label} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                            <p className="text-sm font-medium text-foreground">{f.value}</p>
                        </div>
                    ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                    The loop never executes autonomously beyond what the policy allows: every publish requires compliance to pass, approval-mode
                    decisions go through the approvals queue, and opportunities in cooldown are skipped.
                </p>
            </div>

            {/* Pipeline */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                    <WorkflowIcon size={14} className="text-muted-foreground" />
                    Loop pipeline
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">
                    Runs sequentially: detect → qualify → decide → pipeline → measure → optimize.
                </p>
                <ol className="flex flex-wrap gap-1.5">
                    {PIPELINE_STAGES.map((label, i) => (
                        <li key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {i > 0 && <span aria-hidden className="text-muted-foreground/50">→</span>}
                            <span className="rounded border border-border bg-muted/40 px-2 py-0.5">{label}</span>
                        </li>
                    ))}
                </ol>
            </div>

            {/* Latest detected opportunities */}
            {!loading && !error && (data?.opportunities || []).length > 0 && (
                <div>
                    <h2 className="mb-2 text-sm font-medium text-foreground">Latest detections</h2>
                    <div className="space-y-2">
                        {(data?.opportunities || []).slice(0, 5).map((o) => (
                            <div key={o.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-foreground">{o.title}</p>
                                    <p className="truncate text-muted-foreground">{o.recommendedAction}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                                    <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs">{o.status}</span>
                                    <span className="text-xs">{o.confidence !== null && o.confidence !== undefined ? `${Math.round(o.confidence * 100)}%` : "N/A"}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!loading && !error && (data?.opportunities || []).length === 0 && (
                <EmptyState
                    icon={<ScanSearch size={18} />}
                    title="No opportunities in the current scan"
                    description="When stored content, events, placements or metrics change, the loop detects new opportunities. Press Scan opportunities to re-run detection."
                />
            )}
        </div>
    );
}