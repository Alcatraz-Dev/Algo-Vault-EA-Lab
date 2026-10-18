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
    <div className="bg-card border border-border rounded-xl p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div
          className={`flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[11px] ${
            confirmed ? "text-positive" : "text-warning"
          }`}
        >
          <CheckCircle2 size={15} />
          {confirmed ? "Trade Executed" : "Execution reported"}
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            confirmed
              ? "bg-positive/15 text-positive border-positive/30"
              : "bg-warning/15 text-warning border-warning/30"
          }`}
        >
          {receipt.status}
        </span>
      </div>

      <div className="bg-secondary/40 p-3 rounded-xl border border-border space-y-2 font-numeric text-[11px]">
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">ORDER</span>
          <span className="font-bold">
            {receipt.side} {receipt.quantity} {receipt.symbol}
          </span>
        </div>
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">EXECUTION PRICE</span>
          <span className="font-bold text-positive">
            {receipt.executionPrice !== null ? receipt.executionPrice : "Not reported by venue"}
          </span>
        </div>
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">BROKER TICKET</span>
          <span className="text-foreground text-[10px]">
            {receipt.brokerTicket || "Not reported by venue"}
          </span>
        </div>
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">ORDER ID</span>
          <span className="text-foreground text-[10px]">{receipt.orderId}</span>
        </div>
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">BROKER</span>
          <span className="text-foreground text-[10px]">{receipt.broker}</span>
        </div>
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">ACCOUNT</span>
          <span className="text-foreground text-[10px]">{receipt.accountReference}</span>
        </div>
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">MODE</span>
          <span
            className={`text-[10px] ${
              receipt.mode === "LIVE" || receipt.mode === "UNKNOWN" ? "text-negative" : "text-foreground"
            }`}
          >
            {receipt.mode === "UNKNOWN" ? "MODE NOT REPORTED" : receipt.mode}
          </span>
        </div>
        <div className="flex justify-between text-foreground">
          <span className="text-muted-foreground font-sans text-[10px]">TIME</span>
          <span className="text-foreground text-[10px]">{new Date(receipt.timestamp).toLocaleString()}</span>
        </div>
        {receipt.strategyName && (
          <div className="flex justify-between text-foreground">
            <span className="text-muted-foreground font-sans text-[10px]">STRATEGY</span>
            <span className="text-foreground text-[10px]">{receipt.strategyName}</span>
          </div>
        )}
        {receipt.setupId && (
          <div className="flex justify-between text-foreground">
            <span className="text-muted-foreground font-sans text-[10px]">SETUP ID</span>
            <span className="text-foreground text-[10px]">{receipt.setupId}</span>
          </div>
        )}
        {receipt.analysisId && (
          <div className="flex justify-between text-foreground">
            <span className="text-muted-foreground font-sans text-[10px]">AI ANALYSIS ID</span>
            <span className="text-foreground text-[10px]">{receipt.analysisId}</span>
          </div>
        )}
      </div>

      {receipt.mode === "UNKNOWN" && (
        <div className="bg-warning/10 border border-warning/25 text-warning p-2 rounded-lg text-[11px] flex items-start gap-1.5">
          <AlertTriangle size={13} className="text-warning shrink-0 mt-0.5" />
          <span>The account mode was not reported by any source — verify whether this fill affected a live or demo account.</span>
        </div>
      )}

      {synced && (
        <div className="bg-positive/10 border border-positive/30 text-positive p-2 rounded-lg text-[11px] flex items-center gap-1.5">
          <Database size={13} className="text-positive shrink-0" />
          <span>
            Saved to your AlgoVault Trade Journal
            {syncEntryId ? ` (${syncEntryId})` : ""}.
          </span>
        </div>
      )}

      {syncError && (
        <div className="bg-negative/10 border border-negative/30 text-negative p-2 rounded-lg text-[11px]">
          {syncError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <a
          href={tvUrl}
          target="_blank"
          rel="noreferrer"
          className="py-2 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-foreground font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <ExternalLink size={12} /> Open in TradingView
        </a>
        <a
          href={algovaultUrl}
          target="_blank"
          rel="noreferrer"
          className="py-2 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-foreground font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <ExternalLink size={12} /> Open in AlgoVault
        </a>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={syncing || synced}
          onClick={handleSyncToJournal}
          className={`flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors border ${
            synced
              ? "bg-secondary text-positive border-border cursor-default"
              : "bg-brand-fill hover:bg-brand-fill-hover text-white border-brand"
          }`}
        >
          {syncing ? <RefreshCw size={12} className="animate-spin" /> : <Database size={12} />}
          {synced ? "Synced to Journal" : "Add to Journal"}
        </button>

        <button
          type="button"
          onClick={onNewTrade}
          className="py-2 px-3 bg-secondary hover:bg-secondary/80 text-foreground border border-border rounded-lg font-medium flex items-center gap-1 transition-colors"
        >
          <span>New Trade</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
};
