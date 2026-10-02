import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Crosshair, RefreshCw, RotateCcw, Wallet } from "lucide-react";
import { placeOrder, getOrderStatus, getGatewayStatus, getRiskAnalysis, type OrderStatus } from "@/api/algovault";
import { getSettings } from "@/storage/storage";
import { mirrorSlTp, orderAction, spreadOf, validateTicket, type DemoOrderKind } from "@/services/demo-trading";
import type { GatewayAccount, TradingViewContext } from "@/types";
import { BackButton, ChartSyncBadge, ConfirmActionRow, dirClasses, Field, Feedback, inputClass, MiniButton,
  PrimaryButton, SegmentedControl, StatPill, Stepper, ViewHeader } from "./ui";
import { useChartSync } from "@/utils/chart-sync";

interface ExecuteViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  contextTimestamp?: number | null;
  onBack: () => void;
}

type Side = "BUY" | "SELL";
type SizingMode = "risk" | "fixed";

/** Live capital of the connected MT5 account (gateway status + risk API). */
interface AccountCapital {
  balance: number;
  equity: number;
  marginFree?: number;
  floatingPnl?: number;
  source: "gateway" | "manual";
  bid?: number;
  ask?: number;
}

/** $-risk quick-set chips so the trader can size the SL in one tap. */
const QUICK_RISK_PRESETS = [10, 25, 50, 100] as const;

/**
 * Trade Ticket — REAL account orders only.
 *
 * • Capital is pulled live from the connected MT5 gateway account (balance +
 *   equity + free margin); sizing always uses real equity, never a typed-in
 *   number. Paper/demo trading lives in the Demo Trades panel.
 * • Order types: Market, Limit and Stop entries mapped to the gateway's
 *   MT5 actions (BUY_LIMIT, SELL_LIMIT, BUY_STOP, SELL_STOP) with
 *   wrong-side validation against the live price.
 * • Sizing: risk-% (needs SL) or fixed lots. TP assist suggests targets at
 *   1–3R from the stop distance.
 */
