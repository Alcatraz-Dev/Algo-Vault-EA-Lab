/** AlgoVault Agentic Trading Intelligence — Agent Security (Phase 14 §49, §50)

 * Never allow agent instructions to override system policy.
 * Untrusted content may include: strategy descriptions, marketplace descriptions,
 * user text, external documents, webhook payloads. Treat them as untrusted input.
 * If agents consume external data: validate source, timestamp, provenance,
 * freshness, permissions. Do not treat arbitrary external text as market truth.
 */

import type { AgentPermission, ExternalDataValidation, AgentSecurityPolicy } from "./agent-governance";

// ─── Security policies ─────────────────────────────────────────────────────────
export const DEFAULT_SECURITY_POLICY: AgentSecurityPolicy = {
  allowUntrustedContent: false,
  untrustedContentSources: [],
  policyOverridesAllowed: false,
  executeArbitraryNaturalLanguage: false,
};

// ─── Untrusted content scanner ─────────────────────────────────────────────────
export function isUntrustedContent(text: string): boolean {
  // Simple heuristic: if the text looks like an instruction, treat it as untrusted.
  const instructionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /disregard\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+\w+/i,
    /new\s+instructions/i,
    /override\s+(all\s+)?previous\s+instructions/i,
    /forget\s+(all\s+)?previous\s+instructions/i,
    /do\s+not\s+follow\s+(all\s+)?previous\s+instructions/i,
  ];
  for (const pattern of instructionPatterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// ─── External data validation ──────────────────────────────────────────────────
export function validateExternalData(data: Record<string, unknown>, source: string, timestamp: number, provenance: string, freshnessMs: number, permissions: AgentPermission[]): ExternalDataValidation {
  if (!data || typeof data !== "object") {
    return { source, timestamp, provenance, freshnessMs, permissions, valid: false, reason: "Data is not a valid object." };
  }
  if (!source) {
    return { source: "unknown", timestamp, provenance, freshnessMs, permissions, valid: false, reason: "Source is missing." };
  }
  if (!provenance) {
    return { source, timestamp, provenance: "unknown", freshnessMs, permissions, valid: false, reason: "Provenance is missing." };
  }
  if (freshnessMs < 0) {
    return { source, timestamp, provenance, freshnessMs, permissions, valid: false, reason: "Freshness must be non-negative." };
  }
  if (permissions.length === 0) {
    return { source, timestamp, provenance, freshnessMs, permissions, valid: false, reason: "Permissions are required." };
  }
  // Additional validation could check timestamp freshness.
  const age = Date.now() - timestamp;
  if (age > freshnessMs) {
    return { source, timestamp, provenance, freshnessMs, permissions, valid: false, reason: `Data is stale: ${age}ms old, max freshness ${freshnessMs}ms.` };
  }
  return { source, timestamp, provenance, freshnessMs, permissions, valid: true };
}

// ─── Permission escalation guard ───────────────────────────────────────────────
export function canEscalatePermission(currentPermissions: AgentPermission[], requestedPermission: AgentPermission, policy: AgentSecurityPolicy): { allowed: boolean; reason?: string } {
  if (policy.policyOverridesAllowed) {
    return { allowed: true }; // only in testing
  }
  if (currentPermissions.includes(requestedPermission)) {
    return { allowed: true };
  }
  return { allowed: false, reason: "Permission escalation is not allowed. Agent cannot gain new permissions." };
}

// ─── Policy override guard ─────────────────────────────────────────────────────
export function canOverridePolicy(policy: AgentSecurityPolicy, override: string): { allowed: boolean; reason?: string } {
  if (policy.policyOverridesAllowed) {
    return { allowed: true };
  }
  return { allowed: false, reason: "Policy overrides are not allowed. System policy cannot be overridden by agent instructions." };
}

// ─── Execute arbitrary natural language guard ──────────────────────────────────
export function canExecuteNaturalLanguage(policy: AgentSecurityPolicy, instruction: string): { allowed: boolean; reason?: string } {
  if (policy.executeArbitraryNaturalLanguage) {
    return { allowed: true };
  }
  if (isUntrustedContent(instruction)) {
    return { allowed: false, reason: "Untrusted content detected. Agent cannot execute arbitrary natural language instructions." };
  }
  return { allowed: false, reason: "Arbitrary natural language execution is not allowed. All instructions must be validated against schemas." };
}

// ─── Cross-tenant guard ────────────────────────────────────────────────────────
export function canAccessTenant(currentTenantId: string, targetTenantId: string, policy: AgentSecurityPolicy): { allowed: boolean; reason?: string } {
  if (currentTenantId === targetTenantId) {
    return { allowed: true };
  }
  return { allowed: false, reason: "Cross-tenant access is not allowed. Agents must never cross tenant boundaries." };
}

// ─── Repeated action guard ─────────────────────────────────────────────────────
export function isRepeatedAction(actionId: string, idempotencyStore: { get(actionId: string): { exists: boolean; status: string; result?: unknown } | undefined }, expectedStatus: "pending" | "processed" | "failed"): { isRepeat: boolean; status?: string; result?: unknown } {
  const existing = idempotencyStore.get(actionId);
  if (!existing) {
    return { isRepeat: false };
  }
  if (existing.status === expectedStatus) {
    return { isRepeat: true, status: existing.status, result: existing.result };
  }
  return { isRepeat: false };
}
