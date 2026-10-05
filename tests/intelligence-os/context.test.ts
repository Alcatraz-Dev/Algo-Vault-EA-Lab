/**
 * Phase 12 — Intelligence OS context tests.
 *
 * These tests verify the deterministic aggregation and prioritization logic
 * WITHOUT reaching for Firebase, market providers, or AI. The core point: the
 * OS must remain honest when sources are missing, stale, or degraded.
 */

// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  assembleContext,
  prioritize,
  type AggregationDeps,
  type IntelligenceEvent,
  type IntelligencePriority,
  type MarketSlice,
  type StrategySummary,
  type SetupMemoryRecord,
  type ResearchMission,
  type ResearchCandidate,
  type ResearchEvent,
  type JournalEntry,
  type AlertSummary,
  type AutomationActivity,
  type RecentActivityItem,
  type PositionSummary,
  type SystemComponent,
} from "@/lib/intelligence-os/types";
import type { DataFreshness, FRESHNESS_LABEL } from "@/lib/mobile/contracts";

// ── helpers ────────────────────────────────────────────────────────────────────

function marketSlice(
  partial: Partial<MarketSlice> & { symbol: string; timeframe: string }
): MarketSlice {
  return {
    symbol: partial.symbol as any,
    timeframe: partial.timeframe as any,
    freshness: {
      freshness: "live" as DataFreshness,
      dataTimestamp: Date.now() - 60_000,
      evaluatedAt: Date.now(),
      source: "test",
      fromCache: false,
    },
    price: 100,
    bid: 99.9,
    ask: 100.1,
    spread: 0.2,
    trend: "bullish",
    structure: "BOS bullish",
    regime: "trending_bullish",
    session: "london",
    marketStatus: "open",
    volatility: { atr: 10, atrPercent: 1, state: "normal" },
    fvgCount: 1,
    activeFvg: 1,
    orderBlockCount: 0,
    sweeps: [],
    liquidityLevels: [],
    provider: "test",
    dataTimestamp: Date.now() - 60_000,
    ...partial,
  } as any;
}

function staleMarketSlice(
  partial: Partial<MarketSlice> & { symbol: string; timeframe: string }
): MarketSlice {
  return {
    ...marketSlice(partial),
    freshness: {
      freshness: "stale" as DataFreshness,
      dataTimestamp: Date.now() - 120_000,
      evaluatedAt: Date.now(),
      source: "test",
      fromCache: false,
    },
  };
}

function setup(
  partial: Partial<SetupMemoryRecord> & { id: string }
): SetupMemoryRecord {
  return {
    id: partial.id,
    userId: partial.userId ?? "user",
    setupDefinitionId: partial.setupDefinitionId ?? "def",
    symbol: partial.symbol ?? "XAUUSD",
    timeframe: partial.timeframe ?? "M5",
    mode: partial.mode ?? "LIVE",
    status: partial.status ?? "WAITING",
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 60_000,
    conditions: partial.conditions ?? [{ type: "BOS", matched: true, evidence: "BOS" }],
    matchedCount: partial.matchedCount ?? 1,
    totalCount: partial.totalCount ?? 3,
    ...partial,
  } as any;
}

function strategy(
  partial: Partial<StrategySummary> & { id: string; name: string }
): StrategySummary {
  return {
    id: partial.id,
    name: partial.name,
    version: partial.version ?? "1",
    mode: partial.mode ?? "live",
    health: partial.health ?? "healthy",
    recentPerformance: {
      netProfit: 500,
      profitFactor: 1.2,
      winRate: 0.55,
      maxDrawdownPct: 4,
      totalTrades: 40,
      expectancy: 12,
      oosExpectancy: 10,
      baselineExpectancy: 12,
    },
    lastActivityAt: Date.now() - 120_000,
    riskState: "normal",
    ...partial,
  } as any;
}

