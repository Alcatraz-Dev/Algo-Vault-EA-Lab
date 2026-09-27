/**
 * Research view — cached AI research notes per symbol.
 *
 * Two depths (quick snapshot / deep dive), cached per symbol so switching
 * charts is instant. Regenerating busts the cache entry.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Clock, FileSearch, FileText } from "lucide-react";
import { generateResearch, getCachedResearch } from "@/services/research-service";
import type { ResearchNote, ResearchKind } from "@/types/copilot";
import { Markdown } from "@/popup/components/Markdown";
import type { EnrichedChartContext } from "@/services/chart-intelligence";

interface ResearchViewProps {
  symbol: string;
  timeframe: string;
  structuredContextKey: string;
}

const QUICK_TTL_MS = 30 * 60 * 1000;
const DEEP_TTL_MS = 6 * 60 * 60 * 1000;

function age(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ResearchView({ symbol, timeframe, structuredContextKey }: ResearchViewProps) {
  const [kind, setKind] = useState<ResearchKind>("quick");
  const [note, setNote] = useState<ResearchNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [structuredContext, setStructuredContext] = useState<string | null>(null);

  /* pull canonical structured context */
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (resp) => {
      if (resp?.structuredContext) setStructuredContext(resp.structuredContext as string);
    });
  }, [structuredContextKey]);

  /* load cached note on symbol/kind change */
  const loadCached = useCallback(async () => {
    const cached = await getCachedResearch(symbol, kind);
    setNote(cached);
  }, [symbol, kind]);

  useEffect(() => { loadCached(); }, [loadCached]);

  const generate = async (force: boolean) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const fresh = await generateResearch({
        symbol,
        timeframe,
        kind,
        structuredContext,
        force,
      });
      setNote(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research generation failed");
    } finally {
      setLoading(false);
    }
  };

  /* auto-generate the quick note when nothing is cached */
  useEffect(() => {
    if (kind === "quick" && !note && !loading && !error) {
      generate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, kind, note]);

  const stale = note ? Date.now() - note.generatedAt > (kind === "quick" ? QUICK_TTL_MS : DEEP_TTL_MS) : false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-1.5">
        <button
          onClick={() => setKind("quick")}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${kind === "quick" ? "bg-brand-500/20 text-brand-400" : "text-ink-mute hover:text-ink"}`}
        >
          <FileSearch size={11} /> Snapshot
        </button>
        <button
          onClick={() => setKind("deep")}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${kind === "deep" ? "bg-brand-500/20 text-brand-400" : "text-ink-mute hover:text-ink"}`}
        >
          <FileText size={11} /> Deep dive
        </button>
        <span className="ml-auto flex items-center gap-1 text-[9px] text-ink-faint">
          {note && <><Clock size={9} /> {age(Date.now() - note.generatedAt)}</>}
        </span>
        <button
          onClick={() => generate(true)}
          disabled={loading}
          className="rounded p-1 text-ink-mute hover:text-ink disabled:opacity-40"
          title="Regenerate"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && !note && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Loader2 size={18} className="animate-spin text-brand-400" />
            <p className="text-[11px] text-ink-mute">
              Researching {symbol} — {kind === "quick" ? "snapshot" : "deep dive"}…
            </p>
            <p className="text-[9px] text-ink-faint">Technical data comes live from your chart; wider context is general knowledge.</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] text-rose-300">
            {error}
          </div>
        )}

        {note && !loading && (
          <div className="animate-fade-in">
            <Markdown content={note.content} />
          </div>
        )}

        {stale && note && (
          <p className="mt-2 text-center text-[9px] text-amber-400/80">Cached report — hit refresh for the latest.</p>
        )}
      </div>
    </div>
  );
}
