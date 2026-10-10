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

import { defaultRouter } from "@/lib/ai/router";
import { resolveCandelOwner, requireCandelReadable, requireCandelCanReadAccount } from "../authorization";
import {
  getCandelInstance,
  getCandelTemplate,
  getCandelAccountBindings,
} from "../workspace/database";
import { TOOL_REGISTRY, isToolAllowed, isRiskLevelAcceptable } from "../../agentic-trading-intelligence/tool-registry";
import type { AgentPermission } from "../../agentic-trading-intelligence/contracts";
import { resolveCandelConfig, type EffectiveCandelConfig } from "../config";
import { APPROVAL_ACTION_TYPES, canRaiseApprovals } from "../approvals";
import type {
  CandelInstance,
  CandelTemplate,
  CandelPermissions,
  AccountBinding,
} from "../types";

// ─── Candel agent adapter ───────────────────────────────────────────────────
export class CandelAgentAdapter {
  private resolvedConfig?: EffectiveCandelConfig;

  constructor(
    public readonly candelId: string,
    public readonly userId: string,
    public readonly template: CandelTemplate,
    public readonly instance: CandelInstance,
    public readonly accountBindings: AccountBinding[],
  ) {}

  /**
   * The Candel's effective configuration: template defaults with the instance's
   * user customization merged in (never wider than the template — see
   * `lib/candel/config.ts`). Cached because it is read on every tool check.
   */
  get config(): EffectiveCandelConfig {
    if (!this.resolvedConfig) {
      this.resolvedConfig = resolveCandelConfig(this.instance, this.template);
    }
    return this.resolvedConfig;
  }

  /** Resolve the effective set of tools this Candel may invoke */
  get effectiveToolSet(): ReadonlySet<string> {
    return new Set<string>(this.config.tools);
  }

  /** Is a tool allowed? Combines effective config + account bindings + permissions */
  canUseTool(toolName: string, riskLevel: "read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading"): boolean {
    // 1. The tool must survive the effective config (template ceiling ∩ user choice)
    if (!this.config.tools.includes(toolName)) return false;
    // 2. Agentic Trading Intelligence tool registry check
    if (TOOL_REGISTRY[toolName]) {
      const capabilities = this.config.capabilities;
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
    const role = this.config.role;
    const isMarketRole = role === "market-analyst" || role === "tradingview";
    const isHunterRole = role === "hunter";
    return {
      workspace: {
        readPages: this.template.availability !== "admin_approved",
        createPages: this.template.availability !== "admin_approved",
        editPages: this.template.availability !== "admin_approved",
        saveResearch: this.template.availability !== "admin_approved",
      },
      market: {
        readMarketData: true,
        analyzeChart: isMarketRole,
        scanSymbols: isHunterRole,
        createWatchlists: isHunterRole,
        createAlerts: isMarketRole || isHunterRole,
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
        tradingviewMcp: role === "tradingview",
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

  /** Handle a user message through the multi-agent engine */
  async handleMessage(message: string, options: { memory?: string[] } = {}): Promise<string> {
    // Bridge to the existing AlgoVault Multi-Agent Intelligence Engine
    // via the existing AI router. The Candel's effective config constrains
    // what the agent may do; nothing here can widen it.
    try {
      const contract = buildCandelAgentContract(
        this.candelId,
        this.userId,
        this.template,
        this.instance
      );

      const systemPrompt = [
        contract.systemInstructions,
        describeOperatingContext(this.config),
        options.memory && options.memory.length > 0
          ? "Remembered context about this user (from the Candel's memory store):\n" +
            options.memory.map((line) => `- ${line}`).join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const response = await defaultRouter.chat(
        {
          messages: [{ role: "user", content: message }],
          systemPrompt,
          responseFormat: "text",
        },
        {
          sourceId: this.candelId,
          userId: this.userId,
        }
      );
      if (!response.success) {
        // Surface the real reason (budget guard, provider failure, truncation)
        // instead of a generic "unknown error" that hides a hard limit.
        const reason =
          response.budgetBlocked?.reason ||
          response.fallbackErrors?.[0]?.message ||
          (response.truncated ? "the model hit its output limit" : "no provider available");
        return `Agent execution blocked: ${reason}`;
      }
      return String(response.content || "").trim();
    } catch (error) {
      console.error("[CandelAdapter handleMessage]", error);
      return `Error processing your message: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/**
 * A compact operating brief appended to every system prompt. It tells the agent
 * what it is, what it may touch, and — importantly — that it must fail closed
 * rather than improvise when context or permission is missing.
 */
export function describeOperatingContext(config: EffectiveCandelConfig): string {
  const lines = [
    `Operating context — you are the "${config.name}" Candel, role: ${config.roleLabel}.`,
    config.tools.length > 0
      ? `Your allowed tools are exactly: ${config.tools.join(", ")}. You cannot use any tool outside this list.`
      : "You have no tools enabled. Answer from reasoning and the supplied context only.",
    "If required data, permission or account context is missing, say so explicitly and stop — never assume it is safe and never invent prices, positions or results.",
    config.memoryPolicy === "none"
      ? "Do not rely on remembered preferences: memory is disabled for this Candel."
      : "Preferences and facts supplied as remembered context are advisory; the user's current message always wins.",
  ];

  lines.push(approvalProtocol(config));
  return lines.filter(Boolean).join("\n");
}

/**
 * How a Candel asks for permission instead of acting. The directive is the only
 * channel that can lead to a live action, and the server drops anything that
 * does not follow it exactly, so an out-of-contract answer fails closed.
 */
export function approvalProtocol(config: EffectiveCandelConfig): string {
  if (!canRaiseApprovals(config)) {
    return "You cannot execute or propose live trading actions. If the user asks for one, explain what you would need and stop.";
  }
  return [
    "You cannot execute anything yourself. When the user asks for a live trading action, describe it in prose and then emit exactly one fenced directive:",
    "```approval",
    '{"actionType":"createOrder","summary":"<one sentence>","payload":{"accountId":"<bound account>","symbol":"XAUUSD","side":"buy","size":0.1,"entry":0,"stop":0,"takeProfit":0,"reasoning":"..."}}',
    "```",
    `"actionType" must be one of: ${APPROVAL_ACTION_TYPES.join(", ")}. Name the bound accountId explicitly.`,
    "The user decides; approval is never yours to assume. If no account is bound, say so instead of emitting a directive.",
  ].join("\n");
}

/** Run a Candel: load instance + bindings + build adapter */
export async function runCandelAgent(userId: string, candelId: string) {
  try {
    const instance = await getCandelInstance(candelId);
    if (!instance) return null;
    await requireCandelReadable(candelId, userId);
    const template = await getCandelTemplate(instance.templateId);
    if (!template) return null;
    const accountBindings = await getCandelAccountBindings(candelId);
    return new CandelAgentAdapter(
      candelId,
      userId,
      template,
      instance,
      accountBindings,
    );
  } catch {
    return null;
  }
}

// ─── Candel → Agent contract builder ─────────────────────────────────────────
export function buildCandelAgentContract(
  candelId: string,
  userId: string,
  template: CandelTemplate,
  instance: CandelInstance,
): { capabilities: string[]; requiredPermissions: string[]; tools: string[]; systemInstructions: string } {
  const config = resolveCandelConfig(instance, template);
  return {
    capabilities: [...config.capabilities, "candel_context", "candel_ownership"],
    requiredPermissions: [],
    tools: [...config.tools],
    systemInstructions: config.instructions,
  };
}
