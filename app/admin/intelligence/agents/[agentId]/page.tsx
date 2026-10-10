"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, ShieldCheck, CheckCircle2, AlertCircle, Terminal, Settings, Trash2, Edit } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { AgentStatus, AgentRole } from "@/lib/agents/types";
import { BUILT_IN_AGENTS } from "@/lib/agents/catalog";

const ROLE_LABELS: Record<AgentRole, string> = {
    scout: "Market Scout",
    context: "Market Context",
    "strategy-matcher": "Strategy Matcher",
    risk: "Risk Analyst",
    news: "News / Event",
    "pattern-discovery": "Pattern Discovery",
    structure: "Structure",
    volatility: "Volatility",
    critic: "Critic",
    verification: "Verification",
    synthesis: "Synthesis",
    notification: "Notification",
    "cross-asset": "Cross-Asset",
    supervisor: "Supervisor",
    custom: "Custom",
};

/**
 * Page-local projection of an AgentContract: this detail view only renders
 * identity, status, permissions and declared outputs (the full contract is
 * intentionally not leaked into the UI model).
 */
type AgentView = {
    id: string;
    name: string;
    role: AgentRole;
    version: string;
    description: string;
    status: AgentStatus;
    permissions: string[];
    outputs: string[];
};

export default function AgentDetailPage() {
    const params = useParams<{ agentId: string }>();
    const agentId = params?.agentId || "";
    const [agent, setAgent] = useState<AgentView | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const contract = BUILT_IN_AGENTS.find((a) => a.id === agentId);
        if (contract) {
            setAgent({
                id: contract.id,
                name: contract.name,
                role: contract.role,
                version: contract.version,
                description: contract.description,
                status: contract.status || "active",
                permissions: contract.requiredPermissions.length > 0 ? contract.requiredPermissions : ["market_data"],
                outputs: contract.outputSchema && Object.keys(contract.outputSchema).length > 0 ? Object.keys(contract.outputSchema) : ["findings"],
            });
            setLoading(false);
            return;
        }
        // If not a built-in, try to resolve from runtime state (stub for now).
        setAgent({
            id: agentId,
            name: agentId.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
            role: "custom" as AgentRole,
            version: "0.0.1",
            description: "Custom agent.",
            status: "draft" as AgentStatus,
            permissions: ["market_data", "historical_data"],
            outputs: ["signal", "report"],
        });
        setLoading(false);
    }, [agentId]);

    if (loading) {
        return (
            <AdminShell title="Agent Registry" subtitle="Loading agent details...">
                <div className="h-40 animate-pulse rounded-lg border border-border/30 bg-muted/50" />
            </AdminShell>
        );
    }

    if (!agent) {
        return (
            <AdminShell title="Agent Registry" subtitle="Agent not found">
                <div className="rounded-lg border border-border/30 bg-muted/50 px-6 py-12 text-center">
                    <Bot size={28} className="mx-auto text-muted-foreground mb-3" />
                    <h3 className="text-sm font-medium">Agent not found</h3>
                    <p className="mt-1 text-micro text-muted-foreground">No contract or execution record matches <code className="text-micro bg-muted px-1 rounded">{agentId}</code>.</p>
                    <Link href="/admin/intelligence/agents" className="mt-4 inline-block text-xs text-primary hover:underline">Back to agents</Link>
                </div>
            </AdminShell>
        );
    }

    return (
        <AdminShell title={agent.name} subtitle={ROLE_LABELS[agent.role] || agent.role}>
            <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                    <Link href="/admin/intelligence/agents" className="inline-flex items-center gap-1 text-micro text-muted-foreground hover:text-foreground transition">
                        <ArrowLeft size={14} /> Back to agents
                    </Link>
                </div>

                <div className="rounded-lg border border-border/30 bg-muted/50 p-5">
                    <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/5">
                            <Bot size={24} className="text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-base font-semibold">{agent.name}</h2>
                                <StatusBadge tone={agent.status === "active" ? "positive" : agent.status === "draft" ? "info" : agent.status === "testing" ? "warning" : agent.status === "deprecated" ? "expired" : "negative"} label={agent.status} />
                                <span className="text-micro font-medium text-primary uppercase tracking-wide">v{agent.version}</span>
                            </div>
                            <p className="mt-1 text-micro text-muted-foreground">{agent.description}</p>
                            <p className="mt-1 text-micro text-muted-foreground">Agent ID: <span className="font-numeric">{agent.id}</span></p>
                        </div>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border/30 bg-muted/50 p-5">
                        <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-3">Permissions</h3>
                        <div className="flex flex-wrap gap-1.5">
                            {(agent.permissions || []).map((p) => (
                                <span key={p} className="rounded-md border border-border/20 bg-muted/70 px-2 py-[2px] text-micro font-medium text-muted-foreground">{p}</span>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-lg border border-border/30 bg-muted/50 p-5">
                        <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-3">Outputs</h3>
                        {agent.outputs && (agent.outputs || []).length > 0 ? (
                            <ul className="space-y-1 text-micro">
                                {(agent.outputs || []).map((o) => (
                                    <li key={o} className="flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 size={10} className="text-positive shrink-0" />{o}</li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-micro text-muted-foreground">No declared outputs.</p>
                        )}
                    </div>
                </div>

                <div className="rounded-lg border border-border/30 bg-muted/50 p-5">
                    <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-3">Actions</h3>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => alert(`Sandbox test for agent: ${agent.id}`)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                        >
                            <ShieldCheck size={12} /> Sandbox Test
                        </button>
                        <Link href="/admin/plugins/ai-studio" className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground">
                            <Edit size={12} /> Edit Plugin
                        </Link>
                        <Link href="/api/agents" className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground">
                            <Terminal size={12} /> View API
                        </Link>
                    </div>
                </div>
            </div>
        </AdminShell>
    );
}
