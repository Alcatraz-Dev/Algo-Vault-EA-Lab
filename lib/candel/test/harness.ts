/**
 * lib/candel/test/harness.ts
 *
 * Core verification harness for the AlgoVault Candel SDK.
 *
 * Drives the REAL Candel application logic:
 *   - authorization.ts        (resolveCandelOwner, requireCandelReadable,
 *                             requireCandelCanReadAccount, requireCandelPermission,
 *                             requireExecutionPermission, requireApproval,
 *                             resolveCandelPermissions, resolveCandelOwner)
 *   - workspace/database.ts   (getCandelInstance, saveCandelInstance, saveCandelProposal,
 *                             saveCandelActivity, saveCandelConversation, etc.)
 *   - terminal-context.ts     (buildTerminalCandelContext, marketContextToEvidence)
 *   - dot/adapter.ts          (CandelAgentAdapter, runCandelAgent)
 *
 * Against an in-memory RTDB (lib/candel/test/rtdb.ts) + a fake server-side
 * identity (FakeAdminAuth). Nothing is mocked: the security checks execute the
 * real application code. Only the Firebase transport is stubbed (no
 * credentials, no network).
 *
 * No live Firebase. No live broker. No real-money orders. Protocol-only.
 */

import { FakeRtdb } from "./rtdb";
import { FakeAdminAuth } from "./fake-firebase-admin";
import {
  resolveCandelOwner,
  requireCandelOwner,
  requireCandelReadable,
  requireCandelCanReadAccount,
  requireCandelPermission,
  requireExecutionPermission,
  requireApproval,
  resolveCandelPermissions,
  recordCandelActivity,
} from "@/lib/candel/authorization";
import type {
  CandelInstance,
  CandelTemplate,
  AccountBinding,
  CandelPermissions,
  CandelProposal,
  CandelActivity,
  CandelConversation,
  CandelMemoryEntry,
  CandelActionType,
} from "@/lib/candel/types";
import {
  getCandelInstance,
  getCandelInstancesByUser,
  getCandelActivity,
  saveCandelInstance,
  saveCandelProposal,
  saveCandelActivity,
  saveCandelConversation,
  saveCandelMemoryEntry,
  getCandelConversations,
  getCandelMemory,
  getCandelAccountBindings,
  saveCandelAccountBindings,
} from "@/lib/candel/workspace/database";
import { buildTerminalCandelContext, marketContextToEvidence } from "@/lib/candel/terminal-context";
import { CandelAgentAdapter, runCandelAgent } from "@/lib/candel/dot/adapter";
import type {
  CandelTemplate as Template,
  CandelInstance as Instance,
  AccountBinding as Binding,
  CandelPermissions as Perms,
  CandelProposal as Proposal,
  CandelActivity as Activity,
  CandelConversation as Conversation,
  CandelMemoryEntry as MemoryEntry,
  CandelActionType as ActionType,
} from "@/lib/candel/types";

// ─── Test fixtures (default Candel scenario) ────────────────────────────────

export function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "tpl-market-analyst",
    name: "Market Analyst",
    displayName: "Market Analyst",
    description: "OpenDots market-analyst dot for AlgoVault Candel",
    role: "market-analyst",
    instructions: "Be brief and factual. Analyze the market and report evidence.",
    capabilities: ["market_read", "risk_read"],
    tools: ["get_market_snapshot"],
    model: "",
    mcpConnections: [],
    memoryPolicy: "owner" as const,
    workspaceAccess: "owner" as const,
    tradingAccess: "none" as const,
    accountAccess: [],
    approvalRequirements: {
      createOrder: false,
      modifyOrder: false,
      closePosition: false,
      cancelOrder: false,
      tradeJournalWrite: false,
    },
    backgroundPermissions: { run: false, monitor: false, notify: false },
    proOnly: false,
    availability: "always" as const,
    status: "active" as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: "1.0.0",
    ...overrides,
  };
}

