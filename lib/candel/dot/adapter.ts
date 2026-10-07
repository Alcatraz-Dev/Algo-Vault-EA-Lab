/**
 * AlgoVault Candel SDK — Dot / Candel Agent Adapter
 *
 * Wraps the existing AlgoVault Multi-Agent Intelligence Engine
 * (`lib/agents/*`) into a Candel instance. The Candel "dot" is
 * backed by an existing AlgoVault agent definition, with trading
 * tools loaded from `lib/candel/tools/`.
 *
 * Reuses the existing AI Router, RTDB, permissions, and workflow engine.
 * No duplicate agent runtime.
 */

import type {
  CandelInstance,
  CandelTemplate,
  CandelPermissions,
  CandelRole,
  AccountBinding,
} from "../types";
import { resolveCandelOwner, requireCandelReadable, requireCandelCanReadAccount } from "../authorization";
import { getCandelAccountBindings } from "../workspace/database";
import { TOOL_REGISTRY, isToolAllowed, isRiskLevelAcceptable } from "../../agentic-trading-intelligence/tool-registry";
import type { AgentPermission, AgentRiskLevel } from "../../agentic-trading-intelligence/contracts";

// ─── Candel agent adapter ───────────────────────────────────────────────────
export class CandelAgentAdapter {
  constructor(
    public readonly candelId: string,
    public readonly userId: string,
    public readonly template: CandelTemplate,
    public readonly instance: CandelInstance,
    public readonly accountBindings: AccountBinding[],
  ) {}

  /** Resolve the effective set of tools this Candel may invoke */
  get effectiveToolSet(): ReadonlySet<string> {
    const allowed = new Set<string>(this.template.tools);
    return allowed;
  }

  /** Is a tool allowed? Combines template tools + account bindings + permissions */
  canUseTool(toolName: string, riskLevel: "read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading"): boolean {
    // 1. Template tool must be in template.tools
    if (!this.template.tools.includes(toolName)) return false;
    // 2. Agentic Trading Intelligence tool registry check
    if (TOOL_REGISTRY[toolName]) {
      const capabilities = this.template.capabilities ?? [];
      // capabilities is string[] of permission names; cast to AgentPermission[]
      if (!isToolAllowed(toolName, capabilities as readonly AgentPermission[])) return false;
      if (!isRiskLevelAcceptable(toolName, this.getAllowedRiskLevels(riskLevel))) return false;
    }
    // 3. Account binding permission check
    const perms = this.getEffectivePermissions();
    if (perms) {
      if (perms.execution) {
        const hasExecute = this.accountBindings.some(
          (b) => b.allowedContexts.includes("execute")
        );
        if (!hasExecute) return false;
      }
    }
    return true;
  }

  private getAllowedRiskLevels(maxAllowed: "read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading"): ("read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading")[] {
    const ladder: Record<string, ("read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading")[]> = {
      read_only: ["read_only"],
      low_risk: ["read_only", "low_risk"],
      user_confirmation: ["read_only", "low_risk", "user_confirmation"],
      high_risk: ["read_only", "low_risk", "user_confirmation", "high_risk"],
      live_trading: ["read_only", "low_risk", "user_confirmation", "high_risk", "live_trading"],
    };
    return ladder[maxAllowed] ?? ["read_only"];
  }

  private getEffectivePermissions(): CandelPermissions | null {
    return { ...this.templatePermissions, ...this.instancePermissions };
  }

  private get templatePermissions(): CandelPermissions {
    return {
      workspace: {
        readPages: this.template.availability !== "admin_approved",
        createPages: this.template.availability !== "admin_approved",
        editPages: this.template.availability !== "admin_approved",
        saveResearch: this.template.availability !== "admin_approved",
      },
      market: {
        readMarketData: true,
        analyzeChart: this.template.role === "market" || this.template.role === "market-analyst",
        scanSymbols: this.template.role === "hunter",
        createWatchlists: this.template.role === "hunter",
        createAlerts: this.template.role === "market",
      },
      tradingAccount: {
        readAccount: false,
        readPositions: false,
        readOrders: false,
        readPerformance: false,
        readRisk: false,
      },
      execution: {
        createOrder: false,
        modifyOrder: false,
        closePosition: false,
        cancelOrder: false,
      },
      external: {
        tradingviewMcp: this.template.role === "tradingview",
        telegram: false,
        discord: false,
      },
      executionDefaultsToOff: true,
      approvalRequirements: {
        createOrder: false,
        modifyOrder: false,
        closePosition: false,
        cancelOrder: false,
        tradeJournalWrite: false,
      },
      executionDefault: "off",
    };
  }

  private get instancePermissions(): CandelPermissions | null {
    const bindings = this.accountBindings;
    if (bindings.length === 0) return null;
    return bindings[0].permissions;
  }

  /** Load account bindings (server-enforced) */
  async loadAccountBindings(): Promise<AccountBinding[]> {
    await requireCandelReadable(this.candelId, this.userId);
    return getCandelAccountBindings(this.candelId);
  }

  /** Check Candel can read a specific account (server-enforced) */
  async requireCanReadAccount(accountId: string): Promise<void> {
    await requireCandelCanReadAccount(this.candelId, this.userId, accountId);
  }

  /** Resolve Candel owner (server-enforced) */
  async resolveOwner(): Promise<string | null> {
    return resolveCandelOwner(this.candelId);
  }
}

// ─── Candel → Agent contract builder ─────────────────────────────────────────
export function buildCandelAgentContract(
  candelId: string,
  userId: string,
  template: CandelTemplate,
  instance: CandelInstance,
): { capabilities: string[]; requiredPermissions: string[]; tools: string[]; systemInstructions: string } {
  const capabilities = [
    ...template.capabilities,
    "candel_context",
    "candel_ownership",
  ];
  const tools = [...template.tools];
  const instructions = template.instructions;
  return {
    capabilities,
    requiredPermissions: [],
    tools,
    systemInstructions: instructions,
  };
}
