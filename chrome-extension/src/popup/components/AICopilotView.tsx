import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { chatWithAI } from "@/api/algovault";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { chartDisplayLabel } from "@/services/chart-intelligence";
import type { ChatMessage, TradingViewContext } from "@/types";
import { Markdown } from "./Markdown";

interface AICopilotViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
  onContextChange?: (ctx: TradingViewContext) => void;
}

interface CopilotMessage extends ChatMessage {
  truncated?: boolean;
}

type ContextStatus = "live" | "stale" | "unavailable";

const suggestions = [
  "Is there a valid setup right now? What confirms it?",
  "Where should the stop loss go and why?",
  "What is the most likely take profit target?",
  "What would invalidate the current thesis?",
];

function formatAge(ms: number): string {
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function AICopilotView({ symbol, context, onBack, onContextChange }: AICopilotViewProps) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [enriched, setEnriched] = useState<EnrichedChartContext | null>(null);
  const [structuredContext, setStructuredContext] = useState<string | null>(null);
  const [manualSymbol, setManualSymbol] = useState(context?.symbol || "");
  const [manualTimeframe, setManualTimeframe] = useState(context?.timeframe || "");
  const [showManual, setShowManual] = useState(false);
  const [contextAge, setContextAge] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgCounter = useRef(0);

  const effectiveContext = context && (context.symbol || context.marketSymbol)
    ? context
    : null;

  /* Pull the canonical enriched chart context from the service worker. */
  const refreshContext = useCallback(() => {
    chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (resp) => {
      if (resp?.enriched) {
        setEnriched(resp.enriched as EnrichedChartContext);
        setContextAge(resp.enriched.enrichedAt ? Date.now() - resp.enriched.enrichedAt : null);
      }
      if (resp?.structuredContext) {
        setStructuredContext(resp.structuredContext as string);
      }
    });
  }, []);

  useEffect(() => {
    refreshContext();
  }, [refreshContext, effectiveContext?.symbol, effectiveContext?.timeframe]);

  /* Keep the context live while the view is open. */
  useEffect(() => {
    const listener = (message: { type: string; payload?: unknown }) => {
      if (message.type === "MARKET_CONTEXT_READY" && message.payload) {
        const intel = message.payload as EnrichedChartContext;
        if (intel.chart.symbol === (effectiveContext?.symbol ?? null)) {
          setEnriched(intel);
          setContextAge(Date.now() - intel.enrichedAt);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [effectiveContext?.symbol]);

  useEffect(() => {
    if (enriched) {
      setContextAge(Date.now() - enriched.enrichedAt);
      const interval = setInterval(() => {
        if (enriched) setContextAge(Date.now() - enriched.enrichedAt);
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [enriched]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const contextStatus: ContextStatus = useMemo(() => {
    if (!effectiveContext) return "unavailable";
    if (enriched?.market?.status === "ready" || effectiveContext.price != null) return "live";
    return "stale";
  }, [effectiveContext, enriched]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    // Refresh the canonical context right before sending so the AI always sees
    // the freshest chart evidence — no per-feature context duplication.
    if (!structuredContext) {
      refreshContext();
      // Small grace period for the (cached) enrichment round-trip.
      await new Promise((r) => setTimeout(r, 150));
    }

    const userMsg: CopilotMessage = {
      role: "user",
      content: text.trim(),
      timestamp: ++msgCounter.current,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const contextBlock = structuredContext
        ? `\n\n===== CURRENT CHART CONTEXT (canonical) =====\n${structuredContext}\n===== END CONTEXT =====\n`
        : `\n\n===== CURRENT CHART CONTEXT =====\nNo active chart detected. Ask the user or work from general knowledge, and never fabricate prices.\n===== END CONTEXT =====\n`;

      const result = await chatWithAI(
        [{ role: "user", content: text.trim() + contextBlock, timestamp: Date.now() }],
        "You are AlgoVault AI, a disciplined trading analyst. The user's message is followed by the canonical Chart Context (browser-detected TradingView data plus AlgoVault market analytics). Analyse it thoroughly: reference actual price levels (swings, support/resistance, VWAP, liquidity, indicators) that exist in the context and explain the reasoning step by step. NEVER fabricate prices, levels or data — everything must come from the provided context. If the context is missing something, say exactly what is missing. Be thorough and complete; do not stop early.",
        8000,
        enriched?.chart ?? null
      );

      const truncated = result.truncated === true || result.finishReason === "length";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.content,
          timestamp: Date.now(),
          truncated,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed to get a response from the AI service. ${err instanceof Error ? err.message : "Please try again."}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = () => {
    const sym = manualSymbol.trim().toUpperCase();
    const tf = manualTimeframe.trim().toUpperCase();
    if (sym) {
      const newContext: TradingViewContext = {
        symbol: sym,
        exchange: null,
        timeframe: tf || "H1",
        price: enriched?.market?.currentPrice ?? null,
        isTradingView: false,
        source: "manual",
        manualOverride: true,
        marketSymbol: sym,
        status: "active",
      };
      onContextChange?.(newContext);
      setEnriched(null);
      setStructuredContext(null);
      refreshContext();
    }
    setShowManual(false);
  };

  const setup = enriched?.setup;
  const market = enriched?.market;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#f0f0f5]">
            AI Copilot — {chartDisplayLabel(addressContext(effectiveContext, enriched))}
          </span>
          <div className="flex items-center gap-2">
            <ContextStatusBadge status={contextStatus} age={contextAge} />
            <button
              onClick={refreshContext}
              disabled={loading}
              className="p-0.5 rounded hover:bg-white/5 transition-colors"
              title="Refresh chart context"
            >
              <RefreshCw size={11} className={`text-[#8888aa] ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        {enriched && (
          <div className="flex items-center gap-2 mt-1 text-[9px] text-[#55556a]">
            <span>Sync: {enriched.marketSync}</span>
            <span>·</span>
            <span>Price check: {enriched.priceValidation.state}</span>
            {enriched.priceValidation.deviationPct != null && (
              <>
                <span>·</span>
                <span>{Math.abs(enriched.priceValidation.deviationPct).toFixed(2)}% dev</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {contextStatus === "unavailable" && (
          <div className="text-center py-4">
            <AlertCircle size={20} className="mx-auto text-amber-400 mb-2" />
            <p className="text-[11px] text-[#8888aa]">No active chart detected.</p>
            <p className="text-[10px] text-[#55556a] mt-1">Open a chart on TradingView or enter a symbol manually.</p>
            {!showManual ? (
              <button
                onClick={() => setShowManual(true)}
                className="mt-2 text-[10px] text-violet-400 hover:text-violet-300"
              >
                Enter symbol manually
              </button>
            ) : (
              <div className="mt-2 flex gap-1 justify-center">
                <input
                  value={manualSymbol}
                  onChange={(e) => setManualSymbol(e.target.value)}
                  placeholder="Symbol"
                  className="w-20 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[10px] text-[#f0f0f5] placeholder:text-[#55556a] outline-none"
                />
                <input
                  value={manualTimeframe}
                  onChange={(e) => setManualTimeframe(e.target.value)}
                  placeholder="TF"
                  className="w-12 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[10px] text-[#f0f0f5] placeholder:text-[#55556a] outline-none"
                />
                <button onClick={handleManualSubmit} className="px-2 py-0.5 text-[10px] bg-violet-500/20 text-violet-400 rounded">Go</button>
              </div>
            )}
          </div>
        )}

        {messages.length === 0 && contextStatus !== "unavailable" && (
          <div className="flex flex-col gap-2 pt-4">
            <p className="text-[11px] text-[#8888aa] text-center mb-2">
              Ask anything about {chartDisplayLabel(addressContext(effectiveContext, enriched))}
            </p>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-left text-[11px] px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02] text-[#8888aa] hover:bg-violet-500/10 hover:border-violet-500/20 hover:text-violet-400 transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={`${i}-${msg.timestamp}`} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[92%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${msg.role === "user" ? "bg-violet-500/20 text-violet-200" : "bg-white/5 text-[#f0f0f5]"}`}>
              {msg.role === "assistant" ? <Markdown content={msg.content} /> : msg.content}
              {msg.truncated && (
                <div className="mt-2 pt-2 border-t border-amber-500/20 flex items-center gap-1">
                  <AlertCircle size={10} className="text-amber-400" />
                  <span className="text-[9px] text-amber-400">
                    Response hit the output limit and was cut off. Ask a narrower question to get the rest.
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-lg px-3 py-2 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-violet-400" />
              <span className="text-[11px] text-[#8888aa]">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-2 border-t border-white/5">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            placeholder="Ask the AI..."
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-[#f0f0f5] placeholder:text-[#55556a] outline-none focus:border-violet-500/30"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="p-1.5 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 disabled:opacity-30 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      <div className="px-3 py-1.5 border-t border-white/5">
        <button onClick={onBack} className="w-full text-xs text-[#8888aa] hover:text-[#f0f0f5] transition-colors py-1">Back</button>
      </div>
    </div>
  );
}

/** Merge browser context + enriched context into a displayable ChartContext. */
function addressContext(
  context: TradingViewContext | null,
  enriched: EnrichedChartContext | null
): TradingViewContext | null {
  if (enriched?.chart) return enriched.chart;
  return context;
}

function ContextStatusBadge({ status, age }: { status: ContextStatus; age: number | null }) {
  const config = {
    live: { color: "text-emerald-400", label: "● Live Context" },
    stale: { color: "text-amber-400", label: "◐ Stale Context" },
    unavailable: { color: "text-rose-400", label: "⚠ No Context" },
  };
  return (
    <span className={`text-[9px] ${config[status].color} font-semibold`}>
      {config[status].label}
      {age != null && status === "live" ? ` · ${formatAge(age)} old` : ""}
    </span>
  );
}