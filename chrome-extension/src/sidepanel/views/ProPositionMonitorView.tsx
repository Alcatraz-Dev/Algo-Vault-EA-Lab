import React, { useState } from "react";
import { Activity, XCircle, TrendingUp, TrendingDown, Clock, AlertCircle } from "lucide-react";
import { TradingViewPosition, TradingViewAccountInfo } from "@/types/execution";
import { closePosition } from "@/api/algovault";

interface Props {
  account: TradingViewAccountInfo;
  onRefresh: () => void;
}

export const ProPositionMonitorView: React.FC<Props> = ({ account, onRefresh }) => {
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const positions = account.openPositions || [];

  const handleClose = async (pos: TradingViewPosition) => {
    setProcessingId(pos.id);
    setActionMsg(null);
    try {
      const res = await closePosition(pos.id, pos.symbol);
      if (res && res.success) {
        setActionMsg(`Position ${pos.id} (${pos.symbol}) closed successfully.`);
        onRefresh();
      } else {
        setActionMsg(`Failed to close position: ${res?.message || "Gateway error"}`);
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Error closing position");
    } finally {
      setProcessingId(null);
    }
  };

  const totalUnrealizedPnL = positions.reduce((acc, p) => acc + (p.unrealizedPnl || 0), 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
          <Activity size={14} className="text-cyan-400" /> Open Positions ({positions.length})
        </div>
        <div className="text-right">
          <span className="text-[10px] text-slate-400 block">Total P/L</span>
          <span
            className={`font-bold font-mono text-[11px] ${
              totalUnrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {totalUnrealizedPnL >= 0 ? "+" : ""}
            ${totalUnrealizedPnL.toFixed(2)}
          </span>
        </div>
      </div>

      {actionMsg && (
        <div className="bg-slate-800 border border-slate-700 text-slate-200 p-2 rounded text-[11px] flex items-center gap-1.5">
          <AlertCircle size={13} className="text-cyan-400 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {positions.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-[11px] space-y-1">
          <Clock size={20} className="mx-auto text-slate-600 mb-1" />
          <p>No active open positions detected.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const isProfit = (pos.unrealizedPnl || 0) >= 0;
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
                  </div>

                  <div className="flex items-center gap-1">
                    {isProfit ? (
                      <TrendingUp size={12} className="text-emerald-400" />
                    ) : (
                      <TrendingDown size={12} className="text-rose-400" />
                    )}
                    <span className={`font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                      {isProfit ? "+" : ""}
                      ${(pos.unrealizedPnl || 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-400 pt-1 border-t border-slate-800/60 font-mono">
                  <div>
                    Entry: <span className="text-slate-200">{pos.entryPrice}</span>
                  </div>
                  <div>
                    SL: <span className="text-slate-200">{pos.stopLoss || "None"}</span>
                  </div>
                  <div>
                    TP: <span className="text-slate-200">{pos.takeProfit || "None"}</span>
                  </div>
                </div>

                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    disabled={processingId === pos.id}
                    onClick={() => handleClose(pos)}
                    className="px-2 py-0.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/30 rounded text-[10px] font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <XCircle size={10} />
                    {processingId === pos.id ? "Closing..." : "Close Position"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
