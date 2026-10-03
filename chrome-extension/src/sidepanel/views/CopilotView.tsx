/**
 * Copilot chat view for the side panel.
 *
 * Features beyond a plain chat:
 *   - per-symbol threads (memory persists per chart identity),
 *   - persona + model pickers (wired to copilot prefs),
 *   - one-tap chart actions: "Mark up chart" parses a ```drawings JSON block
 *     from the AI reply and renders it via the smart-drawings content script;
 *     "Switch to…" commands drive the chart via the chart-commands script,
 *   - live chart context status badge.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Send, Loader2, Eraser, Palette, Bot, ChevronDown, Sparkles, Brain, Info } from "lucide-react";
import {
  askCopilot, loadThread, clearThread, listRecentThreads, personaById,
} from "@/services/copilot-engine";
import { getCopilotPrefs, saveCopilotPrefs } from "@/storage/storage";
import type { CopilotMessage, CopilotThread, PersonaId, SmartDrawingSet } from "@/types/copilot";
import { PERSONAS } from "@/types/copilot";
import { Markdown } from "@/popup/components/Markdown";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { fetchCopilotMemory } from "@/api/pro";
import type { CopilotMemoryContext } from "@/types/pro";

interface CopilotViewProps {
  symbol: string;
  timeframe: string;
  enriched: EnrichedChartContext | null;
  /** Changes whenever the chart identity or manual refresh changes. */
  structuredContextKey: string;
  initialPrompt?: string | null;
  onPromptConsumed?: () => void;
}

interface UiMessage extends CopilotMessage {
  pending?: boolean;
}

const QUICK_PROMPTS = [
  "Give me the full read of this chart right now.",
  "Where are the key levels and what triggers a long or short?",
  "Mark the key levels on my chart.",
  "What is the highest-probability trade plan here?",
];

/* ── drawings protocol ──────────────────────────────────────────────── */

