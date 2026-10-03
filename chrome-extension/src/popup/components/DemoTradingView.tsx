import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, FlaskConical, RotateCcw, Wallet, X, Zap, ShieldCheck, Copy, Crosshair } from "lucide-react";
import { getOHLCData } from "@/api/algovault";
import {
  getDemoTradingState, saveDemoTradingState, getDemoTestCapital, saveDemoTestCapital,
} from "@/storage/storage";
import {
  cancelAllPending, cancelDemoOrder, closeAllPositions, closeDemoPosition, createDemoState,
  duplicatePosition, equityCurve, equityOf, floatingPnl, markDemoState, mirrorSlTp,
  moveSlToBreakeven, orderAction, placeDemoOrder, spreadOf, statsOf,
  validateTicket, type DemoCloseReason, type DemoOrderKind, type DemoPosition, type DemoQuote,
  type DemoSide, type DemoState,
} from "@/services/demo-trading";
import type { TradingViewContext } from "@/types";
import {
  BackButton, ChartSyncBadge, ConfirmActionRow, DangerButton, dirClasses, Field, Feedback, GhostButton,
  inputClass, MiniBar, MiniButton, PrimaryButton, SegmentedControl, Sparkline, StatPill, Stepper, ViewHeader,
} from "./ui";
import { useChartSync } from "@/utils/chart-sync";

interface DemoTradingViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  contextTimestamp?: number | null;
  onBack: () => void;
}

type SizingMode = "risk" | "fixed";

const QUOTE_POLL_MS = 4000;
const QUOTE_FAST_POLL_MS = 1500;
const FAST_POLL_WINDOW_MS = 6000;

/** Capital presets the user can tap into on the setup screen. */
const CAPITAL_PRESETS = [1000, 5000, 10000, 50000] as const;
/** Common SL/TP distances (in price units) the trader can one-tap. */
const QUICK_RISK_PRESETS = [10, 25, 50, 100] as const;

/**
 * Demo Trades — the test-logic panel.
 *
 * A fully simulated account funded by test capital the user enters. Orders
 * run through the same ticket rules as the real Trade Ticket (market / limit
 * / stop, risk-% or fixed-lot sizing, SL/TP validation) but fills, PnL and
 * SL/TP hits are simulated against the live bid/ask quote and persisted
 * locally. No MT5 gateway is needed and no real orders can ever fire here.
 */
