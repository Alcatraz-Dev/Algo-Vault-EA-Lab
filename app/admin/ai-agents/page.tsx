"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Boxes,
    CheckCircle2,
    Copy,
    Loader2,
    Play,
    Plus,
    RotateCcw,
    Search,
    Shield,
    Sparkles,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentAvatar, type AgentVisualState } from "@/components/ai-trading-teams/agent-visual";
import { adminTeamsApi, TeamsApiError } from "@/components/ai-trading-teams/api";
import type { AgentRunOutput, TeamAgentDefinition, TeamDataMode } from "@/lib/ai-trading-teams/types";

/**
 * Admin → AI Agents (Agent Factory) (spec §19/§20).
 *
 * Create / edit / disable / version / clone agents, configure capabilities,
 * tools, instructions, output schema, activation rules and visual identity,
 * plus a sandbox test playground that shows input → tools → evidence → output
 * → latency → validation. Never exposes secrets.
 */

interface AgentRow extends TeamAgentDefinition {
    overridden?: boolean;
}

interface TestResult {
    input: Record<string, unknown>;
    output: AgentRunOutput;
    latencyMs: number;
    provider: string | null;
    model: string | null;
    validation: { status: string; error: string | null; warnings: string[]; demotedObservations: number };
}

type SectionId =
    | "identity"
    | "behavior"
    | "capabilities"
    | "tools"
    | "inputs"
    | "outputs"
    | "activation"
    | "memory"
    | "security"
    | "visual"
    | "testing"
    | "versioning";

const SECTIONS: { id: SectionId; label: string }[] = [
    { id: "identity", label: "Identity" },
    { id: "behavior", label: "Behavior" },
    { id: "capabilities", label: "Capabilities" },
    { id: "tools", label: "Tools" },
    { id: "inputs", label: "Inputs" },
    { id: "outputs", label: "Outputs" },
    { id: "activation", label: "Activation rules" },
    { id: "memory", label: "Memory" },
    { id: "security", label: "Security" },
    { id: "visual", label: "Visual identity" },
    { id: "testing", label: "Testing" },
    { id: "versioning", label: "Versioning" },
];

const TOOL_OPTIONS = [
    "smart_money", "market_structure", "liquidity_map", "regime_classifier", "volatility", "sessions",
    "multi_timeframe", "setup_memory", "research_engine", "backtest_summary", "risk_engine", "account_state",
    "economic_calendar", "news_feed", "strategy_lab", "pattern_stats", "price_action", "technical_indicators",
];
const VISUAL_OPTIONS = [
    "market-pulse", "radar", "analytical-sphere", "signal-node", "liquidity-radar", "event-radar",
    "research-prism", "research-lens", "shield", "contrarian-core", "validation-gate", "chief-core",
];
const CATEGORY_OPTIONS = [
    "regime", "smart-money", "technical", "price-action", "liquidity", "macro",
    "quant", "research", "risk", "contrarian", "validation", "chief",
];

