import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  ShieldAlert,
  Send,
  CheckSquare,
  Square,
  AlertOctagon,
  ExternalLink,
  ClipboardCheck,
  Loader2,
} from "lucide-react";
import type {
  ExecutionResult,
  NormalizedOrderIntent,
  PreparedTradeDraft,
  RiskCheckResult,
  TradingViewAccountInfo,
} from "@/types/execution";
import { EXECUTION_UNCONFIRMED_MESSAGE } from "@/types/execution";
import { TradingViewExecutionAdapter } from "@/services/execution-adapter";
import {
  buildOrderIntent,
  createTicketRequestId,
  evaluateTicketGating,
  modeLabel,
  ticketSummary,
} from "@/services/trade-ticket";
import { ProRiskGuardPanel } from "./ProRiskGuardPanel";

interface Props {
  account: TradingViewAccountInfo;
  initialSymbol?: string;
  initialPrice?: number;
  initialSide?: "BUY" | "SELL";
  timeframe?: string | null;
  /** AI Setup Radar / Copilot prepared trade — pre-fills the ticket once. */
  preparedDraft?: PreparedTradeDraft | null;
  onDraftConsumed?: () => void;
  /** Real chart price used as the risk reference for MARKET orders. */
  marketPrice?: number | null;
  /** Chart context is older than the freshness window (§24 stale context). */
  staleContext?: boolean;
  onExecutionComplete: (result: ExecutionResult, intent: NormalizedOrderIntent) => void;
}

const adapter = new TradingViewExecutionAdapter();

const LIFECYCLE_LABEL: Record<string, string> = {
  PREPARING: "PREPARING",
  SUBMITTING: "SUBMITTING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  PARTIALLY_FILLED: "PARTIALLY FILLED",
  FILLED: "FILLED",
  CANCELLED: "CANCELLED",
  UNAVAILABLE: "UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
};

const fieldClass =
  "w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-100 focus:border-cyan-500 focus:outline-none";

/**
 * Professional trade confirmation ticket (§6 + §7 + §8 + §9 + §12).
 *
 * The AI never executes: this component only builds a normalized intent and
 * requires an explicit "Review & Confirm Trade" action (plus a live-risk
 * acknowledgement for LIVE / unreported accounts) before the adapter is
 * allowed to submit anything.
 */
