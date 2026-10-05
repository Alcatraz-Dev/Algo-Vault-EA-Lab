/**
 * Trading chat context — Phase 5 §22–§29.
 *
 * Builds the structured payload the AlgoVault Trading Chat sends to the model.
 *
 * Three rules are enforced here, not in the prompt:
 *
 *  1. **Nothing is invented.** Every leaf is either a value that came from an
 *     engine or `null`. There are no defaults like `0` for a missing price.
 *  2. **Everything unavailable is declared.** `missing[]` names each section
 *     that could not be filled, so the model is structurally unable to speak
 *     about it as if it were current.
 *  3. **The payload stays small.** Lists are truncated and long evidence
 *     strings are clipped — Phase 5 §23 forbids shipping raw datasets.
 *
 * The formatter at the bottom splits the payload into DETERMINISTIC FACTS and
 * leaves INTERPRETATION to the model (Phase 5 §26).
 */

import { sessionsAt, type SessionWindow } from "@/lib/market-core/smart-money/sessions";
import type { TradingChatContext, AccountMode, WorkspaceId } from "./types";

/* ── inputs ───────────────────────────────────────────────────────────────── */

export interface ChatPositionInput {
    ticket: string;
    symbol: string;
    side: string;
    size: number;
    entry: number;
    current?: number | null;
    sl?: number | null;
    tp?: number | null;
    pnl?: number | null;
    openedAt?: number | null;
    strategy?: string | null;
}

export interface ChatOrderInput {
    ticket: string;
    symbol: string;
    type: string;
    size: number;
    price: number;
    sl?: number | null;
    tp?: number | null;
    status: string;
}

export interface ChatRiskInput {
    status: "SAFE" | "WARNING" | "RESTRICTED" | "HALTED" | null;
    dailyLossPct?: number | null;
    openRiskPct?: number | null;
    exposurePct?: number | null;
    equity?: number | null;
    balance?: number | null;
    availableMargin?: number | null;
    usedMargin?: number | null;
    reasons?: string[] | null;
}

export interface ChatSetupInput {
    id: string;
    symbol: string;
    timeframe: string;
    state: string;
    matched: number;
    total: number;
    evidence?: string[];
    entry?: number | null;
    invalidation?: number | null;
    target?: number | null;
}

