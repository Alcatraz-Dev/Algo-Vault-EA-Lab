import React, { useEffect, useState } from "react";
import { Activity, XCircle, TrendingUp, TrendingDown, Clock, AlertCircle, ShieldQuestion, Pencil, Sparkles } from "lucide-react";
import type { TradingViewAccountInfo, TradingViewPosition } from "@/types/execution";
import type { SmartAlert } from "@/types/pro";
import { closeGatewayPosition, modifyGatewayPosition } from "@/api/execution";
import { fetchSmartAlerts } from "@/api/pro";
import { newRequestId } from "@/services/execution-adapter";
import { accountAgeLabel } from "@/services/tv-account-service";

interface Props {
  account: TradingViewAccountInfo;
  onRefresh: () => void;
  /** Timeframe used for the informational AI position monitor. */
  timeframe?: string | null;
}

interface PendingAction {
  type: "close" | "modify";
  positionId: string;
}

/**
 * ACTIVE POSITIONS (§10) — renders only rows reported by the connected
 * gateway. P/L and current price show "—" when the source did not report
 * them; nothing is simulated. Close / modify are queued through the real
 * gateway and always require an explicit in-panel confirmation.
 */
export const ProPositionMonitorView: React.FC<Props> = ({ account, onRefresh, timeframe }) => {
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modifySl, setModifySl] = useState<string>("");
  const [modifyTp, setModifyTp] = useState<string>("");
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
    setPending({ type: "close", positionId: pos.id });
  };

  const startModify = (pos: TradingViewPosition) => {
    setActionMsg(null);
    setModifySl(pos.stopLoss !== null ? String(pos.stopLoss) : "");
    setModifyTp(pos.takeProfit !== null ? String(pos.takeProfit) : "");
    setPending({ type: "modify", positionId: pos.id });
  };

  const confirmClose = async (pos: TradingViewPosition) => {
    if (!account.accountId) {
      setActionMsg("No execution account reference — cannot queue a close.");
      return;
    }
    setBusyId(pos.id);
    setActionMsg(null);
    try {
      const res = await closeGatewayPosition({
        accountId: account.accountId,
        clientOrderId: newRequestId("close"),
        symbol: pos.symbol,
        ticket: Number(pos.id) || undefined,
      });
      if (res.success) {
        setActionMsg(
          `Close queued for ${pos.symbol} (ticket ${pos.id}). Status: ${
            res.order?.status || "queued"
          } — monitor the Execution History for the confirmed result.`
        );
        setPending(null);
        onRefresh();
      } else {
        setActionMsg(`Close rejected: ${res.error || "gateway error"}`);
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Failed to queue close.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmModify = async (pos: TradingViewPosition) => {
    if (!account.accountId) {
      setActionMsg("No execution account reference — cannot queue a modification.");
      return;
    }
    setBusyId(pos.id);
    setActionMsg(null);
    try {
      const res = await modifyGatewayPosition({
        accountId: account.accountId,
        clientOrderId: newRequestId("modify"),
        symbol: pos.symbol,
        ticket: Number(pos.id) || undefined,
        ...(modifySl ? { sl: Number(modifySl) } : {}),
        ...(modifyTp ? { tp: Number(modifyTp) } : {}),
      });
      if (res.success) {
        setActionMsg(
          `Modification queued for ${pos.symbol} (ticket ${pos.id}). Status: ${
            res.order?.status || "queued"
          }.`
        );
        setPending(null);
        onRefresh();
      } else {
        setActionMsg(`Modification rejected: ${res.error || "gateway error"}`);
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Failed to queue modification.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
          <Activity size={14} className="text-cyan-400" /> Active Positions ({positions.length})
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-500">{accountAgeLabel(account)}</span>
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block">Total P/L</span>
            <span
              className={`font-bold font-mono text-[11px] ${
                totalUnrealized === null
                  ? "text-slate-500"
                  : totalUnrealized >= 0
                  ? "text-emerald-400"
                  : "text-rose-400"
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
        <div className="bg-slate-800 border border-slate-700 text-slate-200 p-2 rounded text-[11px] flex items-start gap-1.5">
          <AlertCircle size={13} className="text-cyan-400 shrink-0 mt-0.5" />
          <span>{actionMsg}</span>
        </div>
      )}

      {!available ? (
        <div className="text-center py-6 text-slate-500 text-[11px] space-y-1.5">
          <ShieldQuestion size={20} className="mx-auto text-slate-600 mb-1" />
          <p>Position data unavailable.</p>
          <p className="text-slate-600 max-w-[280px] mx-auto leading-relaxed">
            {account.dataAvailability.reason ||
              "No connected source reports open positions. TradingView MCP exposes no position tool."}
          </p>
        </div>
      ) : positions.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-[11px] space-y-1">
          <Clock size={20} className="mx-auto text-slate-600 mb-1" />
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
                className="bg-slate-950/70 border border-slate-800/80 rounded p-2 space-y-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between font-mono">
                  <div className="flex items-center gap-1.5 font-bold text-slate-200">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] ${
                        pos.side === "BUY" || pos.side === "LONG"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {pos.side}
                    </span>
                    <span>{pos.symbol}</span>
                    <span className="text-slate-400 text-[10px]">x{pos.quantity}</span>
                    <span className="px-1 py-0.5 rounded text-[9px] bg-slate-800 text-slate-300 border border-slate-700">
                      {pos.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {hasPnl ? (
                      isProfit ? (
                        <TrendingUp size={12} className="text-emerald-400" />
                      ) : (
                        <TrendingDown size={12} className="text-rose-400" />
                      )
                    ) : null}
                    <span
                      className={`font-bold ${
                        !hasPnl
                          ? "text-slate-500"
                          : isProfit
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }`}
                    >
                      {!hasPnl
                        ? "P/L not reported"
                        : `${isProfit ? "+" : ""}$${(pos.unrealizedPnl as number).toFixed(2)}`}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1 text-[10px] text-slate-400 pt-1 border-t border-slate-800/60 font-mono">
                  <div>
                    Entry <span className="text-slate-200">{pos.entryPrice}</span>
                  </div>
                  <div>
                    Current{" "}
                    <span className="text-slate-200">{pos.currentPrice ?? "—"}</span>
                  </div>
                  <div>
                    Stop <span className="text-slate-200">{pos.stopLoss ?? "—"}</span>
                  </div>
                  <div>
                    Target <span className="text-slate-200">{pos.takeProfit ?? "—"}</span>
                  </div>
                </div>

                {confirmTarget?.type === "close" && (
                  <div className="bg-rose-950/30 border border-rose-500/30 rounded p-2 space-y-1.5 text-rose-200">
                    <span className="block text-[11px]">
                      Confirm closing {pos.symbol} {pos.side} {pos.quantity} (ticket {pos.id})? The
                      request is queued to the connected gateway — it is not instant.
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPending(null)}
                        className="flex-1 rounded border border-slate-700 bg-slate-800 py-1 text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busyId === pos.id}
                        onClick={() => confirmClose(pos)}
                        className="flex-1 rounded bg-rose-600 hover:bg-rose-500 py-1 font-bold text-white disabled:opacity-50"
                      >
                        {busyId === pos.id ? "Queuing…" : "Confirm Close"}
                      </button>
                    </div>
                  </div>
                )}

                {confirmTarget?.type === "modify" && (
                  <div className="bg-amber-950/30 border border-amber-500/30 rounded p-2 space-y-1.5 text-amber-200">
                    <span className="block text-[11px]">Modify stop / target for {pos.symbol}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="any"
                        value={modifySl}
                        onChange={(e) => setModifySl(e.target.value)}
                        placeholder="Stop loss"
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                      />
                      <input
                        type="number"
                        step="any"
                        value={modifyTp}
                        onChange={(e) => setModifyTp(e.target.value)}
                        placeholder="Take profit"
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPending(null)}
                        className="flex-1 rounded border border-slate-700 bg-slate-800 py-1 text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busyId === pos.id || (!modifySl && !modifyTp)}
                        onClick={() => confirmModify(pos)}
                        className="flex-1 rounded bg-amber-600 hover:bg-amber-500 py-1 font-bold text-white disabled:opacity-50"
                      >
                        {busyId === pos.id ? "Queuing…" : "Confirm Modify"}
                      </button>
                    </div>
                  </div>
                )}

                {!confirmTarget && (
                  <div className="pt-1 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => startModify(pos)}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[10px] font-medium flex items-center gap-1"
                    >
                      <Pencil size={10} /> Modify
                    </button>
                    <button
                      type="button"
                      disabled={!pos.canClose}
                      onClick={() => startClose(pos)}
                      className="px-2 py-0.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/30 rounded text-[10px] font-medium flex items-center gap-1 disabled:opacity-40"
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

      <p className="text-[9px] text-slate-600 leading-relaxed border-t border-slate-800/60 pt-2">
        AI position monitoring is informational only: structure changes, HTF conflicts and strategy
        condition drift are surfaced as alerts. Closing or modifying a position always requires your
        explicit confirmation here.
      </p>

      {/* Informational AI updates for open positions (§15) */}
      {positions.length > 0 && aiUpdates && aiUpdates.length > 0 && (
        <div className="bg-slate-950/60 border border-slate-800 rounded p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
            <Sparkles size={11} className="text-purple-400" /> AI position monitor · informational
          </div>
          {aiUpdates.map((alert) => (
            <div key={alert.id} className="text-[10px] leading-snug">
              <span className="text-slate-300 font-medium">{alert.title}</span>
              <span className="text-slate-500"> — {alert.message}</span>
            </div>
          ))}
          <p className="text-[9px] text-slate-600">
            These updates never act on your positions — trade actions stay behind explicit
            confirmation.
          </p>
        </div>
      )}
    </div>
  );
};