function parseDrawingsBlock(answer: string): { from: number | null; to: number | null; drawings: SmartDrawingSet["drawings"] } | null {
  const match = answer.match(/```drawings\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as SmartDrawingSet;
    if (!Array.isArray(parsed.drawings)) return null;
    return {
      from: parsed.from ?? null,
      to: parsed.to ?? null,
      drawings: parsed.drawings.filter((d) => d && typeof d.label === "string"),
    };
  } catch {
    return null;
  }
}

function stripDrawingsBlock(answer: string): string {
  return answer.replace(/```drawings\s*\n[\s\S]*?```/, "").trim();
}

export function CopilotView({ symbol, timeframe, enriched, structuredContextKey, initialPrompt, onPromptConsumed }: CopilotViewProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [structuredContext, setStructuredContext] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState<PersonaId>("analyst");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [recentThreads, setRecentThreads] = useState<CopilotThread[]>([]);
  const [drawnNotice, setDrawnNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      send(initialPrompt);
      if (onPromptConsumed) onPromptConsumed();
    }
  }, [initialPrompt]);

  const persona = personaById(personaId);

  const [algoVaultMemory, setAlgoVaultMemory] = useState<CopilotMemoryContext | null>(null);
  const [showMemoryDetails, setShowMemoryDetails] = useState(false);

  /* load prefs + thread + AlgoVault memory on chart identity change */
  useEffect(() => {
    let alive = true;
    (async () => {
      const prefs = await getCopilotPrefs();
      if (!alive) return;
      setPersonaId(prefs.personaId);
      setPrefsLoaded(true);
      const thread = await loadThread(symbol, timeframe);
      if (!alive) return;
      setMessages(thread?.messages ?? []);
      setRecentThreads(await listRecentThreads());

      fetchCopilotMemory(symbol, timeframe)
        .then((mem) => {
          if (alive) setAlgoVaultMemory(mem);
        })
        .catch(() => {});
    })();
    return () => { alive = false; };
  }, [symbol, timeframe]);

  /* fetch canonical structured context whenever identity/key changes */
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (resp) => {
      if (resp?.structuredContext) setStructuredContext(resp.structuredContext as string);
      if (resp?.enriched) setEnrichedContextHelper(resp.enriched as EnrichedChartContext);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuredContextKey]);

  const [enrichedState, setEnrichedContextHelper] = useState<EnrichedChartContext | null>(enriched);
  useEffect(() => { setEnrichedContextHelper(enriched); }, [enriched]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const runChartCommand = useCallback((command: string, payload: Record<string, unknown>) => {
    chrome.runtime.sendMessage({ type: "RUN_CHART_COMMAND", payload: { command, ...payload } });
  }, []);

  /* The SW relays chart commands to TradingView tabs; results come back as
   * an asynchronous broadcast — listen and surface them. */
  useEffect(() => {
    const listener = (message: { type: string; payload?: { ok?: boolean; message?: string } }) => {
      if (message.type !== "CHART_COMMAND_RESULT" || !message.payload) return;
      setDrawnNotice(message.payload.message ?? (message.payload.ok ? "Done" : "Command failed"));
      setTimeout(() => setDrawnNotice(null), 4500);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const renderDrawings = useCallback((set: { from: number | null; to: number | null; drawings: SmartDrawingSet["drawings"] }) => {
    const payload: SmartDrawingSet = {
      id: `sd-${symbol}-${timeframe}-${Date.now()}`,
      symbol,
      timeframe,
      from: set.from,
      to: set.to,
      drawings: set.drawings,
      createdAt: Date.now(),
    };
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) return;
      chrome.tabs.sendMessage(tabId, { type: "SET_SMART_DRAWINGS", payload }, () => void chrome.runtime.lastError);
    });
    setDrawnNotice(`${set.drawings.length} level(s) drawn on chart`);
    setTimeout(() => setDrawnNotice(null), 4000);
  }, [symbol, timeframe]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;

    const userMsg: UiMessage = { id: `u${Date.now()}`, role: "user", content: text, at: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // When the user asks for markup, append drawing instructions to the prompt.
    const wantsMarkup = /mark|draw|levels? on (my |the )?chart|annotate/i.test(text);
    const markupBlock = wantsMarkup
      ? `\n\nIf the user asks you to mark or draw on the chart, FIRST reply with the analysis, then append ONE fenced block:\n\`\`\`drawings\n{"from":null,"to":null,"drawings":[{"kind":"hline","label":"Resistance","tone":"resistance","price":1234.5},{"kind":"hzone","label":"Demand","tone":"support","price":1200,"price2":1190},{"kind":"label","label":"Bias: Long","tone":"info","price":1210,"x":0.05}]}\n\`\`\`\nUse ONLY prices that exist in the chart context. tone ∈ support|resistance|entry|stop|target|info. Keep it under 8 drawings.`
      : "";

    try {
      const result = await askCopilot({
        symbol,
        timeframe,
        structuredContext,
        contextObject: enrichedState ?? undefined,
        algoVaultMemory,
        question: text + markupBlock,
      });

      const drawings = parseDrawingsBlock(result.answer);
      const clean = drawings ? stripDrawingsBlock(result.answer) : result.answer;

      setMessages((prev) => [
        ...prev,
        { id: `a${Date.now()}`, role: "assistant", content: clean, at: Date.now(), model: result.model, personaId },
      ]);
      if (drawings) renderDrawings(drawings);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e${Date.now()}`,
          role: "assistant",
          content: `Failed to get a response. ${err instanceof Error ? err.message : "Please try again."}`,
          at: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = async () => {
    await clearThread(symbol, timeframe);
    setMessages([]);
    setRecentThreads(await listRecentThreads());
  };

  const openThread = async (t: CopilotThread) => {
    setShowThreads(false);
    if (t.symbol === symbol && t.timeframe === timeframe) {
      setMessages(t.messages);
    } else {
      // Different identity: jump the chart there via the command engine.
      runChartCommand("set_symbol", { symbol: `${t.symbol}` });
    }
  };

  const contextState = useMemo(() => {
    if (enrichedState?.market?.status === "ready") return { label: "Live context", cls: "text-emerald-400" };
    if (enrichedState || structuredContext) return { label: "Partial context", cls: "text-amber-400" };
    return { label: "No market data", cls: "text-rose-400" };
  }, [enrichedState, structuredContext]);

  if (!prefsLoaded) {
    return <div className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-brand-400" /></div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar: persona / threads / clear */}
      <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-1.5">
        <PersonaPicker value={personaId} onChange={(id) => { setPersonaId(id); saveCopilotPrefs({ personaId: id }); }} />
        <button
          onClick={() => setShowThreads((v) => !v)}
          className="ml-auto rounded p-1 text-ink-mute hover:text-ink"
          title="Recent threads"
        >
          <Bot size={13} />
        </button>
        <button onClick={clearChat} className="rounded p-1 text-ink-mute hover:text-rose-400" title={`Clear ${symbol} thread`}>
          <Eraser size={13} />
        </button>
      </div>

      {showThreads && (
        <div className="max-h-40 overflow-y-auto border-b border-edge bg-raised/60 animate-fade-in">
          {recentThreads.length === 0 && <p className="px-3 py-2 text-[10px] text-ink-faint">No threads yet.</p>}
          {recentThreads.map((t) => (
            <button
              key={t.id}
              onClick={() => openThread(t)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] hover:bg-white/5 ${t.key === `${symbol}|${timeframe}` ? "text-brand-400" : "text-ink-mute"}`}
            >
              <span className="font-mono">{t.title}</span>
              <span className="text-ink-faint">{t.messages.length} msgs</span>
            </button>
          ))}
        </div>
      )}

      {/* AlgoVault intelligence memory banner */}
      {algoVaultMemory && (
        <div className="border-b border-edge/60 bg-raised/40 px-2.5 py-1.5 text-[10px]">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowMemoryDetails((v) => !v)}
              className="flex items-center gap-1.5 font-medium text-brand-300 hover:text-brand-200 transition-colors"
            >
              <Brain size={12} className="text-brand-400" />
              <span>AlgoVault Memory Active</span>
              <span className="text-[9px] text-ink-faint">
                ({algoVaultMemory.savedStrategiesCount} strats · {algoVaultMemory.activeSetupsCount} setups · {algoVaultMemory.recentAnalysesCount} research)
              </span>
              <ChevronDown size={10} className={`transform transition-transform ${showMemoryDetails ? "rotate-180" : ""}`} />
            </button>
          </div>
          {showMemoryDetails && (
            <div className="mt-2 space-y-2 border-t border-edge/40 pt-2 animate-fade-in text-[10px]">
              {algoVaultMemory.similarSavedStrategies && algoVaultMemory.similarSavedStrategies.length > 0 && (
                <div>
                  <span className="font-semibold text-ink">Similar Saved Strategies:</span>
                  <div className="mt-1 space-y-1">
                    {algoVaultMemory.similarSavedStrategies.map((s, idx) => (
                      <div key={idx} className="rounded bg-white/5 p-1.5">
                        <span className="font-medium text-brand-300">{s.name}</span>
                        {s.reasons && s.reasons.length > 0 && (
                          <ul className="mt-0.5 list-disc pl-3 text-[9px] text-ink-mute">
                            {s.reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {algoVaultMemory.similarHistoricalResearch && algoVaultMemory.similarHistoricalResearch.length > 0 && (
                <div>
                  <span className="font-semibold text-ink">Historical Research Evidence:</span>
                  <div className="mt-1 space-y-1">
                    {algoVaultMemory.similarHistoricalResearch.map((r, idx) => (
                      <div key={idx} className="rounded bg-white/5 p-1.5 text-[9px]">
                        <span className="font-medium text-ink">{r.title}</span>
                        <p className="text-ink-mute">{r.outcome}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {algoVaultMemory.recentDismissedSetups && algoVaultMemory.recentDismissedSetups.length > 0 && (
                <div className="text-[9px] text-ink-faint">
                  <span>Recent invalidations: </span>
                  {algoVaultMemory.recentDismissedSetups.map((d) => d.setupType).join(", ")}
                </div>
              )}
              <p className="text-[8px] italic text-ink-faint">
                Memory connects your AlgoVault workspace context to TradingView. Past pattern similarity does not guarantee future results.
              </p>
            </div>
          )}
        </div>
      )}

      {/* messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="pt-2">
            <div className="mb-3 rounded-lg border border-edge bg-card p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                <persona.Icon size={12} className="text-brand-400" /> {persona.name} mode
              </p>
              <p className="mt-0.5 text-[10px] text-ink-mute">{persona.description}</p>
              <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">
                Chart: <span className="font-mono text-ink-mute">{symbol} · {timeframe}</span> —{" "}
                <span className={contextState.cls}>{contextState.label}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="w-full rounded-lg border border-edge bg-white/[0.02] px-3 py-2 text-left text-[11px] text-ink-mute transition-colors hover:border-brand-500/30 hover:bg-brand-500/10 hover:text-brand-300"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[92%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
                m.role === "user" ? "bg-brand-500/20 text-brand-100" : "bg-white/5 text-ink"
              }`}
            >
              {m.role === "assistant" ? <Markdown content={m.content} /> : m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
              <Loader2 size={12} className="animate-spin text-brand-400" />
              <span className="text-[11px] text-ink-mute">{persona.name} is thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* status / notice strip */}
      {drawnNotice && (
        <div className="flex items-center gap-1.5 border-t border-edge bg-brand-500/10 px-3 py-1.5 text-[10px] text-brand-300 animate-fade-in">
          <Palette size={11} /> {drawnNotice}
        </div>
      )}

      {/* composer */}
      <div className="border-t border-edge p-2.5">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            placeholder={`Ask about ${symbol}…`}
            rows={2}
            className="max-h-28 flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-brand-500/60"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="rounded-lg bg-brand-500/20 p-2 text-brand-400 transition-colors hover:bg-brand-500/30 disabled:opacity-30"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── pickers ────────────────────────────────────────────────────────── */

function PersonaPicker({ value, onChange }: { value: PersonaId; onChange: (id: PersonaId) => void }) {
  const [open, setOpen] = useState(false);
  const active = PERSONAS.find((p) => p.id === value) ?? PERSONAS[0];
  const ActiveIcon = active.Icon;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-edge bg-raised px-2 py-1 text-[10px] font-semibold text-ink hover:border-brand-500/40"
      >
        <ActiveIcon size={11} className="text-brand-400" /> {active.name}
        <ChevronDown size={10} className="text-ink-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-edge bg-card shadow-xl animate-fade-in">
            {PERSONAS.map((p) => {
              const PIcon = p.Icon;
              return (
                <button
                  key={p.id}
                  onClick={() => { onChange(p.id); setOpen(false); }}
                  className={`block w-full px-3 py-2 text-left hover:bg-white/5 ${p.id === value ? "text-brand-400" : "text-ink-mute"}`}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold"><PIcon size={11} /> {p.name}</span>
                  <span className="block text-[9px] text-ink-faint">{p.description}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