export function ExecuteView({ symbol, context, contextTimestamp, onBack }: ExecuteViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const livePrice = context?.price ?? null;
  const sync = useChartSync(context, contextTimestamp ?? null);

  const [direction, setDirection] = useState<Side>("BUY");
  const [orderKind, setOrderKind] = useState<DemoOrderKind>("market");
  const [entry, setEntry] = useState(livePrice ? String(livePrice) : "");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [riskPercent, setRiskPercent] = useState("1");
  const [fixedLots, setFixedLots] = useState("0.10");
  const [sizingMode, setSizingMode] = useState<SizingMode>("risk");
  const [manualAccountSize, setManualAccountSize] = useState("");

  const [accounts, setAccounts] = useState<GatewayAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("default");
  const [capital, setCapital] = useState<AccountCapital | null>(null);
  const [capitalLoading, setCapitalLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error" | "info"; msg: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleResetTicket = () => {
    setDirection("BUY");
    setOrderKind("market");
    setEntry(livePrice ? String(livePrice) : "");
    setSl("");
    setTp("");
    setRiskPercent("1");
    setFixedLots("0.10");
    setSizingMode("risk");
    setConfirmReset(false);
    setFeedback({ kind: "info", msg: "Trade ticket reset to defaults." });
  };

  /* Raw text is kept so partial input like "5." or "500" is never clobbered
     while typing; parse only for math. */
  const [tracking, setTracking] = useState<
    (OrderStatus & { clientOrderId: string }) | null
  >(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── load settings + gateway accounts, then pull REAL capital ────────── */
  useEffect(() => {
    getSettings().then((s) => {
      setRiskPercent(String(s.defaultRiskPercent ?? 1));
      if (!s.accountSize || s.accountSize <= 0) return;
      // Manual fallback only — shown when no gateway account is connected.
      setManualAccountSize(String(s.accountSize));
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

  const selectedAccount = accounts.find((a) => a.accountId === accountId) ?? null;

  const refreshCapital = useCallback(async () => {
    if (!selectedAccount) return;
    setCapitalLoading(true);
    try {
      const risk = await getRiskAnalysis(selectedAccount.accountId);
      setCapital({
        balance: risk.accountBalance || selectedAccount.balance,
        equity: risk.accountEquity || selectedAccount.equity || risk.accountBalance || selectedAccount.balance,
        marginFree: risk.marginFree,
        floatingPnl: risk.floatingPnl,
        source: "gateway",
      });
    } catch {
      // Risk API down — degrade to the heartbeat numbers from gateway status.
      setCapital({
        balance: selectedAccount.balance,
        equity: selectedAccount.equity || selectedAccount.balance,
        source: "gateway",
      });
    } finally {
      setCapitalLoading(false);
    }
  }, [selectedAccount]);

  useEffect(() => {
    if (selectedAccount) void refreshCapital();
    else setCapital(null);
  }, [selectedAccount, refreshCapital]);

  /* refresh entry from live price while market order is selected */
  useEffect(() => {
    if (orderKind === "market" && livePrice != null) setEntry(String(livePrice));
  }, [livePrice, orderKind]);

  const calc = useMemo(() => {
    const live = livePrice ?? 0;
    const e = parseFloat(entry) || 0;
    const stop = parseFloat(sl) || 0;
    const target = parseFloat(tp) || 0;
    const isLong = direction === "BUY";

    // Real equity drives risk sizing; the manual figure is a last-resort
    // fallback so the ticket still works when the gateway status is stale.
    const accountBase =
      capital?.equity ||
      capital?.balance ||
      parseFloat(manualAccountSize) ||
      0;
    const risk = parseFloat(riskPercent) || 0;
    const riskAmount = (accountBase * risk) / 100;

    const stopDistance = Math.abs(e - stop);
    const tpValid = target > 0 && stop > 0 && (isLong ? target > e : target < e);
    const rewardDistance = tpValid ? Math.abs(target - e) : 0;
    const riskReward = stopDistance > 0 && rewardDistance > 0 ? rewardDistance / stopDistance : 0;

    const riskLots = stopDistance > 0 ? riskAmount / (stopDistance * 10) : 0;
    const fixedLotsNum = parseFloat(fixedLots) || 0;
    const volume = sizingMode === "risk" ? riskLots : fixedLotsNum;

    const validation = validateTicket({
      side: direction, kind: orderKind, live, entry: e, sl: stop, tp: target,
    });

    return {
      riskAmount, stopDistance, tpValid, riskReward,
      volume: Math.max(0.01, Math.round(volume * 100) / 100),
      isLong, live, entryNum: e, slNum: stop, tpNum: target,
      ticketError: validation.ok ? null : validation.error ?? null,
      accountBase,
    };
  }, [direction, orderKind, entry, sl, tp, riskPercent, fixedLots, sizingMode, livePrice, capital, manualAccountSize]);

  const market = orderKind === "market";
  const needsStop = sizingMode === "risk";

  const canPreview =
    entry !== "" &&
    !calc.ticketError &&
    calc.volume > 0 &&
    (!needsStop || (calc.slNum > 0 && calc.stopDistance > 0));

  /* Orders are keyed to a real gateway account (gateway_<login>). Without one
     loaded the server 404s with "Account not found" — surface that up front
     instead of letting the trader fill the ticket and hit a dead end. */
  const gatewayReady = accounts.length > 0 && !!accountId && accountId !== "default";

  /* Auto-flip SL/TP when the trader reverses BUY↔SELL: keep the same
     *distances* across the entry, otherwise the SL/TP sit on the wrong side
     and validateTicket would block the order. Mirrors DemoTradingView. */
  const flipDirection = (next: Side) => {
    if (next === direction) return;
    setDirection(next);
    if (calc.entryNum > 0) {
      const { sl: msl, tp: mtp } = mirrorSlTp(next, calc.entryNum, calc.slNum || undefined, calc.tpNum || undefined);
      setSl(msl != null ? String(msl) : "");
      setTp(mtp != null ? String(mtp) : "");
    }
  };

  /* Set the SL so the chosen $-risk budget lands at the current lot size.
     Compact one-tap "$10 / $25 / $50 / $100" presets. */
  const setQuickRisk = (usd: number) => {
    if (calc.entryNum <= 0) {
      setFeedback({ kind: "info", msg: "Enter an entry price first." });
      return;
    }
    const lots = Math.max(0.01, parseFloat(fixedLots) || 0.01);
    const distance = usd / (lots * 10);
    const slPrice = direction === "BUY" ? calc.entryNum - distance : calc.entryNum + distance;
    setSl(slPrice.toFixed(slPrice >= 100 ? 2 : 5));
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      // Re-pull capital so the confirm sheet reflects the account at send time.
      if (selectedAccount) void refreshCapital();
      const clientOrderId = `ext_${Date.now()}`;
      const action = orderAction(orderKind, direction);
      await placeOrder({
        accountId,
        symbol: displaySymbol || "",
        action,
        volume: calc.volume,
        price: !market ? parseFloat(entry) || undefined : undefined,
        sl: parseFloat(sl) || undefined,
        tp: parseFloat(tp) || undefined,
        clientOrderId,
      });
      setFeedback({ kind: "success", msg: `Order sent to Gateway (${orderKind} ${direction} ${calc.volume} lots)` });
      setTracking({ clientOrderId, status: "queued" });
      setShowConfirm(false);
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) {
      setFeedback({ kind: "error", msg: err instanceof Error ? err.message : "Order failed" });
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  const trackingActive = !!tracking && !["filled", "rejected", "failed", "timeout"].includes(tracking.status);

  /* Poll the queued order until the gateway EA reports a terminal state
     (execution report) or ~90s elapse — the ticket then shows the outcome
     instead of a blind "order sent". */
  useEffect(() => {
    if (!trackingActive || !tracking) return;

    const startedAt = Date.now();
    const POLL_MS = 3000;
    const MAX_MS = 90000;

    const tick = async () => {
      if (!tracking) return;
      try {
        const status = await getOrderStatus(tracking.clientOrderId);
        if (!status) return; // order row not visible yet — keep polling
        setTracking((t) => (t && t.clientOrderId === tracking.clientOrderId ? { ...t, ...status } : t));
      } catch { /* transient API error — keep polling */ }
    };

    void tick();
    pollTimerRef.current = setInterval(() => {
      if (Date.now() - startedAt > MAX_MS) {
        setTracking((t) => (t && t.status === "queued" ? { ...t, status: "timeout" } : t));
        return;
      }
      void tick();
    }, POLL_MS);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking?.clientOrderId, trackingActive]);

  const fmt = (v: number | null | undefined, digits?: number) =>
    v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: digits ?? (v >= 100 ? 2 : 4), maximumFractionDigits: digits ?? (v >= 100 ? 2 : 4) });

  /* Suggested TP at R multiples of the stop distance. */
  const tpSuggestions = useMemo(() => {
    if (!calc.stopDistance || !calc.entryNum || !calc.slNum) return [];
    return [1, 2, 3].map((r) => ({
      r,
      price: calc.isLong ? calc.entryNum + calc.stopDistance * r : calc.entryNum - calc.stopDistance * r,
    }));
  }, [calc.stopDistance, calc.entryNum, calc.slNum, calc.isLong]);

  /* Try to derive a live spread for the directional hint. If the gateway
     status doesn't include bid/ask we just hide the chip rather than guess. */
  const liveSpread = (capital?.bid && capital?.ask) ? spreadOf({ bid: capital.bid, ask: capital.ask }) : 0;

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title="Trade Ticket"
        sub={displaySymbol || undefined}
        right={
          <div className="flex items-center gap-1.5">
            <ChartSyncBadge
              state={sync.state}
              symbol={displaySymbol}
              timeframe={context?.timeframe ?? null}
              ageMs={sync.ageMs}
              refreshing={sync.refreshing}
              onRefresh={() => void sync.refresh()}
              onOpenChart={() => window.open("https://www.tradingview.com/", "_blank", "noopener,noreferrer")}
              compact
            />
            <span className="flex items-center gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-400">
              <span className="h-1 w-1 animate-pulse-dot rounded-full bg-rose-400" /> Live account
            </span>
          </div>
        }
      />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* direction + flip */}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          {(["BUY", "SELL"] as const).map((d) => {
            const active = direction === d;
            const palette = active
              ? d === "BUY"
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.4)]"
                : "border-rose-500/50 bg-rose-500/15 text-rose-400 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.4)]"
              : "border-edge bg-card text-ink-mute hover:bg-raised hover:text-ink";
            return (
              <button
                key={d}
                onClick={() => flipDirection(d)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-bold transition-all duration-150 active:scale-[0.97] ${palette}`}
              >
                <span>{d}</span>
                <span className="flex flex-col items-end">
                  {livePrice != null ? (
                    <>
                      <span className="font-mono text-[10px] font-normal opacity-90">{fmt(livePrice, livePrice >= 100 ? 2 : 4)}</span>
                      {liveSpread > 0 && (
                        <span className="font-mono text-[8px] font-normal opacity-70">
                          spread {fmt(liveSpread, 5)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[9px] font-normal opacity-60">awaiting quote</span>
                  )}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => flipDirection(direction === "BUY" ? "SELL" : "BUY")}
            disabled={!calc.entryNum || (!calc.slNum && !calc.tpNum)}
            className="flex w-9 items-center justify-center rounded-lg border border-edge bg-raised text-ink-mute transition-all duration-150 hover:bg-[#2a2a2a] hover:text-ink active:scale-95 disabled:opacity-30 disabled:active:scale-100"
            title="Flip side — auto-mirror SL/TP"
          >
            <ArrowDownUp size={13} />
          </button>
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
            <SegmentedControl
              value={orderKind}
              onChange={setOrderKind}
              options={[
                { value: "market", label: "Market" },
                { value: "limit", label: "Limit" },
                { value: "stop", label: "Stop" },
              ]}
            />
          </Field>
        </div>

        {/* ── REAL account capital ──────────────────────────────────── */}
        <div className="rounded-lg border border-edge bg-card p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
              <Wallet size={11} className="text-brand-400" />
              Account capital
            </div>
            {gatewayReady && (
              <button
                onClick={() => void refreshCapital()}
                disabled={capitalLoading}
                className="flex items-center gap-1 rounded border border-edge bg-raised px-1.5 py-0.5 text-[9px] font-medium text-ink-mute transition-all duration-150 hover:border-brand-500/40 hover:text-brand-400 active:scale-95 disabled:opacity-40"
              >
                <RefreshCw size={9} className={capitalLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            )}
          </div>
          {capital ? (
            <div className="grid grid-cols-3 gap-2">
              <StatPill label="Balance" value={fmt(capital.balance, 2)} />
              <StatPill
                label="Equity"
                value={fmt(capital.equity, 2)}
                tone={capital.equity >= capital.balance ? "bullish" : capital.equity < capital.balance ? "bearish" : "neutral"}
              />
              <StatPill
                label="Floating"
                value={capital.floatingPnl != null
                  ? `${capital.floatingPnl >= 0 ? "+" : ""}${fmt(capital.floatingPnl, 2)}`
                  : "—"}
                tone={capital.floatingPnl == null ? "neutral" : capital.floatingPnl >= 0 ? "bullish" : "bearish"}
              />
            </div>
          ) : gatewayReady ? (
            <p className="text-[10px] text-ink-faint">Loading live account capital…</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Capital ($)">
                <input
                  type="number" inputMode="decimal" min={1} step="any"
                  value={manualAccountSize}
                  onChange={(e) => setManualAccountSize(e.target.value)}
                  className={inputClass}
                  placeholder="10000"
                />
              </Field>
              <div className="flex items-end pb-1">
                <p className="text-[9px] leading-snug text-ink-faint">
                  Gateway offline — sizing uses this manual figure. Connect the EA for live balance/equity.
                </p>
              </div>
            </div>
          )}
          {capital?.marginFree != null && (
            <div className="mt-1.5 border-t border-edge pt-1.5 text-[9px] text-ink-faint">
              Free margin <span className="font-mono text-ink-mute">{fmt(capital.marginFree, 2)}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label={market ? "Entry (live)" : orderKind === "limit" ? "Limit price" : "Stop price"}>
            <input
              type="number"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              disabled={market}
              className={`${inputClass} ${market ? "opacity-60" : ""}`}
            />
          </Field>
          <Field label="Stop loss">
            <input type="number" value={sl} onChange={(e) => setSl(e.target.value)} className={inputClass} placeholder="—" />
          </Field>
          <Field label="Take profit">
            <input type="number" value={tp} onChange={(e) => setTp(e.target.value)} className={inputClass} placeholder="optional" />
          </Field>
        </div>

        {/* quick-risk chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-ink-faint">Quick risk</span>
          {QUICK_RISK_PRESETS.map((usd) => (
            <button
              key={usd}
              type="button"
              onClick={() => setQuickRisk(usd)}
              disabled={calc.entryNum <= 0}
              className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[9px] text-ink-mute transition-all duration-150 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400 active:scale-95 disabled:opacity-30 disabled:active:scale-100"
            >
              ${usd}
            </button>
          ))}
          <span className="ml-auto text-[9px] text-ink-faint">
            at {(parseFloat(fixedLots) || 0.01).toFixed(2)} lots
          </span>
        </div>

        {/* TP assist — fill a target at an R multiple of the stop distance */}
        {tpSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-ink-faint">
              <Crosshair size={9} /> TP assist
            </span>
            {tpSuggestions.map((s) => (
              <button
                key={s.r}
                onClick={() => setTp(s.price.toFixed(s.price >= 100 ? 2 : 5))}
                className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-400 transition-all duration-150 hover:bg-emerald-500/20 active:scale-95"
              >
                {s.r}R · {fmt(s.price)}
              </button>
            ))}
          </div>
        )}

        {/* sizing mode */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sizing">
            <SegmentedControl
              value={sizingMode}
              onChange={setSizingMode}
              options={[
                { value: "risk", label: "Risk %" },
                { value: "fixed", label: "Fixed" },
              ]}
            />
          </Field>
          {sizingMode === "risk" ? (
            <Field label="Risk (%)">
              <Stepper
                value={parseFloat(riskPercent) || 0}
                onChange={(v) => setRiskPercent(String(v))}
                step={0.1}
                min={0.1}
                max={20}
                decimals={2}
                ariaLabel="Risk percent"
              />
            </Field>
          ) : (
            <Field label="Lots">
              <Stepper
                value={parseFloat(fixedLots) || 0}
                onChange={(v) => setFixedLots(String(v))}
                step={0.01}
                min={0.01}
                max={100}
                decimals={2}
                ariaLabel="Lots"
              />
            </Field>
          )}
        </div>

        {calc.ticketError && <Feedback kind="info" msg={calc.ticketError} />}
        {needsStop && !calc.ticketError && calc.slNum <= 0 && (
          <Feedback kind="info" msg="Risk-% sizing needs a stop loss — or switch sizing to Fixed lots." />
        )}

        {/* live preview */}
        <div className="rounded-lg border border-edge bg-card p-2.5">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">Order preview</div>
          <div className="grid grid-cols-3 gap-2">
            <StatPill label="Volume" value={calc.volume} />
            <StatPill
              label="Risk"
              value={`$${calc.riskAmount.toFixed(0)}`}
              tone={calc.riskAmount > 0 ? "bearish" : "neutral"}
              sub={riskPercent ? `${riskPercent}% of equity` : undefined}
            />
            <StatPill
              label="R:R"
              value={calc.riskReward > 0 ? `${calc.riskReward.toFixed(1)}R` : "—"}
              tone={calc.riskReward >= 1.5 ? "bullish" : calc.riskReward > 0 ? "neutral" : "neutral"}
            />
          </div>
        </div>

        {feedback && <Feedback kind={feedback.kind} msg={feedback.msg} />}

        {/* live order status after sending */}
        {tracking && (
          <div
            className={`rounded-lg border px-2.5 py-2 text-[10px] leading-snug transition-colors ${
              tracking.status === "filled"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : tracking.status === "rejected" || tracking.status === "failed"
                ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                : "border-edge bg-card text-ink-mute"
            }`}
          >
            {tracking.status === "queued" && (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-amber-400" />
                Queued — waiting for the MT5 gateway to pick it up…
              </span>
            )}
            {tracking.status === "executing" && (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-amber-400" />
                Executing on MT5…
              </span>
            )}
            {tracking.status === "partially_filled" && (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-amber-400" />
                Partially filled…
              </span>
            )}
            {tracking.status === "filled" && (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Filled{tracking.executionPrice ? ` @ ${tracking.executionPrice}` : ""}
                {tracking.mt5Ticket ? ` · MT5 ticket #${tracking.mt5Ticket}` : ""}
              </span>
            )}
            {(tracking.status === "rejected" || tracking.status === "failed") && (
              <span>✗ {tracking.errorMessage || "Rejected by the broker."}</span>
            )}
            {tracking.status === "timeout" && (
              <span>No confirmation yet — check the MT5 terminal or the Trading dashboard.</span>
            )}
          </div>
        )}

        {!gatewayReady && (
          <Feedback
            kind="error"
            msg="No MT5 account connected. Start the AlgoVaultTradeGateway EA on your MT5 terminal (with your gateway token) first — orders need a live gateway account. Want to practice? Use the Demo Trades panel instead."
          />
        )}

        <PrimaryButton onClick={() => setShowConfirm(true)} disabled={!canPreview || !gatewayReady}>
          Review Order
        </PrimaryButton>
      </div>

      <div className="flex items-center gap-2 border-t border-edge bg-card/60 px-3 py-2">
        <BackButton onClick={onBack} />
        {confirmReset ? (
          <ConfirmActionRow
            onCancel={() => setConfirmReset(false)}
            onConfirm={handleResetTicket}
            confirmLabel="Reset"
            confirmIcon={<RotateCcw size={12} className="shrink-0" />}
            destructive
          />
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="group flex h-8 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-edge bg-raised/80 px-3 text-xs font-medium text-ink-mute transition-all duration-150 hover:border-neutral-500 hover:bg-[#252528] hover:text-ink active:scale-95"
            title="Reset ticket fields to defaults"
          >
            <RotateCcw size={12} className="shrink-0 text-ink-faint transition-transform duration-200 group-hover:-rotate-45" />
            <span className="truncate">Reset Ticket</span>
          </button>
        )}
      </div>

      {/* ── confirm sheet ──────────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="animate-slide-up w-full max-w-[330px] space-y-3 rounded-xl border border-edge bg-card p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-rose-400" />
                ⚠ Review — REAL order
              </span>
              <MiniButton onClick={() => setShowConfirm(false)} variant="neutral" title="Close">
                ✕
              </MiniButton>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <Line label="Direction" value={direction} valueClass={dirClasses[calc.isLong ? "bullish" : "bearish"]} />
              <Line label="Symbol" value={displaySymbol || "—"} />
              <Line label="Type" value={orderAction(orderKind, direction)} mono />
              <Line label="Entry" value={entry} mono />
              <Line label="Stop loss" value={sl || "—"} mono valueClass="text-rose-400" />
              {tp && <Line label="Take profit" value={tp} mono valueClass="text-emerald-400" />}
              <Line label="Volume" value={`${calc.volume} lots`} mono />
              <Line label="Risk" value={`$${calc.riskAmount.toFixed(2)} (${riskPercent}%)`} mono />
              {calc.riskReward > 0 && (
                <Line
                  label="R:R"
                  value={`${calc.riskReward.toFixed(2)}R`}
                  mono
                  valueClass={calc.riskReward >= 1.5 ? "text-emerald-400" : "text-amber-400"}
                />
              )}
              <Line
                label="Account"
                value={selectedAccount ? `${selectedAccount.accountNumber} · $${fmt(capital?.equity ?? selectedAccount.equity, 2)}` : "default"}
                mono
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-lg border border-edge bg-raised py-2.5 text-[11px] text-ink-mute transition-all duration-150 hover:bg-[#2a2a2a] active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[11px] font-bold text-white transition-all duration-150 active:scale-[0.97] disabled:opacity-50 ${
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
      <span className={`${mono ? "font-mono tabular-nums" : ""} ${valueClass ?? "text-ink"}`}>{value}</span>
    </div>
  );
}