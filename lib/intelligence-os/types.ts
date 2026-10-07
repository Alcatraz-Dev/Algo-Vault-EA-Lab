/**
 * AlgoVault Intelligence OS — Canonical Context
 *
 * Thin orchestration layer ABOVE existing engines.
 * This module NEVER computes market truth, risk decisions, research results,
 * or strategy signals. It AGGREGATES existing source-of-truth objects into one
 * canonical operating context the Command Center, mobile, PWA and admin surfaces
 * all consume.
 *
 * Architectural rule (Phase 12 §2, §4, §42):
 *   • One contextual aggregation layer, NOT a new trading/AI/research/automation engine.
 *   • Composed from existing sources; does not duplicate source-of-truth data.
 *   • RTDB only.
 *   • Missing / stale / unavailable data is reported as such, never synthesized.
 */

import type {
  SupportedSymbol,
  Timeframe,
  MarketSession,
  MarketRegime,
  MarketScore,
  MultiTimeframeBias,
  Zone,
} from "@/lib/market-data/types";
import type { SmartMoneyEvent } from "@/lib/market-intelligence/types";
import type { WorkspaceId } from "@/lib/terminal/types";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";
import type {
  ResearchMission,
  ResearchCandidate,
  ResearchEvent,
} from "@/lib/strategy-research/types";
import type { BacktestResult, Strategy } from "@/lib/strategy-lab/types";
import type { RiskLimits } from "@/lib/risk/risk-engine";
import type { DataFreshness, FreshnessDescriptor } from "@/lib/mobile/contracts";

// ─────────────────────────────────────────────────────────────────────────────
// §A. Priority model — deterministic, NO AI here (Phase 12 §6)
// ─────────────────────────────────────────────────────────────────────────────

export type IntelligencePriority =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFO";

/**
 * Deterministic priority reason codes. The OS uses these to explain WHY
 * something matters now — without inventing urgency.
 */
export const PRIORITY_REASONS: Record<IntelligencePriority, string> = {
  CRITICAL:
    "Risk, connection or data-freshness state requires immediate attention.",
  HIGH:
    "An active setup, strategy, research result or position event warrants review.",
  MEDIUM:
    "An alert, research milestone, journal reminder or review item is pending.",
  LOW:
    "Educational, discovery or non-critical product signal.",
  INFO:
    "Background context with no required action.",
};

// ─────────────────────────────────────────────────────────────────────────────
// §B. Action classification — safety gating (Phase 12 §15)
// ─────────────────────────────────────────────────────────────────────────────

export type ActionSafetyClass =
  | "READ_ONLY"
  | "LOW_RISK"
  | "USER_CONFIRMATION"
  | "HIGH_RISK"
  | "LIVE_TRADING";

export interface IntelligenceAction {
  id: string;
  label: string;
  /** Deterministic classification. AI may suggest the action; it may not mutate safety gating. */
  safety: ActionSafetyClass;
  /** Actual supported destination or intent. No fake commands. */
  target:
    | { kind: "route"; href: string; preserveContext?: boolean }
    | { kind: "intent"; intent: string; payload?: Record<string, unknown> }
    | { kind: "external"; url: string };
  /** Optional, real supporting data the target will receive. */
  context?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// §C. Canonical intelligence event — normalized over existing event sources
// (Phase 12 §7, §8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized intelligence event.
 *
 * Sources include existing Smart Money / indicator / session / setup / strategy /
 * research / risk / position / alert / journal / automation signals. The OS never
 * invents market events; every event is traceable to a real underlying record.
 */
export type IntelligenceEventType =
  | "MARKET_STRUCTURE_CHANGED"
  | "LIQUIDITY_EVENT"
  | "SETUP_DETECTED"
  | "SETUP_CONFIRMED"
  | "SETUP_INVALIDATED"
  | "STRATEGY_DEGRADED"
  | "STRATEGY_RECOVERED"
  | "RESEARCH_COMPLETED"
  | "RESEARCH_FAILED"
  | "POSITION_OPENED"
  | "POSITION_CHANGED"
  | "POSITION_CLOSED"
  | "RISK_WARNING"
  | "RISK_HALTED"
  | "ALERT_TRIGGERED"
  | "JOURNAL_UPDATED"
  | "BROKER_DISCONNECTED"
  | "DATA_STALE"
  | "INFO";

export interface IntelligenceEvent {
  id: string;
  /** Canonical event type from existing engines. */
  type: IntelligenceEventType;
  /** Priority derived deterministically from event type + source state. */
  priority: IntelligencePriority;
  /** Wall clock when the OS processed the event. */
  timestamp: number;
  /** When the underlying data actually changed, if known. */
  dataTimestamp?: number;
  source: string;
  title: string;
  summary: string;
  /** Evidence the existing engine produced (truncated for display). */
  evidence?: string[];
  reason: string;
  actions: IntelligenceAction[];
  /** Optional expiry so transient noise does not persist forever. */
  expiresAt?: number;
  status: "active" | "read" | "resolved" | "expired";
}

// ─────────────────────────────────────────────────────────────────────────────
// §D. System health — actual infrastructure state only (Phase 12 §28, §29)
// ─────────────────────────────────────────────────────────────────────────────

export type SystemComponentStatus =
  | "live"
  | "healthy"
  | "degraded"
  | "stale"
  | "disconnected"
  | "unavailable"
  | "unknown";

export interface SystemComponent {
  id: string;
  label: string;
  status: SystemComponentStatus;
  detail?: string;
  /** When the last known-good state was observed, if available. */
  asOf?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// §E. Canonical OS context object (Phase 12 §4, §5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IntelligenceOSContext — the canonical operating context.
 *
 * This is an AGGREGATION VIEW. It does not replace:
 *   - market-data providers / market-truth
 *   - the Risk Engine
 *   - Setup Memory
 *   - Strategy Lab / Strategy Engine
 *   - Strategy Research
 *   - the existing event bus
 *
 * Missing sections are explicit `null`/`unknown`, never fabricated.
 */
export interface IntelligenceOSContext {
  // ── user / product (Phase 12 §5 Product Context, User Context) ──────────
  user: {
    uid: string;
    email?: string | null;
    displayName?: string | null;
  };
  subscription: {
    hasSubscription: boolean;
    plan?: string | null;
  };
  workspace: {
    activeWorkspace: WorkspaceId;
    selectedSymbol: SupportedSymbol | null;
    selectedTimeframe: Timeframe;
    preferredMarkets: string[];
  };

