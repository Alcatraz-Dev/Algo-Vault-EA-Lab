import { NextRequest, NextResponse } from "next/server";
import { chatCompletionWithFallback } from "@/lib/ai";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callLLM(messages: ChatMessage[]): Promise<string> {
  const formatted = messages.map((m) => ({ role: m.role, content: m.content }));
  const systemMsg = formatted.find((m) => m.role === "system")?.content;
  const nonSystemMsgs = formatted.filter((m) => m.role !== "system");
  return chatCompletionWithFallback(nonSystemMsgs, systemMsg, "");
}

function extractJSON(text: string): unknown {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error("No JSON found in AI response");
}

// ─── Local heuristic: Build strategy from description ───

interface ParsedStrategy {
  indicators: Set<string>;
  conditions: Set<string>;
  entries: Set<string>;
  hasRisk: boolean;
  params: Record<string, number>;
}

function parseDescription(description: string): ParsedStrategy {
  const lower = description.toLowerCase();
  const indicators = new Set<string>();
  const conditions = new Set<string>();
  const entries = new Set<string>();
  let hasRisk = false;
  const params: Record<string, number> = {};

  // Extract numbers (potential parameters like periods, thresholds)
  const numbers = [...lower.matchAll(/\b(\d+)\b/g)].map(m => parseInt(m[1]));

  // ── Detect indicators ──
  if (/\b(ema|exponential\s*moving\s*average)\b/.test(lower)) {
    indicators.add("moving_average");
    // Extract EMA period
    const emaMatch = lower.match(/ema[_\s]*(\d+)/);
    if (emaMatch) params.ema_period = parseInt(emaMatch[1]);
    else {
      const periodNum = numbers.find(n => n >= 5 && n <= 200 && n !== 14 && n !== 26 && n !== 12 && n !== 9);
      if (periodNum && !params.ema_period) params.ema_period = periodNum;
    }
  }
  if (/\b(sma|simple\s*moving\s*average)\b/.test(lower)) {
    indicators.add("moving_average");
    const smaMatch = lower.match(/sma[_\s]*(\d+)/);
    if (smaMatch) params.sma_period = parseInt(smaMatch[1]);
  }
  if (/\b(moving\s*average|ma)\b/.test(lower) && !indicators.has("moving_average")) {
    indicators.add("moving_average");
  }

  if (/\brsi\b/.test(lower)) {
    indicators.add("rsi");
    const rsiMatch = lower.match(/rsi[_\s]*(\d+)/);
    if (rsiMatch) params.rsi_period = parseInt(rsiMatch[1]);
    else {
      const rsiNum = numbers.find(n => n >= 5 && n <= 50);
      if (rsiNum) params.rsi_period = rsiNum;
    }
  }

  if (/\bmacd\b/.test(lower)) {
    indicators.add("macd");
    const macdMatch = lower.match(/macd[_\s]*(\d+)[/_\s]*(\d+)[/_\s]*(\d+)/);
    if (macdMatch) {
      params.macd_fast = parseInt(macdMatch[1]);
      params.macd_slow = parseInt(macdMatch[2]);
      params.macd_signal = parseInt(macdMatch[3]);
    }
  }

  if (/\b(bollinger|bb|bands)\b/.test(lower)) {
    indicators.add("bollinger");
    const bbMatch = lower.match(/(?:bollinger|bb|bands)[_\s]*(\d+)[/_\s]*(\d+)/);
    if (bbMatch) {
      params.bb_period = parseInt(bbMatch[1]);
      params.bb_std = parseInt(bbMatch[2]);
    }
  }

  if (/\b(stochastic|stoch)\b/.test(lower)) {
    indicators.add("stochastic");
    const stochMatch = lower.match(/(?:stochastic|stoch)[_\s]*(\d+)/);
    if (stochMatch) params.stoch_period = parseInt(stochMatch[1]);
  }

  if (/\badx\b/.test(lower)) {
    indicators.add("adx");
    const adxMatch = lower.match(/adx[_\s]*(\d+)/);
    if (adxMatch) params.adx_period = parseInt(adxMatch[1]);
  }

  if (/\batr\b/.test(lower)) {
    indicators.add("atr");
    const atrMatch = lower.match(/atr[_\s]*(\d+)/);
    if (atrMatch) params.atr_period = parseInt(atrMatch[1]);
  }

  if (/\bcci\b/.test(lower)) {
    indicators.add("cci");
    const cciMatch = lower.match(/cci[_\s]*(\d+)/);
    if (cciMatch) params.cci_period = parseInt(cciMatch[1]);
  }

  if (/\b(psar|parabolic\s*sar)\b/.test(lower)) {
    indicators.add("psar");
  }

  if (/\bvwap\b/.test(lower)) {
    indicators.add("vwap");
  }

  if (/\bichimoku\b/.test(lower)) {
    indicators.add("ichimoku");
    const ichiMatch = lower.match(/ichimoku[_\s]*(\d+)[/_\s]*(\d+)[/_\s]*(\d+)/);
    if (ichiMatch) {
      params.ichi_tenkan = parseInt(ichiMatch[1]);
      params.ichi_kijun = parseInt(ichiMatch[2]);
      params.ichi_senkou = parseInt(ichiMatch[3]);
    }
  }

  if (/\bvolume\b/.test(lower)) {
    indicators.add("volume");
  }

  // ── Detect conditions ──
  if (/\bcross\s*(over|above)\b/.test(lower) || /\b(crosses?\s*above|cross.*up)\b/.test(lower)) {
    conditions.add("crossover");
  }
  if (/\bcross\s*(under|below)\b/.test(lower) || /\b(crosses?\s*below|cross.*down)\b/.test(lower)) {
    conditions.add("crossover");
  }

  if (/\brsi\b/.test(lower)) {
    if (/\brsi\b.*(?:below|under|<)\s*(\d+)/.test(lower)) {
      conditions.add("rsi_oversold");
      const threshold = lower.match(/rsi.*(?:below|under|<)\s*(\d+)/);
      if (threshold) params.rsi_oversold_threshold = parseInt(threshold[1]);
    }
    if (/\brsi\b.*(?:above|over|>)\s*(\d+)/.test(lower)) {
      conditions.add("rsi_overbought");
      const threshold = lower.match(/rsi.*(?:above|over|>)\s*(\d+)/);
      if (threshold) params.rsi_overbought_threshold = parseInt(threshold[1]);
    }
    if (/\b(oversold|below\s*30)\b/.test(lower)) conditions.add("rsi_oversold");
    if (/\b(overbought|above\s*70)\b/.test(lower)) conditions.add("rsi_overbought");
  }

  if (/\bmacd\b/.test(lower)) {
    if (/\bmacd\b.*(?:cross|above|bullish)/.test(lower)) conditions.add("macd_bullish");
    if (/\bmacd\b.*(?:below|bearish)/.test(lower)) conditions.add("macd_bearish");
  }

  if (/\b(stochastic|stoch)\b/.test(lower)) {
    if (/(?:stoch|stochastic).*oversold/.test(lower) || /(?:stoch|stochastic).*below\s*20/.test(lower)) conditions.add("stoch_oversold");
    if (/(?:stoch|stochastic).*overbought/.test(lower) || /(?:stoch|stochastic).*above\s*80/.test(lower)) conditions.add("stoch_overbought");
    if (/(?:stoch|stochastic).*cross/.test(lower)) conditions.add("stoch_cross");
  }

  if (/\badx\b/.test(lower)) {
    if (/(?:adx|trend).*strong/.test(lower) || /adx.*above\s*25/.test(lower) || /adx.*>/.test(lower)) conditions.add("adx_strong");
  }

  if (/\bcci\b/.test(lower)) {
    if (/\bcci\b.*(?:below|under|<)\s*-?100/.test(lower)) conditions.add("cci_oversold");
    if (/\bcci\b.*(?:above|over|>)\s*100/.test(lower)) conditions.add("cci_overbought");
  }

  if (/\b(psar|parabolic)\b/.test(lower)) {
    if (/(?:psar|parabolic).*(?:bull|above|buy)/.test(lower)) conditions.add("psar_bull");
  }

  if (/\bvwap\b/.test(lower)) {
    if (/\bvwap\b.*(?:above|bull|buy)/.test(lower)) conditions.add("vwap_bull");
  }

  if (/\bichimoku\b/.test(lower)) {
    if (/\bichimoku\b.*(?:above|bull|buy|cloud)/.test(lower)) conditions.add("ichimoku_bull");
  }

  if (/\bvolume\b/.test(lower)) {
    if (/\bvolume\b.*(?:surge|spike|high|above)/.test(lower)) conditions.add("volume_surge");
  }

  // ── Detect entries ──
  if (/\b(buy|long|enter\s*long)\b/.test(lower)) entries.add("long_entry");
  if (/\b(sell|short|enter\s*short)\b/.test(lower)) entries.add("short_entry");
  if (/\bclose\s*(long|buy)\b/.test(lower)) entries.add("close_long");
  if (/\bclose\s*(short|sell)\b/.test(lower)) entries.add("close_short");

  // ── Detect risk management ──
  if (/\b(stop\s*loss|sl|stop)\b/.test(lower) || /\b(take\s*profit|tp|target)\b/.test(lower)) {
    hasRisk = true;
    const slMatch = lower.match(/(?:stop\s*loss|sl)[_\s]*(\d+)%?/);
    if (slMatch) params.stop_loss_pct = parseInt(slMatch[1]);
    const tpMatch = lower.match(/(?:take\s*profit|tp|target)[_\s]*(\d+)%?/);
    if (tpMatch) params.take_profit_pct = parseInt(tpMatch[1]);
  }

  // Auto-detect risk if entries exist
  if (entries.size > 0) hasRisk = true;

  return { indicators, conditions, entries, hasRisk, params };
}

