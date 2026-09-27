import React, { useEffect, useMemo, useState } from "react";
import { placeOrder, getGatewayStatus } from "@/api/algovault";
import { getSettings } from "@/storage/storage";
import type { GatewayAccount, TradingViewContext } from "@/types";
import { Field, Feedback, GhostButton, inputClass, PrimaryButton, ViewHeader, dirClasses } from "./ui";

interface ExecuteViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

type Side = "BUY" | "SELL";

/**
 * Unified trade ticket (absorbs the old QuickOrderView): direction, market or
 * limit entry, account selection, risk-based position sizing, live R:R, and a
 * full review sheet before the order is sent to the Gateway.
 */
export function ExecuteView({ symbol, context, onBack }: ExecuteViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const livePrice = context?.price ?? null;

  const [direction, setDirection] = useState<Side>("BUY");
  const [orderKind, setOrderKind] = useState<"market" | "limit">("market");
  const [entry, setEntry] = useState(livePrice ? String(livePrice) : "");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [riskPercent, setRiskPercent] = useState("1");
  const [accountSize, setAccountSize] = useState("10000");
  const [accounts, setAccounts] = useState<GatewayAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("default");
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error" | "info"; msg: string } | null>(null);

  /* settings + gateway accounts */
  useEffect(() => {
    getSettings().then((s) => {
      setRiskPercent(String(s.defaultRiskPercent ?? 1));
      setAccountSize(String(s.accountSize ?? 10000));
    });
    getGatewayStatus()
      .then((gw) => {
        if (gw.connected && gw.accounts.length > 0) {
          setAccounts(gw.accounts);
          setAccountId(gw.accounts[0].accountId);
        }
      })
      .catch(() => { /* gateway offline — order uses "default" */ });
  }, []);

  /* refresh entry from live price while market order is selected */
  useEffect(() => {
    if (orderKind === "market" && livePrice != null) setEntry(String(livePrice));
  }, [livePrice, orderKind]);

  const calc = useMemo(() => {
    const acc = parseFloat(accountSize) || 0;
    const risk = parseFloat(riskPercent) || 0;
    const e = parseFloat(entry) || 0;
    const stop = parseFloat(sl) || 0;
    const target = parseFloat(tp) || 0;
    const isLong = direction === "BUY";

    const riskAmount = (acc * risk) / 100;
    const stopDistance = Math.abs(e - stop);
    const slValid = e > 0 && stop > 0 && (isLong ? stop < e : stop > e);
    const tpValid = target > 0 && slValid && (isLong ? target > e : target < e);
    const rewardDistance = tpValid ? Math.abs(target - e) : 0;
    const riskReward = stopDistance > 0 && rewardDistance > 0 ? rewardDistance / stopDistance : 0;
    const volume = stopDistance > 0 ? riskAmount / (stopDistance * 10) : 0;

    return {
      riskAmount, stopDistance, slValid, tpValid, riskReward,
      volume: Math.max(0.01, Math.round(volume * 100) / 100),
      isLong,
    };
  }, [direction, entry, sl, tp, riskPercent, accountSize]);

  const canPreview = calc.slValid && entry !== "" && sl !== "";

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await placeOrder({
        accountId,
        symbol: displaySymbol || "",
        action: direction,
        volume: calc.volume,
        price: orderKind === "limit" ? parseFloat(entry) || undefined : undefined,
        sl: parseFloat(sl) || undefined,
        tp: parseFloat(tp) || undefined,
        clientOrderId: `ext_${Date.now()}`,
      });
      setFeedback({ kind: "success", msg: `Order sent to Gateway (${orderKind} ${direction} ${calc.volume} lots)` });
      setShowConfirm(false);
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) {
      setFeedback({ kind: "error", msg: err instanceof Error ? err.message : "Order failed" });
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Trade Ticket" sub={displaySymbol || undefined} />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* direction */}
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
              {d} <span className="font-mono text-[10px] font-normal opacity-70">{livePrice != null ? livePrice.toFixed(livePrice >= 100 ? 2 : 4) : ""}</span>
            </button>
          ))}
        </div>

        {/* account + order kind */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Account">
            {accounts.length > 0 ? (
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.broker || a.server} · {a.accountNumber}
                  </option>
                ))}
              </select>
            ) : (
              <input disabled value="default" className={`${inputClass} opacity-50`} />
            )}
          </Field>
          <Field label="Order type">
            <div className="flex gap-1">
              {(["market", "limit"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setOrderKind(k)}
                  className={`flex-1 rounded border py-1.5 text-[10px] font-semibold uppercase transition-colors ${
                    orderKind === k ? "border-brand-500/40 bg-brand-500/15 text-brand-400" : "border-edge bg-card text-ink-mute hover:bg-raised"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label={orderKind === "market" ? "Entry (live)" : "Limit price"}>
            <input
              type="number"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              disabled={orderKind === "market"}
              className={`${inputClass} ${orderKind === "market" ? "opacity-60" : ""}`}
            />
          </Field>
          <Field label="Stop loss">
            <input type="number" value={sl} onChange={(e) => setSl(e.target.value)} className={inputClass} placeholder="—" />
          </Field>
          <Field label="Take profit">
            <input type="number" value={tp} onChange={(e) => setTp(e.target.value)} className={inputClass} placeholder="optional" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Account ($)">
            <input type="number" value={accountSize} onChange={(e) => setAccountSize(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Risk (%)">
            <input type="number" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} className={inputClass} />
          </Field>
        </div>

        {!calc.slValid && sl !== "" && (
          <Feedback kind="info" msg={`Stop is on the wrong side for a ${direction === "BUY" ? "long" : "short"} from ${entry}.`} />
        )}

        {/* live preview */}
        <div className="rounded-lg border border-edge bg-card p-2.5">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">Order preview</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[9px] text-ink-faint">Volume</div>
              <div className="font-mono text-sm font-bold text-ink">{calc.volume}</div>
            </div>
            <div>
              <div className="text-[9px] text-ink-faint">Risk</div>
              <div className="font-mono text-sm font-bold text-ink">${calc.riskAmount.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[9px] text-ink-faint">R:R</div>
              <div className={`font-mono text-sm font-bold ${calc.riskReward >= 1.5 ? "text-emerald-400" : calc.riskReward > 0 ? "text-amber-400" : "text-ink-faint"}`}>
                {calc.riskReward > 0 ? `${calc.riskReward.toFixed(1)}R` : "—"}
              </div>
            </div>
          </div>
        </div>

        {feedback && <Feedback kind={feedback.kind} msg={feedback.msg} />}

        <PrimaryButton onClick={() => setShowConfirm(true)} disabled={!canPreview}>
          Review Order
        </PrimaryButton>
      </div>

      <div className="border-t border-edge px-3 py-2">
        <GhostButton onClick={onBack}>Back</GhostButton>
      </div>

      {/* ── confirm sheet ──────────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="animate-slide-up w-full max-w-[330px] space-y-3 rounded-xl border border-edge bg-card p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink">⚠ Review & Confirm</span>
              <button onClick={() => setShowConfirm(false)} className="text-ink-faint hover:text-ink">
                ✕
              </button>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <Line label="Direction" value={direction} valueClass={dirClasses[calc.isLong ? "bullish" : "bearish"]} />
              <Line label="Symbol" value={displaySymbol || "—"} />
              <Line label="Type" value={orderKind.toUpperCase()} />
              <Line label="Entry" value={entry} mono />
              <Line label="Stop loss" value={sl} mono valueClass="text-rose-400" />
              {tp && <Line label="Take profit" value={tp} mono valueClass="text-emerald-400" />}
              <Line label="Volume" value={`${calc.volume} lots`} mono />
              <Line label="Risk" value={`$${calc.riskAmount.toFixed(2)} (${riskPercent}%)`} mono />
              {calc.riskReward > 0 && <Line label="R:R" value={`${calc.riskReward.toFixed(2)}R`} mono />}
              <Line label="Account" value={accounts.find((a) => a.accountId === accountId)?.accountNumber ?? "default"} mono />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowConfirm(false)} className="flex-1 rounded-lg border border-edge bg-raised py-2 text-[11px] text-ink-mute transition-colors hover:bg-[#2a2a2a]">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-bold text-white transition-colors disabled:opacity-50 ${
                  direction === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"
                }`}
              >
                {loading ? "Sending…" : `Send ${direction}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, mono, valueClass }: { label: string; value: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-mute">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${valueClass ?? "text-ink"}`}>{value}</span>
    </div>
  );
}