  // ── market (Phase 12 §5 Market Context) ────────────────────────────────
  market: {
    /** Primary symbol the user is currently focused on. */
    symbol: SupportedSymbol | null;
    timeframe: Timeframe | null;
    session: MarketSession | null;
    regime: MarketRegime | null;
    regimeConfidence?: number | null;
    volatility: {
      atr: number | null;
      atrPercent: number | null;
      state: "low" | "normal" | "high" | "extreme" | null;
    } | null;
    structure:
      | { trend: "bullish" | "bearish" | "range" | "neutral" | "unknown"; lastEvent?: SmartMoneyEvent | null }
      | null;
    liquidity: {
      /**
       * Levels rebuilt from the market slice. `type` is the raw label stored
       * in RTDB, so it is modeled as a plain string rather than the canonical
       * `LiquidityLevel["type"]` union (the store does not guarantee it).
       */
      levels: Array<{
        id: string;
        type: string;
        price: number;
        strength: number;
        timeframe: Timeframe;
        timestamp: number;
      }>;
      /**
       * Sweeps exactly as stored on the market slice (`side`/`level`/
       * `timestamp`) — not the canonical `LiquiditySweep` shape, which the
       * RTDB record does not carry.
       */
      sweeps: MarketSlice["sweeps"];
    };
    zones: Zone[];
    score: MarketScore | null;
    multiTimeframe: MultiTimeframeBias[];
    /** Per-symbol market truth the OS is actually holding right now. */
    symbols: Record<string, MarketSlice | null>;
  };

  // ── setups (Phase 12 §5, §16 Setup Memory) ──────────────────────────────
  setups: {
    records: SetupMemoryRecord[];
    activeCount: number;
    confirmedCount: number;
  };

  // ── strategies (Phase 12 §5 Trading Context, §15 Strategy Health) ───────
  strategies: {
    items: StrategySummary[];
    degradedCount: number;
    recoveringCount: number;
  };

  // ── risk (Phase 12 §5 Trading Context, §15 Risk) ────────────────────────
  risk: {
    status: "normal" | "caution" | "restricted" | "halted" | "unavailable";
    limits: RiskLimits | null;
    account: {
      balance: number | null;
      equity: number | null;
      openPositions: number;
      exposure: Array<{ symbol: string; lots: number }>;
    };
    /** Deterministic fail-closed freshness for live execution gating. */
    executionFreshness: FreshnessDescriptor | null;
  };

  // ── positions / orders (Phase 12 §5 Trading Context) ────────────────────
  positions: {
    open: PositionSummary[];
    recentClosed: PositionSummary[];
  };

  // ── research (Phase 12 §5 Research Context) ─────────────────────────────
  research: {
    activeMissions: ResearchMission[];
    recentCandidates: ResearchCandidate[];
    recentEvents: ResearchEvent[];
  };

  // ── journal (Phase 12 §5 User Context) ──────────────────────────────────
  journal: {
    recentEntries: JournalEntry[];
    pendingReview: number;
  };