function localBuildStrategy(description: string) {
  const parsed = parseDescription(description);

  // Start with price source
  const nodes: { id: string; kind: string; x: number; y: number; label?: string }[] = [];
  const edges: { from: string; to: string }[] = [];

  const indicatorKinds = ["moving_average", "rsi", "macd", "bollinger", "stochastic", "adx", "atr", "cci", "psar", "vwap", "ichimoku", "volume"];
  const conditionKinds = ["crossover", "rsi_oversold", "rsi_overbought", "macd_bullish", "macd_bearish", "stoch_oversold", "stoch_overbought", "stoch_cross", "adx_strong", "cci_oversold", "cci_overbought", "psar_bull", "vwap_bull", "ichimoku_bull", "volume_surge"];
  const entryKinds = ["long_entry", "short_entry", "close_long", "close_short"];
  const riskKinds = ["risk_manager"];
  const plotKinds = ["plot"];

  // If no indicators detected, don't add defaults — just use price + crossover + entry
  if (parsed.indicators.size === 0) {
    parsed.indicators.add("crossover");
    if (parsed.entries.size === 0) parsed.entries.add("long_entry");
  }

  // Auto-add risk if entries exist
  if (parsed.entries.size > 0) parsed.hasRisk = true;

  // Auto-add plot if indicators exist
  const hasPlotIndicator = indicatorKinds.some(k => parsed.indicators.has(k));
  if (hasPlotIndicator) parsed.indicators.add("plot");

  // Build nodes from parsed data
  const allDetected = new Set<string>([...parsed.indicators, ...parsed.conditions, ...parsed.entries]);
  if (parsed.hasRisk) allDetected.add("risk_manager");
  allDetected.add("plot");

  // Layout groups with ordering
  const layoutGroups = [
    { kinds: indicatorKinds, x: 250 },
    { kinds: conditionKinds, x: 465 },
    { kinds: entryKinds, x: 680 },
    { kinds: riskKinds, x: 680 },
    { kinds: plotKinds, x: 465 },
  ];

  let prevGroupIds: string[] = [];

  for (const group of layoutGroups) {
    const groupIds: string[] = [];
    let yIdx = 0;
    for (const kind of group.kinds) {
      if (!allDetected.has(kind)) continue;

      // Build descriptive label with params
      let label = kind.replace(/_/g, " ");
      if (kind === "moving_average" && parsed.params.ema_period) label = `EMA ${parsed.params.ema_period}`;
      else if (kind === "moving_average" && parsed.params.sma_period) label = `SMA ${parsed.params.sma_period}`;
      else if (kind === "rsi" && parsed.params.rsi_period) label = `RSI ${parsed.params.rsi_period}`;
      else if (kind === "rsi_oversold" && parsed.params.rsi_oversold_threshold) label = `RSI < ${parsed.params.rsi_oversold_threshold}`;
      else if (kind === "rsi_overbought" && parsed.params.rsi_overbought_threshold) label = `RSI > ${parsed.params.rsi_overbought_threshold}`;
      else if (kind === "risk_manager") {
        if (parsed.params.stop_loss_pct && parsed.params.take_profit_pct) label = `SL ${parsed.params.stop_loss_pct}% / TP ${parsed.params.take_profit_pct}%`;
        else if (parsed.params.stop_loss_pct) label = `Stop Loss ${parsed.params.stop_loss_pct}%`;
        else if (parsed.params.take_profit_pct) label = `Take Profit ${parsed.params.take_profit_pct}%`;
      }

      const id = `${kind}_${Date.now()}_${yIdx}`;
      nodes.push({ id, kind, x: group.x, y: 80 + yIdx * 80, label });
      groupIds.push(id);
      yIdx++;
    }

    // Connect from previous group
    if (prevGroupIds.length > 0 && groupIds.length > 0) {
      for (const prevId of prevGroupIds) {
        for (const curId of groupIds) {
          edges.push({ from: prevId, to: curId });
        }
      }
    }

    if (groupIds.length > 0) prevGroupIds = groupIds;
  }

  // Build strategy name from description
  const name = description.slice(0, 50) || "AI Strategy";

  // Build param summary for the description display
  const paramSummary: string[] = [];
  if (parsed.params.ema_period) paramSummary.push(`EMA(${parsed.params.ema_period})`);
  if (parsed.params.sma_period) paramSummary.push(`SMA(${parsed.params.sma_period})`);
  if (parsed.params.rsi_period) paramSummary.push(`RSI(${parsed.params.rsi_period})`);
  if (parsed.params.macd_fast) paramSummary.push(`MACD(${parsed.params.macd_fast}/${parsed.params.macd_slow}/${parsed.params.macd_signal})`);
  if (parsed.params.bb_period) paramSummary.push(`BB(${parsed.params.bb_period},${parsed.params.bb_std})`);
  if (parsed.params.stop_loss_pct) paramSummary.push(`SL ${parsed.params.stop_loss_pct}%`);
  if (parsed.params.take_profit_pct) paramSummary.push(`TP ${parsed.params.take_profit_pct}%`);

  const descriptionParts: string[] = [];
  if (parsed.indicators.size > 0) descriptionParts.push(`Indicators: ${[...parsed.indicators].filter(k => k !== "plot").map(k => k.replace(/_/g, " ")).join(", ")}`);
  if (parsed.conditions.size > 0) descriptionParts.push(`Conditions: ${[...parsed.conditions].map(k => k.replace(/_/g, " ")).join(", ")}`);
  if (parsed.entries.size > 0) descriptionParts.push(`Entries: ${[...parsed.entries].map(k => k.replace(/_/g, " ")).join(", ")}`);
  if (paramSummary.length > 0) descriptionParts.push(`Parameters: ${paramSummary.join(", ")}`);

  return { nodes, edges, name, description: descriptionParts.join(" · ") };
}

