"use client";
import { useCallback, useEffect, useState } from "react";
import {
    RefreshCw,
    HeartPulse,
    Shield,
    Activity,
    Ban,
    AlertTriangle,
    Zap,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/components/ui/status-badge";
import { adminFetch } from "@/components/growth/admin/session";

// Response shapes declared locally so the page never imports the
// server-only health module — the same pattern used by the existing
// AI Usage admin page (Counters, UsageResponse, BudgetStatus, etc.).

type HealthState =
    | "healthy" | "idle" | "degraded" | "blocked" | "unavailable";

type HealthStatus = HealthState;

type HealthUsage = {
    requests: number; successfulRequests: number; failedRequests: number;
    blockedRequests: number; totalTokens: number;
};

type HealthProvider = {
    provider: string; name: string; state: HealthStatus; detail: string;
    available: boolean; credentialsConfigured: boolean; meteredRisk: boolean;
    budgetBlocked: boolean; budgetWarning: boolean;
    attempts: number; providerFailures: number; failureRate: number | null;
    usage: HealthUsage;
};

type HealthReport = {
    month: string; freeOnly: boolean; enforcementActive: boolean;
    gatewayImpaired: boolean; totals: { registered: number; ready: number; blocked: number; degraded: number; idle: number; unavailable: number; };
    providers: HealthProvider[];
};

const STATE_MAP: Record<HealthStatus, StatusTone> = {
    healthy: "positive", idle: "neutral", degraded: "warning",
    blocked: "negative", unavailable: "offline",
};
const STATE_LABEL_MAP: Record<HealthStatus, string> = {
    healthy: "Healthy", idle: "Idle", degraded: "Degraded",
    blocked: "Blocked", unavailable: "Unavailable",
};

export default function AdminAIHealthPage() {
    const [report, setReport] = useState<HealthReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await adminFetch<HealthReport>("/api/admin/ai/health");
            setReport(res);
        } catch (e) { setError(e instanceof Error ? e.message : "Failed to load health."); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    return (
        <AdminShell title="AI Provider Health" subtitle="Credential, policy and budget state per provider account — no provider contacted.">
            <div className="mb-6 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted/50 px-4 py-2.5">
                    <HeartPulse size={14} className="text-muted-foreground" />
                    <span className="text-xs font-medium">{report?.month ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">month</span>
                </div>
                <button onClick={() => void load()} disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50">
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
            </div>
            {error && <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive-muted p-4 text-xs text-destructive-foreground">{error}</div>}
            {!report && loading && <div className="rounded-2xl border border-border/30 bg-muted/50 p-8 text-center text-xs text-muted-foreground">Loading health…</div>}
            {report && (
                <>
                    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Metric label="Registered" value={String(report.totals.registered)} />
                        <Metric label="Ready" value={String(report.totals.ready)} tone={report.gatewayImpaired ? "negative" : undefined} />
                        <Metric label="Blocked" value={String(report.totals.blocked)} tone={report.totals.blocked > 0 ? "negative" : undefined} />
                        <Metric label="Unavailable" value={String(report.totals.unavailable)} tone={report.totals.unavailable > 0 ? "warning" : undefined} />
                    </div>
                    {report.gatewayImpaired && <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive-muted p-4"><p className="text-xs font-medium text-destructive-foreground">Gateway impaired: no provider is ready to serve.</p></div>}
                    <div className="space-y-3">
                        {report.providers.map((p) => (
                            <div key={p.provider} className="rounded-xl border border-border/30 bg-muted/5 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <p className="text-xs font-medium">{p.name}</p>
                                        <StatusBadge tone={STATE_MAP[p.state] ?? "neutral"} label={STATE_LABEL_MAP[p.state] ?? p.state} />
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">{p.provider}</p>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">{p.detail}</p>
                                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                                    <span className="inline-flex items-center gap-1"><Shield size={11}/> Cred {p.credentialsConfigured ? "Yes" : "No"}</span>
                                    <span className="inline-flex items-center gap-1"><Zap size={11}/> Metered risk {p.meteredRisk ? "Yes" : "No"}</span>
                                    <span className="inline-flex items-center gap-1"><Activity size={11}/> Available {p.available ? "Yes" : "No"}</span>
                                    <span className="inline-flex items-center gap-1"><Ban size={11}/> Blocked {p.budgetBlocked ? (p.budgetBlocked ? "Yes" : "No") : "No"}</span>
                                    {p.budgetWarning && <span className="inline-flex items-center gap-1"><AlertTriangle size={11}/> Warning</span>}
                                </div>
                                <div className="mt-2 text-[11px] text-muted-foreground">Usage: {p.usage.requests} req / {p.usage.successfulRequests} ok / {p.usage.failedRequests} fail / {p.usage.blockedRequests} blocked · {p.usage.totalTokens} tokens</div>
                                {p.attempts > 0 && <div className="mt-1 text-[11px] text-muted-foreground">Attempts: {p.attempts} · Failures: {p.providerFailures} · Rate: {p.failureRate !== null ? `${Math.round(p.failureRate * 100)}%` : "—"}</div>}
                            </div>
                        ))}
                    </div>
                    <div className="mt-6 rounded-xl border border-border/30 bg-muted/50 p-4 text-[11px] text-muted-foreground leading-5">No provider contacted by this page. Credentials shown as configured / missing only (value never shown). Cost / token figures are this month's aggregates. Unknown pricing reads as "Cost unavailable"; budget-refused calls count toward blocked requests, not failures.</div>
                </>
            )}
        </AdminShell>
    );
}
function Metric({ label, value, tone }: { label: string; value: string; tone?: StatusTone }) {
    const toneClass =
        tone === "negative" ? "text-destructive-foreground"
            : tone === "warning" ? "text-warning-foreground"
                : "";
    return <div className="rounded-2xl border border-border/30 bg-muted/50 p-5"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p></div>;
}
