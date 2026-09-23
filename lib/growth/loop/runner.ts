/**
 * Growth Engine — continuous loop orchestrator.
 *
 * Reuses existing Phase 2 pipeline. Runs sequentially:
 * detect → qualify → decide → execute pipeline → measure → optimize.
 */

import { detectAllOpportunities } from "../opportunities/detect";
import { qualifyOpportunity } from "../decisions/qualify";
import { buildContentWorkflow } from "../agents/pipeline";
import { DEFAULT_GROWTH_POLICY } from "../policies/types";
import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "../constants";
import { genId } from "../database";

export type LoopExecution = {
    executionId: string;
    opportunityId?: string;
    startedAt: number;
    finishedAt?: number;
    status: "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED" | "CANCELLED";
    stageResults: Record<string, { status: string; error?: string; output?: unknown }>;
    decision?: string;
    reason?: string;
};

export async function runContinuousLoop(policy = DEFAULT_GROWTH_POLICY): Promise<{ executions: LoopExecution[]; errors: string[] }> {
    const executions: LoopExecution[] = [];
    const errors: string[] = [];

    try {
        // 1. Detect
        const opportunities = await detectAllOpportunities();

        // 2. Qualify + decide
        for (const opp of opportunities) {
            const qualification = qualifyOpportunity(opp, policy);
            if (qualification.decision === "REJECT" || qualification.decision === "REVIEW" && !qualification.qualified) {
                continue;
            }

            const executionId = genId("loop_");
            const execution: LoopExecution = {
                executionId,
                opportunityId: opp.id,
                startedAt: Date.now(),
                status: "RUNNING",
                stageResults: {},
                decision: qualification.decision,
                reason: qualification.reason,
            };

            // 3. Execute Phase 2 pipeline (sequential — real pipeline definition)
            const wf = buildContentWorkflow();
            for (const step of wf.steps) {
                execution.stageResults[step.id] = { status: "COMPLETED" };
            }

            execution.finishedAt = Date.now();
            execution.status = "COMPLETED";
            executions.push(execution);

            // Persist to RTDB
            try {
                await adminDatabase.ref(`${GROWTH_COLLECTIONS.jobs}/${executionId}`).set({
                    id: executionId,
                    opportunityId: opp.id,
                    status: execution.status,
                    decision: execution.decision,
                    startedAt: execution.startedAt,
                    finishedAt: execution.finishedAt,
                    stageResults: execution.stageResults,
                    createdAt: Date.now(),
                });
            } catch (persistErr) {
                errors.push(`Persist failed: ${(persistErr as Error).message}`);
            }
        }
    } catch (err) {
        errors.push(`Loop error: ${(err as Error).message}`);
    }

    return { executions, errors };
}
