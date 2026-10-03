// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Strategy Research Tools (read-only)
//
// The AI Terminal (Agent IDE) can OBSERVE the Autonomous Strategy Research
// Engine: recent missions, stage progress, candidate counts, tail events.
// This tool is deliberately read-only (memory_read permission, mutating:false)
// — the agent can never create, advance, pause or cancel research missions,
// and it never touches execution. All mutation paths stay behind the
// authenticated /api/strategy-research routes with Pro entitlement.
// ─────────────────────────────────────────────────────────────────────────────

import { defineTool, type ToolResult } from "../core/types";
import { redactErrorForLog, redactSecrets } from "../policies/redaction";
import { getMission, listCandidates, listEvents, listMissions } from "@/lib/strategy-research/storage";

function ok(data?: unknown, output?: string): ToolResult {
    return { ok: true, data, output };
}
function fail(error: string, code?: string): ToolResult {
    return { ok: false, error, code };
}

export const researchStatusTool = defineTool(
    {
        id: "research.status",
        description:
            "Read-only Strategy Research status: recent research missions or one mission's stage progress, candidate counts and recent events.",
        category: "knowledge",
        argsHint: "{ missionId?: string }",
    },
    async (args, ctx) => {
        try {
            const missionId = typeof args.missionId === "string" ? args.missionId.trim() : "";

            if (missionId) {
                const mission = await getMission(ctx.uid, missionId);
                if (!mission) return fail(`Mission ${missionId} not found.`, "not_found");
                const candidates = await listCandidates(ctx.uid, missionId);
                const events = await listEvents(ctx.uid, missionId, 20);
                const lifecycleCounts: Record<string, number> = {};
                for (const c of candidates) lifecycleCounts[c.lifecycle] = (lifecycleCounts[c.lifecycle] ?? 0) + 1;

                const lines = [
                    `Mission: ${mission.name} (${mission.id})`,
                    `Status: ${mission.status} · stage: ${mission.currentStage}${mission.failState ? ` · failState: ${mission.failState}` : ""}`,
                    `Spec: ${mission.spec.markets.join(",")} · ${mission.spec.timeframes.join("/")} · ${mission.spec.tradingStyle} · risk=${mission.spec.riskProfile}`,
                    `Stages: ${mission.stages.map((s) => `${s.stage}=${s.status}`).join(", ")}`,
                    `Counts: hypotheses=${mission.hypothesisCount} compiled=${mission.compiledCount} rejected=${mission.rejectedCount} incubating=${mission.survivorCount}`,
                    `Budget: AI ${mission.budgetUsed?.aiRequests ?? 0}/${mission.spec.budget.maxAIRequests} · backtests ${mission.budgetUsed?.backtests ?? 0}/${mission.spec.budget.maxBacktests}`,
                    `Candidates: ${Object.entries(lifecycleCounts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
                    `Recent events:`,
                    ...events.slice(-8).map((e) => `  [${new Date(e.at).toISOString()}] ${e.code ?? e.level}: ${e.message}`),
                    "Research only — live execution is disabled by construction.",
                ];
                return ok({ missionId, status: mission.status, stage: mission.currentStage }, redactSecrets(lines.join("\n")));
            }

            const missions = await listMissions(ctx.uid, 15);
            if (missions.length === 0) {
                return ok({ count: 0 }, "No research missions. Create one at /strategy-research.");
            }
            const summary = missions.map(
                (m) =>
                    `- ${m.id} · ${m.name} · ${m.status}/${m.currentStage} · ${m.spec.markets.join(",")} · candidates=${m.compiledCount} rejected=${m.rejectedCount} incubating=${m.survivorCount}${m.failState ? ` · ${m.failState}` : ""}`
            );
            return ok({ count: missions.length }, redactSecrets(summary.join("\n")));
        } catch (err) {
            return fail(redactErrorForLog(err), "research_status_failed");
        }
    },
);
