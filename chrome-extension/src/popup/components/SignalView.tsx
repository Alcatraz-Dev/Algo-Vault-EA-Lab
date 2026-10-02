import React, { useMemo, useState } from "react";
import { createSignal } from "@/api/algovault";
import type { TradingViewContext } from "@/types";
import { BackButton, Field, Feedback, inputClass, PrimaryButton, ViewHeader } from "./ui";

interface SignalViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

type Side = "BUY" | "SELL";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const STYLES = ["scalp", "intraday", "swing", "position"];

export function SignalView({ symbol, context, onBack }: SignalViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const livePrice = context?.price ?? null;

  const [direction, setDirection] = useState<Side>("BUY");
  const [entry, setEntry] = useState(livePrice ? String(livePrice) : "");
  const [sl, setSl] = useState("");
  const [tp1, setTp1] = useState("");
  const [tp2, setTp2] = useState("");
  const [tp3, setTp3] = useState("");
  const [timeframe, setTimeframe] = useState(context?.timeframe || "H1");
  const [style, setStyle] = useState("intraday");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  const calc = useMemo(() => {
    const e = parseFloat(entry) || 0;
    const stop = parseFloat(sl) || 0;
    const isLong = direction === "BUY";
    const slValid = e > 0 && stop > 0 && (isLong ? stop < e : stop > e);
    const stopDistance = Math.abs(e - stop);

    const tpVals = [tp1, tp2, tp3].map((v) => parseFloat(v) || 0);
    const tpValid = tpVals.map((t) => (t > 0 && slValid ? (isLong ? t > e : t < e) : true));
    const rMultiples = slValid
      ? tpVals.map((t) => (t > 0 ? Math.abs(t - e) / stopDistance : null))
      : [null, null, null];
    const rrText = (i: number) => {
      const r = rMultiples[i];
      return r != null ? `${r.toFixed(1)}R` : "—";
    };

    return { e, stop, isLong, slValid, stopDistance, tpValid, rrText };
  }, [entry, sl, tp1, tp2, tp3, direction]);

  /** Suggest TPs at R multiples of the stop distance (2R / 3.5R / 5R). */
  const suggestTargets = () => {
    if (!calc.slValid) return;
    const m = [2, 3.5, 5];
    const vals = m.map((r) => (calc.isLong ? calc.e + calc.stopDistance * r : calc.e - calc.stopDistance * r));
    setTp1(vals[0].toFixed(5));
    setTp2(vals[1].toFixed(5));
    setTp3(vals[2].toFixed(5));
  };

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
      setFeedback({ kind: "success", msg: "Signal created — visible in AlgoVault → Signals." });
      setTimeout(() => setFeedback(null), 3500);
    } catch (err) {
      setFeedback({ kind: "error", msg: err instanceof Error ? err.message : "Failed to create signal" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Create Signal" sub={displaySymbol || undefined} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          {(["BUY", "SELL"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`rounded-lg border py-2 text-xs font-bold transition-all ${
                direction === d
                  ? d === "BUY"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                    : "border-rose-500/40 bg-rose-500/15 text-rose-400"
                  : "border-edge bg-card text-ink-mute hover:bg-raised"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Entry">
            <input type="number" value={entry} onChange={(e) => setEntry(e.target.value)} className={inputClass} placeholder="—" />
          </Field>
          <Field label="Stop">
            <input type="number" value={sl} onChange={(e) => setSl(e.target.value)} className={inputClass} placeholder="—" />
          </Field>
          <Field label="Timeframe">
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className={inputClass}>
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </Field>
        </div>

        {!calc.slValid && sl !== "" && (
          <Feedback kind="info" msg={`Stop is on the wrong side for a ${direction === "BUY" ? "long" : "short"} from ${entry}.`} />
        )}

        {/* targets with live R multiples */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-mute">Targets</span>
            <button
              onClick={suggestTargets}
              disabled={!calc.slValid}
              className="rounded border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[9px] font-semibold text-brand-400 transition-colors hover:bg-brand-500/20 disabled:opacity-30"
            >
              Suggest 2R / 3.5R / 5R
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([tp1, tp2, tp3] as const).map((val, i) => {
              const setters = [setTp1, setTp2, setTp3];
              return (
                <div key={i}>
                  <input
                    type="number"
                    value={val}
                    onChange={(e) => setters[i](e.target.value)}
                    className={`${inputClass} ${!calc.tpValid[i] ? "border-rose-500/40" : ""}`}
                    placeholder={`TP${i + 1}`}
                  />
                  <span className="mt-0.5 block text-center font-mono text-[9px] text-ink-faint">
                    {calc.rrText(i)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Style">
            <select value={style} onChange={(e) => setStyle(e.target.value)} className={inputClass}>
              {STYLES.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Optional…" />
          </Field>
        </div>

        {feedback && <Feedback kind={feedback.kind} msg={feedback.msg} />}

        <PrimaryButton onClick={handleSubmit} disabled={loading || !entry || !sl || !calc.slValid}>
          {loading ? "Creating…" : "Create Signal"}
        </PrimaryButton>
      </div>

      <div className="flex items-center border-t border-edge bg-card/60 px-3 py-2">
        <BackButton onClick={onBack} />
      </div>
    </div>
  );
}
