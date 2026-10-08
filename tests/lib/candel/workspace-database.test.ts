import { describe, it, expect, beforeEach } from "vitest";
import {
  getCandelInstance,
  getCandelInstancesByUser,
  saveCandelInstance,
  deleteCandelInstance,
  getCandelAccountBindings,
  saveCandelAccountBindings,
  getCandelTemplate,
  saveCandelTemplate,
} from "@/lib/candel/workspace/database";
import type { CandelInstance, CandelTemplate, AccountBinding, CandelPermissions } from "@/lib/candel/types";
import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Candel SDK — RTDB persistence tests.
 *
 * Verifies the Candel SDK's RTDB store functions against the actual
 * Firebase RTDB. Uses the real `adminDatabase` instance; requires a
 * Firebase test project env vars (FIREBASE_TEST_PROJECT_ID etc.).
 *
 * These tests use the real RTDB and real admin sdk — they must run
 * with real Firebase credentials in CI.
 */
describe("Candel SDK — workspace/database.ts", () => {
  const userId = "test-user-123";
  const candelId = "candel-456";
  const templateId = "tpl-789";

  /** Reset RTDB between tests. */
  beforeEach(async () => {
    await adminDatabase.ref(`candelInstances/${userId}`).remove();
    await adminDatabase.ref(`candelTemplates/${userId}`).remove();
    await adminDatabase.ref(`candelAccountBindings/${userId}`).remove();
  });

  /**
   * Test: saveCandelInstance + getCandelInstance (owner read)
   */
  it("saveCandelInstance / getCandelInstance (owner read)", async () => {
    const instance: CandelInstance = {
      id: candelId,
      templateId,
      userId,
      name: "Test Candel",
      description: "A test candel",
      status: "active" as const,
      accountBindings: [],
      createdByAdmin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveCandelInstance(instance);
    const loaded = await getCandelInstance(candelId);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(candelId);
    expect(loaded?.userId).toBe(userId);
    expect(loaded?.name).toBe("Test Candel");
  });

  /**
   * Test: saveCandelInstance + getCandelInstancesByUser
   */
  it("getCandelInstancesByUser returns owned Candels", async () => {
    await saveCandelInstance({
      id: candelId,
      templateId,
      userId,
      name: "Candel A",
      description: "",
      status: "active",
      accountBindings: [],
      createdByAdmin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await saveCandelInstance({
      id: "candel-789",
      templateId,
      userId,
      name: "Candel B",
      description: "",
      status: "disabled",
      accountBindings: [],
      createdByAdmin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const all = await getCandelInstancesByUser(userId);
    expect(all).toHaveLength(2);
    expect(all.map((i) => i.name)).toContain("Candel A");
    expect(all.map((i) => i.name)).toContain("Candel B");

    // Non-owner should not see Candel A
    const others = await getCandelInstancesByUser("other-user-999");
    expect(others).toHaveLength(0);
  });

  /**
   * Test: saveCandelInstance → getCandelInstance → deleteCandelInstance
   */
  it("deleteCandelInstance removes persisted data", async () => {
    await saveCandelInstance({
      id: candelId,
      templateId,
      userId,
      name: "To Delete",
      description: "",
      status: "active",
      accountBindings: [],
      createdByAdmin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const before = await getCandelInstance(candelId);
    expect(before).not.toBeNull();

    await deleteCandelInstance(candelId, userId);
    const after = await getCandelInstance(candelId);
    expect(after).toBeNull();
  });

  /**
   * Test: saveCandelAccountBindings + getCandelAccountBindings
   */
  it("saveCandelAccountBindings / getCandelAccountBindings", async () => {
    const bindings: AccountBinding[] = [
      {
        tradingAccountId: "acc-1",
        allowedSymbols: ["XAUUSD", "EURUSD"],
        allowedContexts: ["read_risk"],
        permissions: {
          workspace: { readPages: true, createPages: false, editPages: false, saveResearch: false },
          market: { readMarketData: true, analyzeChart: false, scanSymbols: false, createWatchlists: false, createAlerts: false },
          tradingAccount: { readAccount: true, readPositions: false, readOrders: false, readPerformance: false, readRisk: true },
          execution: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
          external: { tradingviewMcp: false, telegram: false, discord: false },
          approvalRequirements: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false, tradeJournalWrite: false },
          executionDefault: "off",
          executionDefaultsToOff: true,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    await saveCandelAccountBindings(candelId, userId, bindings);
    const loaded = await getCandelAccountBindings(candelId);
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0].tradingAccountId).toBe("acc-1");
    expect(loaded?.[0].allowedSymbols).toEqual(["XAUUSD", "EURUSD"]);
    expect(loaded?.[0].permissions.tradingAccount.readRisk).toBe(true);
  });

  /**
   * Test: saveCandelTemplate + getCandelTemplate
   */
  it("saveCandelTemplate / getCandelTemplate", async () => {
    const template: CandelTemplate = {
      id: templateId,
      name: "Market Analyst",
      displayName: "Market Analyst",
      description: "",
      role: "market-analyst",
      instructions: "Be brief and factual.",
      capabilities: ["market_read"],
      tools: ["analyze_market"],
      model: "",
      mcpConnections: [],
      memoryPolicy: "owner",
      workspaceAccess: "owner",
      tradingAccess: "none",
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
      availability: "always",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: undefined,
      version: "1.0.0",
    };
    await saveCandelTemplate(template);
    const loaded = await getCandelTemplate(templateId);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(templateId);
    expect(loaded?.role).toBe("market-analyst");
    expect(loaded?.tools).toContain("analyze_market");
  });
});
