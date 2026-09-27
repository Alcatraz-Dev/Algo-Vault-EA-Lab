"use client";

// AlgoVault Agent IDE — Cockpit UI
//
// Admin-only (guarded by app/agent/layout.tsx → AdminGuard). Shows operational
// events only — never private chain-of-thought. Follows constitution §54:
// semantic tokens, no gradients/glass, text-[11px] minimum, font-numeric for
// numbers. Renders inside the shared AdminShell, which owns the page header
// (§54.6) and provides the back button to /admin.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type AgentMode = "ask" | "assist" | "engineer" | "autonomous";

interface AgentEventView {
    seq: number;
    type: string;
    message: string;
    at: number;
    data?: Record<string, unknown>;
}

interface RunStatusView {
    status: string;
    events: AgentEventView[];
    mode: AgentMode;
}

interface PolicyView {
    modes: Array<{ id: AgentMode; description: string; permissions: string[]; limits: Record<string, number> }>;
    structurallyBlocked: string[];
    tools: Array<{ id: string; requiresConfirmation: boolean; category: string; mutating: boolean }>;
}

const MODE_LABELS: Record<AgentMode, string> = {
    ask: "ASK",
    assist: "ASSIST",
    engineer: "ENGINEER",
    autonomous: "AUTONOMOUS",
};

const STATUS_TONE: Record<string, string> = {
    planning: "text-info",
    running: "text-positive",
    awaiting_confirmation: "text-warning",
    completed: "text-positive",
    failed: "text-negative",
    cancelled: "text-warning",
};

