// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Runtime / Orchestrator
//
// Lifecycle:
//   scope check → context build → plan → rule gate → execute steps (tools,
//   confirmations, limits) → verify (typecheck/tests) → git diff → final report
//
// Fail-closed everywhere: unverified root, out-of-scope request, exceeded
// budget or exhausted limits stop the run safely. Run records, events and the
// final diff persist to RTDB (sanitized). Only operational events are emitted —
// never private chain-of-thought.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { getProjectRoot } from "../policies/path-sandbox";
import { checkRequestScope, scopeRefusalMessage } from "./scope-guard";
import { createDefaultRegistry, AgentToolRegistry } from "../tools/registry";
import { createLimitsState, defaultLimitsFor, isLimitReached } from "./types";
import type {
    AgentEvent, AgentEventType, AgentMode, AgentPlan, AgentRunRecord,
    RunLimits, ToolExecutionContext,
} from "./types";
import type { PolicyState as EnginePolicyState } from "../policies/permission-engine";
import { appendAgentRunEvent, createAgentRun, updateAgentRun, saveAgentRunDiff } from "./rtdb-store";
import { buildContext } from "../context/context-builder";
import { evaluateProjectRules } from "../context/rule-engine";
import { agentAI } from "../models/model-client";
import { captureGitDiff } from "../tools/git-tools";
import { redactSecrets, redactErrorForLog } from "../policies/redaction";

// ── Per-run in-memory state (confirmations are process-local by design) ──────

interface RunState {
    uid: string;
    mode: AgentMode;
    controller: AbortController;
    policyState: EnginePolicyState;
    events: AgentEvent[];
    eventSeq: number;
    status: "planning" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled";
    plan: AgentPlan | null;
    startedAt: number;
}

const COMPLETED_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

export class AgentRuntime {
    private runs = new Map<string, RunState>();
    private registry: AgentToolRegistry;

    constructor(registry?: AgentToolRegistry) {
        this.registry = registry ?? createDefaultRegistry();
    }

    listRuns(): string[] {
        return [...this.runs.keys()];
    }

    /** Emit an operational event (bounded, redacted, persisted best-effort). */
    private emit(uid: string, runId: string, type: AgentEventType, message: string, data?: Record<string, unknown>): void {
        const state = this.runs.get(runId);
        if (!state) return;
        state.eventSeq += 1;
        const event: AgentEvent = {
            seq: state.eventSeq,
            runId,
            type,
            message: redactSecrets(message.slice(0, 1_000)),
            at: Date.now(),
            ...(data ? { data: redactEventData(data) } : {}),
        };
        state.events.push(event);
        if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
        void appendAgentRunEvent(uid, runId, event);
    }

