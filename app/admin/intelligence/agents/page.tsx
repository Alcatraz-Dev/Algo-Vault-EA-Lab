"use client";

import { useState } from "react";
import Link from "next/link";
import {
    Bot,
    Sparkles,
    Play,
    FileText,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Trash2,
    Copy,
    Edit,
    ChevronDown,
    ChevronUp,
    Search,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";
import { useEffect } from "react";
import { AgentContract, AgentRole, AgentStatus } from "@/lib/agents/types";
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
    custom: "Custom",
};

const STATUS_TONES: Record<AgentStatus, "positive" | "negative" | "info" | "warning" | "expired" | "connected"> = {
    draft: "info",
    testing: "warning",
    active: "positive",
    paused: "warning",
    disabled: "negative",
    deprecated: "expired",
};

export default function AdminAgentsPage() {
    const [agents, setAgents] = useState<AgentContract[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [filterRole, setFilterRole] = useState<string>("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        const agentsRef = ref(database, "agents");
        const unsubscribe = onValue(
            agentsRef,
            (snapshot) => {
                const data = snapshot.val() as Record<string, AgentContract> | null;
                if (!data) {
                    // The RTDB "agents" node is empty. Fall back to the built-in agent contracts so the interface never shows an empty list.
                    setAgents(BUILT_IN_AGENTS.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
                    setLoading(false);
                    return;
                }
                const list = Object.values(data).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                setAgents(list);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsubscribe();
    }, []);

    const filtered = agents.filter((a) => {
        const matchesSearch = !search ||
            a.name?.toLowerCase().includes(search.toLowerCase()) ||
            a.description?.toLowerCase().includes(search.toLowerCase()) ||
            a.id?.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = filterStatus === "all" || a.status === filterStatus;
        const matchesRole = filterRole === "all" || a.role === filterRole;
        return matchesSearch && matchesStatus && matchesRole;
    });

    const roles = [...new Set(agents.map((a) => a.role).filter(Boolean))] as AgentRole[];

    return (
        <AdminShell
            title="Agent Registry"
            subtitle="Manage all agents in the Multi-Agent Intelligence Engine."
        >
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full max-w-md">
                    <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search agents..."
                        className="w-full rounded-xl border border-border/30 bg-muted py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Link href="/admin/intelligence/agents/create" className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-500/15 px-3 py-2.5 text-xs font-bold text-blue-200 transition hover:text-white hover:bg-blue-500/25 shadow-[0_0_12px_rgba(59,130,246,0.12)]">
                        <Bot size={14} /> Create New Agent
                    </Link>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs outline-none"
                    >
                        <option value="all">All Statuses</option>
                        {(["draft", "testing", "active", "paused", "disabled", "deprecated"] as AgentStatus[]).map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <select
                        value={filterRole}
                        onChange={(e) => setFilterRole(e.target.value)}
                        className="rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs outline-none"
                    >
                        <option value="all">All Roles</option>
                        {roles.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                        ))}
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-40 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/30 bg-muted/50 px-6 py-20 text-center">
                    <Bot size={40} className="mx-auto text-muted-foreground" />
                    <h3 className="mt-3 text-lg font-medium">No agents found</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters or search query.</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((agent) => (
                        <AgentCard
                            key={agent.id}
                            agent={agent}
                            isExpanded={expanded === agent.id}
                            onToggle={() => setExpanded(expanded === agent.id ? null : agent.id)}
                        />
                    ))}
                </div>
            )}
        </AdminShell>
    );
}

function AgentCard({
    agent,
    isExpanded,
    onToggle,
}: {
    agent: AgentContract;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const isBuiltIn = !agent.createdBy || agent.createdBy === "admin";

    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden transition hover:border-border/50">
            <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                            <Bot size={20} className="text-blue-300/60" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <Link
                                    href={`/admin/intelligence/agents/${agent.id}`}
                                    className="text-sm font-semibold text-foreground transition hover:text-blue-300 truncate"
                                >
                                    {agent.name}
                                </Link>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-300">
                                    {ROLE_LABELS[agent.role] || agent.role}
                                </span>
                                {isBuiltIn && (
                                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                                        Built-in
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 max-w-xl text-xs text-muted-foreground truncate">{agent.description}</p>
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>v{agent.version}</span>
                                <span className="text-muted-foreground/30">•</span>
                                <StatusBadge tone={STATUS_TONES[agent.status]} label={agent.status} />
                                <span className="text-muted-foreground/30">•</span>
                                <span>Timeout: {Math.round((agent.timeoutMs || 0) / 1000)}s</span>
                                <span className="text-muted-foreground/30">•</span>
                                <span>Model: {agent.modelConfiguration?.model || "deterministic"}</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onToggle}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5 transition hover:bg-muted/10"
                    >
                        {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                    </button>
                </div>

                {isExpanded && (
                    <div className="mt-4 rounded-xl border border-border/30 bg-muted/30 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                            <DetailRow label="ID" value={agent.id} copyable />
                            <DetailRow label="Created" value={agent.createdAt ? new Date(agent.createdAt).toLocaleString() : "—"} />
                            <DetailRow label="Updated" value={agent.updatedAt ? new Date(agent.updatedAt).toLocaleString() : "—"} />
                            <DetailRow label="Created By" value={agent.createdBy || "admin"} />
                            <DetailRow
                                label="Permissions"
                                value={agent.requiredPermissions?.join(", ") || "none"}
                            />
                            <DetailRow
                                label="Capabilities"
                                value={agent.capabilities?.join(", ") || "none"}
                            />
                            <DetailRow
                                label="Tools"
                                value={agent.tools?.join(", ") || "none"}
                            />
                            <DetailRow
                                label="Validation"
                                value={`Fail on error: ${agent.validationRules?.failOnError ? "yes" : "no"}, Min confidence: ${agent.validationRules?.minConfidence || 0}`}
                            />
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <Link
                                href={`/admin/intelligence/agents/${agent.id}`}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                            >
                                <Edit size={13} />
                                Edit
                            </Link>
                            <Link
                                href={`/api/agents/${agent.id}`}
                                target="_blank"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                            >
                                <Copy size={13} />
                                Copy API
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function DetailRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
            <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background/50 px-2 py-1 rounded text-foreground break-all">{value}</code>
                {copyable && (
                    <button
                        onClick={() => navigator.clipboard.writeText(value)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/5 transition hover:bg-muted/10"
                        title="Copy"
                    >
                        <Copy size={12} className="text-muted-foreground" />
                    </button>
                )}
            </div>
        </div>
    );
}