export default function AgentIDE() {
    const router = useRouter();
    const [task, setTask] = useState("");
    const [mode, setMode] = useState<AgentMode>("ask");
    const [runId, setRunId] = useState<string | null>(null);
    const [status, setStatus] = useState<RunStatusView | null>(null);
    const [policy, setPolicy] = useState<PolicyView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const feedRef = useRef<HTMLDivElement | null>(null);

    // Load the policy surface (what the agent may do).
    useEffect(() => {
        let cancelled = false;
        auth.currentUser?.getIdToken().then(async (token) => {
            if (!token || cancelled) return;
            try {
                const res = await fetch("/api/agent/policy", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = (await res.json()) as PolicyView;
                    if (!cancelled) setPolicy(data);
                }
            } catch {
                // policy panel is non-critical
            }
        });
        return () => { cancelled = true; };
    }, []);

    // Poll run status while a run is active.
    useEffect(() => {
        if (!runId) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) return;
                const res = await fetch(`/api/agent/run?runId=${encodeURIComponent(runId)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = (await res.json()) as RunStatusView;
                    if (!cancelled) setStatus(data);
                    const terminal = ["completed", "failed", "cancelled"].includes(data.status);
                    if (!terminal && !cancelled) {
                        timer = setTimeout(poll, 1_500);
                    }
                } else if (res.status === 404) {
                    // Archived after completion — final state already shown.
                    if (!cancelled) timer = setTimeout(poll, 4_000);
                }
            } catch {
                if (!cancelled) timer = setTimeout(poll, 4_000);
            }
        };
        poll();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [runId]);

    useEffect(() => {
        feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    }, [status?.events.length]);

    const authedFetch = useCallback(async (url: string, init?: RequestInit) => {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Not authenticated.");
        return fetch(url, {
            ...init,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        });
    }, []);

    const startRun = async () => {
        if (task.trim() === "" || submitting) return;
        setSubmitting(true);
        setError(null);
        setStatus(null);
        try {
            const res = await authedFetch("/api/agent/run", {
                method: "POST",
                body: JSON.stringify({ request: task, mode }),
            });
            const data = (await res.json()) as { runId?: string; error?: string };
            if (!res.ok || !data.runId) {
                setError(data.error ?? "Failed to start the run.");
            } else {
                setRunId(data.runId);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to start the run.");
        } finally {
            setSubmitting(false);
        }
    };

    const cancelRun = async () => {
        if (!runId) return;
        await authedFetch("/api/agent/run", {
            method: "POST",
            body: JSON.stringify({ action: "cancel", runId }),
        }).catch(() => undefined);
    };

    const pendingConfirmations = (status?.events ?? []).filter((e) => e.type === "confirmation_required");

    const grant = async (confirmCode: string) => {
        if (!runId) return;
        await authedFetch("/api/agent/run", {
            method: "POST",
            body: JSON.stringify({ action: "confirm", runId, confirmCode }),
        }).catch(() => undefined);
    };

    const modeMeta = policy?.modes.find((m) => m.id === mode);

    return (
        <AdminShell
            title="AlgoVault Agent IDE"
            subtitle="Specialized engineering agent — all operations are policy-checked, sandboxed and audited."
            onBack={() => router.push("/admin")}
        >
            <div className="space-y-4">
                {policy && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 font-numeric">
                            {policy.tools.length} tools
                        </span>
                        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 font-numeric">
                            {policy.structurallyBlocked.length} structurally blocked permissions
                        </span>
                    </div>
                )}

                <div className="grid gap-4 lg:grid-cols-3">
                    {/* ── Task + controls ─────────────────────────────── */}
                    <section className="rounded-lg border border-border bg-card p-4 shadow-sm lg:col-span-2">
                        <label className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="agent-task">
                            Engineering task
                        </label>
                        <textarea
                            id="agent-task"
                            value={task}
                            onChange={(e) => setTask(e.target.value)}
                            rows={3}
                            maxLength={8_000}
                            placeholder="e.g. Investigate the trade-management monitor and add a regression test for stale gateway tokens."
                            className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"
                        />

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {(Object.keys(MODE_LABELS) as AgentMode[]).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMode(m)}
                                    className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                                        mode === m
                                            ? "bg-primary text-primary-foreground"
                                            : "border border-border text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {MODE_LABELS[m]}
                                </button>
                            ))}
                        </div>

                        {modeMeta && (
                            <p className="mt-2 text-[11px] text-muted-foreground">{modeMeta.description}</p>
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={startRun}
                                disabled={submitting || task.trim() === ""}
                                className="rounded-md bg-primary px-4 py-2 text-[11px] font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
                            >
                                {submitting ? "Starting…" : "Run agent"}
                            </button>
                            {runId && status && !["completed", "failed", "cancelled"].includes(status.status) && (
                                <button
                                    type="button"
                                    onClick={cancelRun}
                                    className="rounded-md border border-negative/60 px-4 py-2 text-[11px] font-semibold text-negative transition-colors hover:bg-negative/10"
                                >
                                    Stop
                                </button>
                            )}
                            {runId && (
                                <button
                                    type="button"
                                    onClick={() => { setRunId(null); setStatus(null); }}
                                    className="rounded-md border border-border px-4 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    New task
                                </button>
                            )}
                        </div>

                        {error && (
                            <p className="mt-3 rounded-lg border border-negative/50 bg-negative/10 p-2 text-[11px] text-negative">{error}</p>
                        )}
                    </section>

                    {/* ── Permission panel ────────────────────────────── */}
                    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Permissions — {MODE_LABELS[mode]}
                        </h2>
                        <ul className="mt-3 space-y-1.5 text-[11px]">
                            {(modeMeta?.permissions ?? []).map((p) => (
                                <li key={p} className="flex items-center gap-2">
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
                                    <span className="text-foreground/80">{p.replaceAll("_", " ")}</span>
                                </li>
                            ))}
                        </ul>
                        {policy && policy.structurallyBlocked.length > 0 && (
                            <>
                                <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Always blocked
                                </h3>
                                <ul className="mt-2 space-y-1.5 text-[11px]">
                                    {policy.structurallyBlocked.map((p) => (
                                        <li key={p} className="flex items-center gap-2">
                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-negative" />
                                            <span className="text-muted-foreground">{p.replaceAll("_", " ")}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>

                    {/* ── Activity feed ───────────────────────────────── */}
                    <section className="rounded-lg border border-border bg-card p-4 shadow-sm lg:col-span-2">
                        <div className="flex items-center justify-between">
                            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Activity
                            </h2>
                            {status && (
                                <span className={`font-numeric text-[11px] ${STATUS_TONE[status.status] ?? "text-muted-foreground"}`}>
                                    {status.status.replaceAll("_", " ")}
                                </span>
                            )}
                        </div>

                        {!status && (
                            <p className="mt-4 text-[11px] text-muted-foreground">
                                No active run. Describe an AlgoVault engineering task and press “Run agent”.
                            </p>
                        )}

                        <div ref={feedRef} className="mt-3 max-h-[420px] overflow-y-auto pr-1">
                            <ol className="space-y-1.5">
                                {(status?.events ?? []).map((e) => (
                                    <li key={`${e.seq}-${e.at}`} className="flex items-start gap-2 text-[11px]">
                                        <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                                        <span className="font-numeric text-muted-foreground">
                                            {new Date(e.at).toLocaleTimeString()}
                                        </span>
                                        <span className="text-foreground/85">{e.message}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </section>

                    {/* ── Approvals ───────────────────────────────────── */}
                    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Approvals
                        </h2>
                        {!runId || pendingConfirmations.length === 0 ? (
                            <p className="mt-3 text-[11px] text-muted-foreground">Nothing awaiting confirmation.</p>
                        ) : (
                            <ul className="mt-3 space-y-3">
                                {pendingConfirmations.map((e) => {
                                    const code = typeof e.data?.confirmCode === "string" ? e.data.confirmCode : "";
                                    return (
                                        <li key={`${e.seq}-confirm`} className="rounded-lg border border-warning/50 bg-warning/10 p-3">
                                            <p className="text-[11px] text-foreground/85">{e.message}</p>
                                            {typeof e.data?.toolId === "string" && (
                                                <p className="mt-1 font-numeric text-[11px] text-muted-foreground">{e.data.toolId}</p>
                                            )}
                                            <div className="mt-2 flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => grant(code)}
                                                    className="rounded-md bg-positive px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity"
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelRun}
                                                    className="rounded-md border border-negative/60 px-3 py-1.5 text-[11px] font-semibold text-negative transition-colors hover:bg-negative/10"
                                                >
                                                    Deny &amp; stop
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </div>

                <p className="text-[11px] text-muted-foreground">
                    Security boundary: project-sandboxed filesystem · sensitive-file denylist · secret redaction · command classification ·
                    confirmation-gated writes · git push and deployment structurally blocked · AI budget fail-closed.
                </p>
            </div>
        </AdminShell>
    );
}