export function makeCandelInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "candel-100",
    templateId: "tpl-market-analyst",
    userId: "user-1",
    name: "Test Candel",
    description: "A test Candel",
    status: "active",
    accountBindings: [],
    createdByAdmin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function makeAccountBinding(overrides: Partial<Binding> = {}): Binding {
  return {
    tradingAccountId: "acc-demo-a",
    allowedSymbols: ["XAUUSD"],
    allowedContexts: ["read_risk"],
    permissions: {
      workspace: { readPages: true, createPages: false, editPages: false, saveResearch: false },
      market: { readMarketData: true, analyzeChart: true, scanSymbols: false, createWatchlists: false, createAlerts: false },
      tradingAccount: { readAccount: false, readPositions: false, readOrders: false, readPerformance: false, readRisk: true },
      execution: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
      external: { tradingviewMcp: false, telegram: false, discord: false },
      approvalRequirements: {
        createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false, tradeJournalWrite: false,
      },
      executionDefault: "off",
      executionDefaultsToOff: true,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function makePermissions(overrides: Partial<Perms> = {}): Perms {
  return {
    workspace: { readPages: true, createPages: true, editPages: true, saveResearch: true },
    market: { readMarketData: true, analyzeChart: true, scanSymbols: true, createWatchlists: true, createAlerts: true },
    tradingAccount: { readAccount: false, readPositions: false, readOrders: false, readPerformance: false, readRisk: false },
    execution: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
    external: { tradingviewMcp: false, telegram: false, discord: false },
    approvalRequirements: {
      createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false, tradeJournalWrite: false,
    },
    executionDefault: "off",
    executionDefaultsToOff: true,
    ...overrides,
  };
}

// ─── Harness setup ──────────────────────────────────────────────────────────

/**
 * Setup a sandboxed Candel harness.
 *
 * Creates an in-memory RTDB + fake server-side identity. The Candel code
 * (authorization, database, terminal-context, adapter) is real.
 */
export function setupHarness(tree: FakeRtdb, userId: string = "user-1"): () => void {
  const auth = new FakeAdminAuth(userId);
  // Wire the fake auth into the fake firebase-admin surface so the real
  // Candel code (which calls adminAuth.getUser) sees the test identity.
  (globalThis as { _candelHarness?: { auth: FakeAdminAuth } })._candelHarness = { auth };
  return () => {
    delete (globalThis as { _candelHarness?: { auth: FakeAdminAuth } })._candelHarness;
  };
}

export function createHarness(userId: string = "user-1", candelId: string = "candel-100"): {
  dispose: () => void;
  rtdb: FakeRtdb;
  tree: FakeRtdb;
  auth: FakeAdminAuth;
  template: Template;
  candelInstance: Instance;
} {
  const tree = new FakeRtdb();
  const auth = new FakeAdminAuth(userId);
  // Wire the fake auth into the fake firebase-admin surface so the real
  // Candel code (which calls adminAuth.getUser) sees the test identity.
  (globalThis as { _candelHarness?: { auth: FakeAdminAuth } })._candelHarness = { auth };
  const dispose = () => {
    delete (globalThis as { _candelHarness?: { auth: FakeAdminAuth } })._candelHarness;
  };
  const template = makeTemplate();
  const candelInstance = makeCandelInstance();
  return { dispose, rtdb: tree, tree, auth, template, candelInstance };
}

export function getAuthUid(): string {
  return (globalThis as { _candelHarness?: { auth: FakeAdminAuth } })._candelHarness?.auth?.uid ?? "user-1";
}

// ─── Action builders (server-side identity only) ────────────────────────────

export function buildCandelActivity(
  candelId: string,
  userId: string,
  action: ActionType,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
): Activity {
  return {
    id: `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    candelId,
    userId,
    action,
    targetType,
    targetId,
    details,
    timestamp: Date.now(),
  };
}

export function buildMemoryEntry(
  candelId: string,
  userId: string,
  kind: "preference" | "fact" | "strategy" | "risk" | "note",
  text: string,
  source: "agent" | "user" | "system" = "user",
): MemoryEntry {
  return {
    id: `${userId}-${Date.now()}-${kind}`,
    candelId,
    userId,
    kind,
    text,
    source,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function buildCandelConversation(
  candelId: string,
  userId: string,
  title: string,
): Conversation {
  return {
    id: `${userId}-${Date.now()}`,
    candelId,
    userId,
    title,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── RTDB-backed record helpers (reference) ─────────────────────────────────

export async function readCandelFromRtdb(candelId: string): Promise<Instance | null> {
  return getCandelInstance(candelId);
}

export async function writeCandelToRtdb(instance: Instance): Promise<void> {
  await saveCandelInstance(instance);
}

export async function writeProposalToRtdb(proposal: Proposal): Promise<void> {
  await saveCandelProposal(proposal);
}

export async function writeActivityToRtdb(activity: Activity): Promise<void> {
  await saveCandelActivity(activity);
}

export async function writeConversationToRtdb(conv: Conversation): Promise<void> {
  await saveCandelConversation(conv);
}

export async function writeMemoryToRtdb(entry: MemoryEntry): Promise<void> {
  await saveCandelMemoryEntry(entry);
}

export async function readConversationsFromRtdb(candelId: string, userId: string): Promise<Conversation[]> {
  return getCandelConversations(candelId, userId);
}

export async function readMemoryFromRtdb(candelId: string, userId: string): Promise<MemoryEntry[]> {
  return getCandelMemory(candelId, userId);
}

export async function getCandelActivityRtdb(candelId: string, userId: string): Promise<CandelActivity[]> {
  return getCandelActivity(candelId, userId);
}

export async function saveAccountBindingsToRtdb(
  candelId: string,
  userId: string,
  bindings: AccountBinding[],
): Promise<void> {
  await saveCandelAccountBindings(candelId, userId, bindings);
}

export async function readAccountBindingsFromRtdb(candelId: string): Promise<AccountBinding[]> {
  return getCandelAccountBindings(candelId);
}