export function DemoTradingView({ symbol, context, contextTimestamp, onBack }: DemoTradingViewProps) {
  const displaySymbol = context?.symbol || symbol;
  const marketSymbol = context?.marketSymbol || symbol || "";
  const tf = context?.timeframe || "H1";
  const livePrice = context?.price ?? null;
  const sync = useChartSync(context, contextTimestamp ?? null);

  const [demo, setDemo] = useState<DemoState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [quote, setQuote] = useState<DemoQuote | null>(null);
  const [feedOnline, setFeedOnline] = useState(false);

  /* ticket inputs */
  const [direction, setDirection] = useState<DemoSide>("BUY");
  const [orderKind, setOrderKind] = useState<DemoOrderKind>("market");
  const [entry, setEntry] = useState(livePrice ? String(livePrice) : "");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [sizingMode, setSizingMode] = useState<SizingMode>("risk");
  const [riskPercent, setRiskPercent] = useState("1");
  const [fixedLots, setFixedLots] = useState("0.10");

  /* setup inputs */
  const [capitalInput, setCapitalInput] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error" | "info"; msg: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmPanic, setConfirmPanic] = useState<null | "closeAll" | "cancelAll">(null);

  /* keep an eye on the most recent place-id so we can flash-animate the new row */
  const prevPositionIds = useRef<Set<string>>(new Set());
  const [newlyPlacedId, setNewlyPlacedId] = useState<string | null>(null);

  /* ── load persisted demo account ─────────────────────────────────── */
  useEffect(() => {
    (async () => {
      const [state, savedCapital] = await Promise.all([getDemoTradingState(), getDemoTestCapital()]);
      if (state) {
        setDemo(state);
        prevPositionIds.current = new Set(state.positions.map((p) => p.id));
      }
      if (savedCapital) setCapitalInput(String(savedCapital));
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback((next: DemoState) => {
    setDemo(next);
    void saveDemoTradingState(next).catch(() => {});
  }, []);

  /* ── live bid/ask feed → advance the simulation ──────────────────── */
  useEffect(() => {
    if (!marketSymbol) return;
    let alive = true;

    const poll = async () => {
      try {
        const data = await getOHLCData(marketSymbol, tf, 2);
        if (!alive) return;
        if (data.quote?.bid > 0 && data.quote?.ask > 0) {
          setFeedOnline(true);
          setQuote({ bid: data.quote.bid, ask: data.quote.ask });
        }
      } catch { /* feed hiccup — retry next tick */ }
    };

    void poll();
    let interval = QUOTE_POLL_MS;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      // Run a fast poll for the first few seconds after a symbol switch so
      // pending orders trigger and fills feel instant rather than waiting a
      // full 4s tick. Settles back to the slow cadence afterwards.
      interval = Date.now() - startedAt < FAST_POLL_WINDOW_MS ? QUOTE_FAST_POLL_MS : QUOTE_POLL_MS;
      void poll();
    }, interval);

    return () => { alive = false; clearInterval(timer); };
  }, [marketSymbol, tf]);

  /* Apply each fresh quote to the sim: pending fills + SL/TP auto-closes.
     Scoped to the current symbol so other-symbol positions are never marked
     against this feed, and skipped entirely when nothing changed. */
  useEffect(() => {
    if (!quote || !demo) return;
    const next = markDemoState(demo, quote, Date.now(), displaySymbol || marketSymbol);
    if (next !== demo) persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  /* market entry follows the live price */
  useEffect(() => {
    if (orderKind === "market" && livePrice != null) setEntry(String(livePrice));
  }, [livePrice, orderKind]);

  const midPrice = quote ? (quote.bid + quote.ask) / 2 : livePrice ?? 0;
  const spread = quote ? spreadOf(quote) : 0;

  /* ── ticket math (identical rules to the real ticket) ────────────── */
  const calc = useMemo(() => {
    const rawE = parseFloat(entry) || 0;
    const live = midPrice || livePrice || 0;
    const e = orderKind === "market" ? (rawE > 0 ? rawE : live) : rawE;
    const stop = parseFloat(sl) || 0;
    const target = parseFloat(tp) || 0;
    const isLong = direction === "BUY";
    const risk = parseFloat(riskPercent) || 0;
    const fixedLotsNum = parseFloat(fixedLots) || 0;

    const eq = demo ? equityOf(demo, quote ?? { bid: midPrice, ask: midPrice }) : 0;
    const riskAmount = (eq * risk) / 100;
    const stopDistance = Math.abs(e - stop);
    const tpValid = target > 0 && stop > 0 && (isLong ? target > e : target < e);
    const rewardDistance = tpValid ? Math.abs(target - e) : 0;
    const riskReward = stopDistance > 0 && rewardDistance > 0 ? rewardDistance / stopDistance : 0;
    const riskLots = (sizingMode === "risk" && stopDistance > 0) ? riskAmount / (stopDistance * 10) : 0;
    const volume = sizingMode === "risk" && stopDistance > 0 ? riskLots : (fixedLotsNum > 0 ? fixedLotsNum : 0.10);

    const validation = validateTicket({
      side: direction, kind: orderKind, live: midPrice, spread, entry: rawE, sl: stop, tp: target,
    });

    return {
      isLong, riskAmount: stopDistance > 0 ? riskAmount : 0, stopDistance, riskReward,
      volume: Math.max(0.01, Math.round(volume * 100) / 100),
      entryNum: e, slNum: stop, tpNum: target,
      ticketError: validation.ok ? null : validation.error ?? null,
    };
  }, [direction, orderKind, entry, sl, tp, riskPercent, fixedLots, sizingMode, midPrice, livePrice, spread, demo, quote]);

  const needsStop = sizingMode === "risk";
  const market = orderKind === "market";
  const canPreview = !!demo && (market || calc.entryNum > 0) && !calc.ticketError && calc.volume > 0;

  /* Auto-flip SL/TP when the trader reverses BUY↔SELL: keep the same
     *distances* across the entry, otherwise the SL/TP sit on the wrong side
     and validateTicket would block the order. */
  const flipDirection = (next: DemoSide) => {
    if (next === direction) return;
    setDirection(next);
    if (calc.entryNum > 0) {
      const { sl: msl, tp: mtp } = mirrorSlTp(next, calc.entryNum, calc.slNum || undefined, calc.tpNum || undefined);
      setSl(msl != null ? String(msl) : "");
      setTp(mtp != null ? String(mtp) : "");
    }
  };

  /* Set the SL so a 0.01 lot move equals the chosen $ risk, given the
     current entry. Compact one-tap "risk $10 / $25 / $50 / $100" presets. */
  const setQuickRisk = (usd: number) => {
    const entryPriceNum = calc.entryNum > 0 ? calc.entryNum : midPrice;
    if (entryPriceNum <= 0) {
      setFeedback({ kind: "info", msg: "Awaiting live market price." });
      return;
    }
    const lots = Math.max(0.01, parseFloat(fixedLots) || 0.01);
    const distance = usd / (lots * 10);
    const slPrice = direction === "BUY" ? entryPriceNum - distance : entryPriceNum + distance;
    setSl(slPrice.toFixed(slPrice >= 100 ? 2 : 5));
  };

  /* Suggested TP at 1R/2R/3R multiples of the SL distance. */
  const tpSuggestions = useMemo(() => {
    if (!calc.stopDistance || !calc.entryNum || !calc.slNum) return [];
    return [1, 2, 3].map((r) => ({
      r,
      price: calc.isLong ? calc.entryNum + calc.stopDistance * r : calc.entryNum - calc.stopDistance * r,
    }));
  }, [calc.stopDistance, calc.entryNum, calc.slNum, calc.isLong]);

  const handlePlace = () => {
    if (!demo || !quote) return;
    const err = validateTicket({
      side: direction, kind: orderKind, live: midPrice, spread,
      entry: calc.entryNum, sl: calc.slNum, tp: calc.tpNum,
    });
    if (!err.ok) {
      setFeedback({ kind: "error", msg: err.error ?? "Invalid order." });
      return;
    }
    const { state, position } = placeDemoOrder({
      state: demo,
      symbol: displaySymbol || marketSymbol || "UNKNOWN",
      side: direction,
      kind: orderKind,
      lots: calc.volume,
      entry: calc.entryNum,
      sl: calc.slNum || undefined,
      tp: calc.tpNum || undefined,
      quote,
    });
    persist(state);
    setNewlyPlacedId(position.id);
    prevPositionIds.current.add(position.id);
    setFeedback({
      kind: "success",
      msg: market
        ? `Filled ${direction} ${calc.volume} lots @ ${quote.bid.toFixed(quote.bid >= 100 ? 2 : 5)}`
        : `Parked ${orderAction(orderKind, direction)} ${calc.volume} lots @ ${calc.entryNum}`,
    });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleClose = (id: string) => {
    if (!demo || !quote) return;
    persist(closeDemoPosition(demo, id, quote, "manual"));
  };

  const handleCancel = (id: string) => {
    if (!demo) return;
    persist(cancelDemoOrder(demo, id));
  };

  const handleCloseAll = () => {
    if (!demo || !quote) return;
    const result = closeAllPositions(demo, quote, "panic");
    if (result.closedCount === 0) {
      setFeedback({ kind: "info", msg: "No open positions to close." });
    } else {
      persist(result.state);
      setFeedback({
        kind: "success",
        msg: `Closed ${result.closedCount} position${result.closedCount === 1 ? "" : "s"} · realized ${result.realizedPnl >= 0 ? "+" : ""}${result.realizedPnl.toFixed(2)}`,
      });
      setTimeout(() => setFeedback(null), 3500);
    }
    setConfirmPanic(null);
  };

  const handleCancelAll = () => {
    if (!demo) return;
    const before = demo.positions.filter((p) => p.status === "pending").length;
    const next = cancelAllPending(demo);
    if (next === demo) {
      setFeedback({ kind: "info", msg: "No pending orders to cancel." });
    } else {
      persist(next);
      setFeedback({ kind: "success", msg: `Cancelled ${before} pending order${before === 1 ? "" : "s"}.` });
      setTimeout(() => setFeedback(null), 3000);
    }
    setConfirmPanic(null);
  };

  const handleDuplicate = (id: string) => {
    if (!demo || !quote) return;
    const res = duplicatePosition(demo, id, quote);
    if (!res) return;
    persist(res.state);
    setNewlyPlacedId(res.position.id);
    prevPositionIds.current.add(res.position.id);
    setFeedback({ kind: "success", msg: `Duplicated ${orderAction(res.position.kind, res.position.side)} @ ${res.position.entry}` });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleBreakeven = (id: string) => {
    if (!demo) return;
    const next = moveSlToBreakeven(demo, id);
    if (!next) {
      setFeedback({ kind: "error", msg: "Position no longer open — can't move SL to breakeven." });
      setTimeout(() => setFeedback(null), 2500);
      return;
    }
    persist(next);
    setFeedback({ kind: "success", msg: "Stop loss moved to breakeven." });
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleStart = () => {
    const capital = parseFloat(capitalInput);
    if (!Number.isFinite(capital) || capital <= 0) {
      setFeedback({ kind: "error", msg: "Enter a test-capital amount to start." });
      return;
    }
    void saveDemoTestCapital(capital).catch(() => {});
    persist(createDemoState(capital));
  };

  const handleReset = () => {
    if (!demo) return;
    persist(createDemoState(demo.startingCapital, demo.commissionPerLot ?? 0));
    setConfirmReset(false);
  };

  /* ── derived panels data ─────────────────────────────────────────── */
  const pending = useMemo(() => demo?.positions.filter((p) => p.status === "pending") ?? [], [demo]);
  const open = useMemo(() => demo?.positions.filter((p) => p.status === "open") ?? [], [demo]);
  const history = useMemo(
    () => (demo ? [...demo.positions].filter((p) => p.status === "closed").sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 12) : []),
    [demo]
  );
  const stats = demo ? statsOf(demo) : null;
  const equity = demo ? equityOf(demo, quote ?? { bid: midPrice, ask: midPrice }) : 0;
  const openPnl = open.reduce((s, p) => s + floatingPnl(p, quote ?? { bid: midPrice, ask: midPrice }), 0);
  const returnPct = demo && demo.startingCapital > 0 ? ((equity - demo.startingCapital) / demo.startingCapital) * 100 : 0;
  const curvePts = demo ? equityCurve(demo, quote ?? { bid: midPrice, ask: midPrice }).map((p) => p.equity) : [];

  /* Total committed margin (sum of stopDistance × lots × 10 across open
     positions). Shown so the trader can spot over-exposure at a glance. */
  const exposure = open.reduce((s, p) => {
    if (p.filledAt == null) return s;
    return s + Math.abs(p.filledAt - (p.sl ?? p.filledAt)) * p.lots * 10;
  }, 0);

  const fmt = (v: number, digits?: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: digits ?? (Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 10 ? 2 : 4), maximumFractionDigits: digits ?? 4 });

  if (!loaded) return <div className="flex h-full items-center justify-center text-[10px] text-ink-faint">Loading…</div>;

  /* ── setup screen (no demo account yet) ──────────────────────────── */
  if (!demo) {
    return (
      <div className="flex h-full flex-col">
        <ViewHeader title="Demo Trades" sub="Test logic — simulated account" />
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex flex-col items-center gap-2 pt-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400">
              <FlaskConical size={22} />
            </span>
            <p className="text-sm font-semibold text-ink">Practice with test capital</p>
            <p className="max-w-[260px] text-[10px] leading-snug text-ink-mute">
              Enter a virtual account size. Orders fill against the live bid/ask — same market / limit / stop logic as the real Trade Ticket, zero risk.
            </p>
          </div>
          <Field label="Test capital ($)" hint="Your simulated starting balance.">
            <input
              type="number" inputMode="decimal" min={1} step="any"
              value={capitalInput}
              onChange={(e) => setCapitalInput(e.target.value)}
              placeholder="10000"
              className={inputClass}
              autoFocus
            />
          </Field>
          <div className="flex flex-wrap justify-center gap-1.5">
            {CAPITAL_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setCapitalInput(String(v))}
                className={`rounded-md border px-2.5 py-1 font-mono text-[10px] transition-all duration-150 active:scale-95 ${
                  capitalInput === String(v)
                    ? "border-brand-500/50 bg-brand-500/15 text-brand-400 shadow-[inset_0_0_0_1px_rgba(255,77,0,0.25)]"
                    : "border-edge bg-card text-ink-mute hover:bg-raised hover:text-ink"
                }`}
              >
                ${v.toLocaleString()}
              </button>
            ))}
          </div>
          {feedback && <Feedback kind={feedback.kind} msg={feedback.msg} />}
          <PrimaryButton onClick={handleStart} disabled={!capitalInput || parseFloat(capitalInput) <= 0}>
            Start demo account
          </PrimaryButton>
        </div>
        <div className="flex items-center border-t border-edge px-3 py-2">
          <BackButton onClick={onBack} />
        </div>
      </div>
    );
  }

  /* ── main demo panel ─────────────────────────────────────────────── */
  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title="Demo Trades"
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
            <span className="rounded border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-brand-400">
              Simulated
            </span>
            {feedOnline && (
              <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
                <span className="h-1 w-1 animate-pulse-dot rounded-full bg-emerald-400" /> live
              </span>
            )}
          </div>
        }
      />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* account strip */}
        <div className="rounded-lg border border-edge bg-card p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
            <Wallet size={11} className="text-brand-400" />
            Test account
            <span className="ml-auto normal-case">
              {feedOnline ? (
                <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" /> live feed
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[9px] text-ink-faint">
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-600" /> feed offline — paused
                </span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <StatPill label="Balance" value={fmt(demo.balance, 2)} />
            <StatPill
              label="Equity"
              value={fmt(equity, 2)}
              tone={equity >= demo.balance ? "bullish" : equity < demo.balance ? "bearish" : "neutral"}
            />
            <StatPill
              label="Open PnL"
              value={`${openPnl >= 0 ? "+" : ""}${fmt(openPnl, 2)}`}
              tone={openPnl >= 0 ? "bullish" : "bearish"}
            />
            <StatPill
              label="Return"
              value={`${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`}
              tone={returnPct >= 0 ? "bullish" : "bearish"}
            />
          </div>
          {curvePts.length >= 2 && (
            <div className="mt-1.5 border-t border-edge pt-1.5">
              <div className="mb-0.5 flex items-center justify-between text-[9px] text-ink-faint">
                <span>Equity curve</span>
                <span className="font-mono">{fmt(curvePts[curvePts.length - 1], 2)}</span>
              </div>
              <Sparkline data={curvePts} width={350} height={28} />
            </div>
          )}
          {stats && stats.closed > 0 && (
            <div className="mt-1.5 space-y-1 border-t border-edge pt-1.5">
              <div className="flex items-center justify-between text-[9px] text-ink-faint">
                <span>
                  {stats.closed} closed · {stats.wins}W / {stats.losses}L · win rate{" "}
                  <span className="font-mono text-ink-mute">{(stats.winRate * 100).toFixed(0)}%</span>
                </span>
                <span>
                  realized{" "}
                  <span className={`font-mono ${stats.realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {stats.realizedPnl >= 0 ? "+" : ""}{fmt(stats.realizedPnl, 2)}
                  </span>
                </span>
              </div>
              <MiniBar
                pct={stats.winRate * 100}
                tone={stats.winRate >= 0.5 ? "bullish" : stats.winRate >= 0.4 ? "brand" : "bearish"}
                label={
                  <span className="flex w-full justify-between">
                    <span>Win rate</span>
                    <span className="font-mono">
                      PF {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"} · avg{" "}
                      <span className={stats.expectancy >= 0 ? "text-emerald-400" : "text-rose-400"}>
                        {stats.expectancy >= 0 ? "+" : ""}{fmt(stats.expectancy, 2)}
                      </span>
                    </span>
                  </span>
                }
              />
            </div>
          )}
          {exposure > 0 && demo && (
            <div className="mt-1.5 border-t border-edge pt-1.5 text-[9px] text-ink-faint">
              Exposure <span className="font-mono text-ink-mute">${fmt(exposure, 2)}</span>{" "}
              <span className="text-ink-faint">
                ({(exposure / Math.max(1, equity) * 100).toFixed(1)}% of equity at risk)
              </span>
            </div>
          )}
        </div>

        {/* direction + flip helper */}
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
                  {midPrice ? (
                    <>
                      <span className="font-mono text-[10px] font-normal opacity-90">{fmt(midPrice)}</span>
                      {spread > 0 && (
                        <span className="font-mono text-[8px] font-normal opacity-70">
                          spread {fmt(spread, 5)}
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

        {/* order type + sizing */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Order type">
            <SegmentedControl
              value={orderKind}
              onChange={setOrderKind}
              options={[
                { value: "market", label: "Market", title: "Fill at the current bid/ask" },
                { value: "limit", label: "Limit", title: "Park and trigger when price is more favorable" },
                { value: "stop", label: "Stop", title: "Trigger on a breakout through the entry" },
              ]}
            />
          </Field>
          <Field label="Sizing">
            <SegmentedControl
              value={sizingMode}
              onChange={setSizingMode}
              options={[
                { value: "risk", label: "Risk %", title: "Lots = risk% × equity ÷ (SL distance × 10)" },
                { value: "fixed", label: "Fixed", title: "Send exactly the typed-in lots" },
              ]}
            />
          </Field>
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

        {/* quick-SL chips: tap to set SL based on a $-risk budget at the current lot size */}
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

        {/* sizing mode + lots stepper */}
        <div className="grid grid-cols-2 gap-2">
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
          <div className="flex items-end">
            <div className="w-full rounded-lg border border-edge bg-card px-2.5 py-1.5 text-center">
              <div className="text-[9px] text-ink-faint">Volume</div>
              <div className="font-mono text-sm font-bold text-ink tabular-nums">{calc.volume}</div>
            </div>
          </div>
        </div>

        {calc.ticketError && <Feedback kind="info" msg={calc.ticketError} />}
        {needsStop && !calc.ticketError && calc.slNum <= 0 && (
          <Feedback kind="info" msg="Risk-% sizing needs a stop loss — or switch sizing to Fixed lots." />
        )}
        {!feedOnline && (
          <Feedback kind="info" msg="No live prices for this symbol yet — market orders and SL/TP checks resume as soon as the feed reconnects." />
        )}

        {feedback && <Feedback kind={feedback.kind} msg={feedback.msg} />}

        <PrimaryButton onClick={handlePlace} disabled={!canPreview}>
          {market ? `Simulate ${direction} ${calc.volume}` : `Place ${orderAction(orderKind, direction)} ${calc.volume}`}
        </PrimaryButton>

        {/* pending orders */}
        {pending.length > 0 && (
          <section>
            <SectionTitle>
              <span>Pending ({pending.length})</span>
              {confirmPanic === "cancelAll" ? (
                <span className="ml-auto flex gap-1">
                  <MiniButton onClick={() => setConfirmPanic(null)} variant="neutral">Keep</MiniButton>
                  <MiniButton onClick={handleCancelAll} variant="danger">Cancel all</MiniButton>
                </span>
              ) : (
                <MiniButton onClick={() => setConfirmPanic("cancelAll")} variant="danger" className="ml-auto">
                  <X size={9} /> Cancel all
                </MiniButton>
              )}
            </SectionTitle>
            <div className="space-y-1.5">
              {pending.map((p) => (
                <PositionRow
                  key={p.id}
                  p={p}
                  quote={quote}
                  midPrice={midPrice}
                  newlyPlaced={newlyPlacedId === p.id}
                  fmt={fmt}
                  onCancel={() => handleCancel(p.id)}
                  onDuplicate={() => handleDuplicate(p.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* open positions */}
        {open.length > 0 && (
          <section>
            <SectionTitle>
              <span>Open ({open.length}) · floating <span className={`ml-1 font-mono ${openPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{openPnl >= 0 ? "+" : ""}{fmt(openPnl, 2)}</span></span>
              {confirmPanic === "closeAll" ? (
                <span className="ml-auto flex gap-1">
                  <MiniButton onClick={() => setConfirmPanic(null)} variant="neutral">Keep</MiniButton>
                  <MiniButton onClick={handleCloseAll} variant="danger">Close all</MiniButton>
                </span>
              ) : (
                <MiniButton onClick={() => setConfirmPanic("closeAll")} variant="danger" className="ml-auto">
                  <Zap size={9} /> Close all
                </MiniButton>
              )}
            </SectionTitle>
            <div className="space-y-1.5">
              {open.map((p) => (
                <OpenPositionRow
                  key={p.id}
                  p={p}
                  quote={quote}
                  midPrice={midPrice}
                  newlyPlaced={newlyPlacedId === p.id}
                  fmt={fmt}
                  onClose={() => handleClose(p.id)}
                  onBreakeven={() => handleBreakeven(p.id)}
                  onDuplicate={() => handleDuplicate(p.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* history */}
        {history.length > 0 && (
          <section>
            <SectionTitle>
              <span>History</span>
              <span className="ml-auto font-mono normal-case text-ink-faint">
                PF {Number.isFinite(stats!.profitFactor) ? stats!.profitFactor.toFixed(2) : "∞"}
              </span>
            </SectionTitle>
            <div className="space-y-1">
              {history.map((p) => (
                <HistoryRow
                  key={p.id}
                  p={p}
                  fmt={fmt}
                  onDuplicate={() => handleDuplicate(p.id)}
                />
              ))}
            </div>
          </section>
        )}

        {demo.positions.length === 0 && (
          <p className="pt-1 text-center text-[10px] text-ink-faint">
            No trades yet — place your first simulated order above.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-edge bg-card/60 px-3 py-2">
        <BackButton onClick={onBack} />
        {confirmReset ? (
          <ConfirmActionRow
            onCancel={() => setConfirmReset(false)}
            onConfirm={handleReset}
            confirmLabel="Reset"
            confirmIcon={<RotateCcw size={12} className="shrink-0" />}
            destructive
          />
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="group flex h-8 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-edge bg-raised/80 px-3 text-xs font-medium text-ink-mute transition-all duration-150 hover:border-neutral-500 hover:bg-[#252528] hover:text-ink active:scale-95"
            title={`Reset test capital to $${demo.startingCapital.toLocaleString()} and clear positions`}
          >
            <RotateCcw size={12} className="shrink-0 text-ink-faint transition-transform duration-200 group-hover:-rotate-45" />
            <span className="truncate">Reset Demo</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ── sub-components ──────────────────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center text-[9px] font-semibold uppercase tracking-wider text-ink-faint">
      {children}
    </div>
  );
}

/** Age in seconds (or minutes/hours) for a pending / open row. */
function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Compact pnl badge used inside the history list — colored + signed. */
function PnlBadge({ value }: { value: number }) {
  const bull = value >= 0;
  return (
    <span className={`font-mono font-bold tabular-nums ${bull ? "text-emerald-400" : "text-rose-400"}`}>
      {bull ? "+" : ""}{value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

function CloseReasonChip({ reason }: { reason?: DemoCloseReason }) {
  if (!reason) return null;
  const cls =
    reason === "tp" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : reason === "sl" ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
    : reason === "breakeven" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : reason === "panic" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : "bg-white/5 text-neutral-400 border-edge";
  return (
    <span className={`rounded border px-1 py-px text-[8px] font-bold uppercase ${cls}`}>{reason}</span>
  );
}

function PositionRow({
  p, quote, midPrice, newlyPlaced, fmt, onCancel, onDuplicate,
}: {
  p: DemoPosition;
  quote: DemoQuote | null;
  midPrice: number;
  newlyPlaced: boolean;
  fmt: (v: number, digits?: number) => string;
  onCancel: () => void;
  onDuplicate: () => void;
}) {
  const ref = quote ?? { bid: midPrice, ask: midPrice };
  // Show distance from current price to the trigger (positive = not triggered yet).
  const triggerDist =
    p.kind === "limit"
      ? (p.side === "BUY" ? ref.ask - p.entry : p.entry - ref.bid)
      : (p.side === "BUY" ? p.entry - ref.ask : ref.bid - p.entry);
  const waits = triggerDist > 0;
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-edge bg-card px-2.5 py-1.5 transition-all duration-200 ${newlyPlaced ? "animate-fade-in border-brand-500/40" : ""}`}>
      <span className={`text-[10px] font-bold ${p.side === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
        {orderAction(p.kind, p.side)}
      </span>
      <span className="font-mono text-[10px] text-ink-mute">{p.lots} @ {fmt(p.entry)}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="font-mono text-[9px] text-ink-faint">
          {p.sl ? `SL ${fmt(p.sl)} ` : ""}{p.tp ? `TP ${fmt(p.tp)}` : ""}
        </span>
        {waits && quote && (
          <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1 py-px font-mono text-[8px] text-amber-400">
            Δ {fmt(triggerDist, 5)}
          </span>
        )}
        <span className="font-mono text-[8px] text-ink-faint">{formatAge(Date.now() - p.openedAt)}</span>
      </span>
      <button
        onClick={onDuplicate}
        title="Duplicate this order"
        className="rounded border border-edge bg-raised p-1 text-ink-mute transition-all duration-150 hover:border-brand-500/40 hover:text-brand-400 active:scale-90"
      >
        <Copy size={10} />
      </button>
      <button
        onClick={onCancel}
        title="Cancel order"
        className="rounded border border-edge bg-raised p-1 text-ink-mute transition-all duration-150 hover:border-rose-500/40 hover:text-rose-400 active:scale-90"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function OpenPositionRow({
  p, quote, midPrice, newlyPlaced, fmt, onClose, onBreakeven, onDuplicate,
}: {
  p: DemoPosition;
  quote: DemoQuote | null;
  midPrice: number;
  newlyPlaced: boolean;
  fmt: (v: number, digits?: number) => string;
  onClose: () => void;
  onBreakeven: () => void;
  onDuplicate: () => void;
}) {
  const ref = quote ?? { bid: midPrice, ask: midPrice };
  const pnl = floatingPnl(p, ref);
  const slDist = p.filledAt != null && p.sl != null ? Math.abs(p.filledAt - p.sl) : 0;
  const tpDist = p.filledAt != null && p.tp != null ? Math.abs(p.filledAt - p.tp) : 0;
  const atBreakeven = p.filledAt != null && p.sl === p.filledAt;
  // Distance from current price to SL — how many pips before we're stopped out.
  const distToSl = p.filledAt != null && p.sl != null
    ? (p.side === "BUY" ? ref.bid - p.sl : p.sl - ref.ask)
    : null;
  return (
    <div className={`rounded-lg border border-edge bg-card px-2.5 py-1.5 transition-all duration-200 ${newlyPlaced ? "animate-fade-in border-brand-500/40" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold ${dirClasses[p.side === "BUY" ? "bullish" : "bearish"]}`}>{p.side}</span>
        <span className="font-mono text-[10px] text-ink-mute">{p.lots} @ {fmt(p.filledAt ?? p.entry)}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {distToSl != null && (
            <span className={`rounded border px-1 py-px font-mono text-[8px] ${distToSl <= 0 ? "border-rose-500/40 bg-rose-500/15 text-rose-400" : distToSl < slDist * 0.2 ? "border-amber-500/40 bg-amber-500/15 text-amber-400" : "border-edge text-ink-faint"}`}>
              {distToSl <= 0 ? "⚠ past SL" : `Δ ${fmt(distToSl, 5)}`}
            </span>
          )}
          <span className={`font-mono text-[10px] font-bold tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {pnl >= 0 ? "+" : ""}{fmt(pnl, 2)}
          </span>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[9px] text-ink-faint">
        <span className="font-mono">
          {p.sl ? <span className="text-rose-400/80">SL {fmt(p.sl)}</span> : <span className="opacity-50">no SL</span>}
          {" · "}
          {p.tp ? <span className="text-emerald-400/80">TP {fmt(p.tp)}</span> : <span className="opacity-50">no TP</span>}
          {slDist > 0 && (
            <span className="ml-1 opacity-60">({fmt(slDist, 5)}{tpDist > 0 ? ` · R:R ${(tpDist / slDist).toFixed(1)}` : ""})</span>
          )}
        </span>
        <span className="ml-auto font-mono">{formatAge(Date.now() - (p.filledAtMs ?? p.openedAt))}</span>
      </div>
      <div className="mt-1 flex gap-1">
        <MiniButton
          onClick={onBreakeven}
          variant="success"
          disabled={!p.filledAt || p.sl === p.filledAt}
          title="Move stop loss to breakeven"
        >
          <ShieldCheck size={9} /> BE
        </MiniButton>
        <MiniButton onClick={onDuplicate} variant="brand" title="Duplicate this position">
          <Copy size={9} /> Dup
        </MiniButton>
        <MiniButton onClick={onClose} variant="danger" className="ml-auto" title={`${p.filledAt ? "Close at market" : "Cancel pending"}`}>
          <X size={9} /> Close
        </MiniButton>
      </div>
    </div>
  );
}

function HistoryRow({
  p, fmt, onDuplicate,
}: {
  p: DemoPosition;
  fmt: (v: number, digits?: number) => string;
  onDuplicate: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded px-0.5 py-0.5 text-[10px] transition-colors duration-150 hover:bg-raised/50">
      <span className={`font-bold ${dirClasses[p.side === "BUY" ? "bullish" : "bearish"]}`}>{p.side}</span>
      <span className="font-mono text-ink-faint">{p.lots} @ {fmt(p.filledAt ?? p.entry)} → {fmt(p.exitPrice ?? 0)}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <CloseReasonChip reason={p.closeReason} />
        <PnlBadge value={p.pnl ?? 0} />
        <button
          onClick={onDuplicate}
          title="Duplicate this trade"
          className="rounded border border-edge bg-raised p-0.5 text-ink-faint opacity-0 transition-all duration-150 hover:border-brand-500/40 hover:text-brand-400 active:scale-90 group-hover:opacity-100"
        >
          <Copy size={9} />
        </button>
      </span>
    </div>
  );
}