/**
 * AI provider adapter for AI Trading Teams.
 *
 * Uses the EXISTING AlgoVault AI router (`defaultRouter`) — no hard-coded
 * provider, full provider fallback chain, budget guard and usage accounting.
 * The usage context uses the existing `agent` source with a `ai-trading-team/…`
 * sourceId so admin AI usage views can attribute cost per feature without any
 * change to the usage schema.
 */

import { defaultRouter } from "@/lib/ai/router";
import type { AICallRequest, AICallResult, AIFn } from "./agent-executor";

export const TEAM_AI_SOURCE_PREFIX = "ai-trading-team";

export function createTeamAIFn(): AIFn {
    return async (request: AICallRequest): Promise<AICallResult> => {
        try {
            const response = await defaultRouter.chat(
                {
                    messages: [{ role: "user", content: request.user }],
                    systemPrompt: request.system,
                    responseFormat: request.responseFormat ?? "json_object",
                    maxTokens: request.maxTokens,
                    temperature: request.temperature,
                },
                {
                    source: "agent",
                    sourceId: `${TEAM_AI_SOURCE_PREFIX}/${request.sourceId}`,
                    ...(request.userId ? { userId: request.userId } : {}),
                },
            );

            if (!response.success || !response.content) {
                return {
                    ok: false,
                    content: "",
                    error: response.fallbackErrors?.length
                        ? `All AI providers failed: ${response.fallbackErrors.map((e) => e.code).join(", ")}`
                        : "AI gateway returned no content.",
                };
            }

            return {
                ok: true,
                content: response.content,
                provider: response.provider,
                model: response.model,
            };
        } catch (err) {
            return {
                ok: false,
                content: "",
                error: err instanceof Error ? err.message : "AI request failed.",
            };
        }
    };
}

export const teamAIFn: AIFn = createTeamAIFn();
