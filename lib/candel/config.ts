/**
 * AlgoVault Candel SDK — Effective Configuration & Customization
 *
 * A Candel instance is a *user-owned specialization* of a template. This module
 * is the single place where the two are merged, so the agent, the permission
 * engine, the API routes and the UI all agree on what a Candel actually is.
 *
 * Fail-closed rules (enforced by `sanitizeCandelCustomization` on every write):
 *
 *   1. `role` must be in the curated catalog — no free-form roles.
 *   2. `tools` and `capabilities` may only NARROW the template's sets. A Candel
 *      can never grant itself a tool its template did not ship with, so a
 *      "Research Writer" can never become an execution surface by editing a
 *      form field.
 *   3. `instructions` are length-capped and stripped of control characters.
 *   4. Unknown fields are dropped rather than persisted.
 *
 * The merge itself (`resolveCandelConfig`) is total: it always returns a fully
 * populated config, falling back to the template, then to safe defaults.
 */

import { getCandelRole, isCandelRole, DEFAULT_CANDEL_ROLE } from "./roles";
import type {
  CandelInstance,
  CandelTemplate,
  CandelCustomization,
  CandelRole,
  CandelPermissions,
} from "./types";

/** Hard caps that keep a single Candel from blowing the prompt/size budget. */
export const CANDEL_LIMITS = {
  name: 60,
  description: 400,
  instructions: 6_000,
  avatar: 8,
  model: 80,
  maxTools: 64,
  maxCapabilities: 64,
} as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const ROLE_ACCENT_FALLBACK = "slate";

export interface EffectiveCandelConfig {
  role: CandelRole;
  roleLabel: string;
  accent: string;
  icon: string;
  avatar?: string;
  name: string;
  instructions: string;
  capabilities: string[];
  tools: string[];
  model: string;
  memoryPolicy: "owner" | "shared" | "none";
  /** True when the user overrode the template's instructions. */
  instructionsCustomized: boolean;
  /** Tools the template ships that this Candel has switched OFF. */
  toolsDisabled: string[];
  /** Capabilities the template ships that this Candel has switched OFF. */
  capabilitiesDisabled: string[];
}

/** Collapse whitespace + strip control characters from a free-text field. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").replace(/\s+\n/g, "\n").trim().slice(0, max);
}

/** Unique, order-preserving, string-only list capped at `max`. */
function cleanStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/** Only keep values the ceiling already allows — never expand. */
function narrow(requested: string[], ceiling: string[]): string[] {
  if (ceiling.length === 0) return [];
  const allowed = new Set(ceiling);
  return requested.filter((item) => allowed.has(item));
}

/**
 * Validate and normalize untrusted customization input from a request body.
 * Returns only fields that were supplied; callers merge with existing state.
 */
export function sanitizeCandelCustomization(
  input: unknown,
  template: Pick<CandelTemplate, "tools" | "capabilities" | "role" | "model">,
): CandelCustomization {
  const out: CandelCustomization = {};
  if (!input || typeof input !== "object") return out;
  const body = input as Record<string, unknown>;

  if (body.role !== undefined) {
    out.role = isCandelRole(body.role) ? body.role : DEFAULT_CANDEL_ROLE;
  }

  if (body.avatar !== undefined) {
    out.avatar = cleanText(body.avatar, CANDEL_LIMITS.avatar);
  }

  if (body.instructions !== undefined) {
    out.instructions = cleanText(body.instructions, CANDEL_LIMITS.instructions);
  }

  if (body.capabilities !== undefined) {
    out.capabilities = narrow(
      cleanStringList(body.capabilities, CANDEL_LIMITS.maxCapabilities),
      template.capabilities ?? [],
    );
  }

  if (body.tools !== undefined) {
    out.tools = narrow(
      cleanStringList(body.tools, CANDEL_LIMITS.maxTools),
      template.tools ?? [],
    );
  }

  if (body.model !== undefined) {
    out.model = cleanText(body.model, CANDEL_LIMITS.model);
  }

  if (body.memoryPolicy !== undefined) {
    out.memoryPolicy =
      body.memoryPolicy === "shared" || body.memoryPolicy === "none"
        ? body.memoryPolicy
        : "owner";
  }

  return out;
}

