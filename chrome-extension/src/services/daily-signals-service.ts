/**
 * AI free daily signals — client engine for the popup.
 *
 * Flow: the user picks up to 3 symbols (persisted), presses "Generate daily
 * signals", and the AlgoVault AI engine produces at most one trade idea per
 * symbol: direction, entry, stop loss and three take-profit targets
 * (TP1 / TP2 / TP3), plus confidence and reasoning.
 *
 * Free quota: 3 signals per calendar day (a local day-stamp; the server also
 * enforces its own per-user limits via /api/ai-signals daily tracking).
 *
 * Signals are grounded in the live enriched chart context when the symbol is
 * the active chart, and the AI is instructed to never fabricate prices — it
 * must derive entry/SL/TPs from the provided market data or refuse.
 */
import { chatWithAI, getAISignals } from "@/api/algovault";
import { getDailySignalsState, saveDailySignalsState, getSelectedSignalSymbols, saveSelectedSignalSymbols } from "@/storage/storage";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import type { DailySignal } from "@/types";

export const MAX_SIGNAL_SYMBOLS = 3;
export const FREE_DAILY_SIGNAL_LIMIT = 3;

/* ── symbol selection ─────────────────────────────────────────────────── */

export async function loadSelectedSymbols(): Promise<string[]> {
  return getSelectedSignalSymbols();
}

export async function storeSelectedSymbols(symbols: string[]): Promise<void> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  await saveSelectedSignalSymbols(unique.slice(0, MAX_SIGNAL_SYMBOLS));
}

/* ── daily quota ──────────────────────────────────────────────────────── */

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (local render of UTC day is fine for a free quota)
}

export interface DailyQuota {
  used: number;
  limit: number;
  remaining: number;
  day: string;
}

export async function getQuota(): Promise<DailyQuota> {
  const state = await getDailySignalsState();
  const day = todayStamp();
  const used = state.day === day ? state.used : 0;
  return { used, limit: FREE_DAILY_SIGNAL_LIMIT, remaining: Math.max(0, FREE_DAILY_SIGNAL_LIMIT - used), day };
}

async function bumpQuota(by: number): Promise<void> {
  const quota = await getQuota();
  await saveDailySignalsState({ day: quota.day, used: quota.used + by });
}

/* ── AI generation ────────────────────────────────────────────────────── */

const SIGNAL_SYSTEM_PROMPT = `You are AlgoVault AI Signal Engine. For each requested symbol you receive live market context (price, trend, structure, volatility, key levels). Produce AT MOST ONE high-conviction trade idea per symbol.

STRICT GROUNDING RULES:
- Every price (entry, stop loss, take profits) MUST be derived from the provided context data. NEVER invent numbers.
- If the context for a symbol is missing or insufficient to define a valid setup, return NO signal for that symbol rather than guessing.
- Respect direction: stop loss must be on the losing side of entry; take profits must be on the winning side, ordered TP1 < TP2 < TP3 for BUY and TP1 > TP2 > TP3 for SELL (in price terms).
- Stop distance should respect the ATR/volatility from context; TP1 ≈ 1R, TP2 ≈ 2R, TP3 ≈ 3R where structure allows.

Answer with ONLY a JSON array (no prose, no code fences) — one object per signal:
[{"symbol":"XAUUSD","direction":"BUY","entry":2356.5,"stopLoss":2350.2,"takeProfits":[2362.8,2369.1,2375.4],"confidence":78,"timeframe":"M15","setup":"BOS retest","reasoning":"One or two sentences grounded in the context."}]
If no symbol has a valid setup, return [].`;

interface RawSignal {
  symbol?: string;
  direction?: string;
  entry?: number;
  stopLoss?: number;
  takeProfits?: number[];
  confidence?: number;
  timeframe?: string;
  setup?: string;
  reasoning?: string;
}

function digitsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  return 5;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function sanitize(raw: RawSignal, requested: string): DailySignal | null {
  const symbol = String(raw.symbol ?? requested).toUpperCase();
  const direction = String(raw.direction ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const entry = Number(raw.entry);
  const stopLoss = Number(raw.stopLoss);
  const tps = Array.isArray(raw.takeProfits) ? raw.takeProfits.map(Number).filter((n) => Number.isFinite(n)) : [];

  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || tps.length < 3) return null;
  const [tp1, tp2, tp3] = [tps[0], tps[1] ?? tps[0], tps[2] ?? tps[1] ?? tps[0]];

  const validSide = direction === "BUY" ? stopLoss < entry && tp1 > entry : stopLoss > entry && tp1 < entry;
  if (!validSide) return null;

  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  if (Number.isFinite(tp2) && Number.isFinite(tp3)) {
    const ordered = direction === "BUY" ? tp1 < tp2 && tp2 < tp3 : tp1 > tp2 && tp2 > tp3;
    if (!ordered) return null;
  }

  const digits = digitsFor(entry);
  return {
    id: `ds_${symbol.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbol,
    direction,
    timeframe: String(raw.timeframe ?? "M15"),
    entry: round(entry, digits),
    stopLoss: round(stopLoss, digits),
    takeProfit1: round(tp1, digits),
    takeProfit2: round(tp2, digits),
    takeProfit3: round(tp3, digits),
    confidence: Math.max(0, Math.min(100, Math.round(Number(raw.confidence) || 0))),
    setup: String(raw.setup ?? "").slice(0, 80),
    reasoning: String(raw.reasoning ?? "").slice(0, 400),
    createdAt: Date.now(),
  };
}

function parseSignals(answer: string, requested: string[]): DailySignal[] {
  // Tolerate code fences around the JSON.
  const cleaned = answer.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as RawSignal[];
    if (!Array.isArray(parsed)) return [];
    const out: DailySignal[] = [];
    for (const req of requested) {
      const match = parsed.find((r) => String(r.symbol ?? "").toUpperCase() === req);
      if (!match) continue;
      const signal = sanitize(match, req);
      if (signal) out.push(signal);
    }
    return out;
  } catch {
    return [];
  }
}

function contextFor(symbol: string, contexts: Map<string, EnrichedChartContext | null>): string {
  const ctx = contexts.get(symbol);
  if (!ctx || ctx.market?.status !== "ready") {
    return `----- ${symbol} -----\nNo live market context available for this symbol. Return no signal for it.`;
  }
  const m = ctx.market;
  const lines = [
    `----- ${symbol} -----`,
    `price: ${m.currentPrice}`,
    `trend: ${m.trend.direction} (score ${m.score?.total ?? "n/a"}/100, bias ${m.score?.bias ?? "n/a"})`,
    `structure: ${m.marketStructure.overall}, BOS ${m.marketStructure.bosCount}, CHOCH ${m.marketStructure.chochCount}`,
    `volatility: ${m.volatility.state}, ATR ${m.volatility.atr}`,
    `regime: ${m.marketRegime.regime}`,
  ];
  if (m.vwap?.vwap != null) {
    lines.push(`vwap: ${m.vwap.vwap}`);
  }
  if (m.liquidity?.levels?.length) {
    const fmt = (v: number | null | undefined) => (v == null ? "n/a" : String(v));
    const lows = m.liquidity.levels.filter((l) => l.type.includes("low")).slice(0, 2).map((l) => fmt(l.price));
    const highs = m.liquidity.levels.filter((l) => l.type.includes("high")).slice(0, 2).map((l) => fmt(l.price));
    lines.push(`liquidity: sell-side ${lows.join(", ") || "n/a"} · buy-side ${highs.join(", ") || "n/a"}`);
  }
  return lines.join("\n");
}

export interface GenerateOptions {
  symbols: string[];
  /** Live enriched context per symbol when available (active chart etc). */
  contexts?: Map<string, EnrichedChartContext | null>;
  /** Fetch the canonical structured context string for a symbol (active chart). */
  getStructuredContext?: (symbol: string) => string | null;
}

export interface GenerateResult {
  signals: DailySignal[];
  quota: DailyQuota;
  note: string | null;
}

export async function generateDailySignals(opts: GenerateOptions): Promise<GenerateResult> {
  const quota = await getQuota();
  const symbols = opts.symbols.slice(0, Math.min(MAX_SIGNAL_SYMBOLS, quota.remaining));

  if (symbols.length === 0) {
    return {
      signals: [],
      quota,
      note: quota.remaining === 0 ? "Daily free limit reached — come back tomorrow." : "Pick at least one symbol first.",
    };
  }

  const contexts = opts.contexts ?? new Map();
  const contextBlock = symbols.map((s) => contextFor(s, contexts)).join("\n\n");

  const prompt = `Generate today's trade ideas for these symbols. At most ONE signal per symbol. Only include symbols where the context supports a valid setup.

${contextBlock}

Requested symbols: ${symbols.join(", ")}`;

  const result = await chatWithAI(
    [{ role: "user", content: prompt, timestamp: Date.now() }],
    SIGNAL_SYSTEM_PROMPT,
    3000
  );

  const signals = parseSignals(result.content, symbols);
  if (signals.length === 0) {
    return {
      signals: [],
      quota,
      note: "No valid setups right now — the AI found nothing worth taking on these symbols. Try again later or change symbols.",
    };
  }

  await bumpQuota(signals.length);
  const nextQuota = await getQuota();
  return { signals, quota: nextQuota, note: null };
}

/* ── history (server signals, best effort) ────────────────────────────── */

export interface ServerSignalSummary {
  signals: Awaited<ReturnType<typeof getAISignals>>;
  error: string | null;
}

export async function loadServerSignals(symbols: string[]): Promise<ServerSignalSummary> {
  try {
    const all: Awaited<ReturnType<typeof getAISignals>> = [];
    for (const symbol of symbols) {
      const list = await getAISignals(symbol, 10);
      all.push(...list);
    }
    all.sort((a, b) => b.createdAt - a.createdAt);
    return { signals: all.slice(0, 12), error: null };
  } catch (err) {
    return { signals: [], error: err instanceof Error ? err.message : "Failed to load signals" };
  }
}
