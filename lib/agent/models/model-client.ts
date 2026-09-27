// AlgoVault Agent IDE — Model Client (AI Router integration)
//
// Every AI call the agent makes goes through the EXISTING gateway: defaultRouter.chat
// with `source: "agent"`. No independent model-selection system is created here —
// the router already implements provider fallback, free-only enforcement, and the
// pre-flight budget guard (evaluateBudgetSafely). This wrapper adds:
//   • per-run request counting against RunLimits.maxAIRequests
//   • budgetBlocked → fail closed for the agent (stop safely, never bypass)
//   • redaction of any content before it is returned to the runtime
// ─────────────────────────────────────────────────────────────────────────────

import { defaultRouter } from "@/lib/ai/router";
import { redactSecrets } from "../policies/redaction";
import type { ToolExecutionContext } from "../core/types";

export interface AgentAIResult {
    ok: boolean;
    text: string;
    provider?: string;
    model?: string;
    budgetBlocked?: boolean;
    error?: string;
}

export interface AgentAIOptions {
    systemPrompt: string;
    userPrompt: string;
    /** Logical task, e.g. "plan" | "fix" | "report". Used as sourceId. */
    purpose: string;
    maxTokens?: number;
    temperature?: number;
    /** Test seam: inject a fake chat function. */
    chatFn?: typeof defaultRouter.chat;
}

/**
 * One agent AI call. Fail-closed on budget: if the router reports
 * budgetBlocked, the agent must NOT attempt other paths — it stops and reports.
 */
export async function agentAI(options: AgentAIOptions, ctx: ToolExecutionContext): Promise<AgentAIResult> {
    // 1. Per-run AI request budget.
    if (ctx.limits.aiRequests >= ctx.limits.limits.maxAIRequests) {
        return { ok: false, text: "", error: "AI request limit reached for this run.", budgetBlocked: true };
    }
    ctx.limits.aiRequests += 1;

    // 2. Route through the existing gateway with agent attribution.
    try {
        const response = await defaultRouter.chat(
            {
                messages: [{ role: "user", content: redactSecrets(options.userPrompt) }],
                systemPrompt: redactSecrets(options.systemPrompt),
                maxTokens: options.maxTokens ?? 2_000,
                temperature: options.temperature ?? 0.2,
                responseFormat: "text",
            },
            {
                source: "agent",
                sourceId: options.purpose,
                userId: ctx.uid,
            },
        );

        if (response.budgetBlocked) {
            return {
                ok: false,
                text: "",
                budgetBlocked: true,
                provider: response.provider,
                error: `AI budget blocked: ${response.budgetBlocked.reason}`,
            };
        }

        if (!response.success) {
            return {
                ok: false,
                text: "",
                provider: response.provider,
                model: response.model,
                error: `AI request failed on provider ${response.provider}.`,
            };
        }

        return {
            ok: true,
            text: redactSecrets(response.content),
            provider: response.provider,
            model: response.model,
        };
    } catch (err) {
        return {
            ok: false,
            text: "",
            error: err instanceof Error ? redactSecrets(err.message) : "AI request failed.",
        };
    }
}
