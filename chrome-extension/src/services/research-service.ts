/**
 * AI research notes with per-symbol caching — the "TradingView AI Analyst"
 * style feature. Two depths:
 *
 *   quick — a tight snapshot: technicals from live context, sentiment,
 *           risks, and a recommendation. Cached ~30 min.
 *   deep  — a full research report including fundamental context. Cached ~6 h.
 *
 * Grounding rule: everything technical must come from the provided chart
 * context; fundamental/news context is clearly labelled as general knowledge
 * with an as-of caveat — the model is instructed to never invent numbers.
 */
import { chatWithAI } from "@/api/algovault";
import { getResearchCache, setResearchCache } from "@/storage/storage";
import { getCopilotPrefs } from "@/storage/storage";
import { personaById } from "./copilot-engine";
import type { ResearchNote, ResearchKind } from "@/types/copilot";

const QUICK_TTL_MS = 30 * 60 * 1000;
const DEEP_TTL_MS = 6 * 60 * 60 * 1000;

const QUICK_PROMPT = `You are AlgoVault Research. Produce a compact research snapshot for the symbol in the chart context.

Structure exactly these sections with markdown headings:
## Snapshot
2-3 sentences: what the asset is doing right now (trend, momentum, volatility) — strictly from the CHART CONTEXT data.
## Technicals
Bullet list: trend direction, structure (BOS/CHOCH counts), RSI/EMA/VWAP readings if present in context, volatility state. Use ONLY values present in the context.
## Sentiment & Narrative
2-3 bullets on the current market narrative for this asset class. General knowledge — keep it qualitative, no invented numbers.
## Key Risks
2-3 bullets.
## Bottom line
One paragraph: the actionable takeaway and what would change it.

Never fabricate prices, indicator values or fundamental figures. If the chart context lacks data, say what is missing.`;

const DEEP_PROMPT = `You are AlgoVault Research. Produce a structured research report for the symbol in the chart context.

Sections (markdown headings):
## Overview
What the asset is, and how it has been behaving — from the CHART CONTEXT.
## Multi-horizon Read
Bullets for intraday / swing / positional horizon based on the context timeframes and trend data. Strictly from context values.
## Fundamentals & Macro Context
Qualitative drivers for this asset class (e.g. rates & DXY for FX metals, ETF flows & halvings for BTC, earnings & margins for equities). General knowledge — explicitly qualitative, no invented figures.
## Technical Roadmap
Key levels FROM THE CONTEXT: supports, resistances, liquidity zones, VWAP, structure triggers. Mark each as bullish/bearish trigger.
## Scenarios
Bull case, bear case, and the trigger that separates them.
## Risks & What Would Invalidate
Bullets.
## Research Notes
2-4 open questions a trader should verify (upcoming events, data gaps in context).

Never fabricate prices, indicator values, earnings numbers or dates. If the context lacks data, say exactly what is missing.`;

const TTLS: Record<ResearchKind, number> = { quick: QUICK_TTL_MS, deep: DEEP_TTL_MS };

export function researchKey(symbol: string, kind: ResearchKind): string {
  return `${(symbol || "").toUpperCase()}|${kind}`;
}

export async function getCachedResearch(symbol: string, kind: ResearchKind): Promise<ResearchNote | null> {
  const cache = await getResearchCache();
  const note = cache[researchKey(symbol, kind)];
  return note ?? null;
}

export async function isResearchStale(symbol: string, kind: ResearchKind): Promise<boolean> {
  const note = await getCachedResearch(symbol, kind);
  if (!note) return true;
  return Date.now() - note.generatedAt > TTLS[kind];
}

export async function generateResearch(opts: {
  symbol: string;
  timeframe: string;
  kind: ResearchKind;
  structuredContext: string | null;
  contextObject?: unknown;
  force?: boolean;
}): Promise<ResearchNote> {
  const { symbol, kind } = opts;

  if (!opts.force) {
    const cached = await getCachedResearch(symbol, kind);
    if (cached && Date.now() - cached.generatedAt <= TTLS[kind]) return cached;
  }

  const prefs = await getCopilotPrefs();
  const persona = personaById(prefs.personaId);

  const contextBlock = opts.structuredContext
    ? `\n\n===== CHART CONTEXT (canonical, live) =====\n${opts.structuredContext}\n===== END CONTEXT =====`
    : `\n\n===== CHART CONTEXT =====\nNo live chart context available for this symbol. Note this prominently in the Snapshot section.\n===== END CONTEXT =====`;

  const prompt = `${opts.kind === "quick" ? QUICK_PROMPT : DEEP_PROMPT}\n\nResearch target: ${symbol.toUpperCase()} (chart timeframe ${opts.timeframe}).${contextBlock}`;

  const result = await chatWithAI(
    [{ role: "user", content: prompt, timestamp: Date.now() }],
    persona.systemPrompt,
    opts.kind === "deep" ? 8000 : 3000,
    opts.contextObject,
    prefs.model || undefined
  );

  const note: ResearchNote = {
    symbol: symbol.toUpperCase(),
    kind,
    content: result.content,
    model: result.model ?? prefs.model ?? null,
    generatedAt: Date.now(),
    personaId: persona.id,
  };

  const cache = await getResearchCache();
  cache[researchKey(symbol, kind)] = note;
  await setResearchCache(cache);

  return note;
}

export async function clearResearchCache(symbol?: string): Promise<void> {
  const cache = await getResearchCache();
  if (!symbol) {
    await setResearchCache({});
    return;
  }
  for (const key of Object.keys(cache)) {
    if (key.startsWith(`${symbol.toUpperCase()}|`)) delete cache[key];
  }
  await setResearchCache(cache);
}
