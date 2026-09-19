import React, { useState } from "react";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { createSignal } from "@/api/algovault";
import type { TradingViewContext } from "@/types";

interface SignalViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

export function SignalView({ symbol, context, onBack }: SignalViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [entry, setEntry] = useState(context?.price?.toString() || "");
  const [sl, setSl] = useState("");
  const [tp1, setTp1] = useState("");
  const [tp2, setTp2] = useState("");
  const [tp3, setTp3] = useState("");
  const [timeframe, setTimeframe] = useState(context?.timeframe || "H1");
  const [style, setStyle] = useState("scalp");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      await createSignal({
        symbol: displaySymbol || "",
        direction,
        entry,
        stopLoss: parseFloat(sl) || 0,
        takeProfit1: parseFloat(tp1) || 0,
        takeProfit2: parseFloat(tp2) || 0,
        takeProfit3: parseFloat(tp3) || 0,
        timeframe,
        style,
        notes,
      });
      setFeedback({ type: "success", msg: "Signal created successfully" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Failed to create signal",
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
          Create Signal — {displaySymbol}
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
            Entry
          </label>
          <input
            type="number"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            className={inputClass}
          />
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
              Timeframe
            </label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className={inputClass}
            >
              {["M1", "M5", "M15", "M30", "H1", "H4", "D1"].map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              TP1
            </label>
            <input
              type="number"
              value={tp1}
              onChange={(e) => setTp1(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              TP2
            </label>
            <input
              type="number"
              value={tp2}
              onChange={(e) => setTp2(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              TP3
            </label>
            <input
              type="number"
              value={tp3}
              onChange={(e) => setTp3(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
            Style
          </label>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className={inputClass}
          >
            {["scalp", "intraday", "swing", "position"].map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
            placeholder="Optional notes..."
          />
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
          onClick={handleSubmit}
          disabled={loading || !entry || !sl}
          className="w-full py-2 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-30 transition-all flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          {loading ? "Creating..." : "Create Signal"}
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
    </div>
  );
}
