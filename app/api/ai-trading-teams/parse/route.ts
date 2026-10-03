import { NextRequest } from "next/server";
import { authenticateTeams, badRequest, deny, flagDisabled, ok, readJson, unauthorized } from "../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { defaultRouter } from "@/lib/ai/router";
import { listAgentLibrary } from "@/lib/ai-trading-teams/agents";
import { extractIntentsFromRequest, validateAgentIdList, validateTeamConfig } from "@/lib/ai-trading-teams/validation";
import type { TeamConfig } from "@/lib/ai-trading-teams/types";

interface ParsedTeamDraft {
    name?: string;
    config?: unknown;
    agentIds?: unknown;
}

/**
 * POST /api/ai-trading-teams/parse
 *
 * Converts a natural-language request into a STRUCTURED team configuration.
 * The model output is never trusted: it is validated against the same schema
 * used for manual configuration, and unknown agent ids are dropped in favor of
 * deterministic intent-based selection.
 */
export async function POST(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const body = await readJson(request);
    const text = String(body.request ?? "").trim().slice(0, 600);
    if (text.length < 8) return badRequest("Describe the team you want in at least a sentence.");

    const intents = extractIntentsFromRequest(text);

    try {
        const library = await listAgentLibrary(auth.uid);
        const available = library
            .filter((a) => a.enabled !== false)
            .map((a) => ({ id: a.id, name: a.name, tags: a.activationTags, category: a.category }));

        const system =
            "You convert a trader's description into an AlgoVault AI Trading Team configuration. " +
            "Return ONLY a JSON object: { \"name\": string, \"config\": { \"market\": string, " +
            "\"style\": \"scalping|intraday|swing|position|research\", \"entryTimeframe\": string, " +
            "\"confirmationTimeframe\": string, \"contextTimeframe\": string, " +
            "\"riskProfile\": \"conservative|balanced|aggressive\", \"behavior\": \"consensus|evidence-weighted|risk-first|research-first\", " +
            "\"intents\": string[] }, \"agentIds\": string[] }. " +
            "Only use agentIds from the provided list. Timeframes are uppercase like M5, M15, H1, H4, D1. " +
            "Pick a concise team name. Never add fields that were not requested.";

        const response = await defaultRouter.chat(
            {
                messages: [
                    {
                        role: "user",
                        content: `REQUEST\n${text}\n\nAVAILABLE AGENTS\n${JSON.stringify(available)}\n\nDETERMINISTIC INTENT HINTS\n${intents.join(", ")}`,
                    },
                ],
                systemPrompt: system,
                responseFormat: "json_object",
                temperature: 0.1,
                maxTokens: 1200,
            },
            { source: "agent", sourceId: "ai-trading-team/parse", userId: auth.uid },
        );

        if (!response.success || !response.content) {
            return badRequest("AI provider could not parse the request. Please configure the team manually.");
        }

        const cleaned = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        let draft: ParsedTeamDraft;
        try {
            draft = JSON.parse(start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned) as ParsedTeamDraft;
        } catch {
            return badRequest("AI provider returned an unreadable configuration. Please configure the team manually.");
        }

        const configValidation = validateTeamConfig(draft.config);
        const warnings: string[] = [];
        if (!configValidation.valid) {
            return badRequest("Generated configuration failed validation.", configValidation.errors);
        }
        const config = configValidation.value as TeamConfig;

        // Agent selection: keep only ids that exist in the user's library.
        const libraryIds = new Set(library.map((a) => a.id));
        const requested = Array.isArray(draft.agentIds) ? (draft.agentIds as unknown[]) : [];
        const agentIds = requested
            .filter((id): id is string => typeof id === "string" && libraryIds.has(id))
            .slice(0, 12);
        const dropped = requested.filter((id) => typeof id !== "string" || !libraryIds.has(id));
        if (dropped.length) warnings.push("Some suggested agents were not recognized and were removed.");

        const agentsValidation = validateAgentIdList(
            agentIds.length >= 2 ? agentIds : undefined,
        );
        if (!agentsValidation.valid) {
            // Deterministic fallback: intent-based selection.
            const fallback = library
                .filter((a) => a.enabled !== false && (a.activationTags.some((t) => intents.includes(t)) || a.isChief))
                .map((a) => a.id)
                .slice(0, 12);
            const fallbackValidation = validateAgentIdList(fallback);
            if (!fallbackValidation.valid) return badRequest("Could not determine a valid agent set.");
            agentIds.push(...(fallbackValidation.value as string[]).filter((id) => !agentIds.includes(id)));
            warnings.push("Agent selection was rebuilt deterministically from intents.");
        }

        if (!agentIds.includes("chief-analyst")) agentIds.push("chief-analyst");

        return ok({
            name: String(draft.name ?? "").trim().slice(0, 80) || `${config.market} ${config.style} team`,
            config,
            agentIds: Array.from(new Set(agentIds)),
            intents,
            warnings,
        });
    } catch (err) {
        console.error("[ai-trading-teams] parse failed:", err);
        return badRequest("Failed to parse the team request.");
    }
}
