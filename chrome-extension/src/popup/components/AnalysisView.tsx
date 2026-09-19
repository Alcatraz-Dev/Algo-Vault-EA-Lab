import React, { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Send, ChevronDown, ChevronUp } from "lucide-react";
import { chatWithAI } from "@/api/algovault";
import { analyzeChartEnhanced } from "@/api/context";
import { buildAIContextMessage } from "@/services/market-service";
import { getAuthToken } from "@/storage/storage";
import type { MarketContext, AnalysisResult } from "@/types/market-context";
import type { ChatMessage, TradingViewContext } from "@/types";

interface AnalysisViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

interface AnalysisSectionProps {
  title: string;
  children: React.ReactNode;
  accent?: string;
}

function AnalysisSection({ title, children, accent = "violet" }: AnalysisSectionProps) {
  const colorMap: Record<string, string> = {
    violet: "border-violet-500/20 bg-violet-500/5",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    amber: "border-amber-500/20 bg-amber-500/5",
    rose: "border-rose-500/20 bg-rose-500/5",
    cyan: "border-cyan-500/20 bg-cyan-500/5",
  };
  return (
    <div className={`rounded-lg border ${colorMap[accent] || colorMap.violet} p-2.5`}>
      <div className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1">{title}</div>
      {children}
    </div>
  );
}

function DataRow({ label, value, highlight }: { label: string; value: string | number | null; highlight?: boolean }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[10px] text-[#8888aa]">{label}</span>
      <span className={`text-[10px] font-mono ${highlight ? "text-violet-400" : "text-[#f0f0f5]"}`}>{value}</span>
    </div>
  );
}

