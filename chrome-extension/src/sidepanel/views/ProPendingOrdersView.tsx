import React, { useState } from "react";
import { Clock, XCircle, FileText, AlertCircle } from "lucide-react";
import { TradingViewPendingOrder, TradingViewAccountInfo } from "@/types/execution";
import { cancelOrder } from "@/api/algovault";

interface Props {
  account: TradingViewAccountInfo;
  onRefresh: () => void;
}

export const ProPendingOrdersView: React.FC<Props> = ({ account, onRefresh }) => {
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const pendingOrders = account.pendingOrders || [];

  const handleCancel = async (order: TradingViewPendingOrder) => {
    setCancelingId(order.id);
    setActionMsg(null);
    try {
      const res = await cancelOrder(order.id, order.symbol);
      if (res && res.success) {
        setActionMsg(`Order ${order.id} (${order.symbol}) canceled successfully.`);
        onRefresh();
      } else {
        setActionMsg(`Failed to cancel order: ${res?.message || "Gateway error"}`);
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Error canceling order");
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
          <Clock size={14} className="text-amber-400" /> Pending Orders ({pendingOrders.length})
        </div>
      </div>

      {actionMsg && (
        <div className="bg-slate-800 border border-slate-700 text-slate-200 p-2 rounded text-[11px] flex items-center gap-1.5">
          <AlertCircle size={13} className="text-cyan-400 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {pendingOrders.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-[11px] space-y-1">
          <FileText size={20} className="mx-auto text-slate-600 mb-1" />
          <p>No active pending limit or stop orders.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pendingOrders.map((ord) => (
            <div
              key={ord.id}
              className="bg-slate-950/70 border border-slate-800/80 rounded p-2 space-y-1.5 text-[11px]"
            >
              <div className="flex items-center justify-between font-mono">
                <div className="flex items-center gap-1.5 font-bold text-slate-200">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] ${
                      ord.side === "BUY"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {ord.side} {ord.orderType}
                  </span>
                  <span>{ord.symbol}</span>
                  <span className="text-slate-400 text-[10px]">x{ord.quantity}</span>
                </div>

                <span className="text-slate-300 font-bold">@ {ord.price}</span>
              </div>

              <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400 pt-1 border-t border-slate-800/60 font-mono">
                <div>
                  SL: <span className="text-slate-200">{ord.stopLoss || "None"}</span>
                </div>
                <div>
                  TP: <span className="text-slate-200">{ord.takeProfit || "None"}</span>
                </div>
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  disabled={cancelingId === ord.id}
                  onClick={() => handleCancel(ord)}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 rounded text-[10px] font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <XCircle size={10} />
                  {cancelingId === ord.id ? "Canceling..." : "Cancel Order"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
