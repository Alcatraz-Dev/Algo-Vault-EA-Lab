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
      <span className="block flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`font-medium ${tone ?? "text-foreground"}`}>{value}</span>
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
    <div className="space-y-2.5 rounded-xl border border-border bg-card p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {blocked ? (
            <ShieldAlert size={14} className="text-negative" />
          ) : (
            <ShieldCheck size={14} className="text-positive" />
          )}
          Execution Risk Check
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            blocked
              ? "bg-negative/15 text-negative border-negative/30"
              : notCalculable
              ? "bg-warning/15 text-warning border-warning/30"
              : "bg-positive/15 text-positive border-positive/30"
          }`}
        >
          {blocked ? "REJECTED" : notCalculable ? "INCOMPLETE DATA" : "PASSED"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-background p-2 text-[11px]">
        <Metric label="Account mode" value={modeLabel(riskResult.accountMode)} />
        <Metric label="Order size" value={`${riskResult.orderSize} lots`} />
        <Metric
          icon={<DollarSign size={10} />}
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
          icon={<Ruler size={10} />}
          label="Stop distance"
          value={riskResult.stopDistance !== null ? String(riskResult.stopDistance) : "Not reported"}
        />
        <Metric
          icon={<DollarSign size={10} />}
          label="Risk amount"
          value={riskResult.riskAmount !== null ? `$${riskResult.riskAmount.toFixed(2)}` : "Not calculable"}
          tone={riskResult.riskAmount !== null ? "text-foreground" : "text-warning"}
        />
        <Metric
          label="Risk % of balance"
          value={riskResult.riskPercentage !== null ? `${riskResult.riskPercentage.toFixed(2)}%` : "Not reported"}
        />
        <Metric
          icon={<Scale size={10} />}
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
        <div className="rounded-lg border border-warning/25 bg-warning/10 p-2 text-[11px] text-warning">
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
              className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/10 p-1.5 text-[10px] text-warning"
            >
              <AlertTriangle size={12} className="text-warning shrink-0 mt-0.5" />
              <span>Missing risk input: {item}</span>
            </div>
          ))}
        </div>
      )}

      {blocked && (
        <div className="rounded-lg border border-negative/25 bg-negative/10 p-2 text-[11px] text-negative">
          Broker/account restriction: risk exceeds the maximum allowed threshold. Execution is
          blocked until the order size or stop distance is adjusted.
        </div>
      )}

      {riskResult.notes && !notCalculable && (
        <p className="text-[10px] italic text-muted-foreground">{riskResult.notes}</p>
      )}
    </div>
  );
};