export const ProTradeTicketView: React.FC<Props> = ({
  account,
  initialSymbol = "EURUSD",
  initialPrice,
  initialSide = "BUY",
  timeframe,
  preparedDraft = null,
  onDraftConsumed,
  marketPrice,
  staleContext = false,
  onExecutionComplete,
}) => {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [quantity, setQuantity] = useState<number>(0.01);
  const [entryPrice, setEntryPrice] = useState<string>(initialPrice ? String(initialPrice) : "");
  const [stopLoss, setStopLoss] = useState<string>("");
  const [takeProfit, setTakeProfit] = useState<string>("");

  const [requestId, setRequestId] = useState<string>(() => createTicketRequestId());
  const [riskEvaluation, setRiskEvaluation] = useState<RiskCheckResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [liveAcknowledged, setLiveAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);

  // Pre-fill once from an AI prepared trade, then hand control back.
  useEffect(() => {
    if (!preparedDraft) return;
    setSymbol(preparedDraft.symbol);
    setSide(preparedDraft.side);
    setOrderType(preparedDraft.orderType);
    if (preparedDraft.quantity !== null) setQuantity(preparedDraft.quantity);
    setEntryPrice(preparedDraft.price !== null ? String(preparedDraft.price) : "");
    setStopLoss(preparedDraft.stopLoss !== null ? String(preparedDraft.stopLoss) : "");
    setTakeProfit(preparedDraft.takeProfit !== null ? String(preparedDraft.takeProfit) : "");
    setRequestId(createTicketRequestId());
    setRiskEvaluation(null);
    setLastResult(null);
    setLiveAcknowledged(false);
    onDraftConsumed?.();
  }, [preparedDraft, onDraftConsumed]);

  const capabilities = useMemo(() => adapter.getCapabilities(account), [account]);

  const intent: NormalizedOrderIntent = useMemo(
    () =>
      buildOrderIntent(
        {
          requestId,
          symbol,
          side,
          orderType,
          quantity,
          price: entryPrice ? Number(entryPrice) : null,
          stopLoss: stopLoss ? Number(stopLoss) : null,
          takeProfit: takeProfit ? Number(takeProfit) : null,
          timeframe: timeframe ?? null,
        },
        account
      ),
    [requestId, symbol, side, orderType, quantity, entryPrice, stopLoss, takeProfit, timeframe, account]
  );

  const validation = useMemo(
    () => adapter.validateOrder(intent, account, capabilities),
    [intent, account, capabilities]
  );

  const gating = useMemo(
    () =>
      evaluateTicketGating({
        account,
        capabilities,
        validation,
        risk: riskEvaluation,
        riskEvaluated: riskEvaluation !== null,
        liveAcknowledged,
        submitting,
      }),
    [account, capabilities, validation, riskEvaluation, liveAcknowledged, submitting]
  );

  const isLive = account.mode === "LIVE";
  const needsAck = gating.requiresLiveAcknowledgement;
  const executionEnabled =
    account.accountState === "TRADING_ENABLED" && account.tradingEnabled;

  const handleEvaluateRisk = () => {
    setRiskEvaluation(adapter.computeRiskCheck(intent, account, marketPrice ?? null));
  };

  const handleReview = () => {
    if (!gating.canReview) return;
    if (riskEvaluation === null) {
      // The risk check always runs before the confirm sheet is allowed.
      setRiskEvaluation(adapter.computeRiskCheck(intent, account, marketPrice ?? null));
    }
    setShowConfirm(true);
  };

  const handleConfirmAndExecute = async () => {
    if (!gating.canConfirm) return;
    setSubmitting(true);
    try {
      const result = await adapter.submitOrder(intent, account, {
        userConfirmed: true,
        liveAcknowledged,
        marketPrice: marketPrice ?? null,
      });
      setLastResult(result);
      setShowConfirm(false);
      if (result.receipt) {
        onExecutionComplete(result, intent);
      }
    } catch (err) {
      setLastResult({
        requestId,
        status: "UNKNOWN",
        orderId: null,
        executionPrice: null,
        filledQuantity: null,
        timestamp: Date.now(),
        error: `${EXECUTION_UNCONFIRMED_MESSAGE} (${err instanceof Error ? err.message : "unexpected error"})`,
        mode: account.mode,
        broker: account.broker,
        uncertain: true,
        confirmed: false,
        statusTimeline: [{ status: "PREPARING", at: Date.now() }, { status: "UNKNOWN", at: Date.now() }],
      });
      setShowConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  const startNewTicket = () => {
    setRequestId(createTicketRequestId());
    setLastResult(null);
    setRiskEvaluation(null);
    setLiveAcknowledged(false);
    setShowConfirm(false);
  };

  const summaryLines = ticketSummary(intent, account);
  const tvHandoffUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    symbol.toUpperCase()
  )}`;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
          TradingView Trade
        </span>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isLive || needsAck
              ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
              : account.mode === "DEMO"
              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
          }`}
        >
          {isLive ? "⚠ LIVE ACCOUNT" : modeLabel(account.mode)}
        </span>
      </div>

      {/* Execution unavailable → preparation & handoff (§28) */}
      {!executionEnabled && (
        <div className="bg-amber-950/40 border border-amber-500/30 text-amber-300 p-2 rounded text-[11px] flex items-start gap-2">
          <AlertOctagon size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <span className="font-semibold block text-amber-200">Execution unavailable</span>
            <p>
              {account.unsupportedReason ||
                "TradingView MCP is read-only and no execution gateway is connected."}
            </p>
            <p className="text-amber-200/80">
              You can still prepare the full order below and hand it off to TradingView.
            </p>
            <a
              href={tvHandoffUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 font-semibold text-amber-200 hover:bg-amber-500/20"
            >
              <ExternalLink size={11} /> Open in TradingView
            </a>
          </div>
        </div>
      )}

      {/* Stale market context (§24) */}
      {staleContext && (
        <div className="bg-amber-950/40 border border-amber-500/30 text-amber-300 p-2 rounded text-[11px] flex items-start gap-2">
          <AlertOctagon size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <span>
            Market context is older than 2 minutes. The stale price was excluded from the risk
            calculation — refresh the chart before relying on reference levels.
          </span>
        </div>
      )}

      {/* Side selector */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("BUY")}
          className={`py-2 rounded font-bold flex items-center justify-center gap-1.5 transition-colors border ${
            side === "BUY"
              ? "bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-950/50"
              : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
          }`}
        >
          <ArrowUpRight size={14} /> BUY / LONG
        </button>
        <button
          type="button"
          onClick={() => setSide("SELL")}
          className={`py-2 rounded font-bold flex items-center justify-center gap-1.5 transition-colors border ${
            side === "SELL"
              ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/50"
              : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
          }`}
        >
          <ArrowDownRight size={14} /> SELL / SHORT
        </button>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <label className="text-slate-400 block mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1">Order Type</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as "MARKET" | "LIMIT" | "STOP")}
            className={`${fieldClass} font-sans`}
          >
            <option value="MARKET">MARKET</option>
            <option value="LIMIT">LIMIT</option>
            <option value="STOP">STOP</option>
          </select>
        </div>
        <div>
          <label className="text-slate-400 block mb-1">Quantity (Lots)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1">
            Entry Price {orderType === "MARKET" ? "(reference)" : ""}
          </label>
          <input
            type="number"
            step="any"
            placeholder={orderType === "MARKET" ? "Market" : "Required"}
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1">Stop Loss (SL)</label>
          <input
            type="number"
            step="any"
            placeholder="SL price"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1">Take Profit (TP)</label>
          <input
            type="number"
            step="any"
            placeholder="TP price"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>

      {/* Risk guard */}
      <div className="pt-1 flex gap-2">
        <button
          type="button"
          onClick={handleEvaluateRisk}
          className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition-colors border border-slate-700 flex items-center justify-center gap-1.5"
        >
          <ClipboardCheck size={13} />
          {riskEvaluation ? "Re-run Execution Risk Check" : "Run Execution Risk Check"}
        </button>
      </div>
      {riskEvaluation && <ProRiskGuardPanel riskResult={riskEvaluation} />}

      {/* Live acknowledgement (§7 / §21) */}
      {needsAck && (
        <div
          onClick={() => setLiveAcknowledged((v) => !v)}
          className="cursor-pointer bg-rose-950/30 border border-rose-500/30 p-2 rounded flex items-start gap-2 text-rose-300 text-[11px]"
        >
          {liveAcknowledged ? (
            <CheckSquare size={16} className="text-rose-400 shrink-0 mt-0.5" />
          ) : (
            <Square size={16} className="text-rose-400 shrink-0 mt-0.5" />
          )}
          <span>
            {isLive ? (
              <>
                I understand this order will be sent to a <strong>LIVE account</strong> at{" "}
                {account.broker || "the connected broker"} and will affect real funds.
              </>
            ) : (
              <>
                Account mode was <strong>not reported</strong> by any source. I understand this
                order <strong>may affect a live account</strong> and I accept the risk.
              </>
            )}
          </span>
        </div>
      )}

      {/* Blockers */}
      {!gating.canConfirm && gating.blockers.length > 0 && (
        <div className="bg-slate-950/70 border border-slate-700 rounded p-2 space-y-1 text-[10px] text-amber-300/90">
          <span className="font-semibold text-amber-200 uppercase tracking-wider text-[9px]">
            Blocked from execution
          </span>
          {gating.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <ShieldAlert size={11} className="shrink-0 mt-0.5 text-amber-400" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Execution status lifecycle (§12) */}
      {lastResult && !lastResult.receipt && (
        <div
          className={`rounded border p-2 text-[11px] space-y-1.5 ${
            lastResult.status === "UNKNOWN"
              ? "bg-amber-950/40 border-amber-500/40 text-amber-200"
              : lastResult.status === "REJECTED" || lastResult.status === "UNAVAILABLE"
              ? "bg-rose-950/40 border-rose-500/40 text-rose-200"
              : "bg-slate-950/70 border-slate-700 text-slate-300"
          }`}
        >
          <div className="flex flex-wrap items-center gap-1">
            {lastResult.statusTimeline.map((ev, i) => (
              <React.Fragment key={`${ev.status}-${ev.at}-${i}`}>
                {i > 0 && <span className="text-slate-600">↓</span>}
                <span
                  className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${
                    ev.status === lastResult.status
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : "border-slate-700 bg-slate-900 text-slate-400"
                  }`}
                >
                  {LIFECYCLE_LABEL[ev.status] || ev.status}
                </span>
              </React.Fragment>
            ))}
          </div>
          {lastResult.error && <p>{lastResult.error}</p>}
          {lastResult.status === "UNKNOWN" && (
            <button
              type="button"
              onClick={startNewTicket}
              className="mt-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
            >
              Start a new ticket
            </button>
          )}
        </div>
      )}

      {/* Validation summary */}
      {validation.warnings.length > 0 && validation.valid && (
        <ul className="text-[10px] text-amber-300/80 list-disc pl-4 space-y-0.5">
          {validation.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {/* Primary action */}
      <button
        type="button"
        disabled={!gating.canReview}
        onClick={handleReview}
        className={`w-full py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 text-white shadow-lg transition-all border ${
          !gating.canReview
            ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
            : side === "BUY"
            ? "bg-emerald-600 hover:bg-emerald-500 border-emerald-500 shadow-emerald-950/60"
            : "bg-rose-600 hover:bg-rose-500 border-rose-500 shadow-rose-950/60"
        }`}
      >
        <Send size={14} />
        Review &amp; Confirm Trade
      </button>

      <p className="text-[9px] text-slate-500 text-center">
        Ticket {requestId} · the AI never executes orders — submission only happens on your explicit
        confirmation.
      </p>

      {/* ── confirmation sheet ───────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="animate-slide-up w-full max-w-[340px] space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                {isLive || needsAck ? (
                  <ShieldAlert size={13} className="text-rose-400" />
                ) : (
                  <ClipboardCheck size={13} className="text-cyan-400" />
                )}
                Review &amp; Confirm Trade
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                  isLive || needsAck
                    ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                    : "bg-slate-800 text-slate-300 border-slate-700"
                }`}
              >
                {modeLabel(account.mode)}
              </span>
            </div>

            <div className="space-y-1 text-[11px] bg-slate-950/70 rounded border border-slate-800 p-2">
              {summaryLines.map((line) => (
                <div key={line.label} className="flex justify-between">
                  <span className="text-slate-400">{line.label}</span>
                  <span
                    className={`font-mono ${
                      line.tone === "danger"
                        ? "text-rose-400"
                        : line.tone === "success"
                        ? "text-emerald-400"
                        : line.tone === "muted"
                        ? "text-slate-500"
                        : "text-slate-200"
                    }`}
                  >
                    {line.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Estimated risk */}
            <div className="text-[11px] bg-slate-950/70 rounded border border-slate-800 p-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Estimated risk</span>
                <span className="text-slate-200 font-mono">
                  {riskEvaluation && riskEvaluation.riskAmount !== null
                    ? `$${riskEvaluation.riskAmount.toFixed(2)}${
                        riskEvaluation.riskPercentage !== null
                          ? ` (${riskEvaluation.riskPercentage.toFixed(2)}%)`
                          : ""
                      }`
                    : "Not calculable"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">R:R</span>
                <span className="text-slate-200 font-mono">
                  {riskEvaluation && riskEvaluation.potentialRiskReward !== null
                    ? `1 : ${riskEvaluation.potentialRiskReward.toFixed(2)}`
                    : "Not calculable"}
                </span>
              </div>
            </div>

            {(isLive || needsAck) && (
              <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-2 rounded text-[11px] flex items-start gap-2">
                <ShieldAlert size={13} className="text-rose-400 shrink-0 mt-0.5" />
                <span>
                  {isLive
                    ? "This is a LIVE order. It will be routed to the connected broker account."
                    : "Account mode is unreported — this order may be routed to a live account."}
                </span>
              </div>
            )}

            {!gating.canConfirm && (
              <div className="bg-amber-950/40 border border-amber-500/30 text-amber-200 p-2 rounded text-[11px] space-y-1">
                {gating.blockers.map((b, i) => (
                  <div key={i}>• {b}</div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-[11px] text-slate-300 transition-all hover:bg-slate-700 active:scale-[0.97] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAndExecute}
                disabled={!gating.canConfirm || submitting}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[11px] font-bold text-white transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed ${
                  side === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"
                }`}
              >
                {submitting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    Confirm &amp; Submit {side}{" "}
                    {isLive || needsAck ? "· ⚠ LIVE ORDER" : `· ${modeLabel(account.mode)} ORDER`}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