  // ── alerts / notifications (Phase 12 §5, §21) ───────────────────────────
  alerts: {
    recent: AlertSummary[];
    triggeredCount: number;
  };

  // ── AI context (Phase 12 §5, §20) ───────────────────────────────────────
  ai: {
    /** Existing AI context dossier slice, if available. */
    dossier: Record<string, unknown> | null;
    lastInsight?: string | null;
  };

  // ── automation / workflows (Phase 12 §5) ────────────────────────────────
  automation: {
    activeRuns: number;
    recentActivity: AutomationActivity[];
  };

  // ── product usage (Phase 12 §5 Product Context) ─────────────────────────
  productUsage: {
    recentActivity: RecentActivityItem[];
    onboardingSeen: boolean;
  };

  // ── system health (Phase 12 §28) ─────────────────────────────────────────
  system: {
    components: SystemComponent[];
    overall: "live" | "degraded" | "unavailable";
  };

  // ── what matters now (Phase 12 §7) ───────────────────────────────────────
  whatMattersNow: IntelligenceEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// §F. Lightweight aggregation shapes — built FROM existing records
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketSlice {
  symbol: SupportedSymbol;
  timeframe: Timeframe;
  freshness: FreshnessDescriptor;
  price: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  trend: "bullish" | "bearish" | "neutral" | null;
  structure: string | null;
  regime: MarketRegime | null;
  session: MarketSession | null;
  marketStatus:
    | "open"
    | "closed"
    | "pre_market"
    | "post_market"
    | "unknown"
    | null;
  volatility: {
    atr: number;
    atrPercent: number;
    state: "low" | "normal" | "high" | "extreme";
  } | null;
  fvgCount: number;
  activeFvg: number;
  orderBlockCount: number;
  sweeps: Array<{ side: string; level: number; timestamp: number }>;
  liquidityLevels: Array<{ price: number; type: string; strength: number }>;
  provider: string | null;
  dataTimestamp?: number;
}

export interface StrategySummary {
  id: string;
  name: string;
  version?: string | null;
  mode?: "backtest" | "paper" | "live" | "replay" | null;
  health:
    | "healthy"
    | "degraded"
    | "recovering"
    | "unknown"
    | "insufficient_data";
  recentPerformance: StrategyPerformance | null;
  lastActivityAt?: number;
  riskState: "normal" | "caution" | "restricted" | "halted" | "unknown";
}

export interface StrategyPerformance {
  netProfit: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPct: number | null;
  totalTrades: number | null;
  expectancy: number | null;
  oosExpectancy?: number | null;
  baselineExpectancy?: number | null;
}

export interface PositionSummary {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  currentPrice: number | null;
  unrealizedPnL: number | null;
  strategyId?: string | null;
  openedAt?: number;
}

export interface JournalEntry {
  id: string;
  symbol?: string | null;
  type?: string | null;
  summary?: string | null;
  createdAt: number;
}

export interface AlertSummary {
  id: string;
  symbol?: string | null;
  type?: string | null;
  message?: string | null;
  triggered: boolean;
  triggeredAt?: number;
  createdAt: number;
}

export interface AutomationActivity {
  id: string;
  label: string;
  status: "running" | "paused" | "idle" | "error" | "unknown";
  updatedAt?: number;
}

export interface RecentActivityItem {
  id: string;
  type: string;
  title: string;
  summary?: string | null;
  timestamp: number;
  source: string;
  href?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// §G. Aggregation contract — real implementations live in the platform layer
// (Step 5), this file is the canonical contract and deterministic helpers.
// ─────────────────────────────────────────────────────────────────────────────

export interface AggregationDeps {
  /** Existing auth+subscription slice the platform already resolves. */
  user: IntelligenceOSContext["user"];
  subscription: IntelligenceOSContext["subscription"];
  workspace: IntelligenceOSContext["workspace"];
  /** Market slice map keyed by `symbol:timeframe` — aggregated from market-truth / analytics. */
  marketSlices: Record<string, MarketSlice | null>;
  /** Setup Memory records — already fetched from `monitoring/setups/$uid`. */
  setupRecords: SetupMemoryRecord[];
  /** Strategy summaries — aggregated from existing strategy / health / backtest views. */
  strategies: StrategySummary[];
  /** Risk state — derived from canonical Risk Engine inputs, NOT invented. */
  risk: IntelligenceOSContext["risk"];
  /** Positions/orders — aggregated from existing position/order stores. */
  positions: IntelligenceOSContext["positions"];
  /** Research — aggregated from strategy-research storage. */
  research: IntelligenceOSContext["research"];
  /** Journal — aggregated from existing journal store. */
  journal: IntelligenceOSContext["journal"];
  /** Alerts — aggregated from existing alert store. */
  alerts: IntelligenceOSContext["alerts"];
  /** Existing AI dossier slice, if the caller has one. */
  aiDossier: Record<string, unknown> | null;
  /** Existing automation/workflow runs, if available. */
  automation: IntelligenceOSContext["automation"];
  /** Existing product-usage activity. */
  productUsage: IntelligenceOSContext["productUsage"];
  /** System health components — actual infra state. */
  system: IntelligenceOSContext["system"];
}

/**
 * Build the canonical OS context from existing source slices.
 *
 * Deterministic. No market truth computed here. No AI. No fake events.
 */
export function assembleContext(deps: AggregationDeps): IntelligenceOSContext {
  const whatMattersNow = prioritize({
    setups: deps.setupRecords,
    strategies: deps.strategies,
    risk: deps.risk,
    research: deps.research,
    alerts: deps.alerts,
    positions: deps.positions,
    system: deps.system,
    marketSlices: deps.marketSlices,
  });

  const setups = aggregateSetups(deps.setupRecords);
  const strategies = aggregateStrategies(deps.strategies);
  const research = aggregateResearch(deps.research);
  const journal = aggregateJournal(deps.journal);
  const alerts = aggregateAlerts(deps.alerts);
  const positions = aggregatePositions(deps.positions);
  const automation = aggregateAutomation(deps.automation);
  const productUsage = aggregateProductUsage(deps.productUsage);

  return {
    user: deps.user,
    subscription: deps.subscription,
    workspace: deps.workspace,
    market: aggregateMarket(deps.marketSlices, deps.workspace.selectedSymbol, deps.workspace.selectedTimeframe),
    setups,
    strategies,
    risk: deps.risk,
    positions,
    research,
    journal,
    alerts,
    ai: { dossier: deps.aiDossier, lastInsight: null },
    automation,
    productUsage,
    system: deps.system,
    whatMattersNow,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §H. Deterministic prioritization — "What Matters Now" (Phase 12 §6–§7)
// ─────────────────────────────────────────────────────────────────────────────

export interface PrioritizationInput {
  setups: SetupMemoryRecord[];
  strategies: StrategySummary[];
  risk: IntelligenceOSContext["risk"];
  research: IntelligenceOSContext["research"];
  alerts: IntelligenceOSContext["alerts"];
  positions: IntelligenceOSContext["positions"];
  system: IntelligenceOSContext["system"];
  marketSlices: Record<string, MarketSlice | null>;
}

export function prioritize(input: PrioritizationInput): IntelligenceEvent[] {
  const items: IntelligenceEvent[] = [];

  addIf(items, systemEvents(input.system));
  addIf(items, riskEvents(input.risk));
  addIf(items, positionEvents(input.positions));
  addIf(items, dataFreshnessEvents(input.marketSlices, input.risk));
  addIf(items, setupEvents(input.setups));
  addIf(items, strategyEvents(input.strategies));
  addIf(items, researchEvents(input.research));
  addIf(items, alertEvents(input.alerts));

  // Deterministic ordering: CRITICAL → HIGH → MEDIUM → LOW → INFO,
  // then newest dataTimestamp first, then newest timestamp.
  items.sort((a, b) => {
    const p = priorityRank(a.priority) - priorityRank(b.priority);
    if (p !== 0) return p;
    const da = a.dataTimestamp ?? a.timestamp;
    const db = b.dataTimestamp ?? b.timestamp;
    if (db !== da) return db - da;
    return b.timestamp - a.timestamp;
  });

  return items.slice(0, 50);
}

export function priorityRank(p: IntelligencePriority): number {
  return p === "CRITICAL"
    ? 0
    : p === "HIGH"
      ? 1
      : p === "MEDIUM"
        ? 2
        : p === "LOW"
          ? 3
          : 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// §I. Deterministic event builders — each maps to real underlying state
// ─────────────────────────────────────────────────────────────────────────────

function addIf(list: IntelligenceEvent[], events: IntelligenceEvent[]): void {
  for (const e of events) list.push(e);
}

function now(): number {
  return Date.now();
}

function systemEvents(system: IntelligenceOSContext["system"]): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  if (system.overall === "unavailable") {
    events.push({
      id: `sys:unavailable:${now()}`,
      type: "DATA_STALE",
      priority: "CRITICAL",
      timestamp: now(),
      source: "system",
      title: "Trading intelligence partially unavailable",
      summary: "One or more critical system components are degraded or offline.",
      evidence: system.components.filter((c) => c.status === "unavailable" || c.status === "disconnected").map((c) => `${c.label}: ${c.status}`),
      reason: "Deterministic system-health aggregate reports unavailable components.",
      actions: [
        {
          id: "open-system-health",
          label: "Open system status",
          safety: "READ_ONLY",
          target: { kind: "route", href: "/admin/intelligence" },
        },
      ],
      status: "active",
    });
  } else if (system.overall === "degraded") {
    const degraded = system.components.filter((c) => c.status === "stale" || c.status === "disconnected" || c.status === "degraded");
    if (degraded.length > 0) {
      events.push({
        id: `sys:degraded:${now()}`,
        type: "DATA_STALE",
        priority: "HIGH",
        timestamp: now(),
        source: "system",
        title: "System components degraded",
        summary: `${degraded.length} component(s) are stale, disconnected or degraded.`,
        evidence: degraded.map((c) => `${c.label}: ${c.status}`),
        reason: "System health components are not all healthy.",
        actions: [
          {
            id: "open-system-health",
            label: "View system status",
            safety: "READ_ONLY",
            target: { kind: "route", href: "/admin/intelligence" },
          },
        ],
        status: "active",
      });
    }
  }
  return events;
}

function riskEvents(risk: IntelligenceOSContext["risk"]): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  if (risk.status === "unavailable") {
    events.push({
      id: `risk:unavailable:${now()}`,
      type: "RISK_HALTED",
      priority: "CRITICAL",
      timestamp: now(),
      source: "risk",
      title: "Risk state unavailable",
      summary: "Risk status cannot be determined from available account data.",
      reason: "Canonical risk derivation returned unavailable.",
      actions: [
        { id: "open-risk-center", label: "Open Risk Center", safety: "READ_ONLY", target: { kind: "route", href: "/risk" } },
      ],
      status: "active",
    });
  } else if (risk.status === "halted") {
    events.push({
      id: `risk:halted:${now()}`,
      type: "RISK_HALTED",
      priority: "CRITICAL",
      timestamp: now(),
      source: "risk",
      title: "Risk halted",
      summary: "New trading is restricted by risk policy or emergency stop.",
      reason: "Canonical risk status is halted.",
      actions: [
        { id: "open-risk-center", label: "Open Risk Center", safety: "READ_ONLY", target: { kind: "route", href: "/risk" } },
        { id: "review-positions", label: "Review positions", safety: "READ_ONLY", target: { kind: "route", href: "/positions" } },
      ],
      status: "active",
    });
  } else if (risk.status === "restricted") {
    events.push({
      id: `risk:restricted:${now()}`,
      type: "RISK_WARNING",
      priority: "HIGH",
      timestamp: now(),
      source: "risk",
      title: "Risk restricted",
      summary: "Account is approaching or at a risk limit.",
      reason: "Canonical risk status is restricted.",
      actions: [
        { id: "open-risk-center", label: "Open Risk Center", safety: "READ_ONLY", target: { kind: "route", href: "/risk" } },
      ],
      status: "active",
    });
  } else if (risk.status === "caution") {
    events.push({
      id: `risk:caution:${now()}`,
      type: "RISK_WARNING",
      priority: "MEDIUM",
      timestamp: now(),
      source: "risk",
      title: "Risk caution",
      summary: "Account is in a caution state.",
      reason: "Canonical risk status is caution.",
      actions: [
        { id: "open-risk-center", label: "Open Risk Center", safety: "READ_ONLY", target: { kind: "route", href: "/risk" } },
      ],
      status: "active",
    });
  }
  return events;
}

function positionEvents(positions: IntelligenceOSContext["positions"]): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  const open = positions.open;
  if (open.length === 0) return events;
  const biggest = open.reduce((acc, p) => (Math.abs(p.unrealizedPnL ?? 0) > Math.abs(acc.unrealizedPnL ?? 0) ? p : acc), open[0]);
  if (biggest && biggest.unrealizedPnL !== null && Math.abs(biggest.unrealizedPnL) > 0) {
    const sign = biggest.unrealizedPnL >= 0 ? "unrealized gain" : "unrealized loss";
    events.push({
      id: `pos:latest:${biggest.id}:${now()}`,
      type: "POSITION_CHANGED",
      priority: "MEDIUM",
      timestamp: now(),
      source: "positions",
      title: `${biggest.symbol} position changing`,
      summary: `${sign} on open ${biggest.side} ${biggest.symbol}.`,
      evidence: [`unrealized PnL ${biggest.unrealizedPnL}`],
      reason: "Open position has nonzero unrealized PnL.",
      actions: [
        { id: "open-positions", label: "Open positions", safety: "READ_ONLY", target: { kind: "route", href: "/positions" } },
      ],
      status: "active",
    });
  }
  return events;
}

function dataFreshnessEvents(
  marketSlices: Record<string, MarketSlice | null>,
  risk: IntelligenceOSContext["risk"]
): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  const stale = Object.values(marketSlices).filter(
    (m): m is MarketSlice => m !== null && m.freshness.freshness !== "live"
  );
  if (risk.status !== "unavailable" && risk.executionFreshness && risk.executionFreshness.freshness !== "live") {
    events.push({
      id: `fresh:exec:${now()}`,
      type: "DATA_STALE",
      priority: risk.status === "halted" ? "CRITICAL" : "HIGH",
      timestamp: now(),
      source: "system",
      title: "Market data stale for live execution",
      summary: "Live execution is gated because market data freshness is not live.",
      evidence: [`data age ${Math.max(0, now() - risk.executionFreshness.dataTimestamp)}ms`],
      reason: "Fail-closed freshness gate active.",
      actions: [
        { id: "open-market", label: "Open market view", safety: "READ_ONLY", target: { kind: "route", href: "/market-intelligence" } },
      ],
      status: "active",
    });
  } else if (stale.length > 0) {
    const bySymbol = new Map<string, MarketSlice>();
    for (const m of stale) bySymbol.set(m.symbol, m);
    for (const [, m] of bySymbol) {
      events.push({
        id: `fresh:${m.symbol}:${m.timeframe}:${now()}`,
        type: "DATA_STALE",
        priority: "MEDIUM",
        timestamp: now(),
        source: "market",
        title: `${m.symbol} ${m.timeframe} data stale`,
        summary: `Market data for ${m.symbol} is ${m.freshness.freshness}.`,
        evidence: [`provider ${m.provider}`, `data age ${Math.max(0, now() - m.freshness.dataTimestamp)}ms`],
        reason: "Canonical freshness is not live.",
        actions: [
          {
            id: "open-chart",
            label: "Open chart",
            safety: "READ_ONLY",
            target: { kind: "route", href: `/terminal/${m.symbol}?tf=${m.timeframe}` },
          },
        ],
        status: "active",
      });
    }
  } else {
    events.push({
      id: `fresh:ok:${now()}`,
      type: "INFO",
      priority: "INFO",
      timestamp: now(),
      source: "system",
      title: "Market data live",
      summary: "Market data freshness is currently live for watched symbols.",
      reason: "No stale slices reported.",
      actions: [],
      status: "active",
      expiresAt: now() + 60_000,
    });
  }
  return events;
}

function setupEvents(setups: SetupMemoryRecord[]): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  const confirmed = setups.filter((s) => s.status === "ACTIVE" || s.status === "TRIGGERED");
  const invalidated = setups.filter((s) => s.status === "INVALIDATED");
  const waiting = setups.filter((s) => s.status === "PARTIALLY_MATCHED" || s.status === "WAITING");

