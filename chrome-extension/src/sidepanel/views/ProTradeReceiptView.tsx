import React, { useState } from "react";
import { CheckCircle2, ArrowRight, Database, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";
import type { ExecutionResult, NormalizedOrderIntent } from "@/types/execution";
import { getAlgoVaultUrl } from "@/config/environment";
import { tradingViewExecutionAdapter } from "@/services/execution-adapter";

interface Props {
  result: ExecutionResult;
  intent: NormalizedOrderIntent;
  onNewTrade: () => void;
}

/**
 * Trade Receipt (§13) — rendered only after the gateway confirmed a fill.
 * Fields the venue never reported stay visibly "Not reported"; the receipt
 * never invents an execution price, ticket or broker.
 */
export const ProTradeReceiptView: React.FC<Props> = ({ result, intent, onNewTrade }) => {
  const receipt = result.receipt;
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(receipt?.journalSynced ?? false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncEntryId, setSyncEntryId] = useState<string | null>(receipt?.journalEntryId ?? null);

  if (!receipt) return null;

  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(receipt.symbol)}`;
  const algovaultUrl = `${getAlgoVaultUrl()}/account/pro-trading-extension`;

  const handleSyncToJournal = async () => {
    setSyncing(true);
    setSyncError(null);
    const res = await tradingViewExecutionAdapter.syncToJournal(receipt, intent, {
      notes: "Executed via AlgoVault Pro TradingView Execution Bridge",
    });
    if (res.ok) {
      setSynced(true);
      setSyncEntryId(res.entryId ?? null);
    } else {
      setSyncError(res.error || "Failed to sync trade to journal.");
    }
    setSyncing(false);
  };

  const confirmed = receipt.status === "FILLED" || receipt.status === "PARTIALLY_FILLED";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div
          className={`flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[11px] ${
            confirmed ? "text-emerald-400" : "text-amber-400"
          }`}
        >
          <CheckCircle2 size={15} />
          {confirmed ? "Trade Executed" : "Execution reported"}
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            confirmed
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/15 text-amber-400 border-amber-500/30"
          }`}
        >
          {receipt.status}
        </span>
      </div>

      <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-2 font-mono text-[11px]">
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">ORDER</span>
          <span className="font-bold">
            {receipt.side} {receipt.quantity} {receipt.symbol}
          </span>
        </div>
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">EXECUTION PRICE</span>
          <span className="font-bold text-emerald-400">
            {receipt.executionPrice !== null ? receipt.executionPrice : "Not reported by venue"}
          </span>
        </div>
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">BROKER TICKET</span>
          <span className="text-slate-300 text-[10px]">
            {receipt.brokerTicket || "Not reported by venue"}
          </span>
        </div>
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">ORDER ID</span>
          <span className="text-slate-300 text-[10px]">{receipt.orderId}</span>
        </div>
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">BROKER</span>
          <span className="text-slate-300 text-[10px]">{receipt.broker}</span>
        </div>
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">ACCOUNT</span>
          <span className="text-slate-300 text-[10px]">{receipt.accountReference}</span>
        </div>
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">MODE</span>
          <span
            className={`text-[10px] ${
              receipt.mode === "LIVE" || receipt.mode === "UNKNOWN" ? "text-rose-400" : "text-slate-300"
            }`}
          >
            {receipt.mode === "UNKNOWN" ? "MODE NOT REPORTED" : receipt.mode}
          </span>
        </div>
        <div className="flex justify-between text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">TIME</span>
          <span className="text-slate-300 text-[10px]">{new Date(receipt.timestamp).toLocaleString()}</span>
        </div>
        {receipt.strategyName && (
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-400 font-sans text-[10px]">STRATEGY</span>
            <span className="text-slate-300 text-[10px]">{receipt.strategyName}</span>
          </div>
        )}
        {receipt.setupId && (
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-400 font-sans text-[10px]">SETUP ID</span>
            <span className="text-slate-300 text-[10px]">{receipt.setupId}</span>
          </div>
        )}
        {receipt.analysisId && (
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-400 font-sans text-[10px]">AI ANALYSIS ID</span>
            <span className="text-slate-300 text-[10px]">{receipt.analysisId}</span>
          </div>
        )}
      </div>

      {receipt.mode === "UNKNOWN" && (
        <div className="bg-amber-950/30 border border-amber-500/25 text-amber-300 p-2 rounded text-[11px] flex items-start gap-1.5">
          <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <span>The account mode was not reported by any source — verify whether this fill affected a live or demo account.</span>
        </div>
      )}

      {synced && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 p-2 rounded text-[11px] flex items-center gap-1.5">
          <Database size={13} className="text-emerald-400 shrink-0" />
          <span>
            Saved to your AlgoVault Trade Journal
            {syncEntryId ? ` (${syncEntryId})` : ""}.
          </span>
        </div>
      )}

      {syncError && (
        <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-2 rounded text-[11px]">
          {syncError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <a
          href={tvUrl}
          target="_blank"
          rel="noreferrer"
          className="py-2 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <ExternalLink size={12} /> Open in TradingView
        </a>
        <a
          href={algovaultUrl}
          target="_blank"
          rel="noreferrer"
          className="py-2 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <ExternalLink size={12} /> Open in AlgoVault
        </a>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={syncing || synced}
          onClick={handleSyncToJournal}
          className={`flex-1 py-2 rounded font-medium flex items-center justify-center gap-1.5 transition-colors border ${
            synced
              ? "bg-slate-800 text-emerald-400 border-slate-700 cursor-default"
              : "bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-500"
          }`}
        >
          {syncing ? <RefreshCw size={12} className="animate-spin" /> : <Database size={12} />}
          {synced ? "Synced to Journal" : "Add to Journal"}
        </button>

        <button
          type="button"
          onClick={onNewTrade}
          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-medium flex items-center gap-1 transition-colors"
        >
          <span>New Trade</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
};
