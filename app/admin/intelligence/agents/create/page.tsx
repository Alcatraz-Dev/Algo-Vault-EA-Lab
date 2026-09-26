"use client";

import { useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, Bot, Plus, Save, ShieldCheck, Zap, Sparkles, Settings2, Layers, Lock, CheckCircle2, AlertTriangle, Terminal,
    ChevronDown, ChevronUp, Info,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { AgentRole, AgentStatus, AgentPermission } from "@/lib/agents/types";

const ROLES: { value: AgentRole; label: string; desc: string }[] = [
    { value: "scout", label: "Market Scout", desc: "Surveys live markets for volatility and opportunity." },
    { value: "context", label: "Market Context", desc: "Aggregates macro and micro market conditions." },
    { value: "strategy-matcher", label: "Strategy Matcher", desc: "Maps market state to trading strategy." },
    { value: "risk", label: "Risk Analyst", desc: "Quantifies exposure and computes drawdown risk." },
    { value: "news", label: "News / Event", desc: "Parses news flow and predicts impact." },
    { value: "pattern-discovery", label: "Pattern Discovery", desc: "Finds hidden patterns in price and volume." },
    { value: "structure", label: "Structure", desc: "Organizes knowledge into structured outputs." },
    { value: "volatility", label: "Volatility", desc: "Tracks momentum and regime changes." },
    { value: "critic", label: "Critic", desc: "Challenges assumptions and detects errors." },
    { value: "verification", label: "Verification", desc: "Validates agent outputs against rules." },
    { value: "synthesis", label: "Synthesis", desc: "Combines multi-agent results into reports." },
    { value: "notification", label: "Notification", desc: "Dispatches alerts via Telegram/Discord." },
    { value: "custom", label: "Custom", desc: "Fully custom agent definition." },
];

const STATUSES: { value: AgentStatus; label: string; color: string }[] = [
    { value: "draft", label: "Draft", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    { value: "testing", label: "Testing", color: "bg-amber-400/10 text-amber-400 border-amber-400/20" },
    { value: "active", label: "Active", color: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" },
    { value: "paused", label: "Paused", color: "bg-blue-400/10 text-blue-300 border-violet-400/20" },
    { value: "deprecated", label: "Deprecated", color: "bg-rose-400/10 text-rose-300 border-rose-400/20" },
];

const PERMISSIONS: { value: AgentPermission; label: string }[] = [
    { value: "market_data", label: "Market Data" },
    { value: "historical_data", label: "Historical Data" },
    { value: "strategy_data", label: "Strategy Data" },
    { value: "trading_history", label: "Trading History" },
    { value: "portfolio_data", label: "Portfolio Data" },
    { value: "risk_data", label: "Risk Data" },
    { value: "news_data", label: "News Data" },
    { value: "ai_analysis", label: "AI Analysis" },
    { value: "notifications", label: "Notifications" },
    { value: "telegram", label: "Telegram" },
    { value: "discord", label: "Discord" },
    { value: "webhook", label: "Webhook" },
];

export default function CreateAgentPage() {
    const [name, setName] = useState("");
    const [desc, setDesc] = useState("");
    const [role, setRole] = useState<AgentRole>("custom");
    const [status, setStatus] = useState<AgentStatus>("draft");
    const [version, setVersion] = useState("1.0.0");
    const [permissions, setPermissions] = useState<AgentPermission[]>(["market_data"]);
    const [outputs, setOutputs] = useState("signal, report, recommendation");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [agentId, setAgentId] = useState("");

    const togglePermission = (p: AgentPermission) => {
        setPermissions((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `agent-${Date.now()}`;
        setAgentId(id);
        setSubmitted(true);
    };

    const roleDef = ROLES.find((r) => r.value === role);

    return (
        <AdminShell title="Create Agent" subtitle="Register a new agent in the Multi-Agent Intelligence Engine.">
            <div className="max-w-2xl">
                <Link href="/admin/intelligence/agents" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mb-4 transition">← Back to agents</Link>

                {submitted ? (
                    <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-900/20 px-8 py-14 text-center shadow-lg shadow-emerald-900/5">
                        <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                            <Bot size={32} className="text-emerald-400" />
                        </div>
                        <h2 className="text-xl font-bold text-emerald-300 tracking-tight">Agent Registered</h2>
                        <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                            <span className="text-emerald-200 font-medium">{name || "New agent"}</span> (ID: <code className="text-[11px] bg-emerald-950/60 px-1 py-0.5 rounded text-emerald-200 font-mono">{agentId}</code>) has been registered as a <span className="text-emerald-200 font-medium">{roleDef?.label}</span>.
                        </p>
                        <div className="mt-6 flex items-center justify-center gap-4 flex-wrap">
                            <Link href={`/admin/intelligence/agents/${agentId}`} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow shadow-emerald-900/20 hover:bg-emerald-600 transition">
                                <Terminal size={14} /> View Agent
                            </Link>
                            <Link href="/admin/intelligence/agents" className="inline-flex items-center gap-2 rounded-2xl border border-border/30 bg-muted px-5 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition">Back to Registry</Link>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Identity Card */}
                        <div className="rounded-3xl border border-border/30 bg-gradient-to-br from-muted/60 to-background p-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="h-1.5 w-8 rounded-full bg-blue-400" />
                                <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-blue-300">Agent Identity</h3>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label htmlFor="name" className="block text-[11px] font-semibold text-muted-foreground mb-1.5">Agent name</label>
                                    <input
                                        id="name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        placeholder="e.g. Volatility Agent"
                                        className="w-full rounded-2xl border border-border/30 bg-background px-4 py-3 text-sm outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 placeholder:text-muted-foreground transition"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="version" className="block text-[11px] font-semibold text-muted-foreground mb-1.5">Version</label>
                                    <input
                                        id="version"
                                        value={version}
                                        onChange={(e) => setVersion(e.target.value)}
                                        placeholder="e.g. 1.0.0"
                                        className="w-full rounded-2xl border border-border/30 bg-background px-4 py-3 text-sm outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 placeholder:text-muted-foreground transition"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label htmlFor="desc" className="block text-[11px] font-semibold text-muted-foreground mb-1.5">Description</label>
                                    <textarea
                                        id="desc"
                                        value={desc}
                                        onChange={(e) => setDesc(e.target.value)}
                                        rows={2}
                                        placeholder="What does this agent do? What domain does it cover?"
                                        className="w-full rounded-2xl border border-border/30 bg-background px-4 py-3 text-sm outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 placeholder:text-muted-foreground resize-none transition"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Role & Status */}
                        <div className="rounded-3xl border border-border/30 bg-gradient-to-br from-muted/60 to-background p-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="h-1.5 w-8 rounded-full bg-blue-400" />
                                <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-blue-300">Configuration</h3>
                            </div>
                            <div className="grid gap-6 md:grid-cols-2">
                                <div>
                                    <label htmlFor="role" className="block text-[11px] font-semibold text-muted-foreground mb-1.5">Agent Role</label>
                                    <div className="relative">
                                        <select
                                            id="role"
                                            value={role}
                                            onChange={(e) => setRole(e.target.value as AgentRole)}
                                            className="w-full rounded-2xl border border-border/30 bg-background px-4 py-3 text-sm outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 appearance-none transition"
                                        >
                                            {ROLES.map((r) => (
                                                <option key={r.value} value={r.value}>{r.label}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                    </div>
                                    {roleDef && (
                                        <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
                                            <Info size={10} className="shrink-0 mt-0.5 text-blue-300" />
                                            {roleDef.desc}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label htmlFor="status" className="block text-[11px] font-semibold text-muted-foreground mb-1.5">Lifecycle Status</label>
                                    <div className="flex gap-2 flex-wrap">
                                        {STATUSES.map((s) => (
                                            <button
                                                key={s.value}
                                                type="button"
                                                onClick={() => setStatus(s.value)}
                                                className={`rounded-xl border px-3 py-2 text-[10px] font-medium transition ${status === s.value ? s.color + " ring-1 ring-blue-500/30" : "bg-muted/40 text-muted-foreground border-border/20 hover:bg-muted/60"}`}
                                            >
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Permissions */}
                        <div className="rounded-3xl border border-border/30 bg-gradient-to-br from-muted/60 to-background p-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="h-1.5 w-8 rounded-full bg-blue-400" />
                                <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-blue-300">Permissions</h3>
                                <span className="ml-auto text-[10px] text-muted-foreground">Select all that apply</span>
                            </div>
                            <div className="grid gap-2 md:grid-cols-3">
                                {PERMISSIONS.map((p) => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        onClick={() => togglePermission(p.value)}
                                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium transition ${permissions.includes(p.value) ? "bg-blue-500/10 border-blue-500/30 text-blue-300" : "bg-muted/40 border-border/20 text-muted-foreground hover:bg-muted/60"}`}
                                    >
                                        <Lock size={10} className={permissions.includes(p.value) ? "text-blue-300" : "text-muted-foreground/50"} />
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Outputs */}
                        <div className="rounded-3xl border border-border/30 bg-gradient-to-br from-muted/60 to-background p-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="h-1.5 w-8 rounded-full bg-blue-400" />
                                <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-blue-300">Outputs</h3>
                            </div>
                            <textarea
                                value={outputs}
                                onChange={(e) => setOutputs(e.target.value)}
                                placeholder="Comma-separated outputs this agent produces"
                                className="w-full rounded-2xl border border-border/30 bg-background px-4 py-3 text-sm outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 placeholder:text-muted-foreground resize-none transition"
                            />
                        </div>

                        {/* Advanced */}
                        <div className="rounded-3xl border border-border/30 bg-gradient-to-br from-muted/60 to-background shadow-sm overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setAdvancedOpen(!advancedOpen)}
                                className="w-full flex items-center justify-between px-6 py-4 text-[11px] font-bold uppercase tracking-[0.15em] text-blue-300 hover:bg-muted/10 transition"
                            >
                                <div className="flex items-center gap-2"><Zap size={12} /> Multi-Agent Setup</div>
                                {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            {advancedOpen && (
                                <div className="px-6 pb-6 pt-2 border-t border-border/20 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-bold uppercase tracking-wide text-blue-300">Pipeline Dependencies</h4>
                                        <span className="text-[10px] text-muted-foreground">Select agents this agent connects to</span>
                                    </div>
                                    <div className="grid gap-2 md:grid-cols-3">
                                        {[
                                            { id: "market-scout", label: "Market Scout", role: "scout" },
                                            { id: "market-context", label: "Market Context", role: "context" },
                                            { id: "risk", label: "Risk Analyst", role: "risk" },
                                            { id: "volatility-agent", label: "Volatility", role: "volatility" },
                                            { id: "news-event", label: "News / Event", role: "news" },
                                        ].map((a) => (
                                            <label key={a.id} className="flex items-center gap-2 rounded-xl border border-border/20 bg-background/80 px-3 py-2.5 text-[10px] hover:bg-muted/30 transition cursor-pointer select-none">
                                                <input type="checkbox" className="accent-blue-500 h-3.5 w-3.5" />
                                                <span className="font-medium text-muted-foreground">{a.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <div className="rounded-2xl border border-blue-500/10 bg-blue-950/30 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
                                        <strong className="text-blue-200">Pipeline logic:</strong> When linked, this agent will feed outputs from its dependencies into its own prompt context. Multi-agent synthesis happens at execution time, not creation time.
                                    </div>
                                    <div className="flex gap-2">
                                        <Link href="/admin/intelligence/sandbox" className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[11px] font-medium text-blue-300 hover:bg-blue-500/15 transition">
                                            <Layers size={12} /> Run Pipeline Test
                                        </Link>
                                        <Link href="/api/agents" className="inline-flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition">
                                            <Terminal size={12} /> View Pipeline API
                                        </Link>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                            <button
                                type="submit"
                                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500/60 to-blue-600/60 px-5 py-2.5 text-xs font-medium text-blue-200/70 shadow-[0_0_8px_rgba(59,130,246,0.15)] ring-1 ring-blue-300/10 hover:text-blue-100 hover:bg-blue-500/40 hover:ring-blue-200/20 transition"
                            >
                                <Plus size={16} /> Create Agent
                            </button>
                            <Link href="/admin/intelligence/agents" className="text-xs text-muted-foreground hover:text-foreground transition">Cancel</Link>
                        </div>
                    </form>
                )}
            </div>
        </AdminShell>
    );
}
