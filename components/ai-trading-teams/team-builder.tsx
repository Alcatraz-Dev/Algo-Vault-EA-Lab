"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    Loader2,
    Sparkles,
    Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { AgentAvatar, AgentStateDot } from "./agent-visual";
import { teamsApi, TeamsApiError } from "./api";
import type { TeamAgentDefinition, TeamConfig, TeamTemplate } from "@/lib/ai-trading-teams/types";

/**
 * TeamBuilder — premium guided setup (spec §5) + natural-language creation
 * (spec §6). NL output is validated server-side against the same schema as
 * manual configuration; nothing is stored blindly.
 */

const MARKETS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "NAS100", "US30", "SPX500"];
const STYLES = [
    { value: "scalping", label: "Scalping", hint: "Quick, M1–M15 entries" },
    { value: "intraday", label: "Intraday", hint: "Session-based, same-day" },
    { value: "swing", label: "Swing", hint: "Multi-day structure" },
    { value: "position", label: "Position", hint: "Macro-driven, long horizon" },
    { value: "research", label: "Research", hint: "No trade bias, pure research" },
] as const;
const TIMEFRAMES = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];
const RISK_PROFILES = [
    { value: "conservative", label: "Conservative", hint: "Tight invalidation, high evidence bar" },
    { value: "balanced", label: "Balanced", hint: "Standard evidence requirements" },
    { value: "aggressive", label: "Aggressive", hint: "Wider risk, accepts lower evidence" },
] as const;
const BEHAVIORS = [
    { value: "consensus", label: "Consensus", hint: "Weight agents equally, require agreement" },
    { value: "evidence-weighted", label: "Evidence weighted", hint: "Follow the strongest evidence chain" },
    { value: "risk-first", label: "Risk first", hint: "Risk Manager must validate before final" },
    { value: "research-first", label: "Research first", hint: "Quant/research validation required" },
] as const;

const STEPS = ["Market", "Style", "Timeframes", "Risk", "Agents", "Behavior", "Generate"];

