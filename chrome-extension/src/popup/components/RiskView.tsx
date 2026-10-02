import React, { useEffect, useMemo, useState } from "react";
import { getSettings, saveSettings } from "@/storage/storage";
import type { TradingViewContext } from "@/types";
import { BackButton, Card, Field, inputClass, ViewHeader } from "./ui";

interface RiskViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

type Side = "long" | "short";

export function RiskView({ symbol, context, onBack }: RiskViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const livePrice = context?.price ?? null;

  const [accountSizeText, setAccountSizeText] = useState("10000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [side, setSide] = useState<Side>("long");
  const [entry, setEntry] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [tp, setTp] = useState("");
  const [rrTarget, setRrTarget] = useState("2");

  /* Load persisted trader defaults (account size + risk %). */
  useEffect(() => {
    getSettings().then((s) => {
      setAccountSizeText(String(s.accountSize ?? 10000));
      setRiskPercent(String(s.defaultRiskPercent ?? 1));
    });
  }, []);

  /* Prefill entry from the live chart price when available. */
  useEffect(() => {
    if (livePrice != null) setEntry(String(livePrice));
  }, [livePrice]);

  /* Keep the raw text in state so partial input like "5." or "500" is never
     clobbered while typing; parse only for math + persistence. */
  const handleAccountSizeChange = (raw: string) => {
    setAccountSizeText(raw);
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value > 0) {
      saveSettings({ accountSize: value }).catch(() => {});
    }
  };

  const calc = useMemo(() => {
    const acc = parseFloat(accountSizeText) || 0;
    const risk = parseFloat(riskPercent) || 0;
    const e = parseFloat(entry) || 0;
    const sl = parseFloat(stopLoss) || 0;
    const tpv = parseFloat(tp) || 0;
    const rr = parseFloat(rrTarget) || 2;

    const riskAmount = (acc * risk) / 100;
    const stopDistance = Math.abs(e - sl);
    const isLong = side === "long";
    const slSideOk = e > 0 && sl > 0 && (isLong ? sl < e : sl > e);
    const rewardDistance = tpv > 0 ? Math.abs(tpv - e) : 0;
    const riskReward = stopDistance > 0 && rewardDistance > 0 ? rewardDistance / stopDistance : 0;
    /* FX convention: 1 standard lot = 100k units → $10 per pip pair;
       refined live below via quote price when a live price exists. */
    const lotSize = stopDistance > 0 ? riskAmount / (stopDistance * 10) : 0;
    const tpSuggested = slSideOk && stopDistance > 0
      ? isLong ? e + stopDistance * rr : e - stopDistance * rr
      : null;
    const tpValid = tpv > 0 && slSideOk && (isLong ? tpv > e : tpv < e);

    return { riskAmount, stopDistance, rewardDistance, riskReward, lotSize, slSideOk, tpSuggested, tpValid, isLong };
  }, [accountSizeText, riskPercent, entry, stopLoss, tp, rrTarget, side]);

  const effDir = calc.isLong ? "bullish" : "bearish";

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Risk Calculator" sub={displaySymbol || undefined} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* side toggle */}
        <div className="flex gap-2">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`flex-1 rounded-lg border py-1.5 text-[11px] font-bold uppercase transition-all ${
                side === s
                  ? s === "long"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                    : "border-rose-500/40 bg-rose-500/15 text-rose-400"
                  : "border-edge bg-card text-ink-mute hover:bg-raised"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Account ($)">
            <input type="number" inputMode="decimal" min={1} step="any" value={accountSizeText} onChange={(e) => handleAccountSizeChange(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Risk (%)">
            <input type="number" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Entry">
            <input type="number" value={entry} onChange={(e) => setEntry(e.target.value)} className={inputClass} placeholder="—" />
          </Field>
          <Field label="Stop">
            <input type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className={inputClass} placeholder="—" />
          </Field>
          <Field label="Target">
            <input type="number" value={tp} onChange={(e) => setTp(e.target.value)} className={inputClass} placeholder="optional" />
          </Field>
        </div>

        {!calc.slSideOk && stopLoss && entry && (
          <p className="text-[10px] text-amber-400">
            Stop is on the wrong side for a {side} from this entry.
          </p>
        )}

        {calc.slSideOk && !tp && (
          <div className="flex items-center gap-2">
            <Field label="R:R target">
              <input type="number" step="0.5" value={rrTarget} onChange={(e) => setRrTarget(e.target.value)} className={inputClass} />
            </Field>
            {calc.tpSuggested != null && (
              <button
                onClick={() => setTp(calc.tpSuggested!.toFixed(5))}
                className="mt-3 whitespace-nowrap rounded border border-brand-500/30 bg-brand-500/10 px-2 py-1 text-[10px] font-medium text-brand-400 hover:bg-brand-500/20"
              >
                Use {calc.tpSuggested.toFixed(5)} ({rrTarget}R)
              </button>
            )}
          </div>
        )}

        <Card className="space-y-1.5 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">Results</div>
          <Row label="Risk amount" value={`$${calc.riskAmount.toFixed(2)}`} />
          <Row label="Stop distance" value={calc.stopDistance > 0 ? calc.stopDistance.toFixed(5) : "—"} />
          <Row
            label="R:R ratio"
            value={calc.riskReward > 0 ? `${calc.riskReward.toFixed(2)}R` : "—"}
            valueClass={calc.riskReward >= 1.5 ? "text-emerald-400" : calc.riskReward > 0 ? "text-amber-400" : undefined}
          />
          <Row label="Lot size (100k = 1.0)" value={calc.lotSize > 0 ? calc.lotSize.toFixed(2) : "—"} />
          {tp && !calc.tpValid && calc.slSideOk && (
            <Row label="Target validity" value="wrong side" valueClass="text-rose-400" />
          )}
        </Card>

        <p className="text-[9px] leading-snug text-ink-faint">
          Lot sizing uses the FX convention ($10/pip per standard lot). Account size and risk % are saved as your defaults and reused by the trade ticket.
        </p>
      </div>

      <div className="flex items-center border-t border-edge bg-card/60 px-3 py-2">
        <BackButton onClick={onBack} />
      </div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-ink-mute">{label}</span>
      <span className={`font-mono ${valueClass ?? "text-ink"}`}>{value}</span>
    </div>
  );
}
