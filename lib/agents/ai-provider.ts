import { AIRouter, defaultRouter } from "@/lib/ai/router";
import { AIConfig } from "@/lib/ai/config";
import { AgentContract, AgentOutput, WorkflowContext, EvidenceStrength } from "./types";

/**
 * Per-agent AI invocation through the centralized AI Router.
 * Never exposes provider/model secrets to agents or callers.
 */
export async function callAgentAI(
    agent: AgentContract,
    prompt: string,
    systemPrompt: string,
    opts?: { maxTokens?: number; temperature?: number }
): Promise<{ ok: boolean; text: string; provider?: string; model?: string; error?: string }> {
    try {
        if (agent.modelConfiguration.poweredBy === "deterministic") {
            return { ok: false, text: "", error: "Agent is deterministic — no AI call needed." };
        }
        const response = await defaultRouter.chat({
            messages: [{ role: "user", content: prompt }],
            systemPrompt,
            responseFormat: agent.modelConfiguration.responseFormat || "json_object",
            maxTokens: opts?.maxTokens || agent.modelConfiguration.maxTokens || 2000,
            temperature: opts?.temperature || agent.modelConfiguration.temperature || 0.1,
            model: agent.modelConfiguration.model,
            provider: agent.modelConfiguration.provider,
        });
        if (!response.success) {
            return { ok: false, text: "", error: "AI gateway returned no content." };
        }
        return {
            ok: true,
            text: String(response.content || "").trim(),
            provider: response.provider,
            model: response.model,
        };
    } catch (err) {
        return {
            ok: false,
            text: "",
            error: err instanceof Error ? err.message : "AI call failed.",
        };
    }
}

/**
 * Evidence-strength helper used by the Synthesizer and notification decision.
 */
export function classifyEvidenceStrength(params: {
    criticMajorConflict: boolean;
    verificationPassed: boolean;
    staleData: boolean;
    sampleWeak: boolean;
    similarCount: number;
    tradeCount: number;
    riskFlagCount: number;
}): EvidenceStrength {
    const { criticMajorConflict, verificationPassed, staleData, sampleWeak, similarCount, tradeCount, riskFlagCount } = params;
    if (criticMajorConflict || !verificationPassed) return "conflicting";
    if (staleData) return "limited";
    if (sampleWeak) return "limited";
    if (similarCount >= 5 && tradeCount >= 15 && riskFlagCount === 0) return "strong";
    if (tradeCount === 0 && similarCount === 0) return "insufficient";
    return "moderate";
}
