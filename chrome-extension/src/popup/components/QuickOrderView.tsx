import React, { useState, useMemo } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import { placeOrder } from "@/api/algovault";
import type { TradingViewContext } from "@/types";

interface QuickOrderViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

export function QuickOrderView({ symbol, context, onBack }: QuickOrderViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [entry, setEntry] = useState(context?.price?.toString() || "");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [riskPercent, setRiskPercent] = useState("1");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const calc = useMemo(() => {
    const e = parseFloat(entry) || 0;
    const stopLoss = parseFloat(sl) || 0;
    const takeProfit = parseFloat(tp) || 0;
    const stopDistance = Math.abs(e - stopLoss);
    const rewardDistance = Math.abs(takeProfit - e);
    const riskReward = stopDistance > 0 ? rewardDistance / stopDistance : 0;
    return { stopDistance, rewardDistance, riskReward };
  }, [entry, sl, tp]);

  const handlePreview = () => {
    if (!entry || !sl) return;
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
        clientOrderId: `qo_${Date.now()}`,
      });
      setFeedback({ type: "success", msg: "Order sent to Gateway" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Order failed",
      });
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
          Quick Order — {displaySymbol}
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
                className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-all ${
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
            Stop Loss
            </label>
            <input
              type="number"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              className={inputClass}
            />
          </div>
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
            placeholder="Optional"
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

        {calc.stopDistance > 0 && (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-1.5">
            <div className="text-[10px] text-[#8888aa] uppercase tracking-wider">Preview</div>
            <div className="flex justify-between text-[11px]">
              <span className="text-[#8888aa]">Stop Distance</span>
              <span className="text-[#f0f0f5] font-mono">{calc.stopDistance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-[#8888aa]">R:R Ratio</span>
              <span className={calc.riskReward >= 1 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>
                {calc.riskReward.toFixed(2)}R
              </span>
            </div>
          </div>
        )}

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

        <div className="flex gap-2">
          <button
            onClick={handlePreview}
            disabled={!entry || !sl}
            className="flex-1 py-2 rounded-lg bg-white/5 text-[11px] font-medium text-[#f0f0f5] hover:bg-white/10 disabled:opacity-30 transition-all"
          >
            Preview
          </button>
          <button
            onClick={handleConfirm}
            disabled={!entry || !sl || loading}
            className="flex-1 py-2 rounded-lg bg-violet-500 text-white text-[11px] font-medium hover:bg-violet-600 disabled:opacity-30 transition-all"
          >
            {loading ? "Sending..." : "Confirm"}
          </button>
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