export function TeamBuilder({
    agents,
    templates,
    onCreated,
}: {
    agents: TeamAgentDefinition[];
    templates: TeamTemplate[];
    onCreated?: (teamId: string) => void;
}) {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [nlPrompt, setNlPrompt] = useState("");
    const [parsing, setParsing] = useState(false);
    const [nlError, setNlError] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [market, setMarket] = useState("XAUUSD");
    const [style, setStyle] = useState<string>("scalping");
    const [entryTimeframe, setEntryTimeframe] = useState("M5");
    const [confirmationTimeframe, setConfirmationTimeframe] = useState("M15");
    const [contextTimeframe, setContextTimeframe] = useState("H1");
    const [riskProfile, setRiskProfile] = useState<string>("balanced");
    const [behavior, setBehavior] = useState<string>("risk-first");
    const [selectedIds, setSelectedIds] = useState<string[]>([
        "market-regime",
        "smart-money",
        "technical-analyst",
        "liquidity",
        "quant-research",
        "risk-manager",
        "contrarian",
        "chief-analyst",
    ]);
    const [templateId, setTemplateId] = useState<string | undefined>(undefined);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const selectable = useMemo(() => agents.filter((a) => !a.isChief && a.id !== "chief-analyst"), [agents]);

    const toggleAgent = useCallback((id: string) => {
        setSelectedIds((current) =>
            current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
        );
    }, []);

    const applyTemplate = useCallback((template: TeamTemplate) => {
        setTemplateId(template.id);
        setName(template.name);
        setMarket(template.config.market);
        setStyle(template.config.style);
        setEntryTimeframe(template.config.entryTimeframe);
        setConfirmationTimeframe(template.config.confirmationTimeframe);
        setContextTimeframe(template.config.contextTimeframe);
        setRiskProfile(template.config.riskProfile);
        setBehavior(template.config.behavior);
        setSelectedIds(Array.from(new Set([...template.agentIds, "chief-analyst"])));
        setStep(6);
    }, []);

    const parseNaturalLanguage = useCallback(async () => {
        if (nlPrompt.trim().length < 8) {
            setNlError("Describe the team you want (at least a sentence).");
            return;
        }
        setParsing(true);
        setNlError(null);
        try {
            const result = await teamsApi<{
                name: string;
                config: TeamConfig;
                agentIds: string[];
                warnings?: string[];
            }>("/parse", { method: "POST", body: { request: nlPrompt } });
            setName(result.name);
            setMarket(result.config.market);
            setStyle(result.config.style);
            setEntryTimeframe(result.config.entryTimeframe);
            setConfirmationTimeframe(result.config.confirmationTimeframe);
            setContextTimeframe(result.config.contextTimeframe);
            setRiskProfile(result.config.riskProfile);
            setBehavior(result.config.behavior);
            setSelectedIds(result.agentIds);
            setTemplateId(undefined);
            setStep(6);
        } catch (err) {
            setNlError(err instanceof TeamsApiError ? err.message : "Could not parse the request.");
        } finally {
            setParsing(false);
        }
    }, [nlPrompt]);

    const createTeam = useCallback(async () => {
        setCreating(true);
        setCreateError(null);
        try {
            const config: TeamConfig = {
                market: market.toUpperCase(),
                style: style as TeamConfig["style"],
                entryTimeframe,
                confirmationTimeframe,
                contextTimeframe,
                riskProfile: riskProfile as TeamConfig["riskProfile"],
                behavior: behavior as TeamConfig["behavior"],
                behaviorRules: {
                    requireRiskValidation: behavior === "risk-first",
                    requireQuantValidation: behavior === "research-first",
                },
            };
            const created = await teamsApi<{ id: string }>("/", {
                method: "POST",
                body: {
                    name: name.trim() || `${market} ${style} team`,
                    config,
                    agentIds: selectedIds,
                    ...(templateId ? { templateId } : {}),
                },
            });
            if (onCreated) onCreated(created.id);
            else router.push(`/ai-trading-teams/${created.id}`);
        } catch (err) {
            setCreateError(err instanceof TeamsApiError ? err.message : "Failed to create the team.");
        } finally {
            setCreating(false);
        }
    }, [market, style, entryTimeframe, confirmationTimeframe, contextTimeframe, riskProfile, behavior, name, selectedIds, templateId, onCreated, router]);

    return (
        <div className="flex flex-col gap-4">
            {/* ── Natural language entry ─────────────────────────────── */}
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                <SectionHeader
                    title="Describe your AI Trading Team"
                    icon={<Sparkles className="size-4 text-primary" />}
                    description="“Build me a conservative XAUUSD scalping team using M5 entries, M15 confirmation and H1 context.”"
                />
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                        value={nlPrompt}
                        onChange={(e) => setNlPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void parseNaturalLanguage();
                        }}
                        placeholder="Describe the desk you want…"
                        aria-label="Describe your team in natural language"
                        className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
                    />
                    <Button onClick={() => void parseNaturalLanguage()} disabled={parsing} className="h-10">
                        {parsing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                        Generate config
                    </Button>
                </div>
                {nlError ? <p className="mt-2 text-xs text-destructive">{nlError}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                    {templates.slice(0, 4).map((template) => (
                        <button
                            key={template.id}
                            type="button"
                            onClick={() => applyTemplate(template)}
                            className="rounded-full border border-border/70 bg-card/70 px-3 py-1 text-micro text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        >
                            {template.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Stepper ────────────────────────────────────────────── */}
            <div className="rounded-lg border border-border/60 bg-card/60 p-4">
                <ol className="flex flex-wrap items-center gap-1.5" aria-label="Team builder steps">
                    {STEPS.map((label, index) => (
                        <li key={label} className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setStep(index)}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro transition-colors",
                                    index === step
                                        ? "border-primary/60 bg-primary/10 text-primary"
                                        : index < step
                                            ? "border-positive/40 text-positive"
                                            : "border-border/60 text-muted-foreground",
                                )}
                                aria-current={index === step ? "step" : undefined}
                            >
                                {index < step ? <CheckCircle2 className="size-3" /> : <span className="tabular-nums">{index + 1}</span>}
                                {label}
                            </button>
                            {index < STEPS.length - 1 ? <ArrowRight className="size-3 text-muted-foreground/50" /> : null}
                        </li>
                    ))}
                </ol>

                <div className="mt-4 min-h-[220px]">
                    {step === 0 ? (
                        <Picker
                            title="Step 1 · Choose market"
                            options={MARKETS.map((m) => ({ value: m, label: m, hint: "" }))}
                            value={market}
                            onChange={setMarket}
                        />
                    ) : step === 1 ? (
                        <Picker
                            title="Step 2 · Trading style"
                            options={STYLES.map((s) => ({ value: s.value, label: s.label, hint: s.hint }))}
                            value={style}
                            onChange={setStyle}
                        />
                    ) : step === 2 ? (
                        <div>
                            <p className="mb-3 text-sm font-semibold">Step 3 · Timeframes</p>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <TimeframeSelect label="Entry timeframe" value={entryTimeframe} onChange={setEntryTimeframe} />
                                <TimeframeSelect label="Confirmation timeframe" value={confirmationTimeframe} onChange={setConfirmationTimeframe} />
                                <TimeframeSelect label="Context timeframe" value={contextTimeframe} onChange={setContextTimeframe} />
                            </div>
                        </div>
                    ) : step === 3 ? (
                        <Picker
                            title="Step 4 · Risk profile"
                            options={RISK_PROFILES.map((r) => ({ value: r.value, label: r.label, hint: r.hint }))}
                            value={riskProfile}
                            onChange={setRiskProfile}
                        />
                    ) : step === 4 ? (
                        <div>
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-semibold">Step 5 · Select agents</p>
                                <span className="text-micro text-muted-foreground">{selectedIds.length} selected</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                {selectable.map((agent) => {
                                    const selected = selectedIds.includes(agent.id);
                                    return (
                                        <button
                                            key={agent.id}
                                            type="button"
                                            onClick={() => toggleAgent(agent.id)}
                                            aria-pressed={selected}
                                            className={cn(
                                                "flex items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                                                selected ? "border-primary/60 bg-primary/5" : "border-border/60 bg-background/40 hover:border-border",
                                            )}
                                        >
                                            <AgentAvatar visualType={agent.visualType} state={selected ? "completed" : "idle"} size={34} />
                                            <span className="min-w-0">
                                                <span className="block truncate text-xs font-medium text-foreground">{agent.name}</span>
                                                <span className="block truncate text-micro text-muted-foreground">{agent.category}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : step === 5 ? (
                        <Picker
                            title="Step 6 · Team behavior"
                            options={BEHAVIORS.map((b) => ({ value: b.value, label: b.label, hint: b.hint }))}
                            value={behavior}
                            onChange={setBehavior}
                        />
                    ) : (
                        <div>
                            <p className="mb-3 text-sm font-semibold">Step 7 · Generate team</p>
                            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                                <input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Team name"
                                    aria-label="Team name"
                                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                                />
                                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                                    <Summary label="Market" value={market} />
                                    <Summary label="Style" value={style} />
                                    <Summary label="Risk" value={riskProfile} />
                                    <Summary label="Entry" value={entryTimeframe} />
                                    <Summary label="Confirmation" value={confirmationTimeframe} />
                                    <Summary label="Context" value={contextTimeframe} />
                                    <Summary label="Behavior" value={behavior} />
                                    <Summary label="Agents" value={String(selectedIds.length)} />
                                </dl>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {selectedIds.map((id) => (
                                        <span key={id} className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-micro text-muted-foreground">
                                            <AgentStateDot state="idle" />
                                            {agents.find((a) => a.id === id)?.name ?? id}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            {createError ? (
                                <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                                    {createError}
                                </p>
                            ) : null}
                        </div>
                    )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
                    <Button variant="outline" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                        <ArrowLeft className="size-3.5" /> Back
                    </Button>
                    {step < STEPS.length - 1 ? (
                        <Button size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                            Next <ArrowRight className="size-3.5" />
                        </Button>
                    ) : (
                        <Button size="sm" onClick={() => void createTeam()} disabled={creating || selectedIds.length < 2}>
                            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                            Create team
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function Picker({
    title,
    options,
    value,
    onChange,
}: {
    title: string;
    options: { value: string; label: string; hint: string }[];
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <p className="mb-3 text-sm font-semibold">{title}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        aria-pressed={value === option.value}
                        className={cn(
                            "rounded-lg border px-3 py-2.5 text-left transition-colors",
                            value === option.value
                                ? "border-primary/60 bg-primary/5"
                                : "border-border/60 bg-background/40 hover:border-border",
                        )}
                    >
                        <span className="block text-sm font-medium text-foreground">{option.label}</span>
                        {option.hint ? <span className="mt-0.5 block text-micro text-muted-foreground">{option.hint}</span> : null}
                    </button>
                ))}
            </div>
        </div>
    );
}

function TimeframeSelect({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-micro text-muted-foreground">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
            >
                {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                        {tf}
                    </option>
                ))}
            </select>
        </label>
    );
}

function Summary({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-micro tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="font-medium text-foreground capitalize">{value}</dd>
        </div>
    );
}
