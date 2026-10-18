import React, { useEffect, useState } from "react";
import { Activity, XCircle, TrendingUp, TrendingDown, Clock, AlertCircle, ShieldQuestion, Pencil, Sparkles } from "lucide-react";
import type { TradingViewAccountInfo, TradingViewPosition } from "@/types/execution";
import type { SmartAlert } from "@/types/pro";
import {
  closePositionRequest,
  modifyPositionRequest,
  newClientRequestId,
  partialClosePositionRequest,
  runUnifiedExecution,
  type UnifiedExecutionOutcome,
} from "@/api/unified-trading";
import { fetchSmartAlerts } from "@/api/pro";
import { accountAgeLabel } from "@/services/tv-account-service";

interface Props {
  account: TradingViewAccountInfo;
  onRefresh: () => void;
  /** Timeframe used for the informational AI position monitor. */
  timeframe?: string | null;
}

/**
 * One prepared position action. The clientRequestId is minted ONCE when the
 * confirmation is opened and reused on every retry of that same click, so the
 * Unified Trading idempotency system — not a client guess — prevents a double
 * close / double modification.
 */
interface PendingAction {
  type: "close" | "modify";
  positionId: string;
  /** Idempotency key for THIS action (full close, or modify SL/TP). */
  clientRequestId: string;
  /**
   * A distinct key for the partial close offered next to the full close: the
   * two are different payloads, so they must never share one key (the server
   * rejects a reused key with a changed body).
   */
  partialRequestId?: string;
}

/** User-facing line for a Unified Trading outcome (server words, never faked). */
function outcomeLine(prefix: string, outcome: UnifiedExecutionOutcome): string {
  if (outcome.ok) {
    const ticket = outcome.result?.providerRef ? ` · ticket ${outcome.result.providerRef}` : "";
    return `${prefix} — ${outcome.message}${ticket}`;
  }
  return `${prefix} — ${outcome.message}`;
}

/**
 * ACTIVE POSITIONS (§10) — renders only rows reported by the connected
 * gateway. P/L and current price show "—" when the source did not report
 * them; nothing is simulated.
 *
 * Every close / modify action is submitted to the Unified Trading API
 * (`POST /api/trading/execute` → UnifiedTradingService) after an explicit
 * in-panel confirmation, and the panel renders the SERVER's outcome verbatim.
 * "Close" means a full close; a partial close submits a percentage of the
 * CURRENT POSITION VOLUME and lets the server own lot-step rounding, dust
 * handling and full-close promotion. No provider name, environment, mode or
 * userId is ever sent, and no MT5 ticket is used as a command — positions are
 * addressed by their unified `positionId`.
 */
