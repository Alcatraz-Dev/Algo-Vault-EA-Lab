"use client";

/**
 * Admin — AI Usage & Budgets.
 *
 * Reads exclusively from the admin-only endpoints `/api/admin/ai/usage` and
 * `/api/admin/ai/budgets`, which authenticate with the project's existing
 * `requireAdmin`. No direct Realtime Database access is used from the client:
 * the client rules deny reads on the usage/budget namespaces, and routing
 * through the server also keeps per-user ids out of the browser entirely.
 *
 * Cost is always labelled as an estimate, and an unpriced bucket renders as
 * "Cost unavailable" rather than $0.00 — a fabricated zero would read as
 * "we spent nothing" when the truth is "we do not know".
 */

import { useCallback, useEffect, useState } from "react";
import {
    AlertTriangle,
    Ban,
    Coins,
    Gauge,
    RefreshCw,
    Save,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/components/ui/status-badge";
import { adminFetch } from "@/components/growth/admin/session";

type Counters = {
    requests: number;
    successfulRequests: number;
    failedRequests: number;
    blockedRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    costUnknownRequests: number;
};

type ProviderSummary = Counters & {
    provider: string;
    models: Array<Counters & { model: string }>;
};

type UsageResponse = {
    month: string;
    totals: Counters;
    providers: ProviderSummary[];
    sources: Record<string, Counters>;
    modelCount: number;
};

type BudgetStatus = {
    scope: "global" | "provider" | "user" | "plugin";
    id: string;
    monthlyUsd: number | null;
    monthlyTokens: number | null;
    usedTokens: number;
    usedCostUsd: number | null;
    tokenUtilization: number | null;
    costUtilization: number | null;
    status: "healthy" | "warning" | "exceeded" | "unlimited";
    costUnknownRequests: number;
};

type BudgetsResponse = {
    month: string;
    warnThreshold: number;
    blockThreshold: number;
    enforcementActive: boolean;
    global: BudgetStatus;
    providers: BudgetStatus[];
    users: BudgetStatus[];
    plugins: BudgetStatus[];
};

const STATUS_TONE: Record<BudgetStatus["status"], StatusTone> = {
    healthy: "positive",
    warning: "warning",
    exceeded: "negative",
    unlimited: "neutral",
};

const STATUS_LABEL: Record<BudgetStatus["status"], string> = {
    healthy: "Healthy",
    warning: "Warning",
    exceeded: "Exceeded",
    unlimited: "No limit set",
};

function fmtInt(value: number): string {
    return value.toLocaleString("en-US");
}

function fmtUsd(value: number | null): string {
    // Explicitly distinct from $0.00: "unknown" and "free" are different facts.
    return value === null ? "Cost unavailable" : `$${value.toFixed(4)}`;
}

function fmtPct(value: number | null): string {
    return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default function AdminAIUsagePage() {
    const [usage, setUsage] = useState<UsageResponse | null>(null);
    const [budgets, setBudgets] = useState<BudgetsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedNote, setSavedNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [usageData, budgetData] = await Promise.all([
                adminFetch<UsageResponse>("/api/admin/ai/usage"),
                adminFetch<BudgetsResponse>("/api/admin/ai/budgets"),
            ]);
            setUsage(usageData);
            setBudgets(budgetData);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load AI usage data.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const patchGlobal = async (field: "monthlyTokens" | "monthlyUsd", raw: string) => {
        setSaving(true);
        setSavedNote(null);
        try {
            const value = raw.trim() === "" ? null : Number(raw);
            if (value !== null && (!Number.isFinite(value) || value < 0)) {
                throw new Error("Enter a non-negative number, or leave empty to clear.");
            }
            const result = await adminFetch<BudgetsResponse>("/api/admin/ai/budgets", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ global: { [field]: value } }),
            });
            setBudgets(result);
            setSavedNote("Saved. Applies to the next AI request.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save the budget limit.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminShell
            title="AI Usage & Budgets"
            subtitle="Token and cost accounting for the multi-provider AI gateway, with pre-flight budget enforcement."
        >
            <div className="mb-6 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted/50 px-4 py-2.5">
                    <Gauge size={14} className="text-muted-foreground" />
                    <span className="text-xs font-medium">
                        {usage?.month ?? budgets?.month ?? "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">current month</span>
                </div>
                <button
                    onClick={() => void load()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    Refresh
                </button>
                {savedNote && (
                    <span className="text-xs text-success-foreground">{savedNote}</span>
                )}
            </div>

            {error && (
                <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive-muted p-4 text-xs text-destructive-foreground">
                    {error}
                </div>
            )}

            {loading && !usage && (
                <div className="rounded-2xl border border-border/30 bg-muted/50 p-8 text-center text-xs text-muted-foreground">
                    Loading AI usage…
                </div>
            )}

            {usage && (
                <>
                    {/* ── Totals ─────────────────────────────────────────── */}
                    <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                        <Metric label="Requests" value={fmtInt(usage.totals.requests)} />
                        <Metric
                            label="Successful"
                            value={fmtInt(usage.totals.successfulRequests)}
                        />
                        <Metric
                            label="Failed"
                            value={fmtInt(usage.totals.failedRequests)}
                            tone={usage.totals.failedRequests > 0 ? "negative" : undefined}
                        />
                        <Metric
                            label="Total Tokens"
                            value={fmtInt(usage.totals.totalTokens)}
                        />
                        <Metric
                            label="Estimated Cost"
                            value={fmtUsd(usage.totals.estimatedCostUsd)}
                            hint="Estimate from provider-reported pricing — not an invoice."
                        />
                    </div>

                    {usage.totals.blockedRequests > 0 && (
                        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-muted p-4">
                            <Ban size={16} className="mt-0.5 shrink-0 text-warning-foreground" />
                            <div>
                                <p className="text-xs font-medium text-warning-foreground">
                                    {fmtInt(usage.totals.blockedRequests)} request(s) blocked by
                                    the budget guard
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    These were refused before any provider was contacted, so they
                                    cost nothing. The next allowed provider was tried first.
                                </p>
                            </div>
                        </div>
                    )}

                    {usage.totals.costUnknownRequests > 0 && (
                        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-border/30 bg-muted/50 p-4">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                            <div>
                                <p className="text-xs font-medium">
                                    {fmtInt(usage.totals.costUnknownRequests)} request(s) had
                                    unknown pricing
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Their provider reported tokens but no price, so their cost is
                                    excluded from the estimate rather than assumed to be zero.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── Budget status ──────────────────────────────────── */}
                    <Section
                        title="Budget Status"
                        description={
                            budgets?.enforcementActive
                                ? "Limits are enforced before each provider call. A blocked provider is skipped and the next allowed provider runs."
                                : "No limits are configured, so enforcement is inert. Usage is still tracked."
                        }
                    >
                        {budgets && (
                            <div className="space-y-3">
                                <BudgetRow
                                    status={budgets.global}
                                    label="Global"
                                    onSaveTokens={(v) => void patchGlobal("monthlyTokens", v)}
                                    onSaveUsd={(v) => void patchGlobal("monthlyUsd", v)}
                                    saving={saving}
                                />
                                {budgets.providers.length === 0 && (
                                    <p className="px-1 text-xs text-muted-foreground">
                                        No per-provider limits configured. Set
                                        {" "}
                                        <code className="rounded bg-muted px-1 py-0.5">
                                            AI_PROVIDER_&lt;ID&gt;_MONTHLY_TOKEN_LIMIT
                                        </code>{" "}
                                        or add one from this page.
                                    </p>
                                )}
                                {budgets.providers.map((p) => (
                                    <BudgetRow
                                        key={`provider-${p.id}`}
                                        status={p}
                                        label={p.id}
                                        readOnly
                                    />
                                ))}
                                {budgets.users.map((u) => (
                                    <BudgetRow
                                        key={`user-${u.id}`}
                                        status={u}
                                        label={`User ${u.id}`}
                                        readOnly
                                    />
                                ))}
                                {budgets.plugins.map((p) => (
                                    <BudgetRow
                                        key={`plugin-${p.id}`}
                                        status={p}
                                        label={`Plugin ${p.id}`}
                                        readOnly
                                    />
                                ))}
                            </div>
                        )}
                    </Section>

                    {/* ── Provider breakdown ─────────────────────────────── */}
                    <Section
                        title="Provider Breakdown"
                        description={`${usage.providers.length} provider(s), ${usage.modelCount} distinct model(s) this month.`}
                    >
                        {usage.providers.length === 0 ? (
                            <Empty>No AI usage recorded for this month yet.</Empty>
                        ) : (
                            <div className="space-y-3">
                                {usage.providers.map((p) => (
                                    <div
                                        key={p.provider}
                                        className="rounded-xl border border-border/30 bg-muted/5 p-4"
                                    >
                                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                                            <p className="text-xs font-medium">{p.provider}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {fmtInt(p.requests)} req ·{" "}
                                                {fmtInt(p.totalTokens)} tokens ·{" "}
                                                {fmtUsd(p.estimatedCostUsd)}
                                            </p>
                                        </div>
                                        {p.models.length > 0 && (
                                            <div className="mt-3 space-y-1.5">
                                                {p.models.map((m) => (
                                                    <div
                                                        key={m.model}
                                                        className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground"
                                                    >
                                                        <span className="font-mono text-[11px]">
                                                            {m.model}
                                                        </span>
                                                        <span>
                                                            {fmtInt(m.requests)} req ·{" "}
                                                            {fmtInt(m.totalTokens)} tokens ·{" "}
                                                            {fmtUsd(m.estimatedCostUsd)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>

                    {/* ── Source breakdown ───────────────────────────────── */}
                    {Object.keys(usage.sources).length > 0 && (
                        <Section
                            title="By Source"
                            description="Which surface originated the request. Ids are omitted; only the aggregate is shown."
                        >
                            <div className="space-y-1.5">
                                {Object.entries(usage.sources).map(([source, c]) => (
                                    <div
                                        key={source}
                                        className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                                    >
                                        <span className="font-medium">{source}</span>
                                        <span className="text-muted-foreground">
                                            {fmtInt(c.requests)} req ·{" "}
                                            {fmtInt(c.totalTokens)} tokens
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}
                </>
            )}
        </AdminShell>
    );
}

function Section({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="mb-6">
            <h2 className="text-sm font-medium">{title}</h2>
            {description && (
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
            <div className="mt-3">{children}</div>
        </div>
    );
}

function Metric({
    label,
    value,
    hint,
    tone,
}: {
    label: string;
    value: string;
    hint?: string;
    tone?: "negative";
}) {
    return (
        <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p
                className={`mt-2 text-xl font-semibold ${tone === "negative" ? "text-destructive-foreground" : ""}`}
            >
                {value}
            </p>
            {hint && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
        </div>
    );
}

function BudgetRow({
    status,
    label,
    onSaveTokens,
    onSaveUsd,
    readOnly,
    saving,
}: {
    status: BudgetStatus;
    label: string;
    onSaveTokens?: (value: string) => void;
    onSaveUsd?: (value: string) => void;
    readOnly?: boolean;
    saving?: boolean;
}) {
    const worst = Math.max(status.tokenUtilization ?? 0, status.costUtilization ?? 0);
    const showBar = status.tokenUtilization !== null || status.costUtilization !== null;

    return (
        <div className="rounded-xl border border-border/30 bg-muted/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <p className="text-xs font-medium capitalize">{label}</p>
                    <StatusBadge tone={STATUS_TONE[status.status]} label={STATUS_LABEL[status.status]} />
                </div>
                <p className="text-xs text-muted-foreground">
                    {status.monthlyTokens !== null
                        ? `${fmtInt(status.usedTokens)} / ${fmtInt(status.monthlyTokens)} tokens`
                        : "No token limit"}
                </p>
            </div>

            {showBar && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-pill bg-muted">
                    <div
                        className={`h-full rounded-pill ${
                            status.status === "exceeded"
                                ? "bg-destructive"
                                : status.status === "warning"
                                  ? "bg-warning"
                                  : "bg-success"
                        }`}
                        style={{ width: `${Math.min(100, worst * 100)}%` }}
                    />
                </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>Tokens {fmtPct(status.tokenUtilization)}</span>
                <span>
                    <Coins size={11} className="mr-1 inline align-[-1px]" />
                    Cost {fmtUsd(status.usedCostUsd)}
                    {status.costUtilization !== null ? ` (${fmtPct(status.costUtilization)})` : ""}
                </span>
            </div>

            {!readOnly && (onSaveTokens || onSaveUsd) && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <LimitInput
                        label="Monthly token limit"
                        value={status.monthlyTokens}
                        placeholder="no limit"
                        disabled={saving}
                        onSave={onSaveTokens}
                    />
                    <LimitInput
                        label="Monthly cost limit (USD)"
                        value={status.monthlyUsd}
                        placeholder="no limit"
                        disabled={saving}
                        onSave={onSaveUsd}
                    />
                </div>
            )}
        </div>
    );
}

function LimitInput({
    label,
    value,
    placeholder,
    disabled,
    onSave,
}: {
    label: string;
    value: number | null;
    placeholder: string;
    disabled?: boolean;
    onSave?: (value: string) => void;
}) {
    const [draft, setDraft] = useState(value === null ? "" : String(value));
    const [dirty, setDirty] = useState(false);

    // Keep the field in step with server state until the user edits it.
    useEffect(() => {
        if (!dirty) setDraft(value === null ? "" : String(value));
    }, [value, dirty]);

    return (
        <label className="block">
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <div className="mt-1 flex items-center gap-2">
                <input
                    value={draft}
                    placeholder={placeholder}
                    disabled={disabled}
                    inputMode="decimal"
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setDirty(true);
                    }}
                    className="w-full rounded-xl border border-border/30 bg-background px-3 py-2 text-xs outline-none focus:border-border/60"
                />
                <button
                    onClick={() => onSave?.(draft)}
                    disabled={disabled || !dirty}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border/30 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                >
                    <Save size={12} />
                    Save
                </button>
            </div>
        </label>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/5 p-6 text-center text-xs text-muted-foreground">
            {children}
        </div>
    );
}
