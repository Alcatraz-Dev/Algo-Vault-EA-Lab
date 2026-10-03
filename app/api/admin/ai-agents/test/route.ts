import { NextRequest } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { isAgentFactoryEnabled } from "@/lib/ai-trading-teams/flags";
import { getAdminAgent } from "@/lib/ai-trading-teams/database";
import { getBuiltinTeamAgent } from "@/lib/ai-trading-teams/agent-library";
import { executeAgent } from "@/lib/ai-trading-teams/agent-executor";
import { createTeamAIFn } from "@/lib/ai-trading-teams/ai";
import { buildDossier, sliceDossierForAgent } from "@/lib/ai-trading-teams/context";
import { validateRunMode } from "@/lib/ai-trading-teams/validation";
import { productionDossierDeps } from "@/lib/ai-trading-teams/execution";
import type { AITradingTeam, TeamAgentDefinition } from "@/lib/ai-trading-teams/types";

/**
 * POST /api/admin/ai-agents/test
 *
 * Admin test playground: runs ONE agent in sandbox mode against a real (or
 * point-in-time) dossier and returns input, context slice, structured output,
 * latency, provider, validation errors and any failure — never secrets.
 */
export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });
    if (!isAgentFactoryEnabled()) {
        return Response.json({ error: "Admin AI Agent Factory is disabled by feature flag." }, { status: 423 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const agentId = String(body.agentId ?? "").trim();
    if (!agentId) return Response.json({ error: "agentId is required." }, { status: 400 });

    const agent: TeamAgentDefinition | null = (await getAdminAgent(agentId)) ?? getBuiltinTeamAgent(agentId) ?? null;
    if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });

    const modeValidation = validateRunMode({ mode: body.mode ?? "live", asOf: body.asOf });
    if (!modeValidation.valid) {
        return Response.json({ error: "Invalid mode.", details: modeValidation.errors }, { status: 400 });
    }
    const { mode, asOf } = modeValidation.value as { mode: "live" | "replay" | "backtest" | "research" | "historical"; asOf: number | null };

    const market = String(body.market ?? "XAUUSD").toUpperCase().slice(0, 12);
    const request_text = String(body.prompt ?? "").slice(0, 400);

    const testTeam: AITradingTeam = {
        id: "sandbox",
        userId: admin.uid,
        name: "Sandbox Test",
        config: {
            market,
            style: "scalping",
            entryTimeframe: String(body.entryTimeframe ?? "M5").toUpperCase(),
            confirmationTimeframe: String(body.confirmationTimeframe ?? "M15").toUpperCase(),
            contextTimeframe: String(body.contextTimeframe ?? "H1").toUpperCase(),
            riskProfile: "balanced",
            behavior: "evidence-weighted",
        },
        agentIds: [agent.id],
        status: "active",
        version: 0,
        source: "user",
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };

    const startedAt = Date.now();
    try {
        const dossier = await buildDossier({
            userId: admin.uid,
            market,
            entryTimeframe: testTeam.config.entryTimeframe,
            confirmationTimeframe: testTeam.config.confirmationTimeframe,
            contextTimeframe: testTeam.config.contextTimeframe,
            mode,
            asOf,
            deps: productionDossierDeps(),
        });

        const slice = sliceDossierForAgent(dossier, agent);
        const output = await executeAgent({
            agent,
            team: testTeam,
            dossier,
            request: request_text || undefined,
            ai: createTeamAIFn(),
            userId: admin.uid,
        });

        return Response.json({
            agentId: agent.id,
            agentVersion: agent.version,
            mode,
            asOf,
            market,
            input: {
                request: request_text || null,
                sections: slice.includedSections,
                missingSections: slice.missingSections,
                referenceCount: Object.keys(slice.refs).length,
                dossierQuality: dossier.meta.quality,
                candleCounts: dossier.meta.candleCounts,
                dataTimestamp: dossier.meta.dataTimestamp,
            },
            output,
            latencyMs: Date.now() - startedAt,
            validation: {
                status: output.status,
                error: output.error ?? null,
                warnings: output.warnings ?? [],
                demotedObservations: output.observations.filter((o) => o.kind === "UNKNOWN").length,
            },
            provider: output.provider ?? null,
            model: output.model ?? null,
        });
    } catch (err) {
        return Response.json(
            {
                error: errMessage(err, "Sandbox run failed."),
                latencyMs: Date.now() - startedAt,
            },
            { status: 500 },
        );
    }
}