export default function AdminAIAgentsPage() {
    const [agents, setAgents] = useState<AgentRow[]>([]);
    const [versions, setVersions] = useState<(TeamAgentDefinition & { snapshotAt?: number })[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<TeamAgentDefinition | null>(null);
    const [dirty, setDirty] = useState(false);
    const [section, setSection] = useState<SectionId>("identity");
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

    // Test playground state
    const [testPrompt, setTestPrompt] = useState("Analyze XAUUSD M5.");
    const [testMarket, setTestMarket] = useState("XAUUSD");
    const [testMode, setTestMode] = useState<TeamDataMode>("live");
    const [testAsOf, setTestAsOf] = useState("");
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [testing, setTesting] = useState(false);

    const fetchAgents = useCallback(async () => {
        const data = await adminTeamsApi<{ agents: AgentRow[] }>("/ai-agents");
        return data.agents ?? [];
    }, []);

    const load = useCallback(async () => {
        const list = await fetchAgents();
        setAgents(list);
    }, [fetchAgents]);

    useEffect(() => {
        let cancelled = false;
        const bootstrap = async () => {
            try {
                const list = await fetchAgents();
                if (!cancelled) setAgents(list);
            } catch (err) {
                if (!cancelled) {
                    setMessage({ text: err instanceof TeamsApiError ? err.message : "Failed to load agents.", isError: true });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, [fetchAgents]);

    const loadVersions = useCallback(async (agentId: string) => {
        try {
            const data = await adminTeamsApi<{ versions: (TeamAgentDefinition & { snapshotAt?: number })[] }>(
                `/ai-agents/${agentId}`,
            );
            setVersions(data.versions ?? []);
        } catch {
            setVersions([]);
        }
    }, []);

    const selectAgent = useCallback(
        (agent: AgentRow) => {
            setSelectedId(agent.id);
            setDraft({ ...agent });
            setDirty(false);
            setSection("identity");
            setTestResult(null);
            void loadVersions(agent.id);
        },
        [loadVersions],
    );

    const createNew = useCallback(() => {
        setSelectedId(null);
        setVersions([]);
        setDraft({
            id: `agent_${Math.random().toString(36).slice(2, 8)}`,
            name: "New Agent",
            description: "Describe what this agent contributes to the desk.",
            category: "research",
            icon: "Sparkles",
            visualType: "research-lens",
            version: "1.0.0",
            enabled: false,
            builtin: false,
            systemInstructions:
                "You are a specialist agent on a professional trading research desk. Use only the provided dossier, classify every observation and never invent market data.",
            capabilities: [],
            tools: ["market_structure"],
            requiredInputs: [],
            optionalInputs: [],
            outputSchema: [],
            limitations: [],
            activationTags: ["market-analysis"],
            requiredSections: [],
            status: "draft",
            createdAt: Date.now(),
        });
        setDirty(true);
        setSection("identity");
    }, []);

    const update = useCallback((patch: Partial<TeamAgentDefinition>) => {
        setDraft((current) => (current ? { ...current, ...patch } : current));
        setDirty(true);
    }, []);

    const save = useCallback(async () => {
        if (!draft) return;
        setSaving(true);
        setMessage(null);
        try {
            const isNew = !agents.some((a) => a.id === draft.id);
            const payload = {
                ...draft,
                version: isNew ? draft.version : draft.version,
                status: draft.status ?? "active",
                enabled: draft.enabled !== false,
            };
            if (isNew) {
                await adminTeamsApi("/ai-agents", { method: "POST", body: payload });
            } else {
                await adminTeamsApi(`/ai-agents/${draft.id}`, { method: "PATCH", body: payload });
            }
            setMessage({ text: `Saved ${draft.name} (v${payload.version}).`, isError: false });
            setDirty(false);
            await load();
            await loadVersions(draft.id);
        } catch (err) {
            setMessage({ text: err instanceof TeamsApiError ? err.message : "Failed to save agent.", isError: true });
        } finally {
            setSaving(false);
        }
    }, [draft, agents, load, loadVersions]);

    const setStatus = useCallback(
        async (status: TeamAgentDefinition["status"]) => {
            if (!draft) return;
            try {
                await adminTeamsApi(`/ai-agents/${draft.id}`, { method: "PATCH", body: { status } });
                update({ status, enabled: status === "active" });
                await load();
                setMessage({ text: `Agent ${status}.`, isError: false });
            } catch (err) {
                setMessage({ text: err instanceof TeamsApiError ? err.message : "Status update failed.", isError: true });
            }
        },
        [draft, update, load],
    );

    const cloneAgent = useCallback(async () => {
        if (!draft) return;
        try {
            const created = await adminTeamsApi<{ agent: TeamAgentDefinition }>(`/ai-agents/${draft.id}`, {
                method: "PATCH",
                body: { action: "clone", id: `${draft.id}-copy`, name: `${draft.name} (copy)` },
            });
            setMessage({ text: `Cloned to ${created.agent.id}.`, isError: false });
            await load();
            selectAgent({ ...created.agent, overridden: true });
        } catch (err) {
            setMessage({ text: err instanceof TeamsApiError ? err.message : "Clone failed.", isError: true });
        }
    }, [draft, load, selectAgent]);

    const rollback = useCallback(
        async (version: string) => {
            if (!draft) return;
            try {
                await adminTeamsApi(`/ai-agents/${draft.id}`, { method: "PATCH", body: { action: "rollback", version } });
                setMessage({ text: `Rolled back to ${version} (recorded as a new version).`, isError: false });
                await load();
                await loadVersions(draft.id);
            } catch (err) {
                setMessage({ text: err instanceof TeamsApiError ? err.message : "Rollback failed.", isError: true });
            }
        },
        [draft, load, loadVersions],
    );

    const runTest = useCallback(async () => {
        if (!draft) return;
        setTesting(true);
        setTestResult(null);
        setMessage(null);
        try {
            const body: Record<string, unknown> = {
                agentId: draft.id,
                market: testMarket,
                prompt: testPrompt,
                mode: testMode,
            };
            if (testMode !== "live" && testAsOf) body.asOf = Date.parse(testAsOf);
            const result = await adminTeamsApi<TestResult>("/ai-agents/test", { method: "POST", body });
            setTestResult(result);
        } catch (err) {
            setMessage({ text: err instanceof TeamsApiError ? err.message : "Sandbox test failed.", isError: true });
        } finally {
            setTesting(false);
        }
    }, [draft, testMarket, testPrompt, testMode, testAsOf]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return agents;
        return agents.filter(
            (a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.category.includes(q),
        );
    }, [agents, search]);

    const visualState: AgentVisualState = draft?.enabled === false || draft?.status === "disabled" ? "disabled" : "idle";

    return (
        <AdminShell title="AI Agents" subtitle="Agent Factory — identity, behavior, tools, testing and versioning">
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                {/* ── Agent list ─────────────────────────────────────── */}
                <aside className="rounded-xl border border-border/60 bg-card p-3">
                    <SectionHeader
                        title="Registry"
                        icon={<Boxes className="size-4" />}
                        action={
                            <Button size="xs" onClick={createNew}>
                                <Plus className="size-3.5" /> New
                            </Button>
                        }
                    />
                    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-background px-2">
                        <Search className="size-3.5 text-muted-foreground" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search agents…"
                            className="h-8 w-full bg-transparent text-xs outline-none"
                        />
                    </div>
                    {loading ? (
                        <div className="flex justify-center py-8 text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                        </div>
                    ) : (
                        <ul className="mt-2 max-h-[70vh] space-y-1 overflow-y-auto">
                            {filtered.map((agent) => (
                                <li key={agent.id}>
                                    <button
                                        type="button"
                                        onClick={() => selectAgent(agent)}
                                        className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${
                                            selectedId === agent.id
                                                ? "border-primary/50 bg-primary/5"
                                                : "border-transparent hover:bg-muted/40"
                                        }`}
                                    >
                                        <AgentAvatar visualType={agent.visualType} state={agent.enabled === false ? "disabled" : "idle"} size={30} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-xs font-medium">{agent.name}</span>
                                            <span className="block truncate text-[10px] text-muted-foreground">
                                                {agent.category} · v{agent.version}
                                            </span>
                                        </span>
                                        {agent.overridden ? <Badge variant="secondary" className="text-[9px]">admin</Badge> : null}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </aside>

                {/* ── Editor ─────────────────────────────────────────── */}
                <section className="rounded-xl border border-border/60 bg-card p-4">
                    {!draft ? (
                        <EmptyState
                            icon={<Sparkles className="size-5" />}
                            title="Select or create an agent"
                            description="Configure identity, behavior, tools, outputs, activation rules, visual identity, testing and versioning."
                        />
                    ) : (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <AgentAvatar visualType={draft.visualType} state={visualState} size={64} />
                                    <div>
                                        <h2 className="text-base font-bold">{draft.name}</h2>
                                        <p className="text-[11px] text-muted-foreground ">
                                            {draft.id} · v{draft.version} ·{" "}
                                            {draft.builtin ? "built-in" : "admin-managed"}
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            <StatusBadge
                                                tone={draft.status === "active" ? "positive" : draft.status === "disabled" ? "neutral" : "warning"}
                                                label={draft.status ?? "active"}
                                                dot
                                            />
                                            <Badge variant="outline" className="capitalize">{draft.category}</Badge>
                                            {dirty ? <StatusBadge tone="warning" label="unsaved changes" /> : null}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button size="sm" variant="outline" onClick={() => void setStatus("active")}>
                                        <CheckCircle2 className="size-3.5" /> Enable
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => void setStatus("disabled")}>
                                        <Shield className="size-3.5" /> Disable
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => void cloneAgent()}>
                                        <Copy className="size-3.5" /> Clone
                                    </Button>
                                    <Button size="sm" onClick={() => void save()} disabled={saving}>
                                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                                        Save
                                    </Button>
                                </div>
                            </div>

                            {message ? (
                                <p className={`rounded border px-3 py-2 text-xs ${message.isError ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-positive/40 bg-positive/5 text-positive"}`}>
                                    {message.text}
                                </p>
                            ) : null}

                            {/* Section tabs */}
                            <div className="flex flex-wrap gap-1 overflow-x-auto rounded-lg bg-muted p-1">
                                {SECTIONS.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setSection(item.id)}
                                        className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] ${
                                            section === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>

                            <div className="min-h-[320px]">
                                {section === "identity" ? (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <LabeledInput label="Name" value={draft.name} onChange={(v) => update({ name: v })} />
                                        <LabeledInput label="ID (immutable)" value={draft.id} onChange={() => undefined} disabled />
                                        <LabeledInput label="Description" value={draft.description} onChange={(v) => update({ description: v })} />
                                        <LabeledSelect
                                            label="Category"
                                            value={draft.category}
                                            options={CATEGORY_OPTIONS}
                                            onChange={(v) => update({ category: v as TeamAgentDefinition["category"] })}
                                        />
                                        <LabeledInput
                                            label="System instructions"
                                            value={draft.systemInstructions}
                                            onChange={(v) => update({ systemInstructions: v })}
                                            textarea
                                            wide
                                        />
                                    </div>
                                ) : section === "behavior" ? (
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <LabeledInput
                                            label="Temperature"
                                            value={String(draft.temperature ?? 0.2)}
                                            onChange={(v) => update({ temperature: Number(v) })}
                                        />
                                        <LabeledInput
                                            label="Max output tokens"
                                            value={String(draft.maxOutputTokens ?? 1600)}
                                            onChange={(v) => update({ maxOutputTokens: Number(v) })}
                                        />
                                        <LabeledInput
                                            label="Timeout (ms)"
                                            value={String(draft.timeoutMs ?? 30000)}
                                            onChange={(v) => update({ timeoutMs: Number(v) })}
                                        />
                                        <LabeledInput
                                            label="Max retries"
                                            value={String(draft.maxRetries ?? 1)}
                                            onChange={(v) => update({ maxRetries: Number(v) })}
                                        />
                                        <div className="sm:col-span-3 rounded border border-border/60 bg-muted/30 p-3 text-[11px] text-muted-foreground">
                                            The orchestrator enforces wave timeouts, run-level budgets and cooperative
                                            cancellation on top of these per-agent limits. Invalid JSON or failed
                                            validation is retried, then the agent fails structurally — never fakes output.
                                        </div>
                                    </div>
                                ) : section === "capabilities" ? (
                                    <div className="space-y-3">
                                        <LabeledInput
                                            label="Capabilities (comma separated)"
                                            value={draft.capabilities.join(", ")}
                                            onChange={(v) => update({ capabilities: v.split(",").map((c) => c.trim()).filter(Boolean) })}
                                        />
                                        <LabeledInput
                                            label="Declared limitations (one per line)"
                                            value={draft.limitations.join("\n")}
                                            onChange={(v) => update({ limitations: v.split("\n").map((l) => l.trim()).filter(Boolean) })}
                                            textarea
                                        />
                                    </div>
                                ) : section === "tools" ? (
                                    <div className="space-y-2">
                                        <p className="text-[11px] text-muted-foreground">
                                            Only allow-listed tools can be granted. Custom prompts can never expand this set.
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {TOOL_OPTIONS.map((tool) => {
                                                const active = draft.tools.includes(tool as never);
                                                return (
                                                    <button
                                                        key={tool}
                                                        type="button"
                                                        aria-pressed={active}
                                                        onClick={() =>
                                                            update({
                                                                tools: active
                                                                    ? draft.tools.filter((t) => t !== tool)
                                                                    : [...draft.tools, tool as never],
                                                            })
                                                        }
                                                        className={`rounded-full border px-2.5 py-1 text-[10px] ${
                                                            active ? "border-primary/60 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground"
                                                        }`}
                                                    >
                                                        {tool}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : section === "inputs" ? (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <LabeledInput
                                            label="Required inputs (comma separated)"
                                            value={draft.requiredInputs.join(", ")}
                                            onChange={(v) => update({ requiredInputs: v.split(",").map((s) => s.trim()).filter(Boolean) })}
                                        />
                                        <LabeledInput
                                            label="Optional inputs (comma separated)"
                                            value={draft.optionalInputs.join(", ")}
                                            onChange={(v) => update({ optionalInputs: v.split(",").map((s) => s.trim()).filter(Boolean) })}
                                        />
                                    </div>
                                ) : section === "outputs" ? (
                                    <div className="space-y-2">
                                        <p className="text-[11px] text-muted-foreground">
                                            Output contract. Every agent MUST return the shared structured protocol
                                            (summary, observations, evidence, interpretation, stance, confidence,
                                            invalidations, risks, toolsUsed, limitations); this schema declares any
                                            specialty fields on top of it.
                                        </p>
                                        <textarea
                                            rows={10}
                                            value={JSON.stringify(draft.outputSchema, null, 2)}
                                            onChange={(e) => {
                                                try {
                                                    const parsed = JSON.parse(e.target.value);
                                                    if (Array.isArray(parsed)) update({ outputSchema: parsed });
                                                } catch {
                                                    /* live JSON typing — ignore partial documents */
                                                }
                                            }}
                                            className="w-full rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs outline-none focus:border-ring"
                                        />
                                    </div>
                                ) : section === "activation" ? (
                                    <div className="space-y-3">
                                        <LabeledInput
                                            label="Activation tags (comma separated)"
                                            value={draft.activationTags.join(", ")}
                                            onChange={(v) => update({ activationTags: v.split(",").map((s) => s.trim()).filter(Boolean) })}
                                        />
                                        <LabeledInput
                                            label="Required dossier sections (comma separated)"
                                            value={draft.requiredSections.join(", ")}
                                            onChange={(v) => update({ requiredSections: v.split(",").map((s) => s.trim()).filter(Boolean) })}
                                        />
                                        <div className="rounded border border-border/60 bg-muted/30 p-3 text-[11px] text-muted-foreground">
                                            Relevance filtering: agents whose activation tags do not match the request
                                            intents are skipped with a reason — a technical-only question will not wake
                                            every agent.
                                        </div>
                                    </div>
                                ) : section === "memory" ? (
                                    <div className="space-y-2 text-[11px] text-muted-foreground">
                                        <p>
                                            Agents do not hold private conversational memory. Durable learning lives in
                                            structured <strong className="text-foreground">team memory</strong>: preferred
                                            markets/timeframes, validated and rejected setups, research notes and
                                            per-agent performance metadata (runs, success rate, average confidence).
                                        </p>
                                        <p>
                                            Per-agent performance counters are aggregated automatically into
                                            <code className="rounded bg-muted px-1">aiAgentMetrics/{draft.id}</code> and
                                            shown in AI Monitoring.
                                        </p>
                                    </div>
                                ) : section === "security" ? (
                                    <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                                        <li>• Tool access is limited to the allow-list above; no secret or admin tools exist for agents.</li>
                                        <li>• FACT observations without a dossier reference are demoted to UNKNOWN server-side.</li>
                                        <li>• All AI calls run through the platform router (no provider keys are exposed to agents or clients).</li>
                                        <li>• Runs enforce Pro entitlement, ownership, rate limits and per-run budgets server-side.</li>
                                        <li>• Custom (user) agents cannot claim chief status or depend on other custom agents.</li>
                                        <li>• Historical runs preserve the agent version used at execution time.</li>
                                    </ul>
                                ) : section === "visual" ? (
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div className="flex items-center gap-3">
                                            <AgentAvatar visualType={draft.visualType} state="analyzing" size={72} />
                                            <div className="text-[11px] text-muted-foreground">
                                                Live preview
                                                <br />
                                                (state: analyzing)
                                            </div>
                                        </div>
                                        <LabeledSelect
                                            label="Visual type"
                                            value={draft.visualType}
                                            options={VISUAL_OPTIONS}
                                            onChange={(v) => update({ visualType: v as TeamAgentDefinition["visualType"] })}
                                        />
                                        <LabeledInput label="Icon (lucide name)" value={draft.icon} onChange={(v) => update({ icon: v })} />
                                    </div>
                                ) : section === "testing" ? (
                                    <div className="space-y-3">
                                        <div className="grid gap-2 sm:grid-cols-4">
                                            <LabeledInput label="Prompt" value={testPrompt} onChange={setTestPrompt} />
                                            <LabeledInput label="Market" value={testMarket} onChange={setTestMarket} />
                                            <LabeledSelect
                                                label="Mode"
                                                value={testMode}
                                                options={["live", "replay", "backtest", "research"]}
                                                onChange={(v) => setTestMode(v as TeamDataMode)}
                                            />
                                            <LabeledInput
                                                label="As-of (non-live)"
                                                value={testAsOf}
                                                onChange={setTestAsOf}
                                                type="datetime-local"
                                            />
                                        </div>
                                        <Button size="sm" onClick={() => void runTest()} disabled={testing}>
                                            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                                            Run sandbox test
                                        </Button>

                                        {testResult ? (
                                            <div className="grid gap-3 lg:grid-cols-2">
                                                <div className="rounded border border-border/60 bg-muted/20 p-3">
                                                    <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Input</p>
                                                    <pre className="mt-1 max-h-48 overflow-auto text-[10px] whitespace-pre-wrap">
                                                        {JSON.stringify(testResult.input, null, 2)}
                                                    </pre>
                                                    <p className="mt-2 text-[11px] text-muted-foreground">
                                                        Latency {testResult.latencyMs}ms · provider {testResult.provider ?? "—"} · model{" "}
                                                        {testResult.model ?? "—"}
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Validation: {testResult.validation.status}
                                                        {testResult.validation.error ? ` · ${testResult.validation.error}` : ""}
                                                        {testResult.validation.demotedObservations
                                                            ? ` · ${testResult.validation.demotedObservations} demoted to UNKNOWN`
                                                            : ""}
                                                    </p>
                                                    {testResult.validation.warnings.map((warning, i) => (
                                                        <p key={i} className="text-[10px] text-warning">{warning}</p>
                                                    ))}
                                                </div>
                                                <div className="rounded border border-border/60 bg-muted/20 p-3">
                                                    <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Output</p>
                                                    <pre className="mt-1 max-h-72 overflow-auto text-[10px] whitespace-pre-wrap">
                                                        {JSON.stringify(testResult.output, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : section === "versioning" ? (
                                    <div className="space-y-2">
                                        <SectionHeader
                                            title="Version history"
                                            description="Every save snapshots the definition for rollback"
                                            icon={<RotateCcw className="size-4" />}
                                        />
                                        {versions.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">No snapshots yet.</p>
                                        ) : (
                                            <ul className="space-y-1">
                                                {versions.map((version) => (
                                                    <li
                                                        key={`${version.id}-${version.version}`}
                                                        className="flex items-center justify-between gap-2 rounded border border-border/60 px-3 py-2 text-xs"
                                                    >
                                                        <span>
                                                            v{version.version}{" "}
                                                            <span className="text-muted-foreground">
                                                                · {version.snapshotAt ? new Date(version.snapshotAt).toLocaleString() : ""}
                                                            </span>
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            <StatusBadge tone="neutral" label={version.status ?? "active"} />
                                                            <Button size="xs" variant="outline" onClick={() => void rollback(version.version)}>
                                                                Restore
                                                            </Button>
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </AdminShell>
    );
}

function LabeledInput({
    label,
    value,
    onChange,
    textarea,
    wide,
    disabled,
    type = "text",
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    textarea?: boolean;
    wide?: boolean;
    disabled?: boolean;
    type?: string;
}) {
    return (
        <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
            <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
            {textarea ? (
                <textarea
                    rows={5}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-ring disabled:opacity-60"
                />
            ) : (
                <input
                    type={type}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring disabled:opacity-60"
                />
            )}
        </label>
    );
}

function LabeledSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
            >
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </label>
    );
}
