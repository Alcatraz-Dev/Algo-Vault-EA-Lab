import React, { useState, useMemo } from "react";
import type { TradingViewContext } from "@/types";

interface RiskViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

export function RiskView({ symbol, context, onBack }: RiskViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const [accountSize, setAccountSize] = useState("10000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [entry, setEntry] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");

  const calc = useMemo(() => {
    const acc = parseFloat(accountSize) || 0;
    const risk = parseFloat(riskPercent) || 0;
    const e = parseFloat(entry) || 0;
    const sl = parseFloat(stopLoss) || 0;
    const tp = parseFloat(takeProfit) || 0;

    const riskAmount = (acc * risk) / 100;
    const stopDistance = Math.abs(e - sl);
    const rewardDistance = Math.abs(tp - e);
    const riskReward = stopDistance > 0 ? rewardDistance / stopDistance : 0;
    const lotSize = stopDistance > 0 ? riskAmount / (stopDistance * 10) : 0;

    return { riskAmount, stopDistance, rewardDistance, riskReward, lotSize };
  }, [accountSize, riskPercent, entry, stopLoss, takeProfit]);

  const inputClass =
    "w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-[#f0f0f5] outline-none focus:border-violet-500/30 font-mono";

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5">
        <span className="text-xs font-medium text-[#f0f0f5]">
          Risk Calculator — {displaySymbol}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
            Account Size ($)
          </label>
          <input
            type="number"
            value={accountSize}
            onChange={(e) => setAccountSize(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
            Risk (%)
          </label>
          <input
            type="number"
            value={riskPercent}
            onChange={(e) => setRiskPercent(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Entry
            </label>
            <input
              type="number"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className={inputClass}
              placeholder="—"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Stop Loss
            </label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className={inputClass}
              placeholder="—"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Take Profit
            </label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className={inputClass}
              placeholder="—"
            />
          </div>
        </div>

        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-2">
          <div className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-2">
            Results
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[#8888aa]">Risk Amount</span>
            <span className="text-[#f0f0f5] font-mono">
              ${calc.riskAmount.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[#8888aa]">Stop Distance</span>
            <span className="text-[#f0f0f5] font-mono">
              {calc.stopDistance.toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[#8888aa]">Reward Distance</span>
            <span className="text-[#f0f0f5] font-mono">
              {calc.rewardDistance.toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[#8888aa]">R:R Ratio</span>
            <span
              className={`font-mono ${
                calc.riskReward >= 1
                  ? "text-emerald-400"
                  : calc.riskReward > 0
                  ? "text-rose-400"
                  : "text-[#8888aa]"
              }`}
            >
              {calc.riskReward > 0 ? calc.riskReward.toFixed(2) : "—"}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[#8888aa]">Lot Size (100k=1.0)</span>
            <span className="text-[#f0f0f5] font-mono">
              {calc.lotSize > 0 ? calc.lotSize.toFixed(2) : "—"}
            </span>
          </div>
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
