import React, { useState, useEffect } from "react";
import { Loader2, Play, AlertCircle } from "lucide-react";
import { getAISignals, executeAISignal } from "@/api/algovault";
import type { AISignal } from "@/types";
import { timeAgo } from "@/utils/helpers";
import { BackButton } from "./ui";

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
      <div className="px-3 py-2 border-b border-edge">
        <span className="text-xs font-medium text-ink">AI Signals</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 size={20} className="animate-spin text-brand-400" />
            <p className="text-[11px] text-ink-mute">Loading signals...</p>
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
            <p className="text-[11px] text-ink-mute">No signals found</p>
          </div>
        )}

        <div className="space-y-2">
          {signals.map((signal) => (
            <div
              key={signal.id}
              className="rounded-lg border border-edge bg-white/[0.02] p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-ink">
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
                  <span className="text-ink-mute block">Entry</span>
                  <span className="text-ink font-mono">
                    {signal.entry}
                  </span>
                </div>
                <div>
                  <span className="text-ink-mute block">SL</span>
                  <span className="text-rose-400 font-mono">
                    {signal.stopLoss}
                  </span>
                </div>
                <div>
                  <span className="text-ink-mute block">TP1</span>
                  <span className="text-emerald-400 font-mono">
                    {signal.takeProfit1}
                  </span>
                </div>
                <div>
                  <span className="text-ink-mute block">Conf.</span>
                  <span className="text-ink font-mono">
                    {signal.confidence}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[9px] text-ink-mute">
                  {timeAgo(signal.createdAt)}
                </span>
                {signal.status === "ACTIVE" && (
                  <button
                    onClick={() => handleExecute(signal)}
                    disabled={executingId === signal.id}
                    className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 disabled:opacity-50 transition-colors"
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

      <div className="flex items-center border-t border-edge bg-card/60 px-3 py-2">
        <BackButton onClick={onBack} />
      </div>
    </div>
  );
}
