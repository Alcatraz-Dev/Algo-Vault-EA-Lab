/** AlgoVault Agentic Trading Intelligence — Agent Observability (Phase 14 §46)

 * Admin should see: Agent, Run, Task, Duration, Model, Tool Calls, Errors,
 * Cost, Outcome, Blocked Actions. Never expose private prompts unnecessarily.
 */

import type { AgentObservabilityRecord } from "./agent-governance";
import { InMemoryObservabilityStore } from "./agent-integrations";

// ─── Observability store ───────────────────────────────────────────────────────
export class Observability extends InMemoryObservabilityStore {
  record(record: Omit<AgentObservabilityRecord, "createdAt">) {
    super.record({ ...record, createdAt: Date.now() });
  }

  listAgentRuns(agentId?: string, limit = 100): AgentObservabilityRecord[] {
    return super.list(agentId, limit);
  }

  summarize(agentId?: string): { totalRuns: number; totalDurationMs: number; totalToolCalls: number; totalErrors: number; totalCostCents: number; blockedActions: number; successRate: number } {
    const runs = this.listAgentRuns(agentId);
    let totalRuns = 0;
    let totalDurationMs = 0;
    let totalToolCalls = 0;
    let totalErrors = 0;
    let totalCostCents = 0;
    let blockedActions = 0;
    let successes = 0;
    for (const run of runs) {
      totalRuns++;
      totalDurationMs += run.durationMs;
      totalToolCalls += run.toolCalls;
      totalErrors += run.errors;
      totalCostCents += run.costCents;
      blockedActions += run.blockedActions;
      if (run.outcome === "success") successes++;
    }
    return {
      totalRuns,
      totalDurationMs,
      totalToolCalls,
      totalErrors,
      totalCostCents,
      blockedActions,
      successRate: totalRuns > 0 ? successes / totalRuns : 0,
    };
  }
}
