/** AlgoVault Agentic Trading Intelligence — Agent Fail-Closed (Phase 14 §39)

 * If: market data stale, risk unavailable, broker unavailable, account state unavailable,
 * strategy version unavailable, permissions unclear, tool response malformed
 * then: BLOCK ACTION. Do not guess.
 */

import type { FailClosedCondition, AgentFailClosedCondition } from "./agent-governance";

// ─── Fail-closed checks ────────────────────────────────────────────────────────
export function isMarketDataStale(dataTimestamp: number, maxAgeMs: number): boolean {
  return Date.now() - dataTimestamp > maxAgeMs;
}

export function isRiskUnavailable(riskState: unknown): boolean {
  return riskState === null || riskState === undefined || (typeof riskState === "object" && (riskState as Record<string, unknown>).status === "unavailable");
}

export function isBrokerUnavailable(brokerState: unknown): boolean {
  return brokerState === null || brokerState === undefined || (typeof brokerState === "object" && (brokerState as Record<string, unknown>).connected === false);
}

export function isAccountStateUnavailable(accountState: unknown): boolean {
  return accountState === null || accountState === undefined || (typeof accountState === "object" && (accountState as Record<string, unknown>).available === false);
}

export function isStrategyVersionUnavailable(version: unknown): boolean {
  return version === null || version === undefined || (typeof version === "object" && (version as Record<string, unknown>).available === false);
}

export function arePermissionsUnclear(permissions: unknown): boolean {
  return permissions === null || permissions === undefined || !Array.isArray(permissions) || permissions.length === 0;
}

export function isToolResponseMalformed(response: unknown, expectedSchema: { type: string; properties?: Record<string, unknown> }): boolean {
  if (response === null || response === undefined) return true;
  if (typeof response !== "object") return true;
  if (expectedSchema.type && typeof response !== expectedSchema.type) return true;
  if (expectedSchema.properties) {
    for (const [key, value] of Object.entries(expectedSchema.properties)) {
      if ((response as Record<string, unknown>)[key] === undefined) return true;
    }
  }
  return false;
}

// ─── Fail-closed evaluator ─────────────────────────────────────────────────────
export function evaluateFailClosed(conditions: FailClosedCondition[]): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const condition of conditions) {
    switch (condition) {
      case "market_data_stale":
        reasons.push("Market data is stale.");
        break;
      case "risk_unavailable":
        reasons.push("Risk state is unavailable.");
        break;
      case "broker_unavailable":
        reasons.push("Broker is unavailable.");
        break;
      case "account_state_unavailable":
        reasons.push("Account state is unavailable.");
        break;
      case "strategy_version_unavailable":
        reasons.push("Strategy version is unavailable.");
        break;
      case "permissions_unclear":
        reasons.push("Permissions are unclear.");
        break;
      case "tool_response_malformed":
        reasons.push("Tool response is malformed.");
        break;
    }
  }
  return { blocked: reasons.length > 0, reasons };
}

// ─── Build fail-closed conditions from agent state ─────────────────────────────
export function buildFailClosedConditions(
  marketDataFresh: boolean,
  riskState: unknown,
  brokerState: unknown,
  accountState: unknown,
  strategyVersion: unknown,
  permissions: unknown,
  toolResponse: unknown,
  expectedSchema: { type: string; properties?: Record<string, unknown> } | null,
): AgentFailClosedCondition[] {
  const conditions: AgentFailClosedCondition[] = [];
  if (!marketDataFresh) conditions.push({ condition: "market_data_stale", blocked: true, reason: "Market data is stale." });
  if (isRiskUnavailable(riskState)) conditions.push({ condition: "risk_unavailable", blocked: true, reason: "Risk state is unavailable." });
  if (isBrokerUnavailable(brokerState)) conditions.push({ condition: "broker_unavailable", blocked: true, reason: "Broker is unavailable." });
  if (isAccountStateUnavailable(accountState)) conditions.push({ condition: "account_state_unavailable", blocked: true, reason: "Account state is unavailable." });
  if (isStrategyVersionUnavailable(strategyVersion)) conditions.push({ condition: "strategy_version_unavailable", blocked: true, reason: "Strategy version is unavailable." });
  if (arePermissionsUnclear(permissions)) conditions.push({ condition: "permissions_unclear", blocked: true, reason: "Permissions are unclear." });
  if (expectedSchema && isToolResponseMalformed(toolResponse, expectedSchema)) conditions.push({ condition: "tool_response_malformed", blocked: true, reason: "Tool response is malformed." });
  return conditions;
}
