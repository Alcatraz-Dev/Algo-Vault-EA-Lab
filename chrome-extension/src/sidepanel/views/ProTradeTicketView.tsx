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

/**
 * Lifecycle labels rendered on the ticket. They mirror the server's Unified
 * Trading statuses — IN FLIGHT (`ACCEPTED`) and PENDING SYNC are shown as
 * their own states, never as a fill.
 */
const LIFECYCLE_LABEL: Record<string, string> = {
  PREPARING: "PREPARING",
  SUBMITTING: "SUBMITTING",
  ACCEPTED: "ACCEPTED — WAITING FOR CONFIRMATION",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
  PARTIALLY_FILLED: "PARTIALLY FILLED",
  FILLED: "FILLED",
  CANCELLED: "CANCELLED",
  EXECUTED_PENDING_SYNC: "EXECUTED — SYNCING POSITION",
  UNAVAILABLE: "UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
};

const fieldClass =
  "w-full rounded-lg border border-input bg-background px-2 py-1.5 font-numeric text-[11px] text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";

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
    <div className="bg-card border border-border rounded-xl p-3 space-y-3 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
          TradingView Trade
        </span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            isLive || needsAck
              ? "bg-negative/20 text-negative border-negative/40"
              : account.mode === "DEMO"
              ? "bg-warning/15 text-warning border-warning/30"
              : "bg-positive/15 text-positive border-positive/30"
          }`}
        >
          {isLive ? "LIVE ACCOUNT" : modeLabel(account.mode)}
        </span>
      </div>

      {/* Execution unavailable → preparation & handoff (§28) */}
      {!executionEnabled && (
        <div className="bg-warning/10 border border-warning/30 text-warning p-2 rounded-lg text-[11px] flex items-start gap-2">
          <AlertOctagon size={15} className="text-warning shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <span className="font-semibold block text-warning">Execution unavailable</span>
            <p>
              {account.unsupportedReason ||
                "TradingView MCP is read-only and no execution gateway is connected."}
            </p>
            <p className="text-warning">
              You can still prepare the full order below and hand it off to TradingView.
            </p>
            <a
              href={tvHandoffUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 font-semibold text-warning hover:bg-warning/20"
            >
              <ExternalLink size={11} /> Open in TradingView
            </a>
          </div>
        </div>
      )}

      {/* Stale market context (§24) */}
      {staleContext && (
        <div className="bg-warning/10 border border-warning/30 text-warning p-2 rounded-lg text-[11px] flex items-start gap-2">
          <AlertOctagon size={15} className="text-warning shrink-0 mt-0.5" />
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
          className={`py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-colors border ${
            side === "BUY"
              ? "bg-positive-fill text-white border-positive-fill"
              : "bg-secondary text-muted-foreground border-border hover:text-foreground"
          }`}
        >
          <ArrowUpRight size={14} /> BUY / LONG
        </button>
        <button
          type="button"
          onClick={() => setSide("SELL")}
          className={`py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-colors border ${
            side === "SELL"
              ? "bg-negative-fill text-white border-negative-fill"
              : "bg-secondary text-muted-foreground border-border hover:text-foreground"
          }`}
        >
          <ArrowDownRight size={14} /> SELL / SHORT
        </button>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <label className="text-muted-foreground block mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-muted-foreground block mb-1">Order Type</label>
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
          <label className="text-muted-foreground block mb-1">Quantity (Lots)</label>
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
          <label className="text-muted-foreground block mb-1">
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
          <label className="text-muted-foreground block mb-1">Stop Loss (SL)</label>
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
          <label className="text-muted-foreground block mb-1">Take Profit (TP)</label>
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
          className="flex-1 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg font-medium transition-colors border border-border flex items-center justify-center gap-1.5"
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
          className="cursor-pointer bg-negative/10 border border-negative/30 p-2 rounded-lg flex items-start gap-2 text-negative text-[11px]"
        >
          {liveAcknowledged ? (
            <CheckSquare size={16} className="text-negative shrink-0 mt-0.5" />
          ) : (
            <Square size={16} className="text-negative shrink-0 mt-0.5" />
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
        <div className="bg-secondary/40 border border-border rounded-lg p-2 space-y-1 text-[10px] text-warning">
          <span className="font-semibold text-warning uppercase tracking-wider text-[10px]">
            Blocked from execution
          </span>
          {gating.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <ShieldAlert size={11} className="shrink-0 mt-0.5 text-warning" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Execution status lifecycle (§12) */}
      {lastResult && !lastResult.receipt && (
        <div
          className={`rounded-lg border p-2 text-[11px] space-y-1.5 ${
            lastResult.status === "UNKNOWN"
              ? "bg-warning/10 border-warning/40 text-warning"
              : lastResult.status === "REJECTED" || lastResult.status === "UNAVAILABLE"
              ? "bg-negative/10 border-negative/40 text-negative"
              : "bg-secondary/40 border-border text-foreground"
          }`}
        >
          <div className="flex flex-wrap items-center gap-1">
            {lastResult.statusTimeline.map((ev, i) => (
              <React.Fragment key={`${ev.status}-${ev.at}-${i}`}>
                {i > 0 && <span className="text-muted-foreground">↓</span>}
                <span
                  className={`px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${
                    ev.status === lastResult.status
                      ? "border-brand/50 bg-brand/10 text-foreground"
                      : "border-border bg-card text-muted-foreground"
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
              className="mt-1 rounded-lg border border-border bg-secondary px-2 py-1 text-[10px] text-foreground hover:bg-secondary/80"
            >
              Start a new ticket
            </button>
          )}
        </div>
      )}

      {/* Validation summary */}
      {validation.warnings.length > 0 && validation.valid && (
        <ul className="text-[10px] text-warning list-disc pl-4 space-y-0.5">
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
        className={`w-full py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 text-white transition-colors border ${
          !gating.canReview
            ? "bg-secondary border-border text-muted-foreground cursor-not-allowed"
            : side === "BUY"
            ? "bg-positive-fill text-white border-positive-fill"
            : "bg-negative-fill text-white border-negative-fill"
        }`}
      >
        <Send size={14} />
        Review &amp; Confirm Trade
      </button>

      <p className="text-[10px] text-muted-foreground text-center">
        Ticket {requestId} · the AI never executes orders — submission only happens on your explicit
        confirmation.
      </p>

      {/* ── confirmation sheet ───────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[340px] space-y-3 rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                {isLive || needsAck ? (
                  <ShieldAlert size={13} className="text-negative" />
                ) : (
                  <ClipboardCheck size={13} />
                )}
                Review &amp; Confirm Trade
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  isLive || needsAck
                    ? "bg-negative/20 text-negative border-negative/40"
                    : "bg-secondary text-foreground border-border"
                }`}
              >
                {modeLabel(account.mode)}
              </span>
            </div>

            <div className="space-y-1 text-[11px] bg-secondary/40 rounded-lg border border-border p-2">
              {summaryLines.map((line) => (
                <div key={line.label} className="flex justify-between">
                  <span className="text-muted-foreground">{line.label}</span>
                  <span
                    className={`font-numeric ${
                      line.tone === "danger"
                        ? "text-negative"
                        : line.tone === "success"
                        ? "text-positive"
                        : line.tone === "muted"
                        ? "text-muted-foreground"
                        : "text-foreground"
                    }`}
                  >
                    {line.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Estimated risk */}
            <div className="text-[11px] bg-secondary/40 rounded-lg border border-border p-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated risk</span>
                <span className="text-foreground font-numeric">
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
                <span className="text-muted-foreground">R:R</span>
                <span className="text-foreground font-numeric">
                  {riskEvaluation && riskEvaluation.potentialRiskReward !== null
                    ? `1 : ${riskEvaluation.potentialRiskReward.toFixed(2)}`
                    : "Not calculable"}
                </span>
              </div>
            </div>

            {(isLive || needsAck) && (
              <div className="bg-negative/10 border border-negative/30 text-negative p-2 rounded-lg text-[11px] flex items-start gap-2">
                <ShieldAlert size={13} className="text-negative shrink-0 mt-0.5" />
                <span>
                  {isLive
                    ? "This is a LIVE order. It will be routed to the connected broker account."
                    : "Account mode is unreported — this order may be routed to a live account."}
                </span>
              </div>
            )}

            {!gating.canConfirm && (
              <div className="bg-warning/10 border border-warning/30 text-warning p-2 rounded-lg text-[11px] space-y-1">
                {gating.blockers.map((b, i) => (
                  <div key={i}>• {b}</div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
                className="flex-1 rounded-lg border border-border bg-secondary py-2.5 text-[11px] text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAndExecute}
                disabled={!gating.canConfirm || submitting}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[11px] font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  side === "BUY" ? "bg-positive hover:bg-positive/90" : "bg-negative hover:bg-negative/90"
                }`}
              >
                {submitting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    Confirm &amp; Submit {side}{" "}
                    {isLive || needsAck ? "· LIVE ORDER" : `· ${modeLabel(account.mode)} ORDER`}
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
