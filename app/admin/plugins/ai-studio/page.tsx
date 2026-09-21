"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    AlertCircle,
    ArrowLeft,
    Bot,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    FileText,
    FlaskConical,
    Loader2,
    Lock,
    PlayCircle,
    RefreshCw,
    Rocket,
    Save,
    Shield,
    Sparkles,
    Terminal,
    XCircle,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import { auth } from "@/lib/firebase";
import { PluginCategory, PluginDraft, PluginKind, PluginPermission, PluginExtensionType, GenerationJob } from "@/lib/plugins/types";
import { CATEGORIES, CATEGORY_LABELS, EXTENSION_TYPE_LABELS, formatDate, permissionLabel, timeAgo } from "@/lib/plugins/ui";

const SUPPORTED_API_KEYS = [
    "market_monitor",
    "price_signal",
    "risk_limits",
    "news_calendar",
    "notifications",
    "scheduler",
    "trade_history",
    "strategy_context",
];

const EXTENSION_TYPES: PluginExtensionType[] = ["browser", "tradingview", "webhook", "discord", "telegram", "api"];

const VALIDATION_STEPS: { key: keyof PluginDraft["validation"]; label: string; description: string }[] = [
    { key: "schema", label: "Schema", description: "Manifest structure validated against the plugin contract." },
    { key: "permissions", label: "Permissions", description: "No forbidden capabilities requested." },
    { key: "security", label: "Security", description: "No disallowed tokens or execution patterns." },
    { key: "sandbox", label: "Sandbox", description: "Requested runtime APIs all exist in the sandbox." },
    { key: "tests", label: "Tests", description: "Condition evaluated across synthetic market contexts." },
];

function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    return user.getIdToken();
}

