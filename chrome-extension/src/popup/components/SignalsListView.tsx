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
  ACTIVE: "bg-positive/20 text-positive border-positive/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-negative/20 text-negative border-negative/30",
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
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">AI Signals</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground">Loading signals...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-12">
            <AlertCircle size={20} className="text-negative" />
            <p className="text-[11px] text-negative">{error}</p>
          </div>
        )}

        {!loading && !error && signals.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[11px] text-muted-foreground">No signals found</p>
          </div>
        )}

        <div className="space-y-2">
          {signals.map((signal) => (
            <div
              key={signal.id}
              className="rounded-lg border border-border bg-card p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-numeric text-foreground">
                    {signal.symbol}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      signal.direction === "BUY"
                        ? "border-positive/30 bg-positive/10 text-positive"
                        : "border-negative/30 bg-negative/10 text-negative"
                    }`}
                  >
                    {signal.direction}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
                    statusColors[signal.status] || statusColors.ACTIVE
                  }`}
                >
                  {signal.status}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1 text-[10px]">
                <div>
                  <span className="text-muted-foreground block">Entry</span>
                  <span className="text-foreground font-numeric">
                    {signal.entry}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">SL</span>
                  <span className="text-negative font-numeric">
                    {signal.stopLoss}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">TP1</span>
                  <span className="text-positive font-numeric">
                    {signal.takeProfit1}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Conf.</span>
                  <span className="text-foreground font-numeric">
                    {signal.confidence}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {timeAgo(signal.createdAt)}
                </span>
                {signal.status === "ACTIVE" && (
                  <button
                    onClick={() => handleExecute(signal)}
                    disabled={executingId === signal.id}
                    className="flex items-center gap-1 text-[10px] text-brand-foreground hover:text-brand-foreground disabled:opacity-50 transition-colors"
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

      <div className="flex items-center border-t border-border px-3 py-2">
        <BackButton onClick={onBack} />
      </div>
    </div>
  );
}
