/**
 * AlgoVault Intelligence OS — Contextual Aggregation
 *
 * Server-side entrypoint that composes the canonical IntelligenceOSContext
 * from existing source-of-truth slices. It does NOT replace:
 *   - market-truth / analytics
 *   - the Risk Engine
 *   - Setup Memory
 *   - Strategy Lab / strategy-research
 *   - the existing event bus
 *
 * It reads existing RTDB records where possible and returns an honest
 * unavailable marker when a source cannot be reached.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errMessage } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from "@/lib/market-data/types";
import { WorkspaceId } from "@/lib/terminal/types";
import { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";
import { type ResearchMission, type ResearchCandidate, type ResearchEvent } from "@/lib/strategy-research/types";
import { brokerLimitsFromAccount, type RiskLimits } from "@/lib/risk/risk-engine";
import {
  assembleContext,
  type AggregationDeps,
  type IntelligenceOSContext,
  type MarketSlice,
  type StrategySummary,
  type PositionSummary,
  type JournalEntry,
  type AlertSummary,
  type AutomationActivity,
  type RecentActivityItem,
  type IntelligenceEvent,
} from "./types";
import { DataFreshness, FreshnessDescriptor, FRESHNESS_LABEL } from "@/lib/mobile/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_SET = new Set<string>(SUPPORTED_SYMBOLS as readonly string[]);

// ── Bounded reads ──────────────────────────────────────────────────────────────

const MAX_SETUPS = 25;
const MAX_ALERTS = 25;
const MAX_POSITIONS = 25;
const MAX_STRATEGIES = 25;
const MAX_MISSIONS = 10;
const MAX_CANDIDATES = 10;
const MAX_JOURNAL = 10;
const MAX_ACTIVITY = 10;

// ── Public API ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const uid = user.uid;

    const [
      workspace,
      marketSlices,
      setupRecords,
      strategies,
      risk,
      positions,
      research,
      journal,
      alerts,
      automation,
      productUsage,
      system,
    ] = await Promise.all([
      readWorkspace(uid),
      readMarketSlices(uid),
      readSetups(uid),
      readStrategies(uid),
      readRisk(uid),
      readPositions(uid),
      readResearch(uid),
      readJournal(uid),
      readAlerts(uid),
      readAutomation(uid),
      readProductUsage(uid),
      readSystemHealth(),
    ]);

    const deps: AggregationDeps = {
      user: {
        uid,
        email: user.email,
        displayName: user.displayName ?? user.email,
      },
      subscription: {
        hasSubscription: false,
        plan: null,
      },
      workspace: workspace ?? defaultWorkspace(),
      marketSlices,
      setupRecords: setupRecords ?? [],
      strategies: strategies ?? [],
      risk: risk ?? unavailableRisk(),
      positions: positions ?? emptyPositions(),
      research: research ?? emptyResearch(),
      journal: journal ?? emptyJournal(),
      alerts: alerts ?? emptyAlerts(),
      aiDossier: null,
      automation: automation ?? emptyAutomation(),
      productUsage: productUsage ?? emptyProductUsage(),
      system: system ?? defaultSystem(),
    };

    const context = assembleContext(deps);

    return NextResponse.json(
      {
        success: true,
        generatedAt: startedAt,
        elapsedMs: Date.now() - startedAt,
        context,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[intelligence-os/context] failed:", errMessage(err));
    return NextResponse.json({ error: "Failed to build intelligence context" }, { status: 500 });
  }
}

// ── Workspace ─────────────────────────────────────────────────────────────────

interface WorkspaceDoc {
  activeWorkspace?: WorkspaceId;
  selectedSymbol?: string;
  selectedTimeframe?: string;
  preferredMarkets?: string[];
}

async function readWorkspace(uid: string): Promise<AggregationDeps["workspace"] | null> {
  try {
    const snap = await adminDatabase.ref(`mobile/workspaces/${uid}`).get();
    if (!snap.exists()) return null;
    const doc = snap.val() as WorkspaceDoc;
    const symbol = normalizeSymbol(doc.selectedSymbol);
    const timeframe = normalizeTimeframe(doc.selectedTimeframe);
    return {
      activeWorkspace: doc.activeWorkspace ?? "day-trading",
      selectedSymbol: symbol ?? null,
      selectedTimeframe: timeframe ?? "M5",
      preferredMarkets: Array.isArray(doc.preferredMarkets) ? doc.preferredMarkets.slice(0, 20) : [],
    };
  } catch {
    return null;
  }
}

function defaultWorkspace(): AggregationDeps["workspace"] {
  return {
    activeWorkspace: "day-trading",
    selectedSymbol: "XAUUSD",
    selectedTimeframe: "M5",
    preferredMarkets: ["XAUUSD", "EURUSD", "GBPUSD", "NAS100"],
  };
}

// ── Market slices ──────────────────────────────────────────────────────────────

async function readMarketSlices(uid: string): Promise<Record<string, MarketSlice | null>> {
  try {
    const snap = await adminDatabase.ref(`mobile/command-center/${uid}/markets`).get();
    if (!snap.exists()) return {};
    const raw = snap.val() as Record<string, unknown>;
    const out: Record<string, MarketSlice | null> = {};
    for (const [key, value] of Object.entries(raw)) {
      const m = value as Record<string, unknown>;
      if (!m || m.available !== true) {
        out[key] = null;
        continue;
      }
      const symbol = normalizeSymbol(String(m.symbol ?? ""));
      if (!symbol) {
        out[key] = null;
        continue;
      }
      out[key] = {
        symbol,
        timeframe: normalizeTimeframe(String(m.timeframe ?? "M5")) ?? "M5",
        freshness: freshnessFromMap(m),
        price: toNumber(m.price) ?? null,
        bid: toNumber(m.bid) ?? null,
        ask: toNumber(m.ask) ?? null,
        spread: toNumber(m.spread) ?? null,
        trend: trendFromMap(m),
        structure: m.structure ? String(m.structure) : null,
        regime: regimeFromMap(m),
        session: sessionFromMap(m),
        marketStatus: marketStatusFromMap(m),
        volatility: volatilityFromMap(m),
        fvgCount: toNumber(m.fvgCount) ?? 0,
        activeFvg: toNumber(m.activeFvg) ?? 0,
        orderBlockCount: toNumber(m.orderBlockCount) ?? 0,
        sweeps: Array.isArray(m.sweeps)
          ? m.sweeps.slice(-3).map((s: Record<string, unknown>) => ({
              side: String(s.side ?? ""),
              level: toNumber(s.level) ?? 0,
              timestamp: toNumber(s.timestamp) ?? 0,
            }))
          : [],
        liquidityLevels: Array.isArray(m.liquidityLevels)
          ? m.liquidityLevels.slice(0, 5).map((l: Record<string, unknown>) => ({
              price: toNumber(l.price) ?? 0,
              type: String(l.type ?? ""),
              strength: toNumber(l.strength) ?? 0,
            }))
          : [],
        provider: m.provider ? String(m.provider) : null,
        dataTimestamp: toNumber(m.dataTimestamp),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Narrow an unknown RTDB value to a plain map, or undefined when it is not an object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function freshnessFromMap(m: Record<string, unknown>): FreshnessDescriptor {
  const f = asRecord(m.freshness);
  const status = (f?.status as DataFreshness | undefined) ?? "stale";
  const source = f?.source;
  return {
    freshness: (FRESHNESS_LABEL[status] ? status : "stale") as DataFreshness,
    dataTimestamp: toNumber(f?.dataAgeMs) ?? 0,
    evaluatedAt: Date.now(),
    source: source ? String(source) : "unknown",
    fromCache: f?.fromCache === true,
    providerDelayMs: toNumber(f?.providerDelayMs),
  };
}

function trendFromMap(m: Record<string, unknown>): "bullish" | "bearish" | "neutral" | null {
  const t = String(m.trend ?? "").toLowerCase();
  if (t === "bullish" || t === "bearish" || t === "neutral") return t as "bullish" | "bearish" | "neutral";
  return null;
}

function regimeFromMap(m: Record<string, unknown>): "trending_bullish" | "trending_bearish" | "ranging" | "breakout" | "high_volatility" | "low_volatility" | "transitional" | null {
  const r = String(m.regime ?? "").toLowerCase();
  if (
    r === "trending_bullish" ||
    r === "trending_bearish" ||
    r === "ranging" ||
    r === "breakout" ||
    r === "high_volatility" ||
    r === "low_volatility" ||
    r === "transitional"
  ) {
    return r as "trending_bullish" | "trending_bearish" | "ranging" | "breakout" | "high_volatility" | "low_volatility" | "transitional";
  }
  return null;
}

function sessionFromMap(m: Record<string, unknown>): "asian" | "london" | "new_york" | "overlap" | "closed" | null {
  const s = String(m.session ?? "").toLowerCase();
  if (s === "asian" || s === "london" || s === "new_york" || s === "overlap" || s === "closed") return s as "asian" | "london" | "new_york" | "overlap" | "closed";
  return null;
}

function marketStatusFromMap(m: Record<string, unknown>): "open" | "closed" | "pre_market" | "post_market" | "unknown" | null {
  const s = String(m.marketStatus ?? "").toLowerCase();
  if (s === "open" || s === "closed" || s === "pre_market" || s === "post_market") return s as "open" | "closed" | "pre_market" | "post_market";
  return null;
}

function volatilityFromMap(m: Record<string, unknown>): { atr: number; atrPercent: number; state: "low" | "normal" | "high" | "extreme" } | null {
  const v = m.volatility;
  if (!v || typeof v !== "object") return null;
  const vol = v as Record<string, unknown>;
  const atr = toNumber(vol.atr);
  const atrPercent = toNumber(vol.atrPercent);
  const state = String(vol.state ?? "").toLowerCase();
  if (!atr && !atrPercent) return null;
  return {
    atr: atr ?? 0,
    atrPercent: atrPercent ?? 0,
    state: state === "low" || state === "normal" || state === "high" || state === "extreme" ? state : "normal",
  };
}

// ── Setups ─────────────────────────────────────────────────────────────────────

async function readSetups(uid: string): Promise<SetupMemoryRecord[] | null> {
  try {
    const snap = await adminDatabase.ref(`monitoring/setups/${uid}`).get();
    if (!snap.exists()) return [];
    const raw = snap.val() as Record<string, SetupMemoryRecord>;
    const records = Object.entries(raw)
      .map(([id, r]) => ({ ...r, id: r.id ?? id }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, MAX_SETUPS);
    return records;
  } catch {
    return null;
  }
}

// ── Strategies ─────────────────────────────────────────────────────────────────

interface StrategyDoc {
  id?: string;
  name?: string;
  version?: string;
  mode?: string;
  health?: string;
  lastActivityAt?: number;
  riskState?: string;
  metrics?: Record<string, unknown>;
  oosExpectancy?: number;
  baselineExpectancy?: number;
}

async function readStrategies(uid: string): Promise<StrategySummary[] | null> {
  try {
    const snap = await adminDatabase.ref(`strategy_summaries/${uid}`).get();
    if (!snap.exists()) return [];
    const raw = snap.val() as Record<string, StrategyDoc>;
    const items = Object.entries(raw)
      .map(([id, doc]) => {
        const m = doc.metrics as Record<string, unknown> | undefined;
        return {
          id: doc.id ?? id,
          name: doc.name ?? id,
          version: doc.version ?? null,
          mode: modeFromMap(doc.mode),
          health: healthFromMap(doc.health),
          recentPerformance: performanceFromMap(m, doc.oosExpectancy, doc.baselineExpectancy),
          lastActivityAt: toNumber(doc.lastActivityAt),
          riskState: riskStateFromMap(doc.riskState),
        };
      })
      .filter((s) => s.id)
      .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
      .slice(0, MAX_STRATEGIES);
    return items;
  } catch {
    return null;
  }
}

function modeFromMap(value: unknown): "backtest" | "paper" | "live" | "replay" | null {
  const v = String(value ?? "").toLowerCase();
  if (v === "backtest" || v === "paper" || v === "live" || v === "replay") return v as "backtest" | "paper" | "live" | "replay";
  return null;
}

function healthFromMap(value: unknown): StrategySummary["health"] {
  const v = String(value ?? "").toLowerCase();
  if (v === "healthy") return "healthy";
  if (v === "degraded") return "degraded";
  if (v === "recovering") return "recovering";
  if (v === "insufficient_data") return "insufficient_data";
  return "unknown";
}

function performanceFromMap(
  m: Record<string, unknown> | undefined,
  oosExpectancy: unknown,
  baselineExpectancy: unknown
): StrategySummary["recentPerformance"] {
  if (!m) return null;
  const netProfit = toNumber(m.netProfit);
  const profitFactor = toNumber(m.profitFactor);
  const winRate = toNumber(m.winRate);
  const maxDrawdownPct = toNumber(m.maxDrawdown);
  const totalTrades = toNumber(m.totalTrades);
  const expectancy = toNumber(m.expectancy);
  return {
    netProfit: netProfit ?? null,
    profitFactor: profitFactor ?? null,
    winRate: winRate ?? null,
    maxDrawdownPct: maxDrawdownPct ?? null,
    totalTrades: totalTrades ?? null,
    expectancy: expectancy ?? null,
    oosExpectancy: toNumber(oosExpectancy) ?? null,
    baselineExpectancy: toNumber(baselineExpectancy) ?? null,
  };
}

function riskStateFromMap(value: unknown): "normal" | "caution" | "restricted" | "halted" | "unknown" {
  const v = String(value ?? "").toLowerCase();
  if (v === "normal") return "normal";
  if (v === "caution") return "caution";
  if (v === "restricted") return "restricted";
  if (v === "halted") return "halted";
  return "unknown";
}

// ── Risk ───────────────────────────────────────────────────────────────────────

interface AccountDoc {
  [key: string]: unknown;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  status?: string;
  lastHeartbeatAt?: number;
  openPositions?: number;
  exposure?: Array<{ symbol: string; lots: number }>;
  limits?: Record<string, unknown>;
  maxDrawdownPercent?: number;
  maxDailyLossPercent?: number;
  maxOpenPositions?: number;
  emergencyStop?: boolean;
  requireStopLoss?: boolean;
}

async function readRisk(uid: string): Promise<AggregationDeps["risk"] | null> {
  try {
    const [accounts, positions] = await Promise.all([
      adminDatabase.ref(`trading_accounts/${uid}`).get(),
      adminDatabase.ref(`trading_positions/${uid}`).get(),
    ]);
    if (!accounts.exists()) return null;

    const raw = accounts.val() as Record<string, AccountDoc>;
    const first = Object.values(raw)[0] ?? {};
    const balance = toNumber(first.balance) ?? 0;
    const equity = toNumber(first.equity) ?? 0;

    const openPositions = toNumber(first.openPositions) ?? 0;
    const exposure: Array<{ symbol: string; lots: number }> =
      Array.isArray(first.exposure)
        ? first.exposure
            .filter((e): e is { symbol: string; lots: number } => typeof e === "object" && e !== null && typeof e.symbol === "string" && typeof e.lots === "number")
            .slice(0, 20)
        : [];

    const brokerLimits = brokerLimitsFromAccount(first);
    const limits: RiskLimits = {
      ...brokerLimits,
      maxDrawdownPercent: toNumber(first.maxDrawdownPercent),
      maxDailyLossPercent: toNumber(first.maxDailyLossPercent),
      maxOpenPositions: toNumber(first.maxOpenPositions),
      emergencyStop: first.emergencyStop === true,
      requireStopLoss: first.requireStopLoss !== false,
    };

    const riskStatus = deriveRiskStatus(equity, limits, openPositions);

    const executionFreshness: FreshnessDescriptor | null = {
      freshness: "live",
      dataTimestamp: 0,
      evaluatedAt: Date.now(),
      source: "risk-engine",
      fromCache: false,
    };

    return {
      status: riskStatus,
      limits,
      account: {
        balance,
        equity,
        openPositions,
        exposure,
      },
      executionFreshness,
    };
  } catch {
    return null;
  }
}

function deriveRiskStatus(
  equity: number,
  limits: RiskLimits,
  openPositions: number,
  balance?: number
): "normal" | "caution" | "restricted" | "halted" | "unavailable" {
  if (!Number.isFinite(equity) || equity <= 0) return "unavailable";
  if (limits.emergencyStop) return "halted";
  if (!limits) return "unavailable";

  const balanceVal = balance ?? equity;
  const equityVal = equity;
  const drawdownPercent = balanceVal > 0 ? Math.max(0, ((balanceVal - equityVal) / balanceVal) * 100) : 0;

  if (limits.maxDrawdownPercent !== undefined && drawdownPercent >= limits.maxDrawdownPercent) return "halted";
  if (limits.maxDrawdownPercent !== undefined && drawdownPercent >= limits.maxDrawdownPercent * 0.75) return "restricted";
  if (limits.maxOpenPositions !== undefined && openPositions >= limits.maxOpenPositions) return "restricted";
  return "normal";
}

function unavailableRisk(): AggregationDeps["risk"] {
  return {
    status: "unavailable",
    limits: null,
    account: {
      balance: null,
      equity: null,
      openPositions: 0,
      exposure: [],
    },
    executionFreshness: null,
  };
}

// ── Positions ──────────────────────────────────────────────────────────────────

interface PositionDoc {
  id?: string;
  symbol?: string;
  side?: string;
  size?: number;
  entryPrice?: number;
  currentPrice?: number;
  unrealizedPnL?: number;
  strategyId?: string;
  openedAt?: number;
}

async function readPositions(uid: string): Promise<AggregationDeps["positions"] | null> {
  try {
    const snap = await adminDatabase.ref(`trading_positions/${uid}`).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, PositionDoc>;
    const open: PositionSummary[] = Object.entries(raw)
      .map(([id, p]): PositionSummary => {
        const side = String(p.side ?? "").toUpperCase();
        return {
          id: p.id ?? id,
          symbol: String(p.symbol ?? "UNKNOWN"),
          side: side === "LONG" ? "LONG" : side === "SHORT" ? "SHORT" : "LONG",
          size: toNumber(p.size) ?? 0,
          entryPrice: toNumber(p.entryPrice) ?? 0,
          currentPrice: toNumber(p.currentPrice) ?? null,
          unrealizedPnL: toNumber(p.unrealizedPnL) ?? null,
          strategyId: p.strategyId ? String(p.strategyId) : null,
          openedAt: toNumber(p.openedAt),
        };
      })
      .filter((p) => p.symbol)
      .slice(0, MAX_POSITIONS);
    return { open, recentClosed: [] };
  } catch {
    return null;
  }
}

function emptyPositions(): AggregationDeps["positions"] {
  return { open: [], recentClosed: [] };
}

// ── Research ───────────────────────────────────────────────────────────────────

async function readResearch(uid: string): Promise<AggregationDeps["research"] | null> {
  try {
    const snap = await adminDatabase.ref(`strategy_research/${uid}/missions`).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, ResearchMission>;
    const missions = Object.values(raw)
      .filter((m): m is ResearchMission => !!m)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, MAX_MISSIONS);

    const candidatesSnap = await adminDatabase.ref(`strategy_research/${uid}/candidates`).get().catch(() => null);
    const candidatesVal = candidatesSnap?.val() as Record<string, ResearchCandidate> | undefined;
    const candidates = candidatesVal
      ? Object.values(candidatesVal)
          .filter((c): c is ResearchCandidate => !!c)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
          .slice(0, MAX_CANDIDATES)
      : [];

    const eventsSnap = await adminDatabase.ref(`strategy_research/${uid}/events`).get().catch(() => null);
    const eventsVal = eventsSnap?.val() as Record<string, ResearchEvent> | undefined;
    const events = eventsVal
      ? Object.values(eventsVal)
          .filter((e): e is ResearchEvent => !!e)
          .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
          .slice(0, 20)
      : [];

    return {
      activeMissions: missions,
      recentCandidates: candidates,
      recentEvents: events,
    };
  } catch {
    return null;
  }
}

function emptyResearch(): AggregationDeps["research"] {
  return { activeMissions: [], recentCandidates: [], recentEvents: [] };
}

// ── Journal ─────────────────────────────────────────────────────────────────────

interface JournalDoc {
  id?: string;
  symbol?: string;
  type?: string;
  summary?: string;
  createdAt?: number;
  pendingReview?: boolean;
}

async function readJournal(uid: string): Promise<AggregationDeps["journal"] | null> {
  try {
    const snap = await adminDatabase.ref(`journal/${uid}/entries`).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, JournalDoc>;
    const entries = Object.entries(raw)
      .map(([id, e]) => ({
        id: e.id ?? id,
        symbol: e.symbol ? String(e.symbol) : null,
        type: e.type ? String(e.type) : null,
        summary: e.summary ? String(e.summary) : null,
        createdAt: toNumber(e.createdAt) ?? Date.now(),
      }))
      .filter((e) => e.id)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, MAX_JOURNAL);
    const pendingReview = entries.filter((e) => {
      const doc = raw[e.id ?? ""];
      return doc?.pendingReview === true;
    }).length;
    return { recentEntries: entries, pendingReview };
  } catch {
    return null;
  }
}

function emptyJournal(): AggregationDeps["journal"] {
  return { recentEntries: [], pendingReview: 0 };
}

// ── Alerts ─────────────────────────────────────────────────────────────────────

interface AlertDoc {
  id?: string;
  symbol?: string;
  type?: string;
  message?: string;
  triggered?: boolean;
  triggeredAt?: number;
  createdAt?: number;
}

async function readAlerts(uid: string): Promise<AggregationDeps["alerts"] | null> {
  try {
    const snap = await adminDatabase.ref(`alerts/${uid}`).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, AlertDoc>;
    const items = Object.entries(raw)
      .map(([id, a]) => ({
        id: a.id ?? id,
        symbol: a.symbol ? String(a.symbol) : null,
        type: a.type ? String(a.type) : null,
        message: a.message ? String(a.message) : null,
        triggered: a.triggered === true,
        triggeredAt: toNumber(a.triggeredAt),
        createdAt: toNumber(a.createdAt) ?? Date.now(),
      }))
      .filter((a) => a.id)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, MAX_ALERTS);
    return { recent: items, triggeredCount: items.filter((a) => a.triggered).length };
  } catch {
    return null;
  }
}

function emptyAlerts(): AggregationDeps["alerts"] {
  return { recent: [], triggeredCount: 0 };
}

// ── Automation ─────────────────────────────────────────────────────────────────

async function readAutomation(uid: string): Promise<AggregationDeps["automation"] | null> {
  try {
    const snap = await adminDatabase.ref(`workflows/${uid}/runs`).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, { id?: string; label?: string; status?: string; updatedAt?: number }>;
    const runs = Object.values(raw).filter((r): r is { id?: string; label?: string; status?: string; updatedAt?: number } => !!r);
    const activeRuns = runs.filter((r) => r.status === "running").length;
    const recentActivity: AutomationActivity[] = runs
      .slice(0, MAX_ACTIVITY)
      .map((r) => ({
        id: r.id ?? "",
        label: r.label ? String(r.label) : "Workflow run",
        status: statusFromMap(r.status),
        updatedAt: toNumber(r.updatedAt),
      }));
    return { activeRuns, recentActivity };
  } catch {
    return null;
  }
}

function emptyAutomation(): AggregationDeps["automation"] {
  return { activeRuns: 0, recentActivity: [] };
}

function statusFromMap(value: unknown): "running" | "paused" | "idle" | "error" | "unknown" {
  const v = String(value ?? "").toLowerCase();
  if (v === "running") return "running";
  if (v === "paused") return "paused";
  if (v === "idle") return "idle";
  if (v === "error") return "error";
  return "unknown";
}

// ── Product usage ──────────────────────────────────────────────────────────────

async function readProductUsage(uid: string): Promise<AggregationDeps["productUsage"] | null> {
  try {
    const snap = await adminDatabase.ref(`product_usage/${uid}/activity`).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, { id?: string; type?: string; title?: string; summary?: string; timestamp?: number; source?: string; href?: string }>;
    const items = Object.values(raw)
      .filter((a): a is { id?: string; type?: string; title?: string; summary?: string; timestamp?: number; source?: string; href?: string } => !!a)
      .sort((a, b) => (toNumber(b.timestamp) ?? 0) - (toNumber(a.timestamp) ?? 0))
      .slice(0, MAX_ACTIVITY)
      .map((a) => ({
        id: a.id ?? "",
        type: a.type ? String(a.type) : "activity",
        title: a.title ? String(a.title) : "Recent activity",
        summary: a.summary ? String(a.summary) : null,
        timestamp: toNumber(a.timestamp) ?? Date.now(),
        source: a.source ? String(a.source) : "product",
        href: a.href ? String(a.href) : null,
      }));
    return { recentActivity: items, onboardingSeen: true };
  } catch {
    return null;
  }
}

function emptyProductUsage(): AggregationDeps["productUsage"] {
  return { recentActivity: [], onboardingSeen: false };
}

// ── System health ──────────────────────────────────────────────────────────────

async function readSystemHealth(): Promise<IntelligenceOSContext["system"] | null> {
  try {
    const snap = await adminDatabase.ref("system_health").get().catch(() => null);
    const raw = snap?.val() as Record<string, { id?: string; label?: string; status?: string; detail?: string; asOf?: number }> | undefined;
    if (!raw) return null;
    const components: IntelligenceOSContext["system"]["components"] = Object.values(raw)
      .filter((c): c is { id?: string; label?: string; status?: string; detail?: string; asOf?: number } => !!c)
      .map((c) => ({
        id: c.id ?? "",
        label: c.label ? String(c.label) : "Component",
        status: componentStatusFromMap(c.status),
        detail: c.detail ? String(c.detail) : undefined,
        asOf: toNumber(c.asOf),
      }));
    const overall = overallFromComponents(components);
    return { components, overall };
  } catch {
    return null;
  }
}

function componentStatusFromMap(value: unknown): IntelligenceOSContext["system"]["components"][0]["status"] {
  const v = String(value ?? "").toLowerCase();
  if (v === "live") return "live";
  if (v === "healthy") return "healthy";
  if (v === "degraded") return "degraded";
  if (v === "stale") return "stale";
  if (v === "disconnected") return "disconnected";
  if (v === "unavailable") return "unavailable";
  return "unknown";
}

function overallFromComponents(components: IntelligenceOSContext["system"]["components"]): "live" | "degraded" | "unavailable" {
  if (components.some((c) => c.status === "unavailable" || c.status === "disconnected")) return "unavailable";
  if (components.some((c) => c.status === "stale" || c.status === "degraded")) return "degraded";
  return "live";
}

function defaultSystem(): IntelligenceOSContext["system"] {
  return {
    components: [
      { id: "market-data", label: "Market Data", status: "unknown" },
      { id: "broker", label: "Broker", status: "unknown" },
      { id: "ai", label: "AI", status: "unknown" },
      { id: "research", label: "Research", status: "unknown" },
      { id: "notifications", label: "Notifications", status: "unknown" },
    ],
    overall: "unavailable",
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeSymbol(value: unknown): SupportedSymbol | null {
  const upper = String(value ?? "").toUpperCase();
  if ((SUPPORTED_SYMBOLS as readonly string[]).includes(upper)) return upper as SupportedSymbol;
  return null;
}

function normalizeTimeframe(value: unknown): "M1" | "M3" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1" | null {
  const upper = String(value ?? "").toUpperCase();
  if (["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"].includes(upper)) return upper as "M1" | "M3" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";
  return null;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