export default function AdminAiStudioPage() {
    const [prompt, setPrompt] = useState("");
    const [target, setTarget] = useState<PluginKind>("plugin");
    const [category, setCategory] = useState<PluginCategory>("trading-intelligence");
    const [extensionType, setExtensionType] = useState<PluginExtensionType>("browser");
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState("");
    const [draft, setDraft] = useState<PluginDraft | null>(null);
    const [messages, setMessages] = useState<string[]>([]);
    const [jobId, setJobId] = useState("");
    const [supportedApis, setSupportedApis] = useState<Record<string, { label: string; description: string }>>({});
    const [expanded, setExpanded] = useState(false);
    const [publishing, setPublishing] = useState("");
    const [jobs, setJobs] = useState<GenerationJob[]>([]);
    const [jobsLoading, setJobsLoading] = useState(true);

    const loadJobs = useCallback(async () => {
        setJobsLoading(true);
        try {
            const token = await getToken();
            const res = await fetch("/api/admin/plugins/generation-jobs", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
            if (!res.ok) throw new Error("Unable to load generation jobs.");
            const data = await res.json();
            setJobs(Array.isArray(data.jobs) ? (data.jobs as GenerationJob[]) : []);
        } catch {
            setJobs([]);
        } finally {
            setJobsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadJobs();
    }, [loadJobs]);

    async function generate() {
        setGenerating(true);
        setError("");
        setDraft(null);
        setMessages([]);
        setJobId("");
        try {
            const token = await getToken();
            const res = await fetch("/api/admin/plugins/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    prompt,
                    target,
                    category,
                    ...(target === "extension" ? { extensionType } : {}),
                }),
            });
            const data = await res.json();
            setSupportedApis(data.supportedApis || {});
            setJobId(data.jobId || "");
            if (!res.ok || !data.success) {
                setError(data?.error || "Generation failed.");
                setMessages(Array.isArray(data?.messages) ? data.messages : []);
                return;
            }
            setDraft(data.draft as PluginDraft);
            setMessages(Array.isArray(data.messages) ? data.messages : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Generation failed.");
        } finally {
            setGenerating(false);
        }
    }

    async function publish(fromDraft: string, publishNow: boolean) {
        setPublishing(publishNow ? "now" : "draft");
        setError("");
        try {
            const token = await getToken();
            // Extension drafts publish through the extensions endpoint so the
            // connection type (extensionType) is always attached to the record.
            const endpoint = draft?.target === "extension" ? "/api/admin/extensions" : "/api/admin/plugins";
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    fromDraft,
                    publishNow,
                    ...(draft?.target === "extension" ? { extensionType: draft.extensionType || extensionType } : {}),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Publish failed.");
            const published = data.record || data.extension;
            setDraft(null);
            await loadJobs();
            if (publishNow) {
                window.location.href = `/admin/plugins/${published.id}`;
            } else {
                setMessages([`Draft saved to the catalog (id: ${published.id}). Open it from the plugins list to finish the lifecycle.`]);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Publish failed.");
        } finally {
            setPublishing("");
        }
    }

    const validation = draft?.validation;
    const passed = validation
        ? VALIDATION_STEPS.every((step) => validation[step.key] === true)
        : false;

    return (
        <AdminShell title="AI Plugin Studio" subtitle="Generate, validate, sandbox-test and publish plugins from a description.">
            <div className="mb-5">
                <Link href="/admin/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={14} /> Back to Plugins
                </Link>
            </div>

            {error && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                    <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-300" />
                    <p className="text-sm text-red-300">{error}</p>
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-5">
                {/* Generator */}
                <div className="lg:col-span-3">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <Sparkles size={14} /> Describe the plugin
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            The pipeline generates a declarative spec, validates it against the sandbox, runs synthetic tests
                            and produces a draft. Anything outside the declarative surface is reported — never faked.
                        </p>

                        <div className="mt-5 space-y-4">
                            <Field label="Prompt (at least a sentence)">
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    rows={5}
                                    placeholder="e.g. A plugin that alerts me when EURUSD intraday volatility spikes above 2.5x its 14-day ATR during the New York session, plus flags correlated exposure over 30%."
                                    className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                                />
                            </Field>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Target">
                                    <div className="flex gap-2">
                                        {(["plugin", "extension"] as PluginKind[]).map((t) => (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setTarget(t)}
                                                className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
                                                    target === t ? "border-border/50 bg-background text-foreground" : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                                }`}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>
                                </Field>
                                <Field label="Category">
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value as PluginCategory)}
                                        className="w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none focus:border-border/50"
                                    >
                                        {CATEGORIES.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.label}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                            </div>
                            {target === "extension" && (
                                <Field label="Extension type (how it connects)">
                                    <div className="flex flex-wrap gap-2">
                                        {EXTENSION_TYPES.map((t) => (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setExtensionType(t)}
                                                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                                                    extensionType === t
                                                        ? "border-border/50 bg-background text-foreground"
                                                        : "border-border/30 bg-muted/5 text-muted-foreground hover:text-foreground"
                                                }`}
                                            >
                                                {EXTENSION_TYPE_LABELS[t] || t}
                                            </button>
                                        ))}
                                    </div>
                                </Field>
                            )}
                            <button
                                type="button"
                                onClick={generate}
                                disabled={generating || prompt.trim().length < 10}
                                className="inline-flex items-center gap-2 rounded-xl bg-background px-5 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {generating ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                                {generating ? "Generating..." : "Generate plugin"}
                            </button>
                        </div>
                    </div>

                    {/* Result */}
                    {draft && (
                        <div className="mt-5 rounded-2xl border border-border/30 bg-muted/50 p-6">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                                        <FileText size={14} /> {draft.displayName}
                                    </h3>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        {draft.id} · {CATEGORY_LABELS[draft.category]} · {draft.target}
                                        {draft.extensionType ? ` · ${EXTENSION_TYPE_LABELS[draft.extensionType] || draft.extensionType}` : ""}
                                        {jobId ? ` · job ${jobId}` : ""}
                                    </p>
                                </div>
                                <StatusBadge tone={draft.status === "passed" ? "positive" : "warning"} label={draft.status} dot />
                            </div>
                            <p className="mt-3 text-xs leading-5 text-muted-foreground">{draft.description}</p>

                            {/* Validation pipeline */}
                            <div className="mt-5 grid gap-2 sm:grid-cols-5">
                                {VALIDATION_STEPS.map((step) => {
                                    const ok = validation ? validation[step.key] : false;
                                    return (
                                        <div key={step.key} className={`rounded-xl border p-3 ${ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
                                            <div className="flex items-center gap-1.5">
                                                {ok ? <CheckCircle2 size={13} className="text-emerald-300" /> : <XCircle size={13} className="text-red-300" />}
                                                <p className="text-xs font-medium">{step.label}</p>
                                            </div>
                                            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{step.description}</p>
                                        </div>
                                    );
                                })}
                            </div>

                            {messages.length > 0 && (
                                <div className="mt-5 rounded-xl border border-border/30 bg-muted/20 p-4">
                                    <h4 className="text-xs font-medium">Validation messages</h4>
                                    <ul className="mt-2 space-y-1.5">
                                        {messages.map((m, i) => (
                                            <li key={i} className={`flex gap-2 text-[11px] leading-5 ${m.toLowerCase().includes("unsupported") || m.toLowerCase().includes("fail") || m.toLowerCase().includes("error") ? "text-amber-200" : "text-muted-foreground"}`}>
                                                <span className="shrink-0">•</span>
                                                {m}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {draft.spec?.unsupportedCapabilities && draft.spec.unsupportedCapabilities.length > 0 && (
                                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                                    <h4 className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
                                        <AlertCircle size={13} /> Unsupported capabilities reported
                                    </h4>
                                    <ul className="mt-2 space-y-2">
                                        {draft.spec.unsupportedCapabilities.map((u, i) => (
                                            <li key={i} className="text-[11px] leading-5 text-amber-100/80">
                                                <span className="font-medium text-amber-200">{u.required}</span> — {u.suggestedImplementation}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Capabilities & permissions */}
                            <div className="mt-5 grid gap-5 md:grid-cols-2">
                                <div>
                                    <h4 className="text-xs font-medium">Capabilities</h4>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {(draft.spec?.capabilities || []).slice(0, 10).map((cap) => (
                                            <span key={cap} className="rounded-lg bg-muted/5 px-2.5 py-1 text-[11px] text-muted-foreground">{cap}</span>
                                        ))}
                                        {(draft.spec?.capabilities || []).length === 0 && <span className="text-[11px] text-muted-foreground">None declared.</span>}
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-medium">Permissions</h4>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {(Object.keys(draft.permissions || {}) as PluginPermission[]).filter((p) => draft.permissions?.[p]).map((p) => (
                                            <span key={p} className="rounded-lg bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-300">{permissionLabel(p)}</span>
                                        ))}
                                        {(Object.keys(draft.permissions || {}) as PluginPermission[]).filter((p) => draft.permissions?.[p]).length === 0 && (
                                            <span className="text-[11px] text-muted-foreground">No permissions requested.</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-5 border-t border-border/30 pt-4">
                                <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                                    {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                    Show runtime condition & test cases
                                </button>
                                {expanded && (
                                    <div className="mt-3 space-y-4">
                                        <div className="rounded-xl border border-border/30 bg-muted/20 p-4">
                                            <h4 className="text-xs font-medium">Declarative condition</h4>
                                            <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                                                {JSON.stringify(draft.spec?.runtime?.condition || draft.spec?.manifest?.runtime?.condition, null, 2)}
                                            </pre>
                                        </div>
                                        {(draft.spec?.testCases || []).length > 0 && (
                                            <div>
                                                <h4 className="text-xs font-medium">Sandbox test cases</h4>
                                                <ul className="mt-2 space-y-1.5">
                                                    {draft.spec.testCases.map((tc, i) => (
                                                        <li key={i} className="flex gap-2 text-[11px] leading-5 text-muted-foreground">
                                                            <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-400" />
                                                            {tc}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Publish actions */}
                            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/30 pt-4">
                                <button
                                    type="button"
                                    onClick={() => publish(draft.id, true)}
                                    disabled={!passed || publishing === "now"}
                                    className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                        passed ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "border border-border/30 bg-muted/5 text-muted-foreground"
                                    }`}
                                    title={passed ? "Publish to the marketplace immediately" : "Fix the validation failures before publishing"}
                                >
                                    {publishing === "now" ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
                                    Publish to marketplace
                                </button>
                                <button
                                    type="button"
                                    onClick={() => publish(draft.id, false)}
                                    disabled={publishing === "draft"}
                                    className="inline-flex items-center gap-2 rounded-xl bg-background px-5 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {publishing === "draft" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    Save as catalog draft
                                </button>
                                <span className="text-[11px] text-muted-foreground">
                                    {passed ? "All pipeline checks passed — publishing is allowed." : "Does not pass all pipeline checks — publishing is blocked."}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* No result */}
                    {!draft && !generating && !error && (
                        <div className="mt-5 rounded-2xl border border-dashed border-border/30 bg-muted/50 p-8 text-center">
                            <Bot size={28} className="mx-auto text-muted-foreground" />
                            <p className="mt-3 text-sm font-medium">No plugin generated yet</p>
                            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                                Describe a trading-intelligence plugin or an extension idea above. The pipeline returns a validated draft you can inspect, test and publish.
                            </p>
                        </div>
                    )}
                </div>

                {/* Supported APIs + jobs */}
                <div className="lg:col-span-2">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <Shield size={14} /> Sandbox API surface
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Generated plugins may only use these declarative APIs. Anything else is rejected explicitly.
                        </p>
                        <div className="mt-4 space-y-2">
                            {SUPPORTED_API_KEYS.map((key) => {
                                const api = supportedApis[key];
                                return (
                                    <div key={key} className="rounded-xl border border-border/30 bg-muted/20 p-3">
                                        <p className="text-xs font-medium text-foreground">{api?.label || key}</p>
                                        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{api?.description || "Declarative sandbox API."}</p>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-200">
                            <Lock size={13} className="mt-0.5 shrink-0" />
                            Order placement, credentials access, external calls and arbitrary code are never generated.
                        </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-border/30 bg-muted/50 p-6">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                                <Terminal size={14} /> Generation jobs
                            </h3>
                            <button type="button" onClick={loadJobs} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                                <RefreshCw size={12} />
                                Refresh
                            </button>
                        </div>
                        {jobsLoading ? (
                            <div className="mt-4 space-y-2">
                                {[1, 2].map((n) => (
                                    <div key={n} className="h-14 animate-pulse rounded-xl border border-border/30 bg-muted/20" />
                                ))}
                            </div>
                        ) : jobs.length === 0 ? (
                            <p className="mt-4 text-xs text-muted-foreground">No generation jobs yet. Generate a plugin to see them here.</p>
                        ) : (
                            <div className="mt-4 space-y-2">
                                {jobs.slice(0, 10).map((job) => (
                                    <div key={job.id} className="rounded-xl border border-border/30 bg-muted/20 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <StatusBadge tone={job.status === "done" ? "positive" : job.status === "failed" ? "error" : "pending"} label={job.status} dot />
                                            <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(job.createdAt)}</span>
                                        </div>
                                        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{job.prompt}</p>
                                        <p className="mt-1 text-[10px] text-muted-foreground">
                                            {job.target} · {CATEGORY_LABELS[job.category as PluginCategory] || job.category} · created {formatDate(job.createdAt)}
                                        </p>
                                        {job.error && <p className="mt-1 text-[10px] leading-4 text-red-300">{job.error}</p>}
                                        {job.draftId && (
                                            <p className="mt-1 text-[10px] text-violet-300">{job.draftId} {job.status === "done" && "· validated"}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </AdminShell>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>
            {children}
        </div>
    );
}