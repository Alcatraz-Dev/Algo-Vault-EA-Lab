"use client";

/**
 * AI Execution dashboard — AlgoVault-native surface for the AI execution layer.
 *
 * Sections: overview (mode + kill switch + account), active plans,
 * pending approvals (explicit approve/withdraw), automated trading policy,
 * active positions, execution history (audit trail).
 *
 * Data comes exclusively from /api/ai-execution* — the server owns every
 * decision; the UI only displays it and forwards explicit user intent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import {
    Activity,
    AlertTriangle,
    Bot,
    CheckCircle2,
    ChevronRight,
    Clock,
    History,
    Loader2,
    Settings2,
    Shield,
    ShieldOff,
    XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types mirroring the API payload
// ─────────────────────────────────────────────────────────────────────────────

type EvidenceItem = {
    id: string;
    evidenceClass: string;
    sourceId: string;
    label: string;
    value?: number | string | boolean;
    observedAt: number | null;
    reason?: string;
};

type TradePlan = {
    id: string;
    instrument: string;
    direction: "BUY" | "SELL";
    timeframe: string;
    entry: number;
    stopLoss: number;
    takeProfits: Array<{ index: number; price: number }>;
    riskPercent: number;
    positionSizeLots?: number;
    status: string;
    executionMode: string;
    marketRegime: string;
    evidence: EvidenceItem[];
    aiInterpretation?: string;
    invalidationConditions: string[];
    rejectionStage?: string;
    rejectionReason?: string;
    generatedAt: number;
    expiresAt: number;
    riskValidation?: { approved: boolean; code: string; reason?: string; evaluatedAt: number };
    execution?: { mt5Account?: string; clientOrderId?: string; gatewayTicket?: string; submittedAt?: number };
};

type Policy = {
    executionMode: "ANALYSIS" | "APPROVAL" | "AUTOMATION";
    enabled: boolean;
    automation?: Record<string, unknown> & { maxRiskPercentPerTrade?: number; maxOpenPositions?: number; maxDailyLossPercent?: number; allowedInstruments?: string[] };
};

type State = {
    policy: Policy;
    killSwitch: { engaged: boolean; reason?: string; engagedAt?: number };
    plans: TradePlan[];
    reviews: Array<{ id: string; planId: string; verdict: string; summary: string; createdAt: number }>;
    audit: Array<{ id: string; action: string; planId?: string; reason?: string; timestamp: number; actor: string }>;
    account: { connected: boolean; key: string | null };
    positions: Array<Record<string, unknown>>;
};

const MODE_LABEL: Record<string, string> = {
    ANALYSIS: "Analysis — plans are generated, never executed",
    APPROVAL: "Approval — every trade needs your explicit approval",
    AUTOMATION: "Automation — qualifying plans execute under strict risk controls",
};

const STATUS_COLOR: Record<string, string> = {
    DRAFT: "text-muted-foreground",
    VALIDATING: "text-info",
    PENDING_APPROVAL: "text-warning",
    APPROVED: "text-info",
    SUBMITTED: "text-info",
    OPEN: "text-positive",
    MONITORING: "text-positive",
    CLOSED: "text-muted-foreground",
    REJECTED: "text-negative",
    CANCELLED: "text-muted-foreground",
    FAILED: "text-negative",
};

function fmtTime(ts: number | undefined | null): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtPrice(v: number, instrument: string): string {
    const digits = instrument.includes("JPY") ? 3 : instrument.startsWith("XAU") || instrument.startsWith("BTC") ? 2 : 5;
    return v.toFixed(digits);
}

export default function AiExecutionPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [state, setState] = useState<State | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyPlan, setBusyPlan] = useState<string | null>(null);
    const [showPolicy, setShowPolicy] = useState(false);

    // Automation policy form state
    const [policyMode, setPolicyMode] = useState<"ANALYSIS" | "APPROVAL" | "AUTOMATION">("ANALYSIS");
    const [maxRisk, setMaxRisk] = useState("1");
    const [maxOpen, setMaxOpen] = useState("5");
    const [maxDailyLoss, setMaxDailyLoss] = useState("5");
    const [allowedInstruments, setAllowedInstruments] = useState("XAUUSD");
    const [acknowledgeRisk, setAcknowledgeRisk] = useState("");
    const [policyBusy, setPolicyBusy] = useState(false);

    const load = useCallback(async (uid: User) => {
        try {
            const token = await uid.getIdToken();
            const res = await fetch("/api/ai-execution", { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "Failed to load AI execution state.");
                return;
            }
            setError(null);
            setState(data as State);
            setPolicyMode(data.policy.executionMode);
            const a = data.policy.automation ?? {};
            if (a.maxRiskPercentPerTrade) setMaxRisk(String(a.maxRiskPercentPerTrade));
            if (a.maxOpenPositions) setMaxOpen(String(a.maxOpenPositions));
            if (a.maxDailyLossPercent) setMaxDailyLoss(String(a.maxDailyLossPercent));
            if (Array.isArray(a.allowedInstruments) && a.allowedInstruments.length > 0) setAllowedInstruments(a.allowedInstruments.join(", "));
        } catch {
            setError("Network error loading AI execution state.");
        }
    }, []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
            if (u) void load(u);
        });
        return () => unsub();
    }, [load]);

    useEffect(() => {
        if (!user) return;
        const id = setInterval(() => void load(user), 20_000);
        return () => clearInterval(id);
    }, [user, load]);

    const pendingPlans = useMemo(() => (state?.plans ?? []).filter((p) => p.status === "PENDING_APPROVAL" || p.status === "VALIDATING"), [state]);
    const activePlans = useMemo(() => (state?.plans ?? []).filter((p) => ["APPROVED", "SUBMITTED", "OPEN", "MONITORING"].includes(p.status)), [state]);
    const closedPlans = useMemo(() => (state?.plans ?? []).filter((p) => ["CLOSED", "REJECTED", "CANCELLED", "FAILED"].includes(p.status)), [state]);

    const post = async (url: string, body: Record<string, unknown>) => {
        if (!user) return null;
        setBusyPlan(String(body.planId ?? "policy"));
        try {
            const token = await user.getIdToken();
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) setError(data.error ?? "Request failed.");
            else setError(null);
            await load(user);
            return data;
        } finally {
            setBusyPlan(null);
        }
    };

    const savePolicy = async () => {
        const enabling = policyMode === "AUTOMATION" && state?.policy.executionMode !== "AUTOMATION";
        if (enabling && !acknowledgeRisk.trim()) {
            setError("To enable Automation, acknowledge the risk statement in the text field.");
            return;
        }
        setPolicyBusy(true);
        try {
            await post("/api/ai-execution/policy", {
                executionMode: policyMode,
                confirm: enabling ? true : undefined,
                acknowledgeRisk: enabling ? acknowledgeRisk.trim() : undefined,
                enabled: policyMode === "AUTOMATION",
                automation: {
                    maxRiskPercentPerTrade: Number(maxRisk) || 1,
                    maxOpenPositions: Number(maxOpen) || 5,
                    maxDailyLossPercent: Number(maxDailyLoss) || 5,
                    allowedInstruments: allowedInstruments.split(",").map((s) => s.trim()).filter(Boolean),
                },
            });
            setAcknowledgeRisk("");
        } finally {
            setPolicyBusy(false);
        }
    };

    if (authLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!user) {
        return (
            <AccountShell title="AI Execution">
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/30 py-24 text-center">
                    <Shield className="h-10 w-10 text-muted-foreground" />
                    <h1 className="text-lg font-semibold">Sign in required</h1>
                    <Link href="/login?redirect=/account/ai-execution" className="rounded-lg bg-foreground px-5 py-2 text-sm font-medium text-background">Sign In</Link>
                </div>
            </AccountShell>
        );
    }

    const mode = state?.policy.executionMode ?? "ANALYSIS";
    const killSwitch = state?.killSwitch ?? { engaged: false };
    const automationActive = mode === "AUTOMATION" && state?.policy.enabled === true;

    return (
        <AccountShell title="AI Execution" subtitle="Evidence-driven trade plans with a deterministic execution gate">
            <div className="space-y-6">
                {error && (
                    <div role="alert" className="flex items-center gap-2 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {error}
                    </div>
                )}

                {/* ── Mode + safety banner ─────────────────────────────── */}
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-border bg-card p-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Settings2 className="h-3.5 w-3.5" /> Execution mode</div>
                        <p className={cn("mt-2 text-sm font-semibold", automationActive ? "text-warning" : "text-foreground")}>{MODE_LABEL[mode] ?? mode}</p>
                        <button type="button" onClick={() => setShowPolicy((s) => !s)} className="mt-3 text-xs text-primary hover:underline">
                            {showPolicy ? "Hide policy" : "Configure policy"}
                        </button>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Shield className="h-3.5 w-3.5" /> Kill switch</div>
                        {killSwitch.engaged ? (
                            <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-negative"><ShieldOff className="h-4 w-4" /> ENGAGED {killSwitch.reason ? `— ${killSwitch.reason}` : ""}</p>
                        ) : (
                            <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-positive"><CheckCircle2 className="h-4 w-4" /> Clear</p>
                        )}
                        <p className="mt-3 text-[11px] text-muted-foreground">Platform admins can halt all automated execution instantly.</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Activity className="h-3.5 w-3.5" /> MT5 account</div>
                        <p className="mt-2 text-sm font-semibold">{state?.account.connected ? <span className="text-positive">Connected</span> : <span className="text-warning">Not connected</span>}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">Execution runs through your existing gateway account.</p>
                        {!state?.account.connected && (
                            <Link href="/account/trading-access" className="mt-3 inline-block text-xs text-primary hover:underline">Connect via Trading Access →</Link>
                        )}
                    </div>
                </div>

                {automationActive && (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning" role="status">
                        <strong className="font-semibold">Automated execution is ENABLED.</strong> Qualifying plans execute automatically through the deterministic risk gate under your policy limits. The kill switch stops new entries immediately.
                    </div>
                )}

                {/* ── Policy editor ────────────────────────────────────── */}
                {showPolicy && (
                    <div className="rounded-lg border border-border bg-card p-4">
                        <h3 className="text-sm font-semibold">Automation policy</h3>
                        <p className="mt-1 text-[11px] text-muted-foreground">Limits are clamped server-side against platform hard ceilings — the UI can only narrow them, never widen.</p>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="text-muted-foreground">Execution mode</span>
                                <select
                                    value={policyMode}
                                    onChange={(e) => setPolicyMode(e.target.value as typeof policyMode)}
                                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary/50"
                                >
                                    <option value="ANALYSIS">Analysis (no execution)</option>
                                    <option value="APPROVAL">Approval (explicit per-trade approval)</option>
                                    <option value="AUTOMATION">Automation (opt-in, strict controls)</option>
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="text-muted-foreground">Allowed instruments (comma-separated)</span>
                                <input value={allowedInstruments} onChange={(e) => setAllowedInstruments(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50" />
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="text-muted-foreground">Max risk per trade (%)</span>
                                <input value={maxRisk} onChange={(e) => setMaxRisk(e.target.value)} inputMode="decimal" className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50" />
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="text-muted-foreground">Max open positions</span>
                                <input value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} inputMode="numeric" className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50" />
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="text-muted-foreground">Max daily loss (%)</span>
                                <input value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(e.target.value)} inputMode="decimal" className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50" />
                            </label>
                        </div>

                        {policyMode === "AUTOMATION" && state?.policy.executionMode !== "AUTOMATION" && (
                            <label className="mt-3 flex flex-col gap-1 text-xs">
                                <span className="text-warning">Type &quot;I accept the risks of automated trading&quot; to enable Automation</span>
                                <input value={acknowledgeRisk} onChange={(e) => setAcknowledgeRisk(e.target.value)} className="rounded-md border border-warning/50 bg-background px-2 py-1.5 text-xs outline-none focus:border-warning" />
                            </label>
                        )}

                        <div className="mt-4 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={savePolicy}
                                disabled={policyBusy}
                                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                            >
                                {policyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings2 className="h-3.5 w-3.5" />}
                                Save policy
                            </button>
                            <span className="text-[11px] text-muted-foreground">Switching back to Analysis or Approval disables automation immediately.</span>
                        </div>
                    </div>
                )}

                {/* ── Pending approvals ────────────────────────────────── */}
                <section>
                    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4 text-warning" /> Pending approvals ({pendingPlans.length})</h2>
                    {pendingPlans.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">No plans awaiting approval. Plans appear here when a workflow or the terminal generates one in Approval mode.</div>
                    ) : (
                        <div className="space-y-3">
                            {pendingPlans.map((plan) => <ApprovalCard key={plan.id} plan={plan} busy={busyPlan === plan.id} onDecision={(a) => post("/api/ai-execution/approve", { planId: plan.id, action: a })} />)}
                        </div>
                    )}
                </section>

                {/* ── Active plans / positions ─────────────────────────── */}
                <section>
                    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-info" /> Active plans ({activePlans.length})</h2>
                    {activePlans.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">No active plans.</div>
                    ) : (
                        <div className="overflow-hidden rounded-lg border border-border">
                            <table className="w-full text-xs">
                                <thead className="bg-muted/40 text-left text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">Plan</th>
                                        <th className="px-3 py-2 font-medium">Instrument</th>
                                        <th className="px-3 py-2 font-medium">Direction</th>
                                        <th className="px-3 py-2 font-medium">Entry / SL</th>
                                        <th className="px-3 py-2 font-medium">Status</th>
                                        <th className="px-3 py-2 font-medium">Ticket</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activePlans.map((p) => (
                                        <tr key={p.id} className="border-t border-border">
                                            <td className="px-3 py-2 font-mono text-[11px]">{p.id.slice(0, 16)}…</td>
                                            <td className="px-3 py-2 font-mono">{p.instrument}</td>
                                            <td className={cn("px-3 py-2 font-semibold", p.direction === "BUY" ? "text-positive" : "text-negative")}>{p.direction}</td>
                                            <td className="px-3 py-2 font-numeric tabular-nums">{fmtPrice(p.entry, p.instrument)} / {fmtPrice(p.stopLoss, p.instrument)}</td>
                                            <td className={cn("px-3 py-2 font-semibold", STATUS_COLOR[p.status])}>{p.status}</td>
                                            <td className="px-3 py-2 font-mono text-[11px]">{p.execution?.gatewayTicket ?? p.execution?.clientOrderId ?? "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* ── History (audit) ──────────────────────────────────── */}
                <section>
                    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-muted-foreground" /> Execution history ({closedPlans.length} closed · {state?.audit.length ?? 0} events)</h2>
                    <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-3">
                        {(state?.audit ?? []).length === 0 ? (
                            <p className="py-4 text-center text-xs text-muted-foreground">No audit events yet.</p>
                        ) : (
                            (state?.audit ?? []).map((e) => (
                                <div key={e.id} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-[11px] last:border-0">
                                    <span className="font-numeric tabular-nums text-muted-foreground">{fmtTime(e.timestamp)}</span>
                                    <span className={cn("font-semibold", e.action.includes("REJECT") || e.action.includes("FAILED") ? "text-negative" : e.action.includes("APPROVAL") || e.action.includes("ACCEPTED") ? "text-positive" : "text-foreground")}>{e.action}</span>
                                    {e.planId && <span className="font-mono text-[10px] text-muted-foreground">{e.planId.slice(0, 14)}…</span>}
                                    {e.reason && <span className="min-w-0 truncate text-muted-foreground">{e.reason}</span>}
                                </div>
                            ))
                        )}
                    </div>
                </section>

                <p className="text-[11px] leading-5 text-muted-foreground">
                    Every AI-generated plan is grounded in evidence from AlgoVault&apos;s market-intelligence engines and passes a deterministic gate
                    (schema → evidence → freshness → setup lifecycle → risk → authorization → policy → duplicate check) before any order reaches your
                    MT5 account. AI confidence is never a guarantee, and backtest or replay results never represent live execution performance.
                </p>
            </div>
        </AccountShell>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval card — the explicit user action surface
// ─────────────────────────────────────────────────────────────────────────────

function ApprovalCard({ plan, busy, onDecision }: { plan: TradePlan; busy: boolean; onDecision: (action: "approve" | "withdraw") => void }) {
    const [open, setOpen] = useState(true);
    const nonAiEvidence = plan.evidence.filter((e) => e.evidenceClass !== "AI_INTERPRETATION" && e.evidenceClass !== "UNAVAILABLE");

    return (
        <div className="rounded-lg border border-warning/40 bg-card">
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left" aria-expanded={open}>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                    <span className={cn("font-bold", plan.direction === "BUY" ? "text-positive" : "text-negative")}>{plan.direction}</span>
                    <span className="font-mono font-semibold">{plan.instrument}</span>
                    <span className="text-muted-foreground">@</span>
                    <span className="font-numeric tabular-nums">{fmtPrice(plan.entry, plan.instrument)}</span>
                    <span className="text-muted-foreground">SL {fmtPrice(plan.stopLoss, plan.instrument)}</span>
                    <span className="text-muted-foreground">TP {plan.takeProfits.map((t) => fmtPrice(t.price, plan.instrument)).join(" / ")}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{plan.timeframe}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">risk {plan.riskPercent}%</span>
                </div>
                <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition", open && "rotate-90")} />
            </button>

            {open && (
                <div className="border-t border-border px-4 py-3">
                    <div className="grid gap-3 text-xs md:grid-cols-2">
                        <div>
                            <h4 className="font-semibold text-muted-foreground">Why (evidence — {nonAiEvidence.length} deterministic items)</h4>
                            <ul className="mt-1 space-y-0.5">
                                {nonAiEvidence.slice(0, 6).map((e) => (
                                    <li key={e.id} className="flex gap-1.5">
                                        <span className="rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">{e.evidenceClass}</span>
                                        <span className="min-w-0 flex-1 truncate">{e.label}: <span className="font-numeric">{String(e.value)}</span></span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold text-muted-foreground">Invalidation</h4>
                            <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                                {plan.invalidationConditions.slice(0, 4).map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                            {plan.aiInterpretation && (
                                <>
                                    <h4 className="mt-2 font-semibold text-muted-foreground">AI interpretation <span className="rounded bg-primary/10 px-1 text-[10px] uppercase text-primary">AI</span></h4>
                                    <p className="mt-1 max-h-24 overflow-y-auto text-[11px] leading-4 text-muted-foreground">{plan.aiInterpretation}</p>
                                </>
                            )}
                        </div>
                    </div>

                    {plan.riskValidation && (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                            Last gate evaluation: <span className={plan.riskValidation.approved ? "text-positive" : "text-negative"}>{plan.riskValidation.code}</span>
                            {plan.riskValidation.reason ? ` — ${plan.riskValidation.reason}` : ""} at {fmtTime(plan.riskValidation.evaluatedAt)} (re-checked server-side on approval).
                        </p>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onDecision("approve")}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-md bg-positive px-4 py-1.5 text-xs font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                        >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            Approve &amp; execute
                        </button>
                        <button
                            type="button"
                            onClick={() => onDecision("withdraw")}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs transition hover:bg-muted disabled:opacity-50"
                        >
                            <XCircle className="h-3.5 w-3.5" />
                            Withdraw
                        </button>
                        <span className="ml-auto text-[10px] text-muted-foreground">Destination: MT5 via your connected gateway account. The gate re-runs on approval — expired or risk-failing plans are refused.</span>
                    </div>
                </div>
            )}
        </div>
    );
}
