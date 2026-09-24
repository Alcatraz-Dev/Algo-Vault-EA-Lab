"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { PageHeader } from "@/components/ui/page-header";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";

type WorkflowRow = { id: string; name?: string; status?: string; step?: string; createdAt?: number };

export default function GrowthWorkflows() {
    const { data, loading, error, refresh } = useAdminFetch<{ workflows: WorkflowRow[] }>("/api/growth/workflows");
    const [runResult, setRunResult] = useState<{ executionId?: string; status?: string; error?: string } | null>(null);

    async function runWorkflow() {
        const res = await fetch("/api/growth/workflows", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${await (await import("@/components/growth/admin/session")).getGrowthAuthToken().catch(() => "")}` },
            body: JSON.stringify({ topic: "Algorithmic trading education", objective: "awareness", type: "SEO_ARTICLE", tone: "professional" }),
        });
        const json = await res.json();
        setRunResult(json);
        refresh();
    }

    return (
        <div>
            <PageHeader title="Growth Workflows" subtitle="Sequential AI agent pipeline" />
            <div className="mb-4 flex gap-2">
                <button onClick={runWorkflow} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">Run Workflow</button>
                <RefreshButton onRefresh={refresh} loading={loading} />
            </div>
            {runResult && (
                <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
                    Execution: {runResult.executionId} — Status: {runResult.status}
                </div>
            )}
            <div className="space-y-2">
                {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
                {error && <p className="text-xs text-red-600">{error}</p>}
                {data?.workflows?.map((w) => (
                    <div key={w.id} className="rounded-xl border border-border bg-card p-3 text-xs">
                        <div className="font-semibold">{w.name || w.id}</div>
                        <div className="text-muted-foreground">Status: {w.status} | Step: {w.step || "—"} | Created: {w.createdAt ? new Date(w.createdAt).toISOString() : "—"}</div>
                    </div>
                ))}
                {(!loading && (!data?.workflows || data.workflows.length === 0)) && (
                    <p className="text-xs text-muted-foreground">No workflows yet.</p>
                )}
            </div>
        </div>
    );
}