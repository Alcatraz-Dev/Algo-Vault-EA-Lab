import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Zap,
  Activity,
  Clock,
  History,
  Lock,
  WifiOff,
  RefreshCw,
  ExternalLink,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import type {
  ExecutionResult,
  NormalizedOrderIntent,
  PreparedTradeDraft,
  TradingViewAccountInfo,
} from "@/types/execution";
import { detectTradingViewAccount, subscribeTVAccount, accountAgeLabel } from "@/services/tv-account-service";
import { useProAccess } from "@/services/pro-service";
import { getAlgoVaultUrl } from "@/config/environment";
import { ProTradingAccountPanel } from "./ProTradingAccountPanel";
import { ProTradeTicketView } from "./ProTradeTicketView";
import { ProPositionMonitorView } from "./ProPositionMonitorView";
import { ProPendingOrdersView } from "./ProPendingOrdersView";
import { ProTradeReceiptView } from "./ProTradeReceiptView";

interface Props {
  activeSymbol?: string;
  activePrice?: number;
  timeframe?: string | null;
  /** AI Setup Radar / Copilot prepared trade handed into the ticket. */
  preparedDraft?: PreparedTradeDraft | null;
  onDraftConsumed?: () => void;
  /** Which panel to open first (command bar / setup radar handoff). */
  initialSubTab?: SubTab;
  /** Epoch ms of the chart context used as the market price source. */
  contextTimestamp?: number | null;
}

export type SubTab = "ticket" | "positions" | "pending" | "history";

/**
 * TRADINGVIEW EXECUTION command center (§17).
 *
 * Pro-only: free users get a feature preview (the panel itself is visible,
 * but no ticket and no privileged actions) while every privileged endpoint
 * independently enforces entitlement server-side.
 */
