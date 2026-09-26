"use client";

import { useState } from "react";
import Link from "next/link";
import { FlaskConical, Play, CheckCircle2, ShieldCheck, Terminal } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";

export default function AdminSandboxPage() {
    const [busy, setBusy] = useState<string | null>(null);

    return (
        <AdminShell
            title="Sandbox"
            subtitle="Test agent outputs and plugin specs in isolated environments before publishing."
        >
            <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2 rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                        Sandbox Tests
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Every plugin and agent runs through a sandbox before it reaches
                        production. Validate schemas, permissions, security and workflow
                        outputs here.
                    </p>
                    <div className="flex items-center gap-3">
                        <a
                            href="/admin/plugins/ai-studio"
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs font-medium transition hover:text-foreground"
                        >
                            <FlaskConical size={14} /> Plugin Sandbox
                        </a>
                        <a
                            href="/api/agents"
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs font-medium transition hover:text-foreground"
                        >
                            <Terminal size={14} /> Agents API
                        </a>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                        Status
                    </h3>
                    <div className="space-y-2.5 text-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Sandbox mode</span>
                            <StatusBadge status="ok">Active</StatusBadge>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Schema check</span>
                            <span className="font-mono text-emerald-400">PASS</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Permissions</span>
                            <span className="font-mono text-emerald-400">PASS</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Security</span>
                            <span className="font-mono text-emerald-400">PASS</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Workflow</span>
                            <span className="font-mono text-amber-400">PENDING</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-4 rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h3 className="text-sm font-semibold mb-3">Agent Sandbox Results</h3>
                <table className="w-full text-xs">
                    <thead className="text-muted-foreground uppercase tracking-wide">
                        <tr><th className="text-left pb-2">Agent</th><th className="text-left pb-2">Schema</th><th className="text-left pb-2">Security</th><th className="text-left pb-2">Workflow</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border/10">
                        {[
                            { name: "Scout", schema: "PASS", sec: "PASS", wf: "PASS" },
                            { name: "Context", schema: "PASS", sec: "PASS", wf: "PASS" },
                            { name: "Strategy", schema: "PASS", sec: "PASS", wf: "PENDING" },
                        ].map((a) => (
                            <tr key={a.name}>
                                <td className="py-2 font-medium">{a.name}</td>
                                <td className="py-2 text-emerald-400">{a.schema}</td>
                                <td className="py-2 text-emerald-400">{a.sec}</td>
                                <td className="py-2 text-amber-400">{a.wf}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </AdminShell>
    );
}