export function AnalysisView({ symbol, context, onBack }: AnalysisViewProps) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    structure: true, regime: true, score: true, levels: true, scenarios: true,
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAiReply(null);
    try {
      const tf = context?.timeframe || "H1";
      const sym = context?.symbol || symbol || "";
      setResult(await analyzeChartEnhanced(sym, tf, {
        exchange: context?.exchange || null,
        price: context?.price,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, context]);

  const handleAskAI = async () => {
    if (!question.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: question.trim(), timestamp: Date.now() };
    setChatLoading(true);
    setAiReply(null);
    try {
      const token = await getAuthToken();
      if (!token) { setAiReply("Authentication required"); setQuestion(""); return; }
      const ctx: MarketContext | null = result?.marketContext || null;
      const contextMsg = ctx ? `\n\n--- Market Context ---\n${buildAIContextMessage(ctx)}\n--- End Context ---` : "";
      const reply = await chatWithAI(
        [{ role: "user", content: question.trim() + contextMsg, timestamp: Date.now() }],
        "You are AlgoVault AI, an expert trading assistant. Provide thorough, detailed analysis based on the market context provided.",
        8000
      );
      setAiReply(reply.content);
      setQuestion("");
      setQuestion("");
    } catch {
      setAiReply("Failed to get a response. Please try again.");
      setQuestion("");
    } finally {
      setChatLoading(false);
    }
  };

  const didAutoAnalyze = useRef(false);
  useEffect(() => {
    if (!didAutoAnalyze.current) {
      didAutoAnalyze.current = true;
      handleAnalyze();
    }
  }, [symbol, context?.timeframe, context?.symbol, context?.exchange, context?.price]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiReply, chatLoading]);

  const ctx = result?.marketContext;
  const ai = result?.aiAnalysis;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#f0f0f5]">Chart Intelligence — {symbol || "—"}</span>
          {context?.timeframe && <span className="text-[10px] text-[#8888aa]">{context.timeframe}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={24} className="animate-spin text-violet-400" />
            <p className="text-xs text-[#8888aa]">Analyzing chart intelligence...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-8">
            <AlertCircle size={24} className="text-rose-400" />
            <p className="text-xs text-rose-400">{error}</p>
            <button onClick={handleAnalyze} className="text-xs text-violet-400 hover:text-violet-300">Retry</button>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-2">
            {ctx && (
              <>
                <AnalysisSection title="Market Summary" accent="violet">
                  {ctx.currentPrice != null && (
                    <DataRow label="Price" value={ctx.currentPrice.toFixed(ctx.currentPrice >= 1000 ? 1 : ctx.currentPrice >= 100 ? 2 : 4)} highlight />
                  )}
                  <DataRow label="Trend" value={ctx.trend.direction} />
                  <DataRow label="Regime" value={ctx.marketRegime.regime.replace(/_/g, " ")} />
                  <DataRow label="Regime Conf." value={`${ctx.marketRegime.confidence}%`} />
                  <DataRow label="Score" value={`${ctx.score.total} (${ctx.score.bias})`} highlight />
                  <DataRow label="Volatility" value={ctx.volatility.state} />
                </AnalysisSection>

                <AnalysisSection
                  title={`Structure (${ctx.marketStructure.bosCount} BOS / ${ctx.marketStructure.chochCount} CHOCH)`}
                  accent="cyan"
                >
                  <button onClick={() => toggleSection("structure")} className="flex items-center gap-1 text-[10px] text-[#8888aa] mb-1">
                    {expandedSections.structure ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                    {ctx.marketStructure.overall}
                  </button>
                  {expandedSections.structure && ctx.marketStructure.events.length > 0 && (
                    <div className="space-y-0.5">
                      {ctx.marketStructure.events.slice(-10).map((ev: { type: string; price: number; direction: string }, i: number) => (
                        <div key={i} className="text-[10px] text-[#f0f0f5] font-mono">
                          <span className={ev.type === "BOS" ? "text-emerald-400" : "text-rose-400"}>{ev.type}</span>
                          {" "}{ev.price.toFixed(5)} — {ev.direction}
                        </div>
                      ))}
                    </div>
                  )}
                </AnalysisSection>

                <AnalysisSection title="Market Score" accent="amber">
                  <div className="text-[10px] text-[#f0f0f5] font-mono">{ctx.score.total}/100 — {ctx.score.bias} ({ctx.score.confidence})</div>
                  {ctx.score.components.length > 0 && (
                    <div className="space-y-0.5 mt-1">
                      {ctx.score.components.map((c: { name: string; value: number; direction: string }, i: number) => (
                        <div key={i} className="flex justify-between text-[10px]">
                          <span className="text-[#8888aa]">{c.name}</span>
                          <span className={`font-mono ${c.direction === "bullish" ? "text-emerald-400" : c.direction === "bearish" ? "text-rose-400" : "text-[#8888aa]"}`}>
                            {c.value} ({c.direction})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </AnalysisSection>

                <AnalysisSection title="Volatility & VWAP" accent="emerald">
                  <DataRow label="ATR" value={ctx.volatility.atr.toFixed(5)} />
                  <DataRow label="ATR %" value={`${ctx.volatility.atrPercent.toFixed(2)}%`} />
                  <DataRow label="VWAP" value={ctx.vwap.vwap.toFixed(5)} />
                  <DataRow label="Price vs VWAP" value={`${ctx.vwap.distancePercent.toFixed(3)}%`} />
                  <DataRow label="Volume" value={`${ctx.volume.relative}x avg`} />
                </AnalysisSection>

                <AnalysisSection title="Zones & Liquidity" accent="rose">
                  <DataRow label="FVG" value={`${ctx.fvg.count} (${ctx.fvg.direction})`} />
                  <DataRow label="Order Blocks" value={`${ctx.orderBlock.count} (${ctx.orderBlock.direction})`} />
                  <DataRow label="Liquidity Sweeps" value={ctx.liquidity.sweeps.length} />
                </AnalysisSection>

                <AnalysisSection
                  title={`MTF Alignment (${ai?.mtfAlignmentCount || 0})`}
                  accent="cyan"
                >
                  {ctx.mtfAlignment.length > 0 && (
                    <div className="space-y-0.5">
                      {ctx.mtfAlignment.map((m: { timeframe: string; bias: string }, i: number) => (
                        <div key={i} className="flex justify-between text-[10px]">
                          <span className="text-[#8888aa]">{m.timeframe}</span>
                          <span className={`font-mono ${m.bias === "bullish" ? "text-emerald-400" : m.bias === "bearish" ? "text-rose-400" : "text-[#8888aa]"}`}>
                            {m.bias}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </AnalysisSection>

                {ai && (
                  <>
                    <AnalysisSection title="AI Analysis Summary" accent="violet">
                      <div className="text-[11px] text-[#f0f0f5] leading-relaxed whitespace-pre-wrap">{ai.summary}</div>
                    </AnalysisSection>

                    <AnalysisSection
                      title={`Key Levels (${ai.confluences} confluences)`}
                      accent="amber"
                    >
                      <button onClick={() => toggleSection("levels")} className="flex items-center gap-1 text-[10px] text-[#8888aa] mb-1">
                        {expandedSections.levels ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                      </button>
                      {expandedSections.levels && (
                        <div className="space-y-1">
                          {ai.keyLevels.support.length > 0 && (
                            <div>
                              <div className="text-[9px] text-emerald-400 uppercase">Support</div>
                              {ai.keyLevels.support.map((s: { price: number; strength: string; source: string }, i: number) => (
                                <div key={i} className="text-[10px] text-[#f0f0f5] font-mono">{s.price.toFixed(5)} — {s.strength} ({s.source})</div>
                              ))}
                            </div>
                          )}
                          {ai.keyLevels.resistance.length > 0 && (
                            <div>
                              <div className="text-[9px] text-rose-400 uppercase">Resistance</div>
                              {ai.keyLevels.resistance.map((r: { price: number; strength: string; source: string }, i: number) => (
                                <div key={i} className="text-[10px] text-[#f0f0f5] font-mono">{r.price.toFixed(5)} — {r.strength} ({r.source})</div>
                              ))}
                            </div>
                          )}
                          {ai.keyLevels.liquidity.length > 0 && (
                            <div>
                              <div className="text-[9px] text-cyan-400 uppercase">Liquidity</div>
                              {ai.keyLevels.liquidity.map((l: { price: number; side: string; strength: string }, i: number) => (
                                <div key={i} className="text-[10px] text-[#f0f0f5] font-mono">{l.price.toFixed(5)} — {l.side} ({l.strength})</div>
                              ))}
                            </div>
                          )}
                          {ai.keyLevels.fvg.length > 0 && (
                            <div>
                              <div className="text-[9px] text-purple-400 uppercase">FVG</div>
                              {ai.keyLevels.fvg.map((f: { price: number; direction: string; strength: string }, i: number) => (
                                <div key={i} className="text-[10px] text-[#f0f0f5] font-mono">{f.price.toFixed(5)} — {f.direction}</div>
                              ))}
                            </div>
                          )}
                          {ai.keyLevels.orderBlock.length > 0 && (
                            <div>
                              <div className="text-[9px] text-orange-400 uppercase">Order Blocks</div>
                              {ai.keyLevels.orderBlock.map((o: { price: number; direction: string; strength: string }, i: number) => (
                                <div key={i} className="text-[10px] text-[#f0f0f5] font-mono">{o.price.toFixed(5)} — {o.direction}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </AnalysisSection>

                    <AnalysisSection
                      title="Scenarios"
                      accent="emerald"
                    >
                      <button onClick={() => toggleSection("scenarios")} className="flex items-center gap-1 text-[10px] text-[#8888aa] mb-1">
                        {expandedSections.scenarios ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                      </button>
                      {expandedSections.scenarios && ai.scenarios.length > 0 && (
                        <div className="space-y-1">
                          {ai.scenarios.map((sc: { type: string; description: string; invalidation: string; probability: string }, i: number) => (
                            <div key={i} className="space-y-0.5">
                              <div className="text-[10px] font-medium">
                                <span className={sc.type === "bullish" ? "text-emerald-400" : sc.type === "bearish" ? "text-rose-400" : "text-[#8888aa]"}>
                                  {sc.type.toUpperCase()}
                                </span>
                                {" "}({sc.probability})
                              </div>
                              <div className="text-[10px] text-[#f0f0f5]">{sc.description}</div>
                              <div className="text-[9px] text-[#8888aa]">Invalidation: {sc.invalidation}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </AnalysisSection>

                    <div className="text-[9px] text-[#55556a] italic">
                      {ai.structureConfirmations} structure confirmations | {ai.mtfAlignmentCount} MTF aligned
                    </div>
                  </>
                )}

                {result.error && (
                  <div className="text-[10px] text-amber-400 italic">⚠ {result.error}</div>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          {!result?.error && (
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-violet-500/20 bg-violet-500/5 text-[11px] text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-40"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {loading ? "Analyzing..." : "Re-analyze"}
            </button>
          )}

          <div className="flex items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAskAI(); }
              }}
              placeholder="Ask AI about this chart..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-[#f0f0f5] placeholder:text-[#55556a] outline-none focus:border-violet-500/30"
            />
            <button
              onClick={handleAskAI}
              disabled={!question.trim() || chatLoading}
              className="p-1.5 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 disabled:opacity-30 transition-colors"
            >
              <Send size={14} />
            </button>
          </div>

          {chatLoading && (
            <div className="flex items-center gap-2 py-1">
              <Loader2 size={12} className="animate-spin text-violet-400" />
              <span className="text-[10px] text-[#8888aa]">Thinking...</span>
            </div>
          )}

          {aiReply && (
            <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5">
              <div className="text-[10px] text-violet-400 uppercase tracking-wider mb-1">AI Response</div>
              <div className="text-[11px] text-[#f0f0f5] leading-relaxed whitespace-pre-wrap">{aiReply}</div>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-white/5">
        <button onClick={onBack} className="w-full text-xs text-[#8888aa] hover:text-[#f0f0f5] transition-colors py-1">Back</button>
      </div>
    </div>
  );
}