  for (const s of invalidated.slice(0, 1)) {
    events.push({
      id: `setup:inv:${s.id}:${now()}`,
      type: "SETUP_INVALIDATED",
      priority: "HIGH",
      timestamp: now(),
      dataTimestamp: s.updatedAt,
      source: "setup",
      title: `${s.symbol ?? "Setup"} invalidated`,
      summary: `Setup ${s.id} is invalidated.`,
      reason: "Setup Memory status is invalidated.",
      actions: [
        { id: "open-setup", label: "Open setup", safety: "READ_ONLY", target: { kind: "route", href: `/setup/${s.id}` } },
        { id: "journal-setup", label: "Journal", safety: "LOW_RISK", target: { kind: "intent", intent: "createJournalEntry", payload: { setupId: s.id } } },
      ],
      status: "active",
    });
  }

  for (const s of confirmed.slice(0, 2)) {
    events.push({
      id: `setup:conf:${s.id}:${now()}`,
      type: "SETUP_CONFIRMED",
      priority: "HIGH",
      timestamp: now(),
      dataTimestamp: s.updatedAt,
      source: "setup",
      title: `${s.symbol ?? "Setup"} confirmed`,
      summary: `Setup ${s.id} is ${s.status.toLowerCase()}.`,
      evidence: [`matched ${s.matchedCount}/${s.totalCount} conditions`],
      reason: "Setup Memory status is active or triggered.",
      actions: [
        { id: "open-setup", label: "Open setup", safety: "READ_ONLY", target: { kind: "route", href: `/setup/${s.id}` } },
        { id: "open-chart", label: "Open chart", safety: "READ_ONLY", target: { kind: "route", href: `/terminal/${s.symbol ?? "XAUUSD"}?tf=${s.timeframe ?? "M5"}` } },
        { id: "journal-setup", label: "Journal", safety: "LOW_RISK", target: { kind: "intent", intent: "createJournalEntry", payload: { setupId: s.id } } },
      ],
      status: "active",
    });
  }