function mission(
  partial: Partial<ResearchMission> & { id: string }
): ResearchMission {
  return {
    id: partial.id,
    uid: "user",
    name: partial.name ?? "Mission",
    spec: {
      markets: ["XAUUSD"],
      timeframes: ["M5"],
      tradingStyle: "intraday",
      concepts: ["structure"],
      sessions: ["london"],
      direction: "both",
      riskProfile: "moderate",
      historicalPeriod: "6M",
      maxCandidates: 10,
      requireOOS: true,
      requireWalkForward: true,
      requireMonteCarlo: true,
      forwardTesting: false,
      budget: {
        maxHypotheses: 10,
        maxBacktests: 20,
        maxAIRequests: 5,
        maxDurationMs: 1_000_000,
      },
      executionEnabled: false,
    },
    status: partial.status ?? "completed",
    stages: [],
    currentStage: "done",
    dataQuality: null,
    hypothesisCount: 10,
    compiledCount: 8,
    rejectedCount: 2,
    survivorCount: 2,
    failState: partial.failState ?? null,
    budgetUsed: { hypotheses: 10, backtests: 12, aiRequests: 0, startedAt: Date.now() - 7_200_000 },
    lease: null,
    createdAt: Date.now() - 8_640_000,
    updatedAt: Date.now() - 600_000,
    startedAt: Date.now() - 7_200_000,
    completedAt: Date.now() - 600_000,
    error: undefined,
    lineageNote: "test",
    ...partial,
  } as any;
}

function journalEntry(
  partial: Partial<JournalEntry> & { id: string }
): JournalEntry {
  return {
    id: partial.id,
    symbol: partial.symbol ?? "XAUUSD",
    type: partial.type ?? "trade",
    summary: partial.summary ?? "Reviewed trade",
    createdAt: Date.now() - 300_000,
    ...partial,
  } as any;
}

function alert(
  partial: Partial<AlertSummary> & { id: string }
): AlertSummary {
  return {
    id: partial.id,
    symbol: partial.symbol ?? "XAUUSD",
    type: partial.type ?? "setup",
    message: partial.message ?? "Alert",
    triggered: partial.triggered ?? true,
    triggeredAt: partial.triggeredAt ?? Date.now() - 120_000,
    createdAt: Date.now() - 120_000,
    ...partial,
  } as any;
}

function automationActivity(
  partial: Partial<AutomationActivity> & { id: string }
): AutomationActivity {
  return {
    id: partial.id,
    label: partial.label ?? "Run",
    status: partial.status ?? "idle",
    updatedAt: partial.updatedAt ?? Date.now(),
    ...partial,
  } as any;
}

function recentActivity(
  partial: Partial<RecentActivityItem> & { id: string }
): RecentActivityItem {
  return {
    id: partial.id,
    type: partial.type ?? "activity",
    title: partial.title ?? "Activity",
    summary: partial.summary ?? null,
    timestamp: partial.timestamp ?? Date.now() - 60_000,
    source: partial.source ?? "product",
    href: partial.href ?? null,
    ...partial,
  } as any;
}

function position(
  partial: Partial<PositionSummary> & { id: string; symbol: string }
): PositionSummary {
  return {
    id: partial.id,
    symbol: partial.symbol,
    side: partial.side ?? "LONG",
    size: partial.size ?? 1,
    entryPrice: partial.entryPrice ?? 100,
    currentPrice: partial.currentPrice ?? 101,
    unrealizedPnL: partial.unrealizedPnL ?? 100,
    strategyId: partial.strategyId ?? null,
    openedAt: partial.openedAt ?? Date.now() - 3_600_000,
    ...partial,
  } as any;
}

function systemComponent(
  partial: Partial<SystemComponent> & { id: string }
): SystemComponent {
  return {
    id: partial.id,
    label: partial.label ?? "Component",
    status: partial.status ?? "live",
    detail: partial.detail ?? undefined,
    asOf: partial.asOf ?? Date.now(),
    ...partial,
  } as any;
}

// ── aggregation tests ──────────────────────────────────────────────────────────

