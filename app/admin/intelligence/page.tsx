"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Bot,
    GitBranch,
    Plug,
    Puzzle,
    Play,
    Settings,
    Sparkles,
    Gauge,
    LayoutDashboard,
    ChevronRight,
    Plus,
    Search,
    Filter,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";

const tabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "agents", label: "Agents", icon: Bot, href: "/admin/intelligence/agents" },
    { id: "workflows", label: "Workflows", icon: GitBranch, href: "/admin/intelligence/workflows" },
    { id: "plugins", label: "Plugins", icon: Plug, href: "/admin/intelligence/plugins" },
    { id: "extensions", label: "Extensions", icon: Puzzle, href: "/admin/intelligence/extensions" },
    { id: "executions", label: "Executions", icon: Play, href: "/admin/intelligence/executions" },
    { id: "studio", label: "AI Studio", icon: Sparkles, href: "/admin/intelligence/studio" },
    { id: "usage", label: "AI Usage & Budgets", icon: Gauge, href: "/admin/intelligence/ai-usage" },
    { id: "sandbox", label: "Sandbox", icon: Settings, href: "/admin/intelligence/sandbox" },
];

export default function AdminIntelligencePage() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState("overview");

    return (
        <AdminShell
            title="Intelligence Engine"
            subtitle="Manage agents, workflows, plugins, extensions and the AI Studio."
        >
            <div className="mb-6 flex flex-wrap gap-2">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => {
                            if (tab.href) {
                                router.push(tab.href);
                            } else {
                                setActiveTab(tab.id);
                            }
                        }}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition ${
                            activeTab === tab.id
                                ? "border-border/50 bg-background text-foreground"
                                : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/5"
                        }`}
                    >
                        <tab.icon size={14} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === "overview" && (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                        icon={<Bot size={20} className="text-violet-400" />}
                        value="11"
                        label="Built-in Agents"
                        description="Scout, Context, Strategy, Risk, News, Pattern, Critic, Verification, Synthesis, Notification, Volatility, Structure"
                    />
                    <StatCard
                        icon={<GitBranch size={20} className="text-emerald-400" />}
                        value="3"
                        label="Core Workflows"
                        description="Opportunity Radar, Anomaly Detection, Risk Guardian"
                    />
                    <StatCard
                        icon={<Plug size={20} className="text-cyan-400" />}
                        value="10"
                        label="Intelligence Plugins"
                        description="Strategy DNA, Behavior Intel, Counterfactual Lab, Correlation, Setup Fingerprint, Regime, Opportunity, Anomaly, News Impact, Risk Guardian"
                    />
                    <StatCard
                        icon={<Puzzle size={20} className="text-amber-400" />}
                        value="5"
                        label="Extensions"
                        description="Webhook, Browser, TradingView, Telegram, Discord"
                    />
                </div>
            )}

            {activeTab === "sandbox" && (
                <div className="space-y-4">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                        <h3 className="text-sm font-semibold mb-2">Sandbox Tests</h3>
                        <p className="text-xs text-muted-foreground mb-3">Validate agent outputs and plugin specs in isolated environments before publishing.</p>
                        <div className="flex gap-2">
                            <Link href="/admin/plugins/ai-studio" className="rounded-xl border border-border/30 bg-muted px-3 py-2 text-xs font-medium">Plugin Sandbox</Link>
                            <Link href="/api/agents" className="rounded-xl border border-border/30 bg-muted px-3 py-2 text-xs font-medium">Agents API</Link>
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                        {[{ icon: Bot, label: "Agents", v: "11", d: "Schema / Security / Workflow" },
                          { icon: GitBranch, label: "Workflows", v: "3", d: "Opportunity / Anomaly / Risk" },
                          { icon: Plug, label: "Plugins", v: "10", d: "Strategy / Correlation / Setup" },
                          { icon: Puzzle, label: "Extensions", v: "5", d: "Webhook / Telegram / Discord" }].map((c) => (
                            <div key={c.label} className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                                <c.icon size={18} className="text-violet-400 mb-2" />
                                <p className="text-xl font-semibold">{c.v}</p>
                                <p className="text-xs text-muted-foreground">{c.label}</p>
                                <p className="text-[10px] text-muted-foreground/70 mt-1">{c.d}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab !== "overview" && activeTab !== "sandbox" && (
                <div className="rounded-2xl border border-border/30 bg-muted/50 p-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <LayoutDashboard size={32} className="text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium">Coming Soon</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                        The {tabs.find((t) => t.id === activeTab)?.label} management interface
                        is being built. Use the API endpoints for now.
                    </p>
                    <div className="mt-6 flex items-center justify-center gap-3">
                        <Link
                            href="/api/agents"
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                        >
                            View API
                        </Link>
                        <Link
                            href="/api/plugins"
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                        >
                            Plugin API
                        </Link>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}

function StatCard({
    icon,
    value,
    label,
    description,
}: {
    icon: React.ReactNode;
    value: string | number;
    label: string;
    description: string;
}) {
    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
            <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                    {icon}
                </div>
                <div>
                    <p className="text-3xl font-semibold">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
    );
}