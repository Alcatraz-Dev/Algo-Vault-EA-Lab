import React, { useState } from "react";
import { Clock, XCircle, FileText, AlertCircle, ShieldQuestion, RefreshCw } from "lucide-react";
import type { TradingViewAccountInfo, TradingViewPendingOrder } from "@/types/execution";
import {
  cancelOrderRequest,
  newClientRequestId,
  runUnifiedExecution,
} from "@/api/unified-trading";
import { accountAgeLabel } from "@/services/tv-account-service";

interface Props {
  account: TradingViewAccountInfo;
  onRefresh: () => void;
}

/**
 * PENDING ORDERS (§11) — real limit/stop orders reported by the connected
 * gateway. Cancel is supported by the gateway EA; modify of a pending order
 * is NOT (the EA only modifies open positions), so no modify action is shown.
 *
 * Cancel goes through the Unified Trading API (`POST /api/trading/execute` →
 * UnifiedTradingService) and is addressed by the unified `orderId`. The legacy
 * gateway helper `cancelGatewayOrder` (which POSTed to the legacy order queue)
 * is retired: no code here constructs a provider action or an environment, and
 * the outcome rendered below is the server's own. The idempotency key is minted
 * once when the confirmation opens and reused on every retry of that action.
 */
export const ProPendingOrdersView: React.FC<Props> = ({ account, onRefresh }) => {
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ orderId: string; clientRequestId: string } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingOrders = account.pendingOrders || [];
  const available = account.dataAvailability.pendingOrders;

  const handleCancel = async (order: TradingViewPendingOrder, clientRequestId: string) => {
    if (!account.accountId) {
      setActionMsg("No execution account reference — cannot cancel a pending order.");
      return;
    }
    setBusyId(order.id);
    setActionMsg(null);
    try {
      const outcome = await runUnifiedExecution(
        cancelOrderRequest({
          accountId: account.accountId,
          clientRequestId,
          orderId: order.id,
          symbol: order.symbol,
        })
      );
      const label = `${order.symbol} ${order.side} ${order.orderType} (ticket ${order.id})`;
      if (outcome.pendingSync) {
        setActionMsg(`Cancel for ${label}: Order executed — syncing position.`);
        setConfirm(null);
      } else if (outcome.ok) {
        setActionMsg(`Cancel for ${label}: ${outcome.message}.`);
        setConfirm(null);
      } else if (outcome.status === "ACCEPTED") {
        // The server still holds the request (duplicate / in flight): never
        // claim a result the provider has not reported yet.
        setActionMsg(`Cancel for ${label}: Order accepted — waiting for broker confirmation.`);
      } else {
        setActionMsg(`Cancel for ${label}: ${outcome.message}`);
      }
      onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground uppercase tracking-wider text-[11px]">
          <Clock size={14} className="text-warning" /> Pending Orders ({pendingOrders.length})
        </div>
        <div className="flex items-center gap-2">
          <span className="font-numeric text-[10px] text-muted-foreground">{accountAgeLabel(account)}</span>
          <button
            onClick={onRefresh}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/80"
            title="Refresh pending orders"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="bg-secondary border border-border text-foreground p-2 rounded-lg text-[11px] flex items-start gap-1.5">
          <AlertCircle size={13} className="text-warning shrink-0 mt-0.5" />
          <span>{actionMsg}</span>
        </div>
      )}

      {!available ? (
        <div className="text-center py-6 text-muted-foreground text-[11px] space-y-1.5">
          <ShieldQuestion size={20} className="mx-auto text-muted-foreground mb-1" />
          <p>Pending-order data unavailable.</p>
          <p className="text-muted-foreground max-w-[280px] mx-auto leading-relaxed">
            {account.dataAvailability.reason ||
              "No connected source reports pending orders. TradingView MCP exposes no order tool."}
          </p>
        </div>
      ) : pendingOrders.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-[11px] space-y-1">
          <FileText size={20} className="mx-auto text-muted-foreground mb-1" />
          <p>No active pending limit or stop orders.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pendingOrders.map((ord) => (
            <div
              key={ord.id}
              className="bg-secondary/40 border border-border/80 rounded-lg p-2 space-y-1.5 text-[11px]"
            >
              <div className="flex items-center justify-between font-numeric">
                <div className="flex items-center gap-1.5 font-bold text-foreground">
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      ord.side === "BUY"
                        ? "bg-positive/20 text-positive border border-positive/30"
                        : "bg-negative/20 text-negative border border-negative/30"
                    }`}
                  >
                    {ord.side} {ord.orderType}
                  </span>
                  <span>{ord.symbol}</span>
                  <span className="text-muted-foreground text-[10px]">x{ord.quantity}</span>
                  <span className="px-1 py-0.5 rounded-full text-[10px] bg-secondary text-foreground border border-border">
                    {ord.status}
                  </span>
                </div>

                <span className="text-foreground font-bold">@ {ord.price ?? "—"}</span>
              </div>

              <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground pt-1 border-t border-border/60 font-numeric">
                <div>
                  Stop <span className="text-foreground">{ord.stopLoss ?? "—"}</span>
                </div>
                <div>
                  Target <span className="text-foreground">{ord.takeProfit ?? "—"}</span>
                </div>
                <div>
                  Placed{" "}
                  <span className="text-foreground">
                    {ord.timestamp ? new Date(ord.timestamp).toLocaleString() : "—"}
                  </span>
                </div>
              </div>

              {confirm?.orderId === ord.id ? (
                <div className="bg-negative/10 border border-negative/30 rounded-lg p-2 space-y-1.5 text-negative">
                  <span className="block text-[11px]">
                    Cancel {ord.symbol} {ord.side} {ord.orderType} {ord.quantity} (ticket {ord.id})?
                    This request is submitted to the AlgoVault execution service.
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirm(null)}
                      className="flex-1 rounded-lg border border-border bg-secondary py-1 text-foreground"
                    >
                      Keep order
                    </button>
                    <button
                      type="button"
                      disabled={busyId === ord.id}
                      onClick={() => {
                        if (!confirm) return;
                        void handleCancel(ord, confirm.clientRequestId);
                      }}
                      className="flex-1 rounded-lg bg-destructive hover:bg-destructive/90 py-1 font-bold text-white disabled:opacity-50"
                    >
                      {busyId === ord.id ? "Submitting…" : "Confirm Cancel"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    disabled={!ord.canCancel}
                    onClick={() => {
                      setActionMsg(null);
                      // Minted ONCE per confirmation: a retry reuses this exact
                      // key so the server's idempotency protects the user.
                      setConfirm({ orderId: ord.id, clientRequestId: newClientRequestId("cancel") });
                    }}
                    className="px-2 py-0.5 bg-secondary hover:bg-secondary/80 text-negative border border-border rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1 disabled:opacity-40"
                  >
                    <XCircle size={10} /> Cancel Order
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