// ─── Local heuristic: Fix code ───

function localFixCode(source: string, errors?: string[]): string {
  let fixed = source;

  // Fix common issues
  // 1. Unclosed parentheses
  const openParens = (fixed.match(/\(/g) || []).length;
  const closeParens = (fixed.match(/\)/g) || []).length;
  for (let i = 0; i < openParens - closeParens; i++) fixed += ")";

  // 2. Unclosed brackets
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += "]";

  // 3. Missing newline after if/for blocks
  fixed = fixed.replace(/(if\s*\([^)]+\)\s*)(?!\n)(?!\{)/g, "$1\n    ");
  fixed = fixed.replace(/(for\s*\([^)]+\)\s*)(?!\n)(?!\{)/g, "$1\n    ");

  // 4. Fix strategy.exit without strategy.entry
  if (fixed.includes("strategy.exit") && !fixed.includes("strategy.entry")) {
    fixed = `strategy.entry("Long", strategy.long)\n${fixed}`;
  }

  // 5. Add version directive if missing
  if (!fixed.includes("@version")) {
    fixed = `//@version=6\n${fixed}`;
  }

  return fixed;
}

// ─── Local heuristic: Describe script ───

function localDescribe(source: string) {
  const src = source.toLowerCase();
  const indicators: string[] = [];
  const signals: string[] = [];

  if (/ta\.sma|ta\.ema|ta\.wma/.test(src)) indicators.push("Moving Average");
  if (/ta\.rsi/.test(src)) indicators.push("RSI");
  if (/ta\.macd/.test(src)) indicators.push("MACD");
  if (/ta\.bb|ta\.bbands/.test(src)) indicators.push("Bollinger Bands");
  if (/ta\.stoch/.test(src)) indicators.push("Stochastic");
  if (/ta\.adx/.test(src)) indicators.push("ADX");
  if (/ta\.atr/.test(src)) indicators.push("ATR");
  if (/ta\.cci/.test(src)) indicators.push("CCI");
  if (/ta\.psar/.test(src)) indicators.push("Parabolic SAR");
  if (/ta\.vwap/.test(src)) indicators.push("VWAP");
  if (/ichimoku/.test(src)) indicators.push("Ichimoku");
  if (/volume/.test(src)) indicators.push("Volume");

  if (/ta\.crossover/.test(src)) signals.push("Crossover");
  if (/ta\.crossunder/.test(src)) signals.push("Crossunder");
  if (/strategy\.entry/.test(src)) signals.push("Strategy Entry");
  if (/strategy\.exit/.test(src)) signals.push("Strategy Exit");
  if (/alertcondition/.test(src)) signals.push("Alert Condition");

  const isStrategy = /strategy\s*\(/.test(src);
  const isIndicator = /indicator\s*\(/.test(src);
  const type = isStrategy ? "Strategy" : isIndicator ? "Indicator" : "Script";

  const nameMatch = source.match(/(?:indicator|strategy)\s*\(\s*["']([^"']+)["']/);
  const name = nameMatch?.[1] || `${type} — ${indicators.join(", ") || "Custom"}`;

  const complexity = indicators.length > 4 || /array|matrix|request\.security/.test(src) ? "advanced" : indicators.length > 2 ? "moderate" : "simple";

  return {
    name,
    description: `${type} using ${indicators.join(", ") || "custom logic"}${signals.length ? ` with ${signals.join(", ").toLowerCase()} signals` : ""}. Complexity: ${complexity}.`,
    indicators,
    signals,
    complexity,
  };
}

// ─── Main handler ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, source, errors, description } = body;

    if (action === "build-strategy") {
      if (!description) {
        return NextResponse.json({ error: "description required" }, { status: 400 });
      }

      // Try LLM first, fall back to local
      const systemPrompt = `You are a Pine Script v6 expert. Convert natural language trading strategy descriptions into visual strategy builder nodes and edges.

Available node kinds:
price, moving_average, rsi, macd, bollinger, stochastic, adx, atr, cci, psar, vwap, ichimoku, volume,
crossover, rsi_oversold, rsi_overbought, macd_bullish, macd_bearish, stoch_oversold, stoch_overbought,
stoch_cross, adx_strong, cci_oversold, cci_overbought, psar_bull, vwap_bull, ichimoku_bull, volume_surge,
and, long_entry, short_entry, close_long, close_short, risk_manager, plot

Return JSON: { "nodes": [{ "id": "string", "kind": "NodeKind", "x": number, "y": number }], "edges": [{ "from": "string", "to": "string" }], "name": "strategy name" }

Layout: indicators x=250, conditions x=465, entries x=680, risk x=680, plot x=465.`;

      const llmResponse = await callLLM([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Build a strategy for: ${description}` },
      ]);

      if (llmResponse) {
        try {
          const result = extractJSON(llmResponse) as { nodes?: unknown[]; edges?: unknown[]; name?: string };
          return NextResponse.json({ success: true, nodes: result.nodes || [], edges: result.edges || [], name: result.name || description.slice(0, 50) });
        } catch { /* fall through to local */ }
      }

      // Local fallback
      const local = localBuildStrategy(description);
      return NextResponse.json({ success: true, ...local, source: "local-heuristic" });
    }

    if (action === "fix-code") {
      if (!source) {
        return NextResponse.json({ error: "source required" }, { status: 400 });
      }

      const errorContext = errors?.length ? `\n\nErrors found:\n${errors.join("\n")}` : "";

      const systemPrompt = `You are a Pine Script v6 expert. Fix the following Pine Script code.
Return ONLY the corrected Pine Script code, nothing else. No explanations, no markdown fences.
Keep the original intent of the code. Only fix what is broken.`;

      const llmResponse = await callLLM([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Fix this Pine Script:${errorContext}\n\nOriginal code:\n${source}` },
      ]);

      if (llmResponse) {
        let fixedCode = llmResponse.trim();
        if (fixedCode.startsWith("```pine")) fixedCode = fixedCode.slice(7);
        if (fixedCode.startsWith("```")) fixedCode = fixedCode.slice(3);
        if (fixedCode.endsWith("```")) fixedCode = fixedCode.slice(0, -3);
        return NextResponse.json({ success: true, fixedCode: fixedCode.trim() });
      }

      // Local fallback
      const fixedCode = localFixCode(source, errors);
      return NextResponse.json({ success: true, fixedCode, source: "local-heuristic" });
    }

    if (action === "describe") {
      if (!source) {
        return NextResponse.json({ error: "source required" }, { status: 400 });
      }

      const systemPrompt = `You are a Pine Script v6 expert. Analyze this Pine Script and provide a clear, concise description.
Return JSON: { "name": "short name", "description": "1-2 sentence description", "indicators": ["list"], "signals": ["list"], "complexity": "simple|moderate|advanced" }`;

      const llmResponse = await callLLM([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Describe this Pine Script:\n${source}` },
      ]);

      if (llmResponse) {
        try {
          const result = extractJSON(llmResponse) as Record<string, unknown>;
          return NextResponse.json({ success: true, ...result });
        } catch {
          return NextResponse.json({ success: true, description: llmResponse.slice(0, 500) });
        }
      }

      // Local fallback
      const local = localDescribe(source);
      return NextResponse.json({ success: true, ...local, source: "local-heuristic" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("AI Pine error:", err);
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