  if (waiting.length > 0) {
    events.push({
      id: `setup:watch:${now()}`,
      type: "SETUP_DETECTED",
      priority: "MEDIUM",
      timestamp: now(),
      source: "setup",
      title: `${waiting.length} setup(s) awaiting confirmation`,
      summary: `${waiting.length} setup(s) are waiting or partially matched.`,
      reason: "Active setups are not yet confirmed.",
      actions: [
        { id: "open-setups", label: "Open setups", safety: "READ_ONLY", target: { kind: "route", href: "/setup" } },
      ],
      status: "active",
    });
  }

  return events;
}

function strategyEvents(strategies: StrategySummary[]): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  const degraded = strategies.filter((s) => s.health === "degraded");
  const recovering = strategies.filter((s) => s.health === "recovering");

  for (const s of degraded.slice(0, 2)) {
    events.push({
      id: `strat:degraded:${s.id}:${now()}`,
      type: "STRATEGY_DEGRADED",
      priority: "HIGH",
      timestamp: now(),
      dataTimestamp: s.lastActivityAt,
      source: "strategy",
      title: `${s.name} performance degraded`,
      summary: `${s.name} is showing degraded health.`,
      evidence: ["health degraded"],
      reason: "Canonical strategy summary health is degraded.",
      actions: [
        { id: "open-strategy-health", label: "Open strategy health", safety: "READ_ONLY", target: { kind: "route", href: `/strategy/${s.id}/health` } },
        { id: "inspect-trades", label: "Inspect recent trades", safety: "READ_ONLY", target: { kind: "route", href: `/strategy/${s.id}/trades` } },
        { id: "pause-strategy", label: "Pause strategy", safety: "HIGH_RISK", target: { kind: "intent", intent: "pauseStrategy", payload: { strategyId: s.id } } },
      ],
      status: "active",
    });
  }

