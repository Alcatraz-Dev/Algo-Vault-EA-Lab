import React from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle, Scale, DollarSign, Ruler } from "lucide-react";
import type { RiskCheckResult } from "@/types/execution";
import { RISK_NOT_CALCULABLE_MESSAGE } from "@/types/execution";
import { modeLabel } from "@/services/trade-ticket";

interface Props {
  riskResult: RiskCheckResult;
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <span className="text-slate-400 block text-[10px] flex items-center gap-1 uppercase tracking-wider">
        {icon}
        {label}
      </span>
      <span className={`font-medium ${tone ?? "text-slate-200"}`}>{value}</span>
    </div>
  );
}

/**
 * Execution Risk Check (§9) — mandatory before live execution.
 * Never invents a value: anything the sources did not report renders as
 * "Not reported" plus an entry in the missing-data list.
 */
export const ProRiskGuardPanel: React.FC<Props> = ({ riskResult }) => {
  const blocked = riskResult.brokerRestrictions.includes("RISK_EXCEEDED_MAX_THRESHOLD");
  const notCalculable = !riskResult.riskCalculable;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-2.5 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
          {blocked ? (
            <ShieldAlert size={14} className="text-rose-400" />
          ) : (
            <ShieldCheck size={14} className="text-emerald-400" />
          )}
          Execution Risk Check
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            blocked
              ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
              : notCalculable
              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
          }`}
        >
          {blocked ? "REJECTED" : notCalculable ? "INCOMPLETE DATA" : "PASSED"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/50 p-2 rounded border border-slate-800/60">
        <Metric label="Account mode" value={modeLabel(riskResult.accountMode)} />
        <Metric label="Order size" value={`${riskResult.orderSize} lots`} />
        <Metric
          icon={<DollarSign size={10} className="text-cyan-400" />}
          label="Estimated exposure"
          value={
            riskResult.estimatedExposure !== null
              ? riskResult.estimatedExposure.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "Not reported"
          }
        />
        <Metric
          icon={<Ruler size={10} className="text-amber-400" />}
          label="Stop distance"
          value={riskResult.stopDistance !== null ? String(riskResult.stopDistance) : "Not reported"}
        />
        <Metric
          icon={<DollarSign size={10} className="text-rose-400" />}
          label="Risk amount"
          value={riskResult.riskAmount !== null ? `$${riskResult.riskAmount.toFixed(2)}` : "Not calculable"}
          tone={riskResult.riskAmount !== null ? "text-slate-200" : "text-amber-400"}
        />
        <Metric
          label="Risk % of balance"
          value={riskResult.riskPercentage !== null ? `${riskResult.riskPercentage.toFixed(2)}%` : "Not reported"}
        />
        <Metric
          icon={<Scale size={10} className="text-purple-400" />}
          label="Risk : Reward"
          value={
            riskResult.potentialRiskReward !== null
              ? `1 : ${riskResult.potentialRiskReward.toFixed(2)}`
              : "Not calculable"
          }
        />
        <Metric
          label="Reference price"
          value={
            riskResult.referencePrice !== null
              ? `${riskResult.referencePrice} (${riskResult.referencePriceSource})`
              : "None available"
          }
        />
      </div>

      {notCalculable && (
        <div className="bg-amber-950/30 border border-amber-500/25 text-amber-300 p-2 rounded text-[11px]">
          {riskResult.notes?.includes(RISK_NOT_CALCULABLE_MESSAGE)
            ? RISK_NOT_CALCULABLE_MESSAGE
            : `Risk could not be calculated from available data: ${riskResult.missingRiskData.join(", ") || "missing inputs"}.`}
        </div>
      )}

      {riskResult.missingRiskData.length > 0 && (
        <div className="space-y-1">
          {riskResult.missingRiskData.map((item, i) => (
            <div
              key={i}
              className="bg-amber-950/30 border border-amber-500/25 text-amber-300 p-1.5 rounded text-[10px] flex items-start gap-1.5"
            >
              <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
              <span>Missing risk input: {item}</span>
            </div>
          ))}
        </div>
      )}

      {blocked && (
        <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-2 rounded text-[11px]">
          Broker/account restriction: risk exceeds the maximum allowed threshold. Execution is
          blocked until the order size or stop distance is adjusted.
        </div>
      )}

      {riskResult.notes && !notCalculable && (
        <p className="text-[10px] text-slate-400 italic">{riskResult.notes}</p>
      )}
    </div>
  );
};
