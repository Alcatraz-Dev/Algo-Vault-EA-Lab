import React from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle, Scale, DollarSign } from "lucide-react";
import { RiskCheckResult } from "@/types/execution";

interface Props {
  riskResult: RiskCheckResult;
}

export const ProRiskGuardPanel: React.FC<Props> = ({ riskResult }) => {
  const passed = !riskResult.brokerRestrictions.includes("RISK_EXCEEDED_MAX_THRESHOLD");

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-2.5 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
          {passed ? (
            <ShieldCheck size={14} className="text-emerald-400" />
          ) : (
            <ShieldAlert size={14} className="text-rose-400" />
          )}
          Risk Guard Evaluation
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            passed
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-rose-500/15 text-rose-400 border-rose-500/30"
          }`}
        >
          {passed ? "PASSED" : "REJECTED"}
        </span>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/50 p-2 rounded border border-slate-800/60">
        <div>
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <DollarSign size={10} className="text-cyan-400" /> ESTIMATED EXPOSURE
          </span>
          <span className="font-medium text-slate-200">
            {riskResult.estimatedExposure !== null
              ? `$${riskResult.estimatedExposure.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
              : "N/A"}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <DollarSign size={10} className="text-rose-400" /> RISK AMOUNT
          </span>
          <span className="font-medium text-slate-200">
            {riskResult.riskAmount !== null
              ? `$${riskResult.riskAmount.toFixed(2)}`
              : "N/A (Missing SL)"}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <Scale size={10} className="text-purple-400" /> RISK : REWARD
          </span>
          <span className="font-medium text-slate-200">
            {riskResult.potentialRiskReward !== null
              ? `1 : ${riskResult.potentialRiskReward.toFixed(2)}`
              : "N/A"}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px]">ORDER SIZE</span>
          <span className="font-medium text-slate-200">{riskResult.orderSize} lots</span>
        </div>
      </div>

      {/* Warnings & Missing Data */}
      {riskResult.missingRiskData.length > 0 && (
        <div className="space-y-1">
          {riskResult.missingRiskData.map((item, i) => (
            <div
              key={i}
              className="bg-amber-950/30 border border-amber-500/25 text-amber-300 p-1.5 rounded text-[10px] flex items-start gap-1.5"
            >
              <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
              <span>Missing field required for risk calculation: {item}</span>
            </div>
          ))}
        </div>
      )}

      {/* Result Notes */}
      {riskResult.notes && <p className="text-[10px] text-slate-400 italic">{riskResult.notes}</p>}
    </div>
  );
};