    /**
     * Start a run. The API layer has already authenticated the user (requireAdmin);
     * the runtime independently refuses to start when the root is unverified or
     * the request is out of scope.
     */
    async startRun(params: {
        uid: string;
        request: string;
        mode: AgentMode;
        taskId?: string;
        confirmations?: string[];
        permissionOverrides?: string[];
    }): Promise<{ runId: string } | { runId: null; error: string; code: string }> {
        const { uid, request, mode } = params;

        if (!getProjectRoot()) {
            return { runId: null, error: "Project root could not be verified — agent is disabled (fail closed).", code: "project_root_unverified" };
        }

        // Scope guard: refuse out-of-scope requests in code.
        const scope = checkRequestScope(request);
        if (scope.verdict === "out_of_scope") {
            return { runId: null, error: scopeRefusalMessage(scope.reason), code: "out_of_scope" };
        }
        if (scope.verdict === "ambiguous" && mode !== "ask") {
            return { runId: null, error: scopeRefusalMessage(scope.reason), code: "ambiguous_scope" };
        }

        const runId = `run_${randomUUID().slice(0, 12)}`;
        const taskId = params.taskId ?? `task_${randomUUID().slice(0, 8)}`;

        const controller = new AbortController();
        const policyState: EnginePolicyState = {
            mode,
            rootVerified: true,
            grantedConfirmations: new Set(params.confirmations ?? []),
            permissionOverrides: new Set((params.permissionOverrides ?? []) as never),
        };

        const state: RunState = {
            uid,
            mode,
            controller,
            policyState,
            events: [],
            eventSeq: 0,
            status: "planning",
            plan: null,
            startedAt: Date.now(),
        };
        this.runs.set(runId, state);

        const record: AgentRunRecord = {
            runId,
            taskId,
            request: redactSecrets(request.slice(0, 2_000)),
            mode,
            status: "planning",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await createAgentRun(uid, record).catch(() => undefined);

        void this.executeRun(uid, runId, request).catch((err) => {
            this.emit(uid, runId, "error", redactErrorForLog(err));
            void updateAgentRun(uid, runId, { status: "failed", finishedAt: Date.now() }).catch(() => undefined);
        });

        return { runId };
    }

    /** Grant a confirmation for a run (approval layer). */
    grantConfirmation(runId: string, confirmCode: string): boolean {
        const state = this.runs.get(runId);
        if (!state) return false;
        const grants = state.policyState.grantedConfirmations as Set<string>;
        grants.add(confirmCode);
        this.emit(state.uid, runId, "confirmation_granted", `Confirmation granted.`, { confirmCode: confirmCode.split(":")[0] });
        return true;
    }

    /** Cancel a run (stop button). Bounded commands observe the signal. */
    cancelRun(runId: string, reason = "Cancelled by user."): boolean {
        const state = this.runs.get(runId);
        if (!state) return false;
        state.controller.abort();
        state.status = "cancelled";
        this.emit(state.uid, runId, "cancelled", reason);
        void updateAgentRun(state.uid, runId, { status: "cancelled", finishedAt: Date.now(), summary: reason }).catch(() => undefined);
        // Keep state briefly for status polling; entries are cleared on completion paths.
        return true;
    }

    getStatus(runId: string): {
        status: RunState["status"];
        events: AgentEvent[];
        mode: AgentMode;
        plan: AgentPlan | null;
    } | null {
        const state = this.runs.get(runId);
        if (!state) return null;
        return {
            status: state.status,
            events: state.events.slice(-80),
            mode: state.mode,
            plan: state.plan,
        };
    }

    // ── Main loop ─────────────────────────────────────────────────────────

    private async executeRun(uid: string, runId: string, request: string): Promise<void> {
        const state = this.runs.get(runId);
        if (!state) return;
        const limits = createLimitsState(defaultLimitsFor(state.mode) as RunLimits);
        const signal = state.controller.signal;

        const ctx: ToolExecutionContext = {
            runId,
            uid,
            mode: state.mode,
            signal,
            limits,
            emit: (event) => {
                state.eventSeq += 1;
                const wrapped: AgentEvent = { ...event, seq: state.eventSeq };
                state.events.push(wrapped);
                if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
                void appendAgentRunEvent(uid, runId, wrapped);
            },
        };

        try {
            this.emit(uid, runId, "run_started", "Run started — inspecting repository…");

            // ── 1. Context ────────────────────────────────────────────────
            this.emit(uid, runId, "status", "Building AlgoVault-aware context…");
            const context = await buildContext(request, ctx);
            this.emit(uid, runId, "status", `Context ready: ${context.relevantFiles.length} relevant file(s), ${context.memoryHits} memory hit(s).`);

            // ── 2. Plan ───────────────────────────────────────────────────
            this.emit(uid, runId, "status", "Preparing implementation plan…");
            const planResult = await this.makePlan(request, context.text, ctx);
            if (!planResult.ok) {
                const msg = planResult.budgetBlocked
                    ? "AI budget blocked the planning request — run stopped safely."
                    : (planResult.error ?? "Planning failed.");
                this.emit(uid, runId, planResult.budgetBlocked ? "budget_exceeded" : "error", msg);
                state.status = "failed";
                await updateAgentRun(uid, runId, { status: "failed", finishedAt: Date.now(), summary: msg });
                return;
            }
            state.plan = planResult.plan;
            state.status = "running";
            await updateAgentRun(uid, runId, { status: "running" });
            this.emit(uid, runId, "plan_created", planResult.plan.summary, { steps: planResult.plan.steps.map((s) => s.title) });

            // ── 3. Rule gate ──────────────────────────────────────────────
            const conflicts = evaluateProjectRules({
                paths: planResult.plan.affectedAreas,
                changeSummary: `${planResult.plan.summary} ${planResult.plan.steps.map((s) => s.title).join("; ")}`,
            });
            const blocking = conflicts.filter((c) => c.rule.severity === "block");
            if (blocking.length > 0) {
                const msg = `Plan conflicts with project rules: ${blocking.map((c) => c.conflict).join(" | ")}`;
                this.emit(uid, runId, "rule_violation", msg);
                state.status = "failed";
                await updateAgentRun(uid, runId, { status: "failed", finishedAt: Date.now(), summary: msg });
                return;
            }
            for (const warn of conflicts.filter((c) => c.rule.severity === "warn")) {
                this.emit(uid, runId, "rule_violation", `Warning: ${warn.conflict}`);
            }

            // ── 4. Execute steps ──────────────────────────────────────────
            const filesChanged: string[] = [];
            let deniedCalls = 0;
            let confirmationsNeeded = 0;

            for (const step of planResult.plan.steps) {
                if (signal.aborted) break;
                if (isLimitReached(limits).reached) break;

                this.emit(uid, runId, "plan_step_started", step.title);
                const stepResult = await this.executeStep(uid, runId, step, ctx, state.policyState);
                deniedCalls += stepResult.deniedCalls;

                if (stepResult.confirmations.length > 0) {
                    confirmationsNeeded += stepResult.confirmations.length;
                    state.status = "awaiting_confirmation";
                    await updateAgentRun(uid, runId, { status: "awaiting_confirmation" });
                    for (const c of stepResult.confirmations) {
                        this.emit(uid, runId, "confirmation_required", c.description, { confirmCode: c.confirmCode, toolId: c.toolId });
                    }
                    return; // awaiting human approval; resumption re-enters via grantConfirmation
                }

                for (const f of stepResult.filesChanged) {
                    if (!filesChanged.includes(f)) filesChanged.push(f);
                }
                this.emit(uid, runId, "plan_step_done", `${step.title} — done.`);
            }

            if (signal.aborted) {
                state.status = "cancelled";
                await updateAgentRun(uid, runId, { status: "cancelled", finishedAt: Date.now(), summary: "Run cancelled by user." });
                this.emit(uid, runId, "cancelled", "Run cancelled.");
                return;
            }

            // ── 5. Verify ─────────────────────────────────────────────────
            const verification = await this.verify(planResult.plan.taskKind ?? "unknown", ctx);

            // ── 6. Diff + report ──────────────────────────────────────────
            const diffText = await captureGitDiff(false);
            if (diffText && diffText.trim() !== "") {
                await saveAgentRunDiff(uid, runId, redactSecrets(diffText)).catch(() => undefined);
                this.emit(uid, runId, "diff_ready", `Final diff captured.`);
            }

            const verificationText = Object.entries(verification)
                .map(([k, v]) => `${k}: ${v}`)
                .join("; ");
            const summary = [
                `Task: ${request.slice(0, 300)}`,
                `Mode: ${state.mode}`,
                `Files changed: ${filesChanged.length === 0 ? "none (analysis only)" : filesChanged.join(", ")}`,
                `Verification: ${verificationText || "skipped (read-only task)"}`,
            ].join("\n");

            state.status = "completed";
            await updateAgentRun(uid, runId, {
                status: "completed",
                finishedAt: Date.now(),
                summary: summary.slice(0, 8_000),
                verification,
                filesChanged,
                stats: {
                    toolCalls: state.eventSeq,
                    terminalCommands: limits.terminalCommands,
                    aiRequests: limits.aiRequests,
                    deniedCalls,
                    confirmations: confirmationsNeeded,
                },
            });
            this.emit(uid, runId, "run_ended", `Run completed. ${verificationText || "No verification required."}`);
        } catch (err) {
            state.status = "failed";
            const msg = redactErrorForLog(err);
            this.emit(uid, runId, "error", msg);
            await updateAgentRun(uid, runId, { status: "failed", finishedAt: Date.now(), summary: msg }).catch(() => undefined);
        } finally {
            // Drop completed/failed/cancelled runs from memory (records live in RTDB).
            if (COMPLETED_STATUSES.has(state.status)) {
                setTimeout(() => this.runs.delete(runId), 60_000);
            }
        }
    }

    // ── Planning ──────────────────────────────────────────────────────────

    private async makePlan(
        request: string,
        contextText: string,
        ctx: ToolExecutionContext,
    ): Promise<{ ok: true; plan: AgentPlan } | { ok: false; error?: string; budgetBlocked?: boolean }> {
        const ai = await agentAI(
            {
                purpose: "plan",
                systemPrompt: AGENT_SYSTEM_PROMPT,
                userPrompt: [
                    "Build an execution plan for this AlgoVault engineering task.",
                    "",
                    "Context (repo map, relevant files, memory):",
                    contextText,
                    "",
                    "Request:",
                    request,
                    "",
                    'Respond ONLY with JSON: {"summary": string, "steps": [{"title": string, "tools": string[], "detail": string}], "affectedAreas": string[], "risks": string[], "taskKind": "feature|bugfix|refactor|test|docs|analysis|unknown"}',
                ].join("\n"),
                maxTokens: 1_500,
            },
            ctx,
        );

        if (!ai.ok) {
            return { ok: false, error: ai.error, budgetBlocked: ai.budgetBlocked === true };
        }

        const parsed = parsePlanJson(ai.text);
        if (!parsed) {
            return { ok: false, error: "Planner returned unparseable output." };
        }

        return {
            ok: true,
            plan: {
                summary: String(parsed.summary ?? "Plan"),
                steps: (Array.isArray(parsed.steps) ? parsed.steps : [])
                    .slice(0, 12)
                    .map((s: unknown, i: number) => {
                        const obj = (s ?? {}) as Record<string, unknown>;
                        return {
                            id: `step_${i + 1}`,
                            title: String(obj.title ?? `Step ${i + 1}`).slice(0, 200),
                            tools: Array.isArray(obj.tools) ? obj.tools.map(String).slice(0, 5) : [],
                            detail: obj.detail ? String(obj.detail).slice(0, 500) : undefined,
                        };
                    }),
                affectedAreas: (Array.isArray(parsed.affectedAreas) ? parsed.affectedAreas : []).map(String).slice(0, 20),
                risks: (Array.isArray(parsed.risks) ? parsed.risks : []).map(String).slice(0, 8),
                taskKind: parseTaskKind(parsed.taskKind),
            },
        };
    }

    // ── Step execution via the registry ───────────────────────────────────

    private async executeStep(
        uid: string,
        runId: string,
        step: AgentPlan["steps"][number],
        ctx: ToolExecutionContext,
        policyState: EnginePolicyState,
    ): Promise<{ filesChanged: string[]; deniedCalls: number; confirmations: Array<{ confirmCode: string; toolId: string; description: string }> }> {
        const filesChanged: string[] = [];
        let deniedCalls = 0;
        const confirmations: Array<{ confirmCode: string; toolId: string; description: string }> = [];

        // The model decides the concrete tool calls for this step.
        const ai = await agentAI(
            {
                purpose: `step:${step.id}`,
                systemPrompt: AGENT_SYSTEM_PROMPT,
                userPrompt: [
                    `Step: ${step.title}`,
                    step.detail ? `Detail: ${step.detail}` : "",
                    `Available tools: ${this.registry.list().map((t) => `${t.id} (${t.argsHint})`).join("; ")}`,
                    "",
                    "Decide the next concrete tool call for this step.",
                    'Respond ONLY with JSON: {"tool": string, "args": object} — or {"tool": null} when the step needs no tool call.',
                ].filter(Boolean).join("\n"),
                maxTokens: 600,
            },
            ctx,
        );

        if (!ai.ok) {
            this.emit(uid, runId, ai.budgetBlocked ? "budget_exceeded" : "error", ai.error ?? "Step planning failed.");
            return { filesChanged, deniedCalls, confirmations };
        }

        let call: { tool?: unknown; args?: unknown } | null = null;
        try {
            call = JSON.parse(stripFences(ai.text)) as { tool?: unknown; args?: unknown };
        } catch {
            this.emit(uid, runId, "error", "Step executor returned unparseable tool call.");
            return { filesChanged, deniedCalls, confirmations };
        }

        const toolId = typeof call?.tool === "string" ? call.tool : null;
        if (!toolId || toolId === "null") {
            return { filesChanged, deniedCalls, confirmations }; // step needs no tool
        }

        const args = (call.args && typeof call.args === "object" ? call.args : {}) as Record<string, unknown>;
        this.emit(uid, runId, "tool_started", `Running ${toolId}…`, { toolId });

        const result = await this.registry.execute(toolId, args, ctx, policyState);

        if (result.code === "confirmation_required") {
            const confirmCode = (result.data as { confirmCode?: string } | undefined)?.confirmCode ?? "";
            confirmations.push({
                confirmCode,
                toolId,
                description: `Tool ${toolId} requires confirmation.`,
            });
            return { filesChanged, deniedCalls, confirmations };
        }

        if (!result.ok) {
            if (result.code === "policy_denied" || result.code === "command_blocked") {
                deniedCalls += 1;
                this.emit(uid, runId, "tool_denied", `${toolId} denied: ${result.error ?? "policy"}`, { toolId });
            } else {
                this.emit(uid, runId, "error", `${toolId} failed: ${result.error ?? "unknown error"}`, { toolId });
            }
            return { filesChanged, deniedCalls, confirmations };
        }

        this.emit(uid, runId, "tool_done", `${toolId} completed.`, { toolId, durationMs: result.durationMs });
        return { filesChanged: [...ctx.limits.filesChanged], deniedCalls, confirmations };
    }

    // ── Verification ──────────────────────────────────────────────────────

    private async verify(
        taskKind: AgentPlan["taskKind"],
        ctx: ToolExecutionContext,
    ): Promise<Record<string, string>> {
        const verification: Record<string, string> = {};

        // Typecheck is always valuable after edits; cheap relative to build.
        if (taskKind !== "analysis" && taskKind !== "unknown") {
            const tscResult = await this.registry.execute("tests.run", { target: "typecheck" }, ctx, {
                mode: "engineer",
                rootVerified: true,
                grantedConfirmations: new Set(["*"]),
                permissionOverrides: new Set(),
            } satisfies EnginePolicyState);
            verification.typecheck = tscResult.ok ? "passed" : "failed";

            if (taskKind === "test" || taskKind === "feature") {
                const suite = await this.registry.execute("tests.run", { target: "suite:agentIde" }, ctx, {
                    mode: "engineer",
                    rootVerified: true,
                    grantedConfirmations: new Set(["*"]),
                    permissionOverrides: new Set(),
                } satisfies EnginePolicyState);
                verification.tests = suite.ok ? "passed" : "failed";
            }
        }

        return verification;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTaskKind(value: unknown): AgentPlan["taskKind"] {
    const allowed = ["feature", "bugfix", "refactor", "test", "docs", "analysis", "unknown"];
    const v = String(value ?? "unknown");
    return (allowed as string[]).includes(v) ? (v as AgentPlan["taskKind"]) : "unknown";
}

/** Tolerant JSON extraction: raw → fenced → first{ .. last}. */
function parsePlanJson(text: string): Record<string, unknown> | null {
    const cleaned = stripFences(text).trim();
    try {
        return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
        const first = cleaned.indexOf("{");
        const last = cleaned.lastIndexOf("}");
        if (first !== -1 && last > first) {
            try {
                return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
            } catch {
                return null;
            }
        }
        return null;
    }
}

function stripFences(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return fenced ? fenced[1] : text;
}

function redactEventData(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
        out[k] = typeof v === "string" ? redactSecrets(v.slice(0, 300)) : v;
    }
    return out;
}

export const AGENT_SYSTEM_PROMPT = `You are the AlgoVault Specialized Agent: a software engineering agent for the AlgoVault trading platform ONLY.

Non-negotiable constraints:
- RTDB only, never Firestore. All AI calls via the platform gateway. Never push to git. Never deploy.
- Never read, request, or repeat secrets: .env files, keys, tokens, credentials. Sensitive files are excluded from your context by tooling — do not ask for them.
- You are an engineering assistant, not a financial advisor. Never fabricate trading facts; Market Intelligence stays evidence-driven.
- Preserve anti-lookahead/next-bar backtesting protections and Pro-gating.
- Respond with exactly the JSON shape requested. No chain-of-thought, no hidden reasoning.`;
