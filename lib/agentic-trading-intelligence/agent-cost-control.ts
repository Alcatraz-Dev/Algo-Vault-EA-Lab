/** AlgoVault Agentic Trading Intelligence — Agent Cost Control (Phase 14 §45)

 * Track: model, tokens, latency, tool calls, compute, estimated cost.
 * Per: user, tenant, agent, task, day, month. Use limits.
 */

import type { AgentCostRecord } from "./agent-governance";
import { InMemoryCostTracker } from "./agent-integrations";

// ─── Default cost limits ───────────────────────────────────────────────────────
export const DEFAULT_COST_LIMITS = {
  perUserPerDayCents: 1000,
  perUserPerMonthCents: 10000,
  perAgentPerDayCents: 500,
  perAgentPerMonthCents: 5000,
  perTaskCents: 100,
};

// ─── Cost tracker with limits ──────────────────────────────────────────────────
export class CostControlledTracker extends InMemoryCostTracker {
  constructor(private readonly limits = DEFAULT_COST_LIMITS) {
    super();
  }

  recordCost(userId: string, tenantId: string, agentId: string, taskId: string, model: string, tokens: number, latencyMs: number, toolCalls: number, computeMs: number, estimatedCostCents: number, period: "day" | "month") {
    super.recordCost(userId, tenantId, agentId, taskId, model, tokens, latencyMs, toolCalls, computeMs, estimatedCostCents, period);
  }

  hasExceededLimit(userId: string, tenantId: string, agentId: string, period: "day" | "month", periodKey: string, limitCents = this.limits.perUserPerDayCents): boolean {
    return super.hasExceededLimit(userId, tenantId, agentId, period, periodKey, limitCents);
  }

  checkLimit(userId: string, tenantId: string, agentId: string, taskId: string, model: string, tokens: number, latencyMs: number, toolCalls: number, computeMs: number, estimatedCostCents: number, period: "day" | "month"): { allowed: boolean; reason?: string } {
    const periodKey = period === "day" ? new Date().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 7);
    const current = super.getCost(userId, tenantId, agentId, period, periodKey);
    const limit = period === "day" ? this.limits.perUserPerDayCents : this.limits.perUserPerMonthCents;
    if (current + estimatedCostCents > limit) {
      return { allowed: false, reason: `Cost limit exceeded. Current: ${current}¢, estimated addition: ${estimatedCostCents}¢, limit: ${limit}¢.` };
    }
    super.recordCost(userId, tenantId, agentId, taskId, model, tokens, latencyMs, toolCalls, computeMs, estimatedCostCents, period);
    return { allowed: true };
  }
}

// ─── Token estimation ──────────────────────────────────────────────────────────
export function estimateTokenCost(promptTokens: number, completionTokens: number, model: string, pricePerToken?: number): number {
  // Simplified: assume $0.0001 per token if no price provided.
  const price = pricePerToken ?? 0.0001;
  return Math.round((promptTokens + completionTokens) * price * 100) / 100;
}

// ─── Latency tracking ──────────────────────────────────────────────────────────
export function trackLatency(startMs: number, endMs: number): number {
  return endMs - startMs;
}

// ─── Compute cost estimation ───────────────────────────────────────────────────
export function estimateComputeCost(computeMs: number, model: string): number {
  // Simplified: assume $0.00001 per ms of compute.
  return Math.round(computeMs * 0.00001 * 100) / 100;
}

// ─── Aggregate cost record ─────────────────────────────────────────────────────
export function buildCostRecord(userId: string, tenantId: string, agentId: string, taskId: string, model: string, tokens: number, latencyMs: number, toolCalls: number, computeMs: number, estimatedCostCents: number, period: "day" | "month"): AgentCostRecord {
  const periodKey = period === "day" ? new Date().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 7);
  return {
    userId,
    tenantId,
    agentId,
    taskId,
    model,
    tokens,
    latencyMs,
    toolCalls,
    computeMs,
    estimatedCostCents,
    period,
    periodKey,
  };
}
