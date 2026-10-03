import React, { useEffect, useState } from "react";
import { fetchMTFIntelligence } from "@/api/pro";
import type { MTFResponse, MTFRow } from "@/types/pro";
import { RefreshCwIcon, AlertTriangleIcon, LayersIcon } from "lucide-react";

interface ProMTFViewProps {
  symbol: string;
  timeframe: string;
}

export const ProMTFView: React.FC<ProMTFViewProps> = ({ symbol, timeframe }) => {
  const [data, setData] = useState<MTFResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadMTF = async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMTFIntelligence(symbol, timeframe || "1H");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MTF data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMTF();
  }, [symbol, timeframe]);

  const getStateBadge = (state: MTFRow["state"]) => {
    switch (state) {
      case "BULLISH":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "BEARISH":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      case "RANGE":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "TRANSITION":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      default:
        return "bg-base/60 text-ink-mute border-edge";
    }
  };

  return (
    <div className="flex flex-col h-full bg-base text-ink text-xs p-3 space-y-3 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge/60 pb-2">
        <div className="flex items-center space-x-2">
          <LayersIcon className="w-4 h-4 text-brand-400" />
          <span className="font-semibold text-sm tracking-wide">MTF Intelligence</span>
          <span className="bg-raised border border-edge rounded px-1.5 py-0.5 text-[10px] text-ink-mute font-mono">
            {symbol || "NO SYMBOL"}
          </span>
        </div>
        <button
          onClick={loadMTF}
          disabled={loading}
          className="p-1 text-ink-mute hover:text-ink hover:bg-raised rounded transition-colors disabled:opacity-50"
          title="Refresh MTF matrix"
        >
          <RefreshCwIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded flex items-center space-x-2">
          <AlertTriangleIcon className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-12 space-y-2 text-ink-mute">
          <RefreshCwIcon className="w-5 h-5 animate-spin text-brand-400" />
          <span>Analyzing multi-timeframe alignment...</span>
        </div>
      )}

      {data && (
        <div className="space-y-2.5">
          <div className="text-[11px] text-ink-mute flex justify-between items-center">
            <span>Base TF: <strong className="text-ink">{data.baseTimeframe}</strong></span>
            <span>Refreshed: {new Date(data.fetchedAt).toLocaleTimeString()}</span>
          </div>

          <div className="space-y-2">
            {data.rows.map((row) => {
              const isBase = row.timeframe === data.baseTimeframe;
              return (
                <div
                  key={row.timeframe}
                  className={`p-2.5 rounded-lg border transition-all ${
                    isBase
                      ? "bg-brand-500/5 border-brand-500/30 shadow-sm"
                      : "bg-card border-edge hover:border-edge/80"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-sm text-ink">{row.timeframe}</span>
                      <span className="text-[10px] uppercase tracking-wider text-ink-mute bg-raised px-1.5 py-0.5 rounded border border-edge/60">
                        {row.role}
                      </span>
                      {isBase && (
                        <span className="text-[9px] bg-brand-500/20 text-brand-400 font-semibold px-1 rounded">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getStateBadge(
                        row.state
                      )}`}
                    >
                      {row.state}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 text-[11px] py-1 border-t border-edge/40">
                    <div>
                      <span className="text-ink-mute block text-[9px] uppercase">Structure</span>
                      <span className="font-medium">{row.structure || "—"}</span>
                    </div>
                    <div>
                      <span className="text-ink-mute block text-[9px] uppercase">Momentum</span>
                      <span className="font-medium">{row.momentum || "—"}</span>
                    </div>
                    <div>
                      <span className="text-ink-mute block text-[9px] uppercase">Setup</span>
                      <span className="font-medium">{row.setup || "—"}</span>
                    </div>
                  </div>

                  {row.conflicts && row.conflicts.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-edge/30 text-[10px] text-amber-400/90 flex items-start space-x-1">
                      <AlertTriangleIcon className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                      <span>{row.conflicts.join(", ")}</span>
                    </div>
                  )}

                  {row.notes && row.notes.length > 0 && (
                    <div className="mt-1 text-[10px] text-ink-mute italic">
                      {row.notes.join(" • ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