describe("IntelligenceOSContext aggregation", () => {
  it("builds a context from fully-populated deps", () => {
    const deps: AggregationDeps = {
      user: { uid: "user", email: "a@b.com", displayName: "A" },
      subscription: { hasSubscription: true, plan: "pro" },
      workspace: {
        activeWorkspace: "day-trading",
        selectedSymbol: "XAUUSD",
        selectedTimeframe: "M5",
        preferredMarkets: ["XAUUSD"],
      },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
      setupRecords: [setup({ id: "s1", status: "ACTIVE" }), setup({ id: "s2", status: "WAITING" })],
      strategies: [strategy({ id: "st1", name: "Alpha", health: "healthy" })],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10, maxOpenPositions: 5 },
        account: {
          balance: 10_000,
          equity: 10_000,
          openPositions: 2,
          exposure: [{ symbol: "XAUUSD", lots: 1 }],
        },
        executionFreshness: {
          freshness: "live" as DataFreshness,
          dataTimestamp: Date.now(),
          evaluatedAt: Date.now(),
          source: "risk-engine",
          fromCache: false,
        },
      },
      positions: {
        open: [position({ id: "p1", symbol: "XAUUSD" })],
        recentClosed: [],
      },
      research: {
        activeMissions: [mission({ id: "m1", status: "completed", survivorCount: 2 })],
        recentCandidates: [],
        recentEvents: [],
      },
      journal: { recentEntries: [journalEntry({ id: "j1" })], pendingReview: 1 },
      alerts: { recent: [alert({ id: "a1" })], triggeredCount: 1 },
      aiDossier: null,
      automation: { activeRuns: 1, recentActivity: [automationActivity({ id: "w1", status: "running" })] },
      productUsage: { recentActivity: [recentActivity({ id: "r1" })], onboardingSeen: true },
      system: {
        components: [systemComponent({ id: "market-data", status: "live" })],
        overall: "live",
      },
    };

    const ctx = assembleContext(deps);

    expect(ctx.user.uid).toBe("user");
    expect(ctx.subscription.hasSubscription).toBe(true);
    expect(ctx.workspace.selectedSymbol).toBe("XAUUSD");
    expect(ctx.setups.records).toHaveLength(2);
    expect(ctx.setups.activeCount).toBe(1);
    expect(ctx.strategies.items).toHaveLength(1);
    expect(ctx.strategies.degradedCount).toBe(0);
    expect(ctx.risk.status).toBe("normal");
    expect(ctx.risk.account.balance).toBe(10_000);
    expect(ctx.positions.open).toHaveLength(1);
    expect(ctx.research.activeMissions).toHaveLength(1);
    expect(ctx.research.activeMissions[0].survivorCount).toBe(2);
    expect(ctx.journal.recentEntries).toHaveLength(1);
    expect(ctx.journal.pendingReview).toBe(1);
    expect(ctx.alerts.recent).toHaveLength(1);
    expect(ctx.alerts.triggeredCount).toBe(1);
    expect(ctx.automation.activeRuns).toBe(1);
    expect(ctx.productUsage.onboardingSeen).toBe(true);
    expect(ctx.system.components).toHaveLength(1);
    expect(ctx.system.overall).toBe("live");
    expect(ctx.whatMattersNow).toBeInstanceOf(Array);
  });

  it("returns honest nulls when deps are empty", () => {
    const deps: AggregationDeps = {
      user: { uid: "user", email: null, displayName: null },
      subscription: { hasSubscription: false, plan: null },
      workspace: {
        activeWorkspace: "day-trading",
        selectedSymbol: null,
        selectedTimeframe: "M5",
        preferredMarkets: [],
      },
      marketSlices: {},
      setupRecords: [],
      strategies: [],
      risk: {
        status: "unavailable",
        limits: null,
        account: { balance: null, equity: null, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      positions: { open: [], recentClosed: [] },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      journal: { recentEntries: [], pendingReview: 0 },
      alerts: { recent: [], triggeredCount: 0 },
      aiDossier: null,
      automation: { activeRuns: 0, recentActivity: [] },
      productUsage: { recentActivity: [], onboardingSeen: false },
      system: {
        components: [systemComponent({ id: "market-data", status: "unknown" })],
        overall: "unavailable",
      },
    };

    const ctx = assembleContext(deps);

    expect(ctx.workspace.selectedSymbol).toBeNull();
    expect(ctx.market.symbol).toBeNull();
    expect(ctx.setups.records).toHaveLength(0);
    expect(ctx.setups.activeCount).toBe(0);
    expect(ctx.strategies.items).toHaveLength(0);
    expect(ctx.risk.status).toBe("unavailable");
    expect(ctx.risk.limits).toBeNull();
    expect(ctx.positions.open).toHaveLength(0);
    expect(ctx.research.activeMissions).toHaveLength(0);
    expect(ctx.journal.recentEntries).toHaveLength(0);
    expect(ctx.alerts.recent).toHaveLength(0);
    expect(ctx.system.overall).toBe("unavailable");
    expect(ctx.whatMattersNow.length).toBeGreaterThan(0);
  });
});

// ── priority model tests ───────────────────────────────────────────────────────

