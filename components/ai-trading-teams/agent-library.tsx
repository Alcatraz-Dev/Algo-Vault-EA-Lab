"use client";

import { useCallback, useState } from "react";
import { Bot, Info, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader } from "@/components/ui/section-header";
import { AgentAvatar } from "./agent-visual";
import { teamsApi, TeamsApiError } from "./api";
import type { TeamAgentDefinition } from "@/lib/ai-trading-teams/types";

/**
 * AgentLibrary — browse the shared agent library and (when permitted) create
 * user-defined custom agents inside strict capability boundaries.
 */
export function AgentLibrary({
    agents,
    canCreateCustom,
    onAgentCreated,
}: {
    agents: TeamAgentDefinition[];
    canCreateCustom: boolean;
    onAgentCreated?: () => void;
}) {
    const [creating, setCreating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        name: "",
        description: "",
        category: "research",
        systemInstructions: "",
        tools: ["market_structure"] as string[],
        activationTags: "setup-validation,research",
    });

    const createCustomAgent = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            await teamsApi("/agents", {
                method: "POST",
                body: {
                    name: form.name,
                    description: form.description,
                    category: form.category,
                    visualType: "research-lens",
                    systemInstructions: form.systemInstructions,
                    tools: form.tools,
                    activationTags: form.activationTags.split(",").map((t) => t.trim()).filter(Boolean),
                    limitations: ["Custom agent: runs inside the shared evidence protocol and tool allow-list."],
                },
            });
            setCreating(false);
            setForm({ name: "", description: "", category: "research", systemInstructions: "", tools: ["market_structure"], activationTags: "setup-validation,research" });
            onAgentCreated?.();
        } catch (err) {
            setError(err instanceof TeamsApiError ? err.message : "Failed to create agent.");
        } finally {
            setSaving(false);
        }
    }, [form, onAgentCreated]);

    return (
        <div className="space-y-4">
            <SectionHeader
                title="Agent library"
                description="Specialized instruments of the trading research desk"
                icon={<Bot className="size-4" />}
                action={
                    canCreateCustom ? (
                        <Button size="xs" variant="outline" onClick={() => setCreating((v) => !v)}>
                            <Plus className="size-3.5" /> New custom agent
                        </Button>
                    ) : undefined
                }
            />

            {creating ? (
                <div className="rounded-lg border border-border/60 bg-card/60 p-4">
                    <p className="text-xs text-muted-foreground">
                        Custom agents run inside strict capability boundaries: server-side auth, tool allow-list,
                        output validation and the shared evidence protocol. Prompts cannot grant extra permissions.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label="Name">
                            <input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Fibonacci Specialist"
                                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                            />
                        </Field>
                        <Field label="Category">
                            <select
                                value={form.category}
                                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                            >
                                {["regime", "smart-money", "technical", "price-action", "liquidity", "macro", "quant", "research", "risk", "contrarian", "validation"].map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Description">
                            <input
                                value={form.description}
                                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder="What this agent contributes to the desk"
                                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                            />
                        </Field>
                        <Field label="Activation tags (comma separated)">
                            <input
                                value={form.activationTags}
                                onChange={(e) => setForm((f) => ({ ...f, activationTags: e.target.value }))}
                                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
                            />
                        </Field>
                        <Field label="System instructions" wide>
                            <textarea
                                value={form.systemInstructions}
                                onChange={(e) => setForm((f) => ({ ...f, systemInstructions: e.target.value }))}
                                rows={4}
                                placeholder="You are a Fibonacci Specialist. Use only the provided dossier…"
                                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-ring"
                            />
                        </Field>
                        <Field label="Tools (allow-list)" wide>
                            <div className="flex flex-wrap gap-1.5">
                                {["market_structure", "smart_money", "liquidity_map", "technical_indicators", "volatility", "setup_memory", "research_engine", "pattern_stats", "price_action", "sessions", "multi_timeframe", "regime_classifier"].map((tool) => {
                                    const active = form.tools.includes(tool);
                                    return (
                                        <button
                                            key={tool}
                                            type="button"
                                            onClick={() =>
                                                setForm((f) => ({
                                                    ...f,
                                                    tools: active ? f.tools.filter((t) => t !== tool) : [...f.tools, tool],
                                                }))
                                            }
                                            aria-pressed={active}
                                            className={`rounded-full border px-2.5 py-1 text-micro transition-colors ${active ? "border-primary/60 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground"}`}
                                        >
                                            {tool}
                                        </button>
                                    );
                                })}
                            </div>
                        </Field>
                    </div>
                    {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
                    <div className="mt-3 flex items-center gap-2">
                        <Button size="sm" onClick={() => void createCustomAgent()} disabled={saving || form.name.length < 3 || form.systemInstructions.length < 20}>
                            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                            Create agent
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
                        <span className="inline-flex items-center gap-1 text-micro text-muted-foreground">
                            <ShieldCheck className="size-3" /> validated server-side
                        </span>
                    </div>
                </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => (
                    <article key={agent.id} className="flex gap-3 rounded-lg border border-border/60 bg-card/60 p-3.5">
                        <AgentAvatar visualType={agent.visualType} state="idle" size={52} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold">{agent.name}</p>
                                    <p className="text-micro text-muted-foreground">{agent.category} · v{agent.version}</p>
                                </div>
                                <StatusBadge
                                    tone={agent.enabled === false ? "neutral" : agent.builtin ? "info" : "active"}
                                    label={agent.enabled === false ? "disabled" : agent.builtin ? "built-in" : "custom"}
                                />
                            </div>
                            <p className="mt-1 line-clamp-2 text-micro leading-snug text-muted-foreground">{agent.description}</p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                                {agent.tools.slice(0, 4).map((tool) => (
                                    <Badge key={tool} variant="outline" className="text-micro">{tool}</Badge>
                                ))}
                                {agent.tools.length > 4 ? (
                                    <Badge variant="outline" className="text-micro">+{agent.tools.length - 4}</Badge>
                                ) : null}
                            </div>
                        </div>
                    </article>
                ))}
            </div>

            <p className="flex items-start gap-1.5 text-micro text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Agents interpret deterministic AlgoVault intelligence — they never replace the Smart Money, regime,
                volatility and research engines, and they cannot present uncited claims as verified market facts.
            </p>
        </div>
    );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
            <span className="mb-1 block text-micro text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}
