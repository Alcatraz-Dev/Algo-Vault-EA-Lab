import React, { useState, useEffect } from "react";
import { Loader2, Play, AlertCircle } from "lucide-react";
import { getAISignals, executeAISignal } from "@/api/algovault";
import type { AISignal } from "@/types";
import { timeAgo } from "@/utils/helpers";

interface SignalsListViewProps {
  onBack: () => void;
}

const statusColors: Record<string, string> = {
  ACTIVE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  CLOSED: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
  CANCELLED: "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

export function SignalsListView({ onBack }: SignalsListViewProps) {
  const [signals, setSignals] = useState<AISignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAISignals();
        setSignals(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load signals");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleExecute = async (signal: AISignal) => {
    if (executingId === signal.id) return;
    setExecutingId(signal.id);
    setError(null);
    try {
      const result = await executeAISignal(signal.id);
      setSignals((prev) =>
        prev.map((s) =>
          s.id === signal.id
            ? { ...s, status: result.status === "EXECUTED" ? "EXECUTED" : s.status }
            : s
        )
      );
      if (result.status !== "EXECUTED") {
        setError(`Execution ${result.status}: ${result.status === "REJECTED" ? "Risk limit exceeded" : "Not accepted"}`);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Execution failed: ${err.message}`
          : "Execution failed: Unable to reach AlgoVault"
      );
    } finally {
      setExecutingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5">
        <span className="text-xs font-medium text-[#f0f0f5]">AI Signals</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 size={20} className="animate-spin text-violet-400" />
            <p className="text-[11px] text-[#8888aa]">Loading signals...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-12">
            <AlertCircle size={20} className="text-rose-400" />
            <p className="text-[11px] text-rose-400">{error}</p>
          </div>
        )}

        {!loading && !error && signals.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[11px] text-[#8888aa]">No signals found</p>
          </div>
        )}

        <div className="space-y-2">
          {signals.map((signal) => (
            <div
              key={signal.id}
              className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#f0f0f5]">
                    {signal.symbol}
                  </span>
                  <span
                    className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                      signal.direction === "BUY"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-rose-500/20 text-rose-400"
                    }`}
                  >
                    {signal.direction}
                  </span>
                </div>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    statusColors[signal.status] || statusColors.ACTIVE
                  }`}
                >
                  {signal.status}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1 text-[10px]">
                <div>
                  <span className="text-[#8888aa] block">Entry</span>
                  <span className="text-[#f0f0f5] font-mono">
                    {signal.entry}
                  </span>
                </div>
                <div>
                  <span className="text-[#8888aa] block">SL</span>
                  <span className="text-rose-400 font-mono">
                    {signal.stopLoss}
                  </span>
                </div>
                <div>
                  <span className="text-[#8888aa] block">TP1</span>
                  <span className="text-emerald-400 font-mono">
                    {signal.takeProfit1}
                  </span>
                </div>
                <div>
                  <span className="text-[#8888aa] block">Conf.</span>
                  <span className="text-[#f0f0f5] font-mono">
                    {signal.confidence}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[#8888aa]">
                  {timeAgo(signal.createdAt)}
                </span>
                {signal.status === "ACTIVE" && (
                  <button
                    onClick={() => handleExecute(signal)}
                    disabled={executingId === signal.id}
                    className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 disabled:opacity-50 transition-colors"
                  >
                    {executingId === signal.id ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Play size={10} />
                    )}
                    Execute
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-white/5">
        <button
          onClick={onBack}
          className="w-full text-xs text-[#8888aa] hover:text-[#f0f0f5] transition-colors py-1"
        >
          Back
        </button>
      </div>
    </div>
  );
}
