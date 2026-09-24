"use client";

import { useState, useEffect } from "react";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { PageHeader } from "@/components/ui/page-header";

export default function LoopPage() {
    const [state, setState] = useState<any>(null);

    async function runScan() {
        const res = await fetch("/api/growth/opportunities");
        const json = await res.json();
        setState(json);
    }

    return (
        <div>
            <PageHeader title="Growth Loop" subtitle="Continuous autonomous growth engine status" />
            <div className="mb-4 flex gap-2">
                <button onClick={runScan} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">Scan Opportunities</button>
                <RefreshButton onRefresh={runScan} loading={false} />
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-xs">
                <p>Policy mode: <span className="font-semibold">APPROVAL (default)</span> — autonomous execution requires approved policy.</p>
                <p>Pipeline stages: Research → Content → SEO → Social → Compliance → Campaign → Publisher → Analytics → Optimization → Report</p>
                <p>Detection sources: real content, events, revenue, placements, metrics only. No simulated data.</p>
            </div>
        </div>
    );
}