export const ProExecutionBridgeView: React.FC<Props> = ({
  activeSymbol = "EURUSD",
  activePrice,
  timeframe,
  preparedDraft = null,
  onDraftConsumed,
  initialSubTab = "ticket",
  contextTimestamp = null,
}) => {
  const { isPro, flags, loading: proLoading } = useProAccess();
  const [account, setAccount] = useState<TradingViewAccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>(initialSubTab);
  const [lastExecution, setLastExecution] = useState<{
    result: ExecutionResult;
    intent: NormalizedOrderIntent;
  } | null>(null);

  const loadAccount = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const info = await detectTradingViewAccount({ force });
      setAccount(info);
    } catch {
      // detection failures are surfaced through the account panel states
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

  const handleExecutionComplete = useCallback((result: ExecutionResult, intent: NormalizedOrderIntent) => {
    if (result.receipt) setLastExecution({ result, intent });
    void loadAccount(true);
  }, [loadAccount]);

  const flagEnabled = flags.tradingViewExecutionBridge;
  const capabilities = useMemo(() => {
    if (!account) return null;
    return {
      execution:
        account.accountState === "TRADING_ENABLED" && account.tradingEnabled
          ? "AVAILABLE"
          : "UNAVAILABLE",
      broker: account.broker || null,
      masked: account.accountIdMasked || null,
      tvConnected: account.tradingView.chartConnected || account.connectionStatus === "CONNECTED",
      mode: account.mode,
    };
  }, [account]);

  if (proLoading || loading) {
    return (
      <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
        <Zap size={14} className="animate-spin text-cyan-400" />
        Initializing TradingView Execution…
      </div>
    );
  }

  /* ── non-Pro feature preview (§20 — visible, never actionable) ───── */
  if (!isPro) {
    return (
      <div className="space-y-3">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-amber-400" />
            <span className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
              TradingView Execution
            </span>
            <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold border bg-amber-500/10 text-amber-400 border-amber-500/30">
              PRO
            </span>
          </div>
          <p className="text-slate-400 leading-relaxed">
            Pro subscribers get the full execution bridge: trade tickets with an Execution Risk
            Check, live position monitoring, pending-order management, execution history and
            AlgoVault journal sync.
          </p>
          <ul className="space-y-1 text-slate-500 text-[10px]">
            <li>• TradingView account &amp; broker context (where supported)</li>
            <li>• Explicit confirmation flow — the AI never executes</li>
            <li>• Duplicate-order protection with idempotency keys</li>
            <li>• Trade receipts synchronized into the AlgoVault journal</li>
          </ul>
          <a
            href={`${getAlgoVaultUrl()}/pricing`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-xs font-bold text-slate-950"
          >
            Upgrade to AlgoVault Pro <ExternalLink size={11} />
          </a>
          <p className="text-[9px] text-slate-600">
            Entitlement is verified server-side on every privileged execution endpoint — UI
            manipulation cannot bypass this gate.
          </p>
        </div>
      </div>
    );
  }

  if (flagEnabled === false) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-center space-y-2 text-xs">
        <ShieldCheck size={20} className="mx-auto text-slate-500" />
        <p className="text-slate-300 font-semibold">TradingView Execution is not enabled on your account.</p>
        <p className="text-slate-500 text-[11px]">
          The feature flag is currently off — reach out to support if you expect it to be active.
        </p>
      </div>
    );
  }

  const historyRows = account?.executionHistory ?? [];

  // A market price older than 2 minutes is treated as stale: it is no longer
  // used as a risk reference, and the ticket says so explicitly (§24).
  const marketAgeMs = contextTimestamp ? Date.now() - contextTimestamp : null;
  const staleContext = marketAgeMs !== null && marketAgeMs > 120_000;
  const freshMarketPrice = activePrice != null && !staleContext ? activePrice : null;

  return (
    <div className="space-y-3">
      {/* ── command center header (§17) ─────────────────────────────── */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 text-[11px] space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-bold text-slate-200 uppercase tracking-wider text-[11px]">
            <Zap size={13} className="text-cyan-400" /> TradingView Execution
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-slate-500">
              {account ? accountAgeLabel(account) : "—"}
            </span>
            <button
              onClick={() => void loadAccount(true)}
              disabled={refreshing}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              title="Refresh execution context"
            >
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <span className="flex items-center justify-between">
            <span className="text-slate-500">TradingView</span>
            <span
              className={`font-semibold ${capabilities?.tvConnected ? "text-emerald-400" : "text-slate-400"}`}
            >
              ● {capabilities?.tvConnected ? "Connected" : "Not connected"}
            </span>
          </span>
          <span className="flex items-center justify-between">
            <span className="text-slate-500">Broker</span>
            <span className="font-semibold text-slate-300 truncate max-w-[110px]">
              {capabilities?.broker || "Not detected"}
            </span>
          </span>
          <span className="flex items-center justify-between">
            <span className="text-slate-500">Account</span>
            <span className="font-mono font-semibold text-slate-300">
              {capabilities?.masked || "Unavailable"}
            </span>
          </span>
          <span className="flex items-center justify-between">
            <span className="text-slate-500">Mode</span>
            <span
              className={`font-semibold ${
                capabilities?.mode === "LIVE"
                  ? "text-rose-400"
                  : capabilities?.mode === "UNKNOWN"
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              {capabilities?.mode === "LIVE"
                ? "LIVE"
                : capabilities?.mode === "UNKNOWN"
                ? "NOT REPORTED"
                : capabilities?.mode}
            </span>
          </span>
          <span className="flex items-center justify-between">
            <span className="text-slate-500">Execution</span>
            <span
              className={`font-semibold ${
                capabilities?.execution === "AVAILABLE" ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              ● {capabilities?.execution}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Open positions</span>
            <span className="font-semibold text-slate-300">
              {account?.dataAvailability.positions ? account.openPositions.length : "—"}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Pending orders</span>
            <span className="font-semibold text-slate-300">
              {account?.dataAvailability.pendingOrders ? account.pendingOrders.length : "—"}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Executions</span>
            <span className="font-semibold text-slate-300">{historyRows.length}</span>
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800">
          <button
            onClick={() => setSubTab("ticket")}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
          >
            <Zap size={10} /> Trade Ticket
          </button>
          <button
            onClick={() => setSubTab("positions")}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
          >
            <Activity size={10} /> Open Positions
          </button>
          <button
            onClick={() => setSubTab("pending")}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
          >
            <Clock size={10} /> Pending Orders
          </button>
          <button
            onClick={() => setSubTab("history")}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
          >
            <History size={10} /> Execution History
          </button>
          <a
            href={`${getAlgoVaultUrl()}/account/pro-trading-extension`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          >
            <Sparkles size={10} /> Trade History ↗
          </a>
        </div>
      </div>

      {/* ── account panel (§2) ──────────────────────────────────────── */}
      {account && (
        <ProTradingAccountPanel
          account={account}
          onRefresh={() => void loadAccount(true)}
          refreshing={refreshing}
        />
      )}

      {/* ── sub-tab content ─────────────────────────────────────────── */}
      {subTab === "ticket" && (
        <>
          {lastExecution?.result.receipt ? (
            <ProTradeReceiptView
              result={lastExecution.result}
              intent={lastExecution.intent}
              onNewTrade={() => setLastExecution(null)}
            />
          ) : account ? (
            <ProTradeTicketView
              account={account}
              initialSymbol={activeSymbol}
              initialPrice={activePrice}
              timeframe={timeframe}
              marketPrice={freshMarketPrice}
              staleContext={staleContext}
              preparedDraft={preparedDraft}
              onDraftConsumed={onDraftConsumed}
              onExecutionComplete={handleExecutionComplete}
            />
          ) : (
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-center space-y-3">
              <WifiOff size={22} className="mx-auto text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-300">No execution source detected</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                TradingView MCP is read-only and no execution gateway responded. Start the{" "}
                <strong className="text-slate-200">AlgoVaultTradeGateway</strong> EA on your MT5
                terminal (with your gateway token) to enable order execution.
              </p>
              <button
                onClick={() => void loadAccount(true)}
                disabled={refreshing}
                className="mx-auto flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={11} className={refreshing ? "animate-pulse" : ""} />
                {refreshing ? "Checking…" : "Re-check gateway"}
              </button>
            </div>
          )}
        </>
      )}

      {subTab === "positions" && account && (
        <ProPositionMonitorView
          account={account}
          onRefresh={() => void loadAccount(true)}
          timeframe={timeframe}
        />
      )}

      {subTab === "pending" && account && (
        <ProPendingOrdersView account={account} onRefresh={() => void loadAccount(true)} />
      )}

      {subTab === "history" && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 text-[11px]">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5 font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
              <History size={13} className="text-cyan-400" /> Execution History
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {account ? accountAgeLabel(account) : "—"}
            </span>
          </div>

          {!account?.dataAvailability.executionHistory ? (
            <p className="text-slate-500 text-center py-5">
              Execution history unavailable —{" "}
              {account?.dataAvailability.reason || "no execution gateway responded."}
            </p>
          ) : historyRows.length === 0 ? (
            <p className="text-slate-500 text-center py-5">No execution records yet.</p>
          ) : (
            <div className="space-y-1.5">
              {historyRows.map((row) => (
                <div
                  key={`${row.requestId}-${row.createdAt ?? 0}`}
                  className="bg-slate-950/70 border border-slate-800 rounded p-2 font-mono text-[10px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-slate-200 font-bold">
                      {row.side || "—"} {row.quantity ?? "—"} {row.symbol || "—"}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded border ${
                        /filled/i.test(row.status) && !/partially/i.test(row.status)
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : /rejected|failed/i.test(row.status)
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                          : "bg-slate-800 text-slate-300 border-slate-700"
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500 mt-1">
                    <span>{row.requestId}</span>
                    <span>
                      {row.executedAt
                        ? new Date(row.executedAt).toLocaleString()
                        : row.createdAt
                        ? new Date(row.createdAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                  {row.errorMessage && (
                    <div className="text-rose-400 mt-1">{row.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