  for (const s of recovering.slice(0, 1)) {
    events.push({
      id: `strat:recovering:${s.id}:${now()}`,
      type: "STRATEGY_RECOVERED",
      priority: "MEDIUM",
      timestamp: now(),
      dataTimestamp: s.lastActivityAt,
      source: "strategy",
      title: `${s.name} recovering`,
      summary: `${s.name} health is recovering.`,
      reason: "Canonical strategy summary health is recovering.",
      actions: [
        { id: "open-strategy-health", label: "Open strategy health", safety: "READ_ONLY", target: { kind: "route", href: `/strategy/${s.id}/health` } },
      ],
      status: "active",
    });
  }

  return events;
}

function researchEvents(research: IntelligenceOSContext["research"]): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  const completed = research.activeMissions.filter((m) => m.status === "completed");
  const failed = research.activeMissions.filter((m) => m.status === "failed");

  for (const m of completed.slice(0, 2)) {
    events.push({
      id: `research:completed:${m.id}:${now()}`,
      type: "RESEARCH_COMPLETED",
      priority: "HIGH",
      timestamp: now(),
      dataTimestamp: m.completedAt,
      source: "research",
      title: `Research ${m.name} completed`,
      summary: `${m.survivorCount} survivor(s), ${m.rejectedCount} rejected.`,
      evidence: ["research mission completed"],
      reason: "Research mission status is completed.",
      actions: [
        { id: "open-research", label: "Open research", safety: "READ_ONLY", target: { kind: "route", href: `/strategy-research/${m.id}` } },
        { id: "backtest-candidate", label: "Backtest candidate", safety: "USER_CONFIRMATION", target: { kind: "intent", intent: "backtestCandidate", payload: { missionId: m.id } } },
      ],
      status: "active",
    });
  }