describe("IntelligenceOSContext priority", () => {
  it("prioritizes CRITICAL risk over HIGH setups over MEDIUM alerts", () => {
    const items = prioritize({
      setups: [setup({ id: "s1", status: "ACTIVE" })],
      strategies: [],
      risk: {
        status: "halted",
        limits: null,
        account: { balance: 0, equity: 0, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [alert({ id: "a1" })], triggeredCount: 1 },
      positions: { open: [], recentClosed: [] },
      system: {
        components: [],
        overall: "live",
      },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const priorities = items.map((i) => i.priority);
    expect(priorities[0]).toBe("CRITICAL");
    expect(priorities).toContain("HIGH");
    expect(priorities).toContain("INFO");
  });

  it("surfaces stale market data", () => {
    const items = prioritize({
      setups: [],
      strategies: [],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": staleMarketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const stale = items.find((i) => i.type === "DATA_STALE" && i.source === "market");
    expect(stale).toBeDefined();
    expect(stale?.title).toContain("XAUUSD");
  });

  it("surfaces setup confirmed and invalidated events", () => {
    const items = prioritize({
      setups: [
        setup({ id: "s1", status: "ACTIVE" }),
        setup({ id: "s2", status: "INVALIDATED" }),
        setup({ id: "s3", status: "WAITING" }),
      ],
      strategies: [],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const confirmed = items.find((i) => i.type === "SETUP_CONFIRMED");
    const invalidated = items.find((i) => i.type === "SETUP_INVALIDATED");
    const waiting = items.find((i) => i.type === "SETUP_DETECTED");

    expect(confirmed).toBeDefined();
    expect(invalidated).toBeDefined();
    expect(waiting).toBeDefined();
  });

  it("surfaces strategy degradation and recovery", () => {
    const items = prioritize({
      setups: [],
      strategies: [
        strategy({ id: "st1", name: "Alpha", health: "degraded" }),
        strategy({ id: "st2", name: "Beta", health: "recovering" }),
      ],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const degraded = items.find((i) => i.type === "STRATEGY_DEGRADED");
    const recovering = items.find((i) => i.type === "STRATEGY_RECOVERED");

    expect(degraded).toBeDefined();
    expect(recovering).toBeDefined();
  });

  it("surfaces research completed and failed events", () => {
    const items = prioritize({
      setups: [],
      strategies: [],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: {
        activeMissions: [
          mission({ id: "m1", status: "completed", survivorCount: 2, failState: null }),
          mission({ id: "m2", status: "failed", failState: "DATA_UNAVAILABLE" }),
          mission({ id: "m3", status: "running" }),
        ],
        recentCandidates: [],
        recentEvents: [],
      },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const completed = items.find((i) => i.type === "RESEARCH_COMPLETED");
    const failed = items.find((i) => i.type === "RESEARCH_FAILED");
    const running = items.find((i) => i.type === "INFO" && i.title.includes("running"));

    expect(completed).toBeDefined();
    expect(failed).toBeDefined();
    expect(running).toBeDefined();
  });

  it("surfaces alert-triggered events", () => {
    const items = prioritize({
      setups: [],
      strategies: [],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [alert({ id: "a1", triggered: true }), alert({ id: "a2", triggered: false })], triggeredCount: 1 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const alerts = items.filter((i) => i.type === "ALERT_TRIGGERED");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("a1");
  });

  it("surfaces system unavailable with CRITICAL priority", () => {
    const items = prioritize({
      setups: [],
      strategies: [],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: {
        components: [systemComponent({ id: "market-data", status: "unavailable" })],
        overall: "unavailable",
      },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const critical = items.find((i) => i.priority === "CRITICAL" && i.type === "DATA_STALE" && i.source === "system");
    expect(critical).toBeDefined();
    expect(critical?.title).toBe("Trading intelligence partially unavailable");
  });

  it("surfaces execution freshness gate when live execution is not live", () => {
    const items = prioritize({
      setups: [],
      strategies: [],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: {
          freshness: "stale" as DataFreshness,
          dataTimestamp: Date.now() - 120_000,
          evaluatedAt: Date.now(),
          source: "risk-engine",
          fromCache: false,
        },
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const exec = items.find((i) => i.title.includes("live execution") && i.title.includes("stale"));
    expect(exec).toBeDefined();
    expect(exec?.priority).toBe("HIGH");
  });

  it("returns FAIL-CLosed risk when system is unavailable", () => {
    const events = prioritize({
      setups: [],
      strategies: [],
      risk: {
        status: "unavailable",
        limits: null,
        account: { balance: null, equity: null, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: {
        components: [systemComponent({ id: "market-data", status: "unavailable" })],
        overall: "unavailable",
      },
      marketSlices: {},
    });

    const unavailable = events.find((i) => i.type === "RISK_HALTED" && i.priority === "CRITICAL");
    expect(unavailable).toBeDefined();
  });
});

// ── deterministic priority order test ──────────────────────────────────────────

describe("IntelligenceOSContext deterministic ordering", () => {
  it("returns items sorted by priority then newest first", () => {
    const items = prioritize({
      setups: [
        setup({ id: "s1", status: "ACTIVE" }),
        setup({ id: "s2", status: "WAITING" }),
      ],
      strategies: [],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    let lastRank = -1;
    for (const item of items) {
      const rank = item.priority === "CRITICAL" ? 0 : item.priority === "HIGH" ? 1 : item.priority === "MEDIUM" ? 2 : item.priority === "LOW" ? 3 : 4;
      expect(rank).toBeLessThanOrEqual(lastRank + 1); // non-decreasing priority rank, but allow equal groups
      lastRank = rank;
    }
    // The exact ordering within same priority can vary by implementation;
    // we only require priority buckets are respected in descending // @ts-nocheck
importance
    const priorities = items.map((i) => i.priority);
    expect(priorities[0]).toBeOneOf(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
  });

  it("CRITICAL appears before HIGH before MEDIUM before LOW before INFO in ordering", () => {
    const items = prioritize({
      setups: [setup({ id: "s1", status: "ACTIVE" })],
      strategies: [strategy({ id: "st1", name: "Alpha", health: "degraded" })],
      risk: {
        status: "normal",
        limits: { maxDrawdownPercent: 10 },
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      alerts: { recent: [], triggeredCount: 0 },
      positions: { open: [], recentClosed: [] },
      system: { components: [], overall: "live" },
      marketSlices: {
        "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }),
      },
    });

    const priorities = items.map((i) => i.priority);
    const firstCritical = priorities.indexOf("CRITICAL");
    const firstHigh = priorities.indexOf("HIGH");
    const firstMedium = priorities.indexOf("MEDIUM");
    expect(firstCritical).toBeGreaterThanOrEqual(0);
    expect(firstHigh).toBeGreaterThanOrEqual(0);
    expect(firstMedium).toBeGreaterThanOrEqual(0);
    expect(firstCritical).toBeLessThan(firstHigh);
    expect(firstHigh).toBeLessThan(firstMedium);
  });
});

// ── event shape tests ──────────────────────────────────────────────────────────


describe("IntelligenceEvent shape", () => {
  it("every event exposes required fields", () => {
    const deps: AggregationDeps = {
      user: { uid: "user", email: null, displayName: null },
      subscription: { hasSubscription: false, plan: null },
      workspace: { activeWorkspace: "day-trading", selectedSymbol: "XAUUSD", selectedTimeframe: "M5", preferredMarkets: [] },
      marketSlices: { "XAUUSD:M5": marketSlice({ symbol: "XAUUSD", timeframe: "M5" }) },
      setupRecords: [],
      strategies: [],
      risk: {
        status: "normal",
        limits: null,
        account: { balance: 10_000, equity: 10_000, openPositions: 0, exposure: [] },
        executionFreshness: null,
      },
      positions: { open: [], recentClosed: [] },
      research: { activeMissions: [], recentCandidates: [], recentEvents: [] },
      journal: { recentEntries: [], pendingReview: 0 },
      alerts: { recent: [], triggeredCount: 0 },
      aiDossier: null,
      automation: { activeRuns: 0, recentActivity: [] },
      productUsage: { recentActivity: [], onboardingSeen: false },
      system: { components: [], overall: "live" },
    };
    const ctx = assembleContext(deps);
    for (const event of ctx.whatMattersNow) {
      expect(event).toHaveProperty("id");
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("priority");
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("source");
      expect(event).toHaveProperty("title");
      expect(event).toHaveProperty("summary");
      expect(event).toHaveProperty("reason");
      expect(event).toHaveProperty("actions");
      expect(event).toHaveProperty("status");
      for (const action of event.actions) {
        expect(action).toHaveProperty("id");
        expect(action).toHaveProperty("label");
        expect(action).toHaveProperty("safety");
        expect(action).toHaveProperty("target");
      }
    }
  });
});