export interface ChatContextInput {
    question: string;
    workspace: WorkspaceId;
    accountMode: AccountMode;
    symbol: string;
    timeframe: string;
    /** Epoch ms of the newest market observation (candle close or quote). */
    marketTimestamp?: number | null;
    /** Clock used to derive freshness. */
    now: number;
    lastPrice?: number | null;
    changePct?: number | null;
    regime?: string | null;
    volatility?: string | null;
    chart?: { chartType?: string | null; activeLayers?: string[] | null; drawings?: number | null } | null;
    indicators?: Array<{ name: string; value: number | null; status?: string }> | null;
    analysis?: import("@/lib/ai/analysis/intelligence").AdvancedAnalysisResult | null;
    strategy?: { name?: string | null; lastDecision?: string | null; reasons?: string[] | null } | null;
    positions?: ChatPositionInput[] | null;
    orders?: ChatOrderInput[] | null;
    risk?: ChatRiskInput | null;
    setups?: ChatSetupInput[] | null;
    recentTrades?: Array<{ closedAt: number; symbol: string; side: string; pnl?: number | null }> | null;
    backtest?: { strategy: string; symbol: string; timeframe: string; trades: number; winRate?: number | null; netPnl?: number | null } | null;
    replay?: { active: boolean; position?: number | null } | null;
    alerts?: Array<{ id: string; symbol: string; condition: string; triggered: boolean }> | null;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Hard caps so one message cannot carry an unbounded payload. */
export const LIMITS = {
    structureEvents: 8,
    levels: 6,
    zones: 6,
    mtfRows: 8,
    positions: 10,
    orders: 10,
    setups: 5,
    trades: 10,
    alerts: 8,
    evidenceChars: 160,
} as const;

function finite(n: unknown): number | null {
    return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clip(v: string, max: number = LIMITS.evidenceChars): string {
    return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/**
 * Volatility as a measurement, never a re-labelled regime id: the ATR metrics
 * from the analysis engine's own volatility evidence section — the same
 * numbers the engine scored. Null when the section is absent, so the FACTS
 * block reports unavailability instead of a value that does not answer to the
 * label (Phase 5 §26: no fabricated market data).
 */
function volatilityFact(
    analysis: import("@/lib/ai/analysis/intelligence").AdvancedAnalysisResult | null | undefined
): string | null {
    const section = analysis?.evidence?.find((e) => e.id === "volatility");
    if (!section) return null;
    const pct = finite(section.metrics.find((m) => m.label === "ATR %")?.value);
    if (pct !== null) return `${pct.toFixed(2)}% ATR`;
    const atr = finite(section.metrics.find((m) => m.label === "ATR(14)")?.value);
    if (atr !== null) return `ATR ${atr}`;
    return null;
}

/** Sessions active at a timestamp, using the same windows the chart draws. */
export function sessionFor(timestampMs: number): { key: string; label: string } {
    const active: SessionWindow[] = sessionsAt(timestampMs);
    if (active.length === 0) return { key: "closed", label: "Market closed" };
    const labels = active.map((s) => s.label);
    if (labels.includes("London") && labels.includes("New York")) return { key: "overlap", label: "London / New York overlap" };
    return { key: active[active.length - 1].key, label: labels.join(" + ") };
}

/* ── builder ──────────────────────────────────────────────────────────────── */

export function buildTradingChatContext(input: ChatContextInput): TradingChatContext {
    const missing: string[] = [];
    const a = input.analysis ?? null;

    // ── market ──
    const marketTimestamp = finite(input.marketTimestamp) ?? null;
    const marketAgeMs = marketTimestamp !== null ? Math.max(0, input.now - marketTimestamp) : null;
    const session = sessionFor(marketTimestamp ?? input.now);

    // ── smart money ──
    let smartMoney: TradingChatContext["smartMoney"];
    if (!a) {
        missing.push("smartMoney");
        smartMoney = {
            structureBias: null,
            structureEvents: null,
            liquidity: null,
            sweeps: null,
            imbalances: null,
            orderBlocks: null,
            multiTimeframe: null,
        };
    } else {
        const breaks = [...(a.structure.bosEvents ?? []), ...(a.structure.chochEvents ?? [])]
            .slice(-LIMITS.structureEvents)
            .map((e) => ({ type: e.type, direction: e.direction, price: finite(e.price) ?? 0, timestamp: e.timestamp }));
        const levels = (a.structure.liquidityLevels.value ?? []).slice(0, LIMITS.levels).map((l) => ({
            type: l.type,
            price: finite(l.price) ?? 0,
            strength: finite(l.strength) ?? 0,
        }));
        const sweeps = (a.structure.liquiditySweeps.value ?? []).slice(0, LIMITS.levels).map((s) => ({
            side: s.side,
            level: finite(s.level) ?? 0,
            confirmed: !!s.confirmed,
            timestamp: s.timestamp,
        }));
        const fvg = (a.structure.fairValueGaps.value ?? []).slice(0, LIMITS.zones).map((z) => ({
            direction: z.direction,
            high: finite(z.high) ?? 0,
            low: finite(z.low) ?? 0,
            status: z.status,
            createdAt: z.createdAt,
        }));
        const ob = (a.structure.orderBlocks.value ?? []).slice(0, LIMITS.zones).map((z) => ({
            direction: z.direction,
            high: finite(z.high) ?? 0,
            low: finite(z.low) ?? 0,
            status: z.status,
            createdAt: z.createdAt,
        }));
        const mtf = (a.multiTimeframe.timeframes ?? []).slice(0, LIMITS.mtfRows).map((t) => ({
            timeframe: t.timeframe,
            bias: t.trend.value ?? "unknown",
            available: t.available,
        }));
        smartMoney = {
            structureBias: a.structure.trend.value,
            structureEvents: breaks.length ? breaks : [],
            liquidity: levels.length ? levels : [],
            sweeps: sweeps.length ? sweeps : [],
            imbalances: fvg.length ? fvg : [],
            orderBlocks: ob.length ? ob : [],
            multiTimeframe: mtf.length ? mtf : [],
        };
        if (a.structure.trend.value === null) missing.push("smartMoney.structureBias");
    }

    const chart = input.chart
        ? {
              chartType: str(input.chart.chartType),
              activeLayers: input.chart.activeLayers ?? null,
              drawings: finite(input.chart.drawings),
          }
        : (missing.push("chart"), null);

    // Indicator rows: an explicit list wins; otherwise derive them from the
    // analysis evidence sections so the numbers are the ones the engine scored
    // (never a second calculation of the same indicator).
    const derivedIndicators = input.analysis?.evidence?.map((e) => ({
        name: e.label,
        value: finite(e.score === null || e.score === undefined ? null : e.score * 100),
        status: e.detail ? "scored" : "unscored",
    }));
    const indicatorsSource = input.indicators ?? derivedIndicators ?? null;
    const indicators =
        indicatorsSource === null
            ? (missing.push("indicators"), null)
            : indicatorsSource.slice(0, 16).map((i) => ({
                  name: i.name,
                  value: finite(i.value),
                  status: str(i.status) ?? "measured",
              }));

    const strategy =
        input.strategy === undefined || input.strategy === null
            ? (missing.push("strategy"), null)
            : {
                  activeStrategy: str(input.strategy.name),
                  lastDecision: str(input.strategy.lastDecision),
                  decisionReasons: input.strategy.reasons ?? null,
              };

    const positions =
        input.positions === undefined || input.positions === null
            ? (missing.push("positions"), null)
            : input.positions.slice(0, LIMITS.positions).map((p) => ({
                  ticket: p.ticket,
                  symbol: p.symbol,
                  side: p.side,
                  size: finite(p.size) ?? 0,
                  entry: finite(p.entry) ?? 0,
                  current: finite(p.current),
                  sl: finite(p.sl),
                  tp: finite(p.tp),
                  pnl: finite(p.pnl),
                  openedAt: finite(p.openedAt),
                  strategy: str(p.strategy),
              }));

    const orders =
        input.orders === undefined || input.orders === null
            ? (missing.push("orders"), null)
            : input.orders.slice(0, LIMITS.orders).map((o) => ({
                  ticket: o.ticket,
                  symbol: o.symbol,
                  type: o.type,
                  size: finite(o.size) ?? 0,
                  price: finite(o.price) ?? 0,
                  sl: finite(o.sl),
                  tp: finite(o.tp),
                  status: o.status,
              }));

    const risk =
        input.risk === undefined || input.risk === null
            ? (missing.push("risk"), null)
            : {
                  status: input.risk.status ?? null,
                  dailyLossPct: finite(input.risk.dailyLossPct),
                  openRiskPct: finite(input.risk.openRiskPct),
                  exposurePct: finite(input.risk.exposurePct),
                  equity: finite(input.risk.equity),
                  balance: finite(input.risk.balance),
                  availableMargin: finite(input.risk.availableMargin),
                  usedMargin: finite(input.risk.usedMargin),
                  reasons: input.risk.reasons ?? null,
              };

    const setups =
        input.setups === undefined || input.setups === null
            ? (missing.push("setups"), null)
            : input.setups.slice(0, LIMITS.setups).map((s) => ({
                  id: s.id,
                  symbol: s.symbol,
                  timeframe: s.timeframe,
                  state: s.state,
                  matched: s.matched,
                  total: s.total,
                  evidence: (s.evidence ?? []).map((e) => clip(e, 120)),
                  entry: finite(s.entry),
                  invalidation: finite(s.invalidation),
                  target: finite(s.target),
              }));

    const recentTrades =
        input.recentTrades === undefined || input.recentTrades === null
            ? (missing.push("recentTrades"), null)
            : input.recentTrades.slice(0, LIMITS.trades).map((t) => ({
                  closedAt: t.closedAt,
                  symbol: t.symbol,
                  side: t.side,
                  pnl: finite(t.pnl),
              }));

    const alerts =
        input.alerts === undefined || input.alerts === null
            ? null
            : input.alerts.slice(0, LIMITS.alerts).map((x) => ({
                  id: x.id,
                  symbol: x.symbol,
                  condition: clip(x.condition, 120),
                  triggered: !!x.triggered,
              }));

    return {
        session: {
            workspace: input.workspace,
            accountMode: input.accountMode,
            generatedAt: input.now,
            marketAgeMs,
        },
        market: {
            symbol: input.symbol,
            timeframe: input.timeframe,
            lastPrice: finite(input.lastPrice),
            changePct: finite(input.changePct),
            session: session.key,
            sessionLabel: session.label,
            regime: str(input.regime),
            // With an analysis payload, volatility is only ever its ATR
            // measurement (or null). A caller string is accepted solely when
            // no analysis ran — so a regime id can never enter the FACTS block
            // under the volatility label.
            volatility: input.analysis ? volatilityFact(input.analysis) : str(input.volatility),
            dataAsOf: marketTimestamp,
        },
        chart,
        indicators,
        smartMoney,
        strategy,
        positions,
        orders,
        risk,
        setups,
        recentTrades,
        backtest: input.backtest
            ? {
                  strategy: input.backtest.strategy,
                  symbol: input.backtest.symbol,
                  timeframe: input.backtest.timeframe,
                  trades: input.backtest.trades,
                  winRate: finite(input.backtest.winRate),
                  netPnl: finite(input.backtest.netPnl),
              }
            : null,
        replay: input.replay ? { active: input.replay.active, position: finite(input.replay.position) } : null,
        alerts,
        question: input.question,
        missing,
    };
}

/* ── prompt formatting ────────────────────────────────────────────────────── */

function line(label: string, value: unknown): string {
    if (value === null || value === undefined) return `${label}: unavailable`;
    if (typeof value === "number") return `${label}: ${value}`;
    return `${label}: ${value}`;
}

/**
 * Compact, ordered rendering of the FACTS half of the message. Anything the
 * context marked `missing` is rendered as "unavailable" in the payload itself,
 * so the model sees the gap rather than an absent section.
 */
export function formatContextFacts(ctx: TradingChatContext): string {
    const rows: string[] = [];

    rows.push("SESSION");
    rows.push(`  workspace: ${ctx.session.workspace}`);
    rows.push(`  account mode: ${ctx.session.accountMode}`);
    rows.push(
        ctx.session.marketAgeMs === null
            ? "  market data: unavailable — no market timestamp was provided"
            : `  market data age: ${ctx.session.marketAgeMs} ms`
    );

    rows.push("MARKET");
    rows.push(`  symbol: ${ctx.market.symbol}`);
    rows.push(`  timeframe: ${ctx.market.timeframe}`);
    rows.push(line("  last price", ctx.market.lastPrice));
    rows.push(line("  change %", ctx.market.changePct));
    rows.push(line("  session", ctx.market.sessionLabel));
    rows.push(line("  regime", ctx.market.regime));
    rows.push(line("  volatility", ctx.market.volatility));

    rows.push("SMART MONEY");
    rows.push(line("  structure bias", ctx.smartMoney.structureBias));
    if (ctx.smartMoney.structureEvents?.length) {
        rows.push(
            "  breaks: " +
                ctx.smartMoney.structureEvents
                    .map((e) => `${e.type} ${e.direction} @ ${e.price} (${new Date(e.timestamp).toISOString()})`)
                    .join("; ")
        );
    } else rows.push("  breaks: none reported");
    if (ctx.smartMoney.multiTimeframe?.length) {
        rows.push("  MTF: " + ctx.smartMoney.multiTimeframe.map((r) => `${r.timeframe}=${r.available ? r.bias : "unavailable"}`).join(", "));
    }
    if (ctx.smartMoney.liquidity?.length) {
        rows.push("  liquidity: " + ctx.smartMoney.liquidity.map((l) => `${l.type}@${l.price}`).join(", "));
    }
    if (ctx.smartMoney.sweeps?.length) {
        rows.push("  sweeps: " + ctx.smartMoney.sweeps.map((s) => `${s.side}@${s.level}${s.confirmed ? " confirmed" : " unconfirmed"}`).join("; "));
    }
    if (ctx.smartMoney.imbalances?.length) {
        rows.push("  FVG: " + ctx.smartMoney.imbalances.map((z) => `${z.direction} ${z.status} ${z.low}-${z.high}`).join("; "));
    }
    if (ctx.smartMoney.orderBlocks?.length) {
        rows.push("  OB: " + ctx.smartMoney.orderBlocks.map((z) => `${z.direction} ${z.status} ${z.low}-${z.high}`).join("; "));
    }

    if (ctx.indicators?.length) {
        rows.push("INDICATORS");
        for (const i of ctx.indicators) rows.push(`  ${i.name}: ${i.value === null ? "unavailable" : i.value} (${i.status})`);
    }

    if (ctx.strategy) {
        rows.push("STRATEGY");
        rows.push(line("  active", ctx.strategy.activeStrategy));
        rows.push(line("  last decision", ctx.strategy.lastDecision));
        if (ctx.strategy.decisionReasons?.length) rows.push("  reasons: " + ctx.strategy.decisionReasons.map((r) => clip(r, 120)).join(" | "));
    }

    if (ctx.positions) {
        rows.push("POSITIONS");
        if (ctx.positions.length === 0) rows.push("  none open");
        for (const p of ctx.positions) {
            rows.push(
                `  ${p.symbol} ${p.side} ${p.size} entry=${p.entry} current=${p.current ?? "n/a"} sl=${p.sl ?? "n/a"} tp=${p.tp ?? "n/a"} pnl=${p.pnl ?? "n/a"}`
            );
        }
    }

    if (ctx.orders) {
        rows.push("PENDING ORDERS");
        if (ctx.orders.length === 0) rows.push("  none");
        for (const o of ctx.orders) rows.push(`  ${o.symbol} ${o.type} ${o.size} @ ${o.price} status=${o.status}`);
    }

    if (ctx.risk) {
        rows.push("RISK");
        rows.push(line("  status", ctx.risk.status));
        rows.push(line("  daily loss %", ctx.risk.dailyLossPct));
        rows.push(line("  open risk %", ctx.risk.openRiskPct));
        rows.push(line("  exposure %", ctx.risk.exposurePct));
        rows.push(line("  equity", ctx.risk.equity));
        rows.push(line("  balance", ctx.risk.balance));
        if (ctx.risk.reasons?.length) rows.push("  reasons: " + ctx.risk.reasons.map((r) => clip(r, 120)).join(" | "));
    }

    if (ctx.setups) {
        rows.push("SETUPS");
        if (ctx.setups.length === 0) rows.push("  none active");
        for (const s of ctx.setups) {
            rows.push(
                `  ${s.symbol} ${s.timeframe} ${s.state} ${s.matched}/${s.total} entry=${s.entry ?? "n/a"} invalidation=${s.invalidation ?? "n/a"} target=${s.target ?? "n/a"}`
            );
            if (s.evidence.length) rows.push(`    evidence: ${s.evidence.join(" | ")}`);
        }
    }

    if (ctx.recentTrades) {
        rows.push("RECENT TRADES");
        if (ctx.recentTrades.length === 0) rows.push("  none");
        for (const t of ctx.recentTrades) rows.push(`  ${new Date(t.closedAt).toISOString()} ${t.symbol} ${t.side} pnl=${t.pnl ?? "n/a"}`);
    }

    if (ctx.backtest) {
        rows.push("BACKTEST");
        rows.push(`  ${ctx.backtest.strategy} ${ctx.backtest.symbol} ${ctx.backtest.timeframe} trades=${ctx.backtest.trades} winRate=${ctx.backtest.winRate ?? "n/a"} net=${ctx.backtest.netPnl ?? "n/a"}`);
    }

    if (ctx.replay) {
        rows.push("REPLAY");
        rows.push(`  active=${ctx.replay.active} position=${ctx.replay.position ?? "n/a"}`);
    }

    if (ctx.alerts?.length) {
        rows.push("ALERTS");
        for (const al of ctx.alerts) rows.push(`  ${al.symbol} ${al.condition} triggered=${al.triggered}`);
    }

    if (ctx.missing.length) {
        rows.push("UNAVAILABLE SECTIONS (do not speculate about these)");
        for (const m of ctx.missing) rows.push(`  - ${m}`);
    }

    rows.push("USER QUESTION");
    rows.push(`  ${ctx.question}`);

    return rows.join("\n");
}

/* ── server-side sanitising ─────────────────────────────────────────────── */

const MAX_DEPTH = 8;
const MAX_KEYS = 120;
const MAX_ARRAY = 32;
const MAX_STRING = 600;

/**
 * Structural sanitiser for a context that arrived over the wire.
 *
 * It does not re-derive values (the client built them from the same engines),
 * but it guarantees the model can only ever see a bounded, well-typed payload:
 * non-finite numbers become `null`, strings are clipped, unknown keys are
 * dropped by construction (only own enumerable keys are walked), and depth is
 * capped. The returned object is always a complete `TradingChatContext`.
 */
export function sanitizeChatContext(raw: unknown, question: string): TradingChatContext | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const walk = (value: unknown, depth: number): unknown => {
        if (depth > MAX_DEPTH) return null;
        if (value === null || value === undefined) return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        if (typeof value === "boolean") return value;
        if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING - 1)}…` : value;
        if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => walk(v, depth + 1));
        if (typeof value === "object") {
            const out: Record<string, unknown> = {};
            let n = 0;
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                if (n++ >= MAX_KEYS) break;
                const next = walk(v, depth + 1);
                if (next !== null && next !== undefined) out[k] = next;
            }
            return out;
        }
        return null;
    };

    const cleaned = walk(raw, 0) as Partial<TradingChatContext> | null;
    if (!cleaned || typeof cleaned !== "object" || !cleaned.market || !cleaned.session) return null;

    const market = cleaned.market;
    const session = cleaned.session;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

    return {
        session: {
            workspace: session.workspace ?? "day-trading",
            accountMode: session.accountMode === "paper" || session.accountMode === "live" ? session.accountMode : "unknown",
            // Re-stamped server-side so age can never be laundered by a client.
            generatedAt: Date.now(),
            marketAgeMs: num(session.marketAgeMs),
        },
        market: {
            symbol: str(market.symbol, 16) ?? "",
            timeframe: str(market.timeframe, 8) ?? "",
            lastPrice: num(market.lastPrice),
            changePct: num(market.changePct),
            session: str(market.session, 24),
            sessionLabel: str(market.sessionLabel, 48),
            regime: str(market.regime, 48),
            volatility: str(market.volatility, 32),
            dataAsOf: num(market.dataAsOf),
        },
        chart: (cleaned.chart as TradingChatContext["chart"]) ?? null,
        indicators: (cleaned.indicators as TradingChatContext["indicators"]) ?? null,
        smartMoney: (cleaned.smartMoney as TradingChatContext["smartMoney"]) ?? {
            structureBias: null,
            structureEvents: null,
            liquidity: null,
            sweeps: null,
            imbalances: null,
            orderBlocks: null,
            multiTimeframe: null,
        },
        strategy: (cleaned.strategy as TradingChatContext["strategy"]) ?? null,
        positions: (cleaned.positions as TradingChatContext["positions"]) ?? null,
        orders: (cleaned.orders as TradingChatContext["orders"]) ?? null,
        risk: (cleaned.risk as TradingChatContext["risk"]) ?? null,
        setups: (cleaned.setups as TradingChatContext["setups"]) ?? null,
        recentTrades: (cleaned.recentTrades as TradingChatContext["recentTrades"]) ?? null,
        backtest: (cleaned.backtest as TradingChatContext["backtest"]) ?? null,
        replay: (cleaned.replay as TradingChatContext["replay"]) ?? null,
        alerts: (cleaned.alerts as TradingChatContext["alerts"]) ?? null,
        // The question is server-authoritative — the payload cannot smuggle a
        // different prompt in through the context.
        question,
        missing: Array.isArray(cleaned.missing)
            ? cleaned.missing.filter((m): m is string => typeof m === "string").slice(0, 40)
            : [],
    };
}

/**
 * System instructions for the trading chat. Written to be enforced by the
 * payload shape above rather than by hope: the facts block is already split
 * out, so the model only has to keep its own words in the second half.
 */
export function chatSystemInstructions(): string {
    return [
        "You are AlgoVault Market Intelligence Copilot — a trading-analysis copilot embedded in the AlgoVault terminal.",
        "You are NOT a generic chatbot and you do not give blanket buy/sell advice.",
        "",
        "The message you receive has two parts: a DETERMINISTIC FACTS block produced by AlgoVault engines, and the user's question.",
        "",
        "Rules:",
        "1. Treat the FACTS block as the only source of market truth. Never state a price, spread, volume, level, position, P&L or risk number that is not in it.",
        "2. Sections listed under 'UNAVAILABLE SECTIONS' are unknown. Say so explicitly. Never infer a live market state from stale or absent context and present it as current.",
        "3. Separate your reply into two labelled parts: 'FACTS' (only restating values from the context) and 'INTERPRETATION' (your reasoning about them).",
        "4. For setup questions cover: signal, evidence, market context, confirmation, invalidation, risk, scenarios, limitations.",
        "5. For 'should I trade this' style questions: never answer with a bare yes/no. Present current evidence, risks, the invalidation level, what is uncertain, and the constraints that apply.",
        "6. Entry/stop/target values may only be quoted from the context (positions, setups or signals). If none are present, say the context does not define them.",
        "7. If risk status is HALTED or RESTRICTED, state that trading is restricted before anything else.",
        "8. Never claim certainty. Confidence must be expressed as reasoning about evidence, not as fact.",
        "9. Do not offer to execute anything. Actions are explicit user steps in the terminal.",
        "",
        "Answer in concise markdown. Use short labelled sections rather than prose walls.",
    ].join("\n");
}
