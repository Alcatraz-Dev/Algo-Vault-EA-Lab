import React, { useState } from "react";
import { X, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { placeOrder } from "@/api/algovault";
import type { TradingViewContext } from "@/types";

interface ExecuteViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

export function ExecuteView({ symbol, context, onBack }: ExecuteViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [entry, setEntry] = useState(context?.price?.toString() || "");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [riskPercent, setRiskPercent] = useState("1");
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const handlePreview = () => {
    if (!entry || !sl) return;
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
        await placeOrder({
        accountId: "default",
        symbol: displaySymbol || "",
        action: direction,
        volume: 0.01,
        price: parseFloat(entry) || undefined,
        sl: parseFloat(sl) || undefined,
        tp: parseFloat(tp) || undefined,
        clientOrderId: `ext_${Date.now()}`,
      });
      setFeedback({ type: "success", msg: "Order sent to Gateway" });
      setShowConfirm(false);
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Order failed",
      });
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-[#f0f0f5] outline-none focus:border-violet-500/30 font-mono";

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5">
        <span className="text-xs font-medium text-[#f0f0f5]">
          Execute Order — {displaySymbol}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
            Direction
          </label>
          <div className="flex gap-2">
            {(["BUY", "SELL"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`flex-1 py-2 rounded text-[11px] font-semibold transition-all ${
                  direction === d
                    ? d === "BUY"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    : "bg-white/5 text-[#8888aa] border border-white/5 hover:bg-white/10"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
            Symbol
          </label>
          <input disabled value={displaySymbol || ""} className={`${inputClass} opacity-60`} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Entry
            </label>
            <input
              type="number"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Risk %
            </label>
            <input
              type="number"
              value={riskPercent}
              onChange={(e) => setRiskPercent(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Stop Loss
            </label>
            <input
              type="number"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Take Profit
            </label>
            <input
              type="number"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {feedback && (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] ${
              feedback.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle size={14} />
            ) : (
              <AlertCircle size={14} />
            )}
            {feedback.msg}
          </div>
        )}

        <button
          onClick={handlePreview}
          disabled={!entry || !sl}
          className="w-full py-2 rounded-lg bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 disabled:opacity-30 transition-all"
        >
          Preview Order
        </button>
      </div>

      <div className="px-3 py-2 border-t border-white/5">
        <button
          onClick={onBack}
          className="w-full text-xs text-[#8888aa] hover:text-[#f0f0f5] transition-colors py-1"
        >
          Back
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#12121a] border border-white/10 rounded-lg w-full max-w-[320px] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#f0f0f5]">
                ⚠ Review Order
              </span>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-[#8888aa] hover:text-[#f0f0f5]"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-[#8888aa]">Direction</span>
                <span
                  className={
                    direction === "BUY" ? "text-emerald-400" : "text-rose-400"
                  }
                >
                  {direction}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8888aa]">Symbol</span>
                <span className="text-[#f0f0f5]">{displaySymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8888aa]">Entry</span>
                <span className="text-[#f0f0f5] font-mono">{entry}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8888aa]">Stop Loss</span>
                <span className="text-rose-400 font-mono">{sl}</span>
              </div>
              {tp && (
                <div className="flex justify-between">
                  <span className="text-[#8888aa]">Take Profit</span>
                  <span className="text-emerald-400 font-mono">{tp}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#8888aa]">Risk</span>
                <span className="text-[#f0f0f5]">{riskPercent}%</span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-1.5 rounded text-[11px] text-[#8888aa] bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 py-1.5 rounded text-[11px] font-medium bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : null}
                {loading ? "Sending..." : "Confirm Execution"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