  for (const m of failed.slice(0, 1)) {
    events.push({
      id: `research:failed:${m.id}:${now()}`,
      type: "RESEARCH_FAILED",
      priority: "MEDIUM",
      timestamp: now(),
      dataTimestamp: m.updatedAt,
      source: "research",
      title: `Research ${m.name} failed`,
      summary: `Research failed: ${m.failState ?? "unknown"}.`,
      evidence: [m.failState ? `failState: ${m.failState}` : "no fail state"],
      reason: "Research mission status is failed.",
      actions: [
        { id: "open-research", label: "Open research", safety: "READ_ONLY", target: { kind: "route", href: `/strategy-research/${m.id}` } },
      ],
      status: "active",
    });
  }

  const running = research.activeMissions.filter((m) => m.status === "running");
  if (running.length > 0) {
    events.push({
      id: `research:running:${now()}`,
      type: "INFO",
      priority: "LOW",
      timestamp: now(),
      source: "research",
      title: `${running.length} research mission(s) running`,
      summary: "Active research is in progress.",
      reason: "Research missions are running.",
      actions: [
        { id: "open-research", label: "Open research", safety: "READ_ONLY", target: { kind: "route", href: "/strategy-research" } },
      ],
      status: "active",
    });
  }

  return events;
}

function alertEvents(alerts: IntelligenceOSContext["alerts"]): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  const triggered = alerts.recent.filter((a) => a.triggered);
  if (triggered.length === 0) return events;
  for (const a of triggered.slice(0, 3)) {
    events.push({
      id: `alert:${a.id}:${now()}`,
      type: "ALERT_TRIGGERED",
      priority: a.type === "risk" ? "HIGH" : "MEDIUM",
      timestamp: now(),
      dataTimestamp: a.triggeredAt,
      source: "alert",
      title: `Alert ${a.id}`,
      summary: a.message ?? "Alert triggered.",
      evidence: [a.type ?? "alert"],
      reason: "Alert store reports triggered alert.",
      actions: [
        { id: "open-alert", label: "Open alert", safety: "READ_ONLY", target: { kind: "route", href: `/alert/${a.id}` } },
        { id: "create-journal-from-alert", label: "Journal", safety: "LOW_RISK", target: { kind: "intent", intent: "createJournalEntry", payload: { alertId: a.id } } },
      ],
      status: "active",
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// §J. Aggregation helpers
// ─────────────────────────────────────────────────────────────────────────────

function aggregateMarket(
  slices: Record<string, MarketSlice | null>,
  selectedSymbol: SupportedSymbol | null,
  selectedTimeframe: Timeframe | null
): IntelligenceOSContext["market"] {
  const symbols: Record<string, MarketSlice | null> = {};
  for (const [k, v] of Object.entries(slices)) {
    symbols[k] = v;
  }
  const selectedSlice = selectedSymbol && selectedTimeframe ? slices[`${selectedSymbol}:${selectedTimeframe}`] ?? null : null;

  return {
    symbol: selectedSlice?.symbol ?? selectedSymbol,
    timeframe: selectedSlice?.timeframe ?? selectedTimeframe,
    session: selectedSlice?.session ?? null,
    regime: selectedSlice?.regime ?? null,
    regimeConfidence: null,
    volatility: selectedSlice?.volatility ?? null,
    structure:
      selectedSlice && selectedSlice.structure
        ? { trend: "unknown", lastEvent: null }
        : null,
    liquidity: {
      levels: selectedSlice?.liquidityLevels.map((l) => ({ id: "", type: l.type, price: l.price, strength: l.strength, timeframe: selectedTimeframe ?? "M5", timestamp: now() })) ?? [],
      sweeps: selectedSlice?.sweeps ?? [],
    },
    zones: [],
    score: null,
    multiTimeframe: [],
    symbols,
  };
}

function aggregateSetups(setups: SetupMemoryRecord[]): IntelligenceOSContext["setups"] {
  const activeCount = setups.filter((s) => s.status === "ACTIVE" || s.status === "TRIGGERED" || s.status === "PARTIALLY_MATCHED").length;
  const confirmedCount = setups.filter((s) => s.status === "ACTIVE" || s.status === "TRIGGERED").length;
  return {
    records: setups.slice(0, 25),
    activeCount,
    confirmedCount,
  };
}

function aggregateStrategies(strategies: StrategySummary[]): IntelligenceOSContext["strategies"] {
  return {
    items: strategies.slice(0, 25),
    degradedCount: strategies.filter((s) => s.health === "degraded").length,
    recoveringCount: strategies.filter((s) => s.health === "recovering").length,
  };
}

function aggregateResearch(research: IntelligenceOSContext["research"]): IntelligenceOSContext["research"] {
  return {
    activeMissions: research.activeMissions.slice(0, 10),
    recentCandidates: research.recentCandidates.slice(0, 10),
    recentEvents: research.recentEvents.slice(0, 20),
  };
}

function aggregateJournal(journal: IntelligenceOSContext["journal"]): IntelligenceOSContext["journal"] {
  return {
    recentEntries: journal.recentEntries.slice(0, 10),
    pendingReview: journal.pendingReview,
  };
}

function aggregateAlerts(alerts: IntelligenceOSContext["alerts"]): IntelligenceOSContext["alerts"] {
  return {
    recent: alerts.recent.slice(0, 25),
    triggeredCount: alerts.recent.filter((a) => a.triggered).length,
  };
}

function aggregatePositions(positions: IntelligenceOSContext["positions"]): IntelligenceOSContext["positions"] {
  return {
    open: positions.open.slice(0, 25),
    recentClosed: positions.recentClosed.slice(0, 10),
  };
}

function aggregateAutomation(automation: IntelligenceOSContext["automation"]): IntelligenceOSContext["automation"] {
  return {
    activeRuns: automation.activeRuns,
    recentActivity: automation.recentActivity.slice(0, 10),
  };
}

function aggregateProductUsage(productUsage: IntelligenceOSContext["productUsage"]): IntelligenceOSContext["productUsage"] {
  return {
    recentActivity: productUsage.recentActivity.slice(0, 10),
    onboardingSeen: productUsage.onboardingSeen,
  };
}
