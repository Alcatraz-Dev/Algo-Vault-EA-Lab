import React, { useState, useEffect, useCallback } from "react";
import { Zap, Activity, Clock, FileText, Lock, ShieldAlert } from "lucide-react";
import { TradingViewAccountInfo, ExecutionResult, TradeReceipt } from "@/types/execution";
import { detectTradingViewAccount, subscribeTVAccount } from "@/services/tv-account-service";
import { useProAccess } from "@/services/pro-service";
import { ProTradingAccountPanel } from "./ProTradingAccountPanel";
import { ProTradeTicketView } from "./ProTradeTicketView";
import { ProPositionMonitorView } from "./ProPositionMonitorView";
import { ProPendingOrdersView } from "./ProPendingOrdersView";
import { ProTradeReceiptView } from "./ProTradeReceiptView";

interface Props {
  activeSymbol?: string;
  activePrice?: number;
}

export const ProExecutionBridgeView: React.FC<Props> = ({ activeSymbol = "EURUSD", activePrice }) => {
  const { isPro, flags, loading: proLoading } = useProAccess();
  const [account, setAccount] = useState<TradingViewAccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subTab, setSubTab] = useState<"ticket" | "positions" | "pending">("ticket");
  const [latestReceipt, setLatestReceipt] = useState<TradeReceipt | null>(null);

  const loadAccount = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const info = await detectTradingViewAccount(force);
      setAccount(info);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount(false);
    const unsubscribe = subscribeTVAccount((info) => {
      setAccount(info);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [loadAccount]);

  const handleExecutionComplete = (result: ExecutionResult) => {
    if (result.receipt) {
      setLatestReceipt(result.receipt);
    }
    // Refresh account data after execution attempt
    void loadAccount(true);
  };

  // Pro Gating Check
  if (proLoading || loading) {
    return (
      <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
        <Zap size={14} className="animate-spin text-cyan-400" />
        Initializing Execution Bridge...
      </div>
    );
  }

  if (!isPro && !flags.tradingViewExecutionBridge) {
    return (
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-center space-y-3">
        <Lock size={24} className="mx-auto text-amber-400" />
        <h3 className="text-sm font-bold text-slate-100">Pro Entitlement Required</h3>
        <p className="text-xs text-slate-400">
          The TradingView Execution Bridge requires an active AlgoVault Pro plan.
        </p>
        <button
          onClick={() => window.open("https://algovault.pro/pricing", "_blank")}
          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold rounded text-xs"
        >
          Upgrade to AlgoVault Pro
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Account Status Header Panel */}
      {account && (
        <ProTradingAccountPanel
          account={account}
          onRefresh={() => loadAccount(true)}
          refreshing={refreshing}
        />
      )}

      {/* Sub-tab Navigation */}
      <div className="flex border-b border-slate-800 text-xs">
        <button
          onClick={() => {
            setSubTab("ticket");
            setLatestReceipt(null);
          }}
          className={`flex-1 py-1.5 font-medium border-b-2 flex items-center justify-center gap-1 transition-colors ${
            subTab === "ticket"
              ? "border-cyan-400 text-cyan-400 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Zap size={12} />
          Trade Ticket
        </button>

        <button
          onClick={() => setSubTab("positions")}
          className={`flex-1 py-1.5 font-medium border-b-2 flex items-center justify-center gap-1 transition-colors ${
            subTab === "positions"
              ? "border-cyan-400 text-cyan-400 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Activity size={12} />
          Positions ({account?.openPositions?.length || 0})
        </button>

        <button
          onClick={() => setSubTab("pending")}
          className={`flex-1 py-1.5 font-medium border-b-2 flex items-center justify-center gap-1 transition-colors ${
            subTab === "pending"
              ? "border-cyan-400 text-cyan-400 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Clock size={12} />
          Pending ({account?.pendingOrders?.length || 0})
        </button>
      </div>

      {/* Tab Content */}
      {subTab === "ticket" && (
        <>
          {latestReceipt ? (
            <ProTradeReceiptView
              receipt={latestReceipt}
              onNewTrade={() => setLatestReceipt(null)}
            />
          ) : (
            account && (
              <ProTradeTicketView
                account={account}
                initialSymbol={activeSymbol}
                initialPrice={activePrice}
                onExecutionComplete={handleExecutionComplete}
              />
            )
          )}
        </>
      )}

      {subTab === "positions" && account && (
        <ProPositionMonitorView account={account} onRefresh={() => loadAccount(true)} />
      )}

      {subTab === "pending" && account && (
        <ProPendingOrdersView account={account} onRefresh={() => loadAccount(true)} />
      )}
    </div>
  );
};