/** Merge a validated patch over the existing customization (empty = inherit). */
export function mergeCandelCustomization(
  current: CandelCustomization | undefined,
  patch: CandelCustomization,
): CandelCustomization {
  const next: CandelCustomization = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch) as [keyof CandelCustomization, unknown][]) {
    if (value === undefined) continue;
    if ((key === "instructions" || key === "model" || key === "avatar") && value === "") {
      // Explicit empty string clears the override -> inherit from template.
      delete next[key];
      continue;
    }
    (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

/** Build customization overrides from a create request body. */
export function customizationFromCreateBody(
  body: Record<string, unknown>,
  template: Pick<CandelTemplate, "tools" | "capabilities" | "role" | "model">,
): CandelCustomization {
  return sanitizeCandelCustomization(
    {
      role: body.role,
      avatar: body.avatar,
      instructions: body.instructions,
      capabilities: body.capabilities,
      tools: body.tools,
      model: body.model,
      memoryPolicy: body.memoryPolicy,
    },
    template,
  );
}

/**
 * Resolve the effective configuration of an instance against its template.
 * Total function: always returns a usable config.
 */
export function resolveCandelConfig(
  instance: CandelInstance,
  template: CandelTemplate,
): EffectiveCandelConfig {
  const custom = instance.customization ?? {};
  const role = isCandelRole(custom.role) ? custom.role : isCandelRole(template.role) ? template.role : DEFAULT_CANDEL_ROLE;
  const spec = getCandelRole(role);

  const templateTools = template.tools ?? [];
  const tools = custom.tools === undefined ? templateTools : narrow(custom.tools, templateTools);
  const templateCapabilities = template.capabilities ?? [];
  const capabilities =
    custom.capabilities === undefined
      ? templateCapabilities
      : narrow(custom.capabilities, templateCapabilities);

  const instructions = (custom.instructions ?? "").trim() || template.instructions || "";

  return {
    role,
    roleLabel: spec.label,
    accent: spec.accent ?? ROLE_ACCENT_FALLBACK,
    icon: spec.icon,
    avatar: custom.avatar || template.avatar || undefined,
    name: instance.displayName || instance.name,
    instructions,
    capabilities,
    tools,
    model: (custom.model ?? "").trim() || template.model || "",
    memoryPolicy: custom.memoryPolicy ?? template.memoryPolicy ?? "owner",
    instructionsCustomized: Boolean((custom.instructions ?? "").trim()),
    toolsDisabled: templateTools.filter((tool) => !tools.includes(tool)),
    capabilitiesDisabled: templateCapabilities.filter((cap) => !capabilities.includes(cap)),
  };
}

/**
 * Fail-closed authorization overlay: a Candel may only use the tools its
 * *effective* config allows. Returns the allowed tools as a set.
 */
export function effectiveToolSet(config: EffectiveCandelConfig): ReadonlySet<string> {
  return new Set(config.tools);
}

/** True when the effective config permits any live-execution capable tool. */
export function hasExecutionTools(config: EffectiveCandelConfig): boolean {
  return config.tools.some((tool) =>
    /^(prepare_order|submit_live_order|close_position|modify_order|cancel_order)$/.test(tool),
  );
}

/** Human-readable risk posture line shown in the Candel header. */
export function riskPostureLabel(
  config: EffectiveCandelConfig,
  permissions?: CandelPermissions | null,
): "Read-only" | "Advisory" | "Approval-gated" | "Live execution" {
  const spec = getCandelRole(config.role);
  const execution = permissions?.execution;
  const canExecute =
    !!execution &&
    (execution.createOrder || execution.modifyOrder || execution.closePosition || execution.cancelOrder);
  if (canExecute) return "Live execution";
  if (spec.riskPosture === "approval_gated" || hasExecutionTools(config)) return "Approval-gated";
  if (spec.riskPosture === "advisory") return "Advisory";
  return "Read-only";
}

/** Default permission document written for a freshly created Candel. */
export function defaultCandelPermissions(overrides?: Partial<CandelPermissions>): CandelPermissions {
  return {
    workspace: { readPages: true, createPages: true, editPages: true, saveResearch: true },
    market: { readMarketData: true, analyzeChart: true, scanSymbols: false, createWatchlists: false, createAlerts: false },
    tradingAccount: { readAccount: false, readPositions: false, readOrders: false, readPerformance: false, readRisk: false },
    execution: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
    external: { tradingviewMcp: false, telegram: false, discord: false },
    approvalRequirements: { createOrder: true, modifyOrder: true, closePosition: true, cancelOrder: true, tradeJournalWrite: false },
    executionDefault: "off",
    executionDefaultsToOff: true,
    ...overrides,
  };
}

const bool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

/**
 * Coerce an untrusted permission document into a complete, booleans-only one.
 *
 * Two invariants the caller cannot opt out of:
 *   1. any enabled execution capability keeps its approval requirement ON, so
 *      enabling execution can never silently remove the human gate;
 *   2. `executionDefaultsToOff` stays true and `executionDefault` stays "off"
 *      unless the user explicitly asked for conditional execution.
 */
export function sanitizeCandelPermissions(input: unknown): CandelPermissions {
  const base = defaultCandelPermissions();
  if (!input || typeof input !== "object") return base;
  const body = input as Record<string, unknown>;
  const group = (key: string): Record<string, unknown> => {
    const value = body[key];
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  };

  const workspace = group("workspace");
  const market = group("market");
  const tradingAccount = group("tradingAccount");
  const execution = group("execution");
  const external = group("external");

  const sanitized: CandelPermissions = {
    workspace: {
      readPages: bool(workspace.readPages, base.workspace.readPages),
      createPages: bool(workspace.createPages, base.workspace.createPages),
      editPages: bool(workspace.editPages, base.workspace.editPages),
      saveResearch: bool(workspace.saveResearch, base.workspace.saveResearch),
    },
    market: {
      readMarketData: bool(market.readMarketData, base.market.readMarketData),
      analyzeChart: bool(market.analyzeChart, base.market.analyzeChart),
      scanSymbols: bool(market.scanSymbols, base.market.scanSymbols),
      createWatchlists: bool(market.createWatchlists, base.market.createWatchlists),
      createAlerts: bool(market.createAlerts, base.market.createAlerts),
    },
    tradingAccount: {
      readAccount: bool(tradingAccount.readAccount),
      readPositions: bool(tradingAccount.readPositions),
      readOrders: bool(tradingAccount.readOrders),
      readPerformance: bool(tradingAccount.readPerformance),
      readRisk: bool(tradingAccount.readRisk),
    },
    execution: {
      createOrder: bool(execution.createOrder),
      modifyOrder: bool(execution.modifyOrder),
      closePosition: bool(execution.closePosition),
      cancelOrder: bool(execution.cancelOrder),
    },
    external: {
      tradingviewMcp: bool(external.tradingviewMcp),
      telegram: bool(external.telegram),
      discord: bool(external.discord),
    },
    // Never taken from the client: a live action always needs the human gate.
    approvalRequirements: {
      createOrder: true,
      modifyOrder: true,
      closePosition: true,
      cancelOrder: true,
      tradeJournalWrite: false,
    },
    executionDefault: body.executionDefault === "conditional" ? "conditional" : "off",
    executionDefaultsToOff: true,
  };

  return sanitized;
}