export const ProPositionMonitorView: React.FC<Props> = ({ account, onRefresh, timeframe }) => {
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modifySl, setModifySl] = useState<string>("");
  const [modifyTp, setModifyTp] = useState<string>("");
  /** Percentage of the CURRENT POSITION VOLUME to close. */
  const [partialPercent, setPartialPercent] = useState<string>("50");
  const [aiUpdates, setAiUpdates] = useState<SmartAlert[] | null>(null);

  const positions = account.openPositions || [];
  const positionSymbols = [...new Set(positions.map((p) => p.symbol))].join(",");
  const available = account.dataAvailability.positions;
  const totalUnrealized = positions.every((p) => p.unrealizedPnl !== null)
    ? positions.reduce((acc, p) => acc + (p.unrealizedPnl || 0), 0)
    : null;

  /* §15 — informational AI monitoring for open positions. The AI may only
     surface context changes; it never queues, modifies or closes anything. */
  useEffect(() => {
    if (!positions.length) {
      setAiUpdates(null);
      return;
    }
    let cancelled = false;
    const symbols = positionSymbols.split(",").filter(Boolean).slice(0, 3);
    void (async () => {
      try {
        const since = Date.now() - 6 * 60 * 60 * 1000;
        const batches = await Promise.all(
          symbols.map((s) => fetchSmartAlerts(s, timeframe || "H1", since).catch(() => []))
        );
        if (!cancelled) setAiUpdates(batches.flat().slice(0, 6));
      } catch {
        if (!cancelled) setAiUpdates(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionSymbols, timeframe]);

  const startClose = (pos: TradingViewPosition) => {
    setActionMsg(null);
    setPending({
      type: "close",
      positionId: pos.id,
      clientRequestId: newClientRequestId("close"),
      partialRequestId: newClientRequestId("partial"),
    });
  };

  const startModify = (pos: TradingViewPosition) => {
    setActionMsg(null);
    setModifySl(pos.stopLoss !== null ? String(pos.stopLoss) : "");
    setModifyTp(pos.takeProfit !== null ? String(pos.takeProfit) : "");
    setPending({ type: "modify", positionId: pos.id, clientRequestId: newClientRequestId("modify") });
  };

  const confirmClose = async (pos: TradingViewPosition, action: PendingAction) => {
    if (!account.accountId) {
      setActionMsg("No execution account reference — cannot submit a close.");
      return;
    }
    setBusyId(pos.id);
    setActionMsg(null);
    try {
      // The SAME clientRequestId is reused if this click is retried.
      const outcome = await runUnifiedExecution(
        closePositionRequest({
          accountId: account.accountId,
          clientRequestId: action.clientRequestId,
          positionId: pos.id,
          symbol: pos.symbol,
        })
      );
      setActionMsg(outcomeLine(`Close ${pos.symbol}`, outcome));
      if (outcome.ok || outcome.status === "ACCEPTED") setPending(null);
    } finally {
      setBusyId(null);
      onRefresh();
    }
  };

  const confirmPartialClose = async (pos: TradingViewPosition, action: PendingAction) => {
    if (!account.accountId) {
      setActionMsg("No execution account reference — cannot submit a partial close.");
      return;
    }
    const percentage = Number(partialPercent);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) {
      setActionMsg("Partial close percentage must be between 1 and 99.");
      return;
    }
    setBusyId(pos.id);
    setActionMsg(null);
    try {
      // The percentage is a percentage of the CURRENT POSITION VOLUME. The
      // Extension never converts it to lots and never rounds it — the server
      // owns lot-step rounding, dust closing and full-close promotion.
      const outcome = await runUnifiedExecution(
        partialClosePositionRequest({
          accountId: account.accountId,
          clientRequestId: action.partialRequestId ?? action.clientRequestId,
          positionId: pos.id,
          percentage,
          symbol: pos.symbol,
        })
      );
      setActionMsg(outcomeLine(`Partial close ${percentage}% of ${pos.symbol}`, outcome));
      if (outcome.ok || outcome.status === "ACCEPTED") setPending(null);
    } finally {
      setBusyId(null);
      onRefresh();
    }
  };

  const confirmModify = async (pos: TradingViewPosition, action: PendingAction) => {
    if (!account.accountId) {
      setActionMsg("No execution account reference — cannot submit a modification.");
      return;
    }
    setBusyId(pos.id);
    setActionMsg(null);
    try {
      const outcome = await runUnifiedExecution(
        modifyPositionRequest({
          accountId: account.accountId,
          clientRequestId: action.clientRequestId,
          positionId: pos.id,
          symbol: pos.symbol,
          stopLoss: modifySl ? Number(modifySl) : null,
          takeProfit: modifyTp ? Number(modifyTp) : null,
        })
      );
      setActionMsg(outcomeLine(`Modify ${pos.symbol}`, outcome));
      if (outcome.ok || outcome.status === "ACCEPTED") setPending(null);
    } finally {
      setBusyId(null);
      onRefresh();
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground uppercase tracking-wider text-[11px]">
          <Activity size={14} /> Active Positions ({positions.length})
        </div>
        <div className="flex items-center gap-2">
          <span className="font-numeric text-[10px] text-muted-foreground">{accountAgeLabel(account)}</span>
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground block">Total P/L</span>
            <span
              className={`font-bold font-numeric text-[11px] ${
                totalUnrealized === null
                  ? "text-muted-foreground"
                  : totalUnrealized >= 0
                  ? "text-positive"
                  : "text-negative"
              }`}
            >
              {totalUnrealized === null
                ? "Not reported"
                : `${totalUnrealized >= 0 ? "+" : ""}$${totalUnrealized.toFixed(2)}`}
            </span>
          </div>
        </div>
      </div>

      {actionMsg && (
        <div className="bg-secondary border border-border text-foreground p-2 rounded-lg text-[11px] flex items-start gap-1.5">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{actionMsg}</span>
        </div>
      )}

      {!available ? (
        <div className="text-center py-6 text-muted-foreground text-[11px] space-y-1.5">
          <ShieldQuestion size={20} className="mx-auto text-muted-foreground mb-1" />
          <p>Position data unavailable.</p>
          <p className="text-muted-foreground max-w-[280px] mx-auto leading-relaxed">
            {account.dataAvailability.reason ||
              "No connected source reports open positions. TradingView MCP exposes no position tool."}
          </p>
        </div>
      ) : positions.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-[11px] space-y-1">
          <Clock size={20} className="mx-auto text-muted-foreground mb-1" />
          <p>No open positions on the connected account.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const hasPnl = pos.unrealizedPnl !== null;
            const isProfit = hasPnl && (pos.unrealizedPnl as number) >= 0;
            const confirmTarget = pending?.positionId === pos.id ? pending : null;

            return (
              <div
                key={pos.id}
                className="bg-secondary/40 border border-border/80 rounded-lg p-2 space-y-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between font-numeric">
                  <div className="flex items-center gap-1.5 font-bold text-foreground">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                        pos.side === "BUY" || pos.side === "LONG"
                          ? "bg-positive/20 text-positive border border-positive/30"
                          : "bg-negative/20 text-negative border border-negative/30"
                      }`}
                    >
                      {pos.side}
                    </span>
                    <span>{pos.symbol}</span>
                    <span className="text-muted-foreground text-[10px]">x{pos.quantity}</span>
                    <span className="px-1 py-0.5 rounded-full text-[10px] bg-secondary text-foreground border border-border">
                      {pos.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {hasPnl ? (
                      isProfit ? (
                        <TrendingUp size={12} className="text-positive" />
                      ) : (
                        <TrendingDown size={12} className="text-negative" />
                      )
                    ) : null}
                    <span
                      className={`font-bold ${
                        !hasPnl
                          ? "text-muted-foreground"
                          : isProfit
                          ? "text-positive"
                          : "text-negative"
                      }`}
                    >
                      {!hasPnl
                        ? "P/L not reported"
                        : `${isProfit ? "+" : ""}$${(pos.unrealizedPnl as number).toFixed(2)}`}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground pt-1 border-t border-border/60 font-numeric">
                  <div>
                    Entry <span className="text-foreground">{pos.entryPrice}</span>
                  </div>
                  <div>
                    Current{" "}
                    <span className="text-foreground">{pos.currentPrice ?? "—"}</span>
                  </div>
                  <div>
                    Stop <span className="text-foreground">{pos.stopLoss ?? "—"}</span>
                  </div>
                  <div>
                    Target <span className="text-foreground">{pos.takeProfit ?? "—"}</span>
                  </div>
                </div>

                {confirmTarget !== null && confirmTarget.type === "close" && (
                  <div className="bg-negative/10 border border-negative/30 rounded-lg p-2 space-y-1.5 text-negative">
                    <span className="block text-[11px]">
                      Confirm closing {pos.symbol} {pos.side} {pos.quantity} (position {pos.id})? The
                      request is submitted to the Unified Trading API and the broker decides the
                      fill — it is not instant.
                    </span>
                    <label className="flex items-center gap-2 text-[10px]">
                      <span className="shrink-0">Partial close % of current volume</span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        step={1}
                        value={partialPercent}
                        onChange={(e) => setPartialPercent(e.target.value)}
                        className="w-16 rounded-lg border border-input bg-background px-2 py-1 font-numeric text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPending(null)}
                        className="flex-1 rounded-lg border border-border bg-secondary py-1 text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busyId === pos.id}
                        onClick={() => confirmPartialClose(pos, confirmTarget)}
                        className="flex-1 rounded-lg border border-warning/40 bg-warning/15 py-1 font-bold text-warning transition-colors hover:bg-warning/25 disabled:opacity-50"
                      >
                        {busyId === pos.id ? "Submitting…" : "Confirm Partial Close"}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === pos.id}
                        onClick={() => confirmClose(pos, confirmTarget)}
                        className="flex-1 rounded-lg bg-destructive hover:bg-destructive/90 py-1 font-bold text-white disabled:opacity-50"
                      >
                        {busyId === pos.id ? "Submitting…" : "Confirm Close"}
                      </button>
                    </div>
                  </div>
                )}

                {confirmTarget !== null && confirmTarget.type === "modify" && (
                  <div className="bg-warning/10 border border-warning/30 rounded-lg p-2 space-y-1.5 text-warning">
                    <span className="block text-[11px]">Modify stop / target for {pos.symbol}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="any"
                        value={modifySl}
                        onChange={(e) => setModifySl(e.target.value)}
                        placeholder="Stop loss"
                        className="w-full rounded-lg border border-input bg-background px-2 py-1 font-numeric text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      />
                      <input
                        type="number"
                        step="any"
                        value={modifyTp}
                        onChange={(e) => setModifyTp(e.target.value)}
                        placeholder="Take profit"
                        className="w-full rounded-lg border border-input bg-background px-2 py-1 font-numeric text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPending(null)}
                        className="flex-1 rounded-lg border border-border bg-secondary py-1 text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busyId === pos.id || (!modifySl && !modifyTp)}
                        onClick={() => confirmModify(pos, confirmTarget)}
                        className="flex-1 rounded-lg border border-warning/40 bg-warning/15 py-1 font-bold text-warning transition-colors hover:bg-warning/25 disabled:opacity-50"
                      >
                        {busyId === pos.id ? "Submitting…" : "Confirm Modify"}
                      </button>
                    </div>
                  </div>
                )}

                {!confirmTarget && (
                  <div className="pt-1 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => startModify(pos)}
                      className="px-2 py-0.5 bg-secondary hover:bg-secondary/80 text-foreground border border-border rounded-lg text-[10px] font-medium flex items-center gap-1"
                    >
                      <Pencil size={10} /> Modify
                    </button>
                    <button
                      type="button"
                      disabled={!pos.canClose}
                      onClick={() => startClose(pos)}
                      className="px-2 py-0.5 bg-negative/10 hover:bg-negative/20 text-negative border border-negative/30 rounded-lg text-[10px] font-medium flex items-center gap-1 disabled:opacity-40"
                    >
                      <XCircle size={10} /> Close Position
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
        AI position monitoring is informational only: structure changes, HTF conflicts and strategy
        condition drift are surfaced as alerts. Closing or modifying a position always requires your
        explicit confirmation here.
      </p>

      {/* Informational AI updates for open positions (§15) */}
      {positions.length > 0 && aiUpdates && aiUpdates.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-border bg-secondary p-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles size={11} /> AI position monitor · informational
          </div>
          {aiUpdates.map((alert) => (
            <div key={alert.id} className="text-[10px] leading-snug">
              <span className="font-medium text-foreground">{alert.title}</span>
              <span className="text-muted-foreground"> — {alert.message}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">
            These updates never act on your positions — trade actions stay behind explicit
            confirmation.
          </p>
        </div>
      )}
    </div>
  );
};
