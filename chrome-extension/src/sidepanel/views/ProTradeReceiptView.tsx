import React, { useState } from "react";
import { CheckCircle2, ArrowRight, Database, RefreshCw } from "lucide-react";
import { TradeReceipt } from "@/types/execution";

interface Props {
  receipt: TradeReceipt;
  onNewTrade: () => void;
}

export const ProTradeReceiptView: React.FC<Props> = ({ receipt, onNewTrade }) => {
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(receipt.journalSynced);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSyncToJournal = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/extension/journal-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSynced(true);
      } else {
        setSyncError(data.error || "Failed to sync trade to journal.");
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Journal sync exception");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-emerald-400 uppercase tracking-wider text-[11px]">
          <CheckCircle2 size={15} /> Trade Executed Successfully
        </div>
        <span className="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold">
          FILLED
        </span>
      </div>

      <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-2 font-mono text-[11px]">
        <div className="flex justify-between items-center text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">ORDER</span>
          <span className="font-bold">
            {receipt.side} {receipt.quantity} {receipt.symbol}
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">FILLED PRICE</span>
          <span className="font-bold text-emerald-400">${receipt.executionPrice}</span>
        </div>

        <div className="flex justify-between items-center text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">ORDER ID</span>
          <span className="text-slate-300 text-[10px]">{receipt.orderId}</span>
        </div>

        <div className="flex justify-between items-center text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">MODE & BROKER</span>
          <span className="text-slate-300 text-[10px]">
            {receipt.mode} ({receipt.broker})
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-200">
          <span className="text-slate-400 font-sans text-[10px]">TIME</span>
          <span className="text-slate-300 text-[10px]">{new Date(receipt.timestamp).toLocaleString()}</span>
        </div>
      </div>

      {synced && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 p-2 rounded text-[11px] flex items-center gap-1.5">
          <Database size={13} className="text-emerald-400 shrink-0" />
          <span>Trade successfully saved to your AlgoVault Trade Journal!</span>
        </div>
      )}

      {syncError && (
        <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-2 rounded text-[11px]">
          {syncError}
        </div>
      )}

      <div className="flex gap-2 pt-1">
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
          {syncing ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <Database size={12} />
          )}
          {synced ? "Synced to Journal" : "Add to Trade Journal"}
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
