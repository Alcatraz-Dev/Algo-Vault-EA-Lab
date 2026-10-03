import React, { useState } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  ShieldAlert,
  Send,
  CheckSquare,
  Square,
  AlertOctagon,
} from "lucide-react";
import {
  NormalizedOrderIntent,
  TradingViewAccountInfo,
  ExecutionResult,
  RiskCheckResult,
} from "@/types/execution";
import { TradingViewExecutionAdapter } from "@/services/execution-adapter";
import { ProRiskGuardPanel } from "./ProRiskGuardPanel";

interface Props {
  account: TradingViewAccountInfo;
  initialSymbol?: string;
  initialPrice?: number;
  initialSide?: "BUY" | "SELL";
  onExecutionComplete: (result: ExecutionResult) => void;
}

const adapter = new TradingViewExecutionAdapter();

export const ProTradeTicketView: React.FC<Props> = ({
  account,
  initialSymbol = "EURUSD",
  initialPrice,
  initialSide = "BUY",
  onExecutionComplete,
}) => {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [quantity, setQuantity] = useState<number>(0.1);
  const [entryPrice, setEntryPrice] = useState<string>(initialPrice ? String(initialPrice) : "");
  const [stopLoss, setStopLoss] = useState<string>("");
  const [takeProfit, setTakeProfit] = useState<string>("");

  const [riskEvaluation, setRiskEvaluation] = useState<RiskCheckResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [liveConfirmation, setLiveConfirmation] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isLive = account.mode === "LIVE";
  const isExecutionDisabled = account.accountState === "EXECUTION_UNAVAILABLE";

  const buildIntent = (): NormalizedOrderIntent => {
    return {
      requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      symbol: symbol.toUpperCase(),
      side,
      orderType,
      quantity: Number(quantity) || 0,
      price: entryPrice ? Number(entryPrice) : null,
      stopLoss: stopLoss ? Number(stopLoss) : null,
      takeProfit: takeProfit ? Number(takeProfit) : null,
      mode: account.mode,
      broker: account.broker,
      accountId: account.accountId,
    };
  };

  const handleEvaluateRisk = () => {
    setErrorMsg(null);
    const intent = buildIntent();
    const evaluation = adapter.computeRiskCheck(intent, account);
    setRiskEvaluation(evaluation);
  };

  const handleConfirmAndExecute = async () => {
    setErrorMsg(null);

    if (isLive && !liveConfirmation) {
      setErrorMsg("You must explicitly confirm live trading risk before executing.");
      return;
    }

    setSubmitting(true);
    try {
      const intent = buildIntent();
      const result = await adapter.submitOrder(intent, account, true);

      if (result.status !== "FILLED" && result.error) {
        setErrorMsg(result.error || "Order execution failed.");
      }

      onExecutionComplete(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Execution exception");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
          Trade Ticket
        </span>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isLive
              ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
              : account.mode === "DEMO"
              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
          }`}
        >
          {isLive ? "⚠ LIVE ACCOUNT" : account.mode === "DEMO" ? "DEMO ACCOUNT" : "PAPER TRADING"}
        </span>
      </div>

      {/* Execution Unavailable Alert */}
      {isExecutionDisabled && (
        <div className="bg-amber-950/40 border border-amber-500/30 text-amber-300 p-2 rounded text-[11px] flex items-start gap-2">
          <AlertOctagon size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block text-amber-200">Execution Unavailable via TradingView MCP</span>
            TradingView MCP is read-only. Please connect the AlgoVault MT5 Gateway server to enable live execution.
          </div>
        </div>
      )}

      {/* Side Selector (BUY / SELL) */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("BUY")}
          className={`py-2 rounded font-bold flex items-center justify-center gap-1.5 transition-colors border ${
            side === "BUY"
              ? "bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-950/50"
              : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
          }`}
        >
          <ArrowUpRight size={14} /> BUY / LONG
        </button>
        <button
          type="button"
          onClick={() => setSide("SELL")}
          className={`py-2 rounded font-bold flex items-center justify-center gap-1.5 transition-colors border ${
            side === "SELL"
              ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/50"
              : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
          }`}
        >
          <ArrowDownRight size={14} /> SELL / SHORT
        </button>
      </div>

      {/* Form Fields Grid */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <label className="text-slate-400 block mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-100 uppercase focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-slate-400 block mb-1">Order Type</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as any)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 focus:border-cyan-500 focus:outline-none"
          >
            <option value="MARKET">MARKET</option>
            <option value="LIMIT">LIMIT</option>
            <option value="STOP">STOP</option>
          </select>
        </div>

        <div>
          <label className="text-slate-400 block mb-1">Quantity (Lots)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-slate-400 block mb-1">Entry Price {orderType === "MARKET" && "(Optional)"}</label>
          <input
            type="number"
            step="any"
            placeholder={orderType === "MARKET" ? "Market Price" : "Required"}
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-slate-400 block mb-1">Stop Loss (SL)</label>
          <input
            type="number"
            step="any"
            placeholder="SL Price"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-slate-400 block mb-1">Take Profit (TP)</label>
          <input
            type="number"
            step="any"
            placeholder="TP Price"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="pt-1 flex gap-2">
        <button
          type="button"
          onClick={handleEvaluateRisk}
          className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition-colors border border-slate-700"
        >
          Check Risk Guard
        </button>
      </div>

      {riskEvaluation && <ProRiskGuardPanel riskResult={riskEvaluation} />}

      {isLive && (
        <div
          onClick={() => setLiveConfirmation(!liveConfirmation)}
          className="cursor-pointer bg-rose-950/30 border border-rose-500/30 p-2 rounded flex items-start gap-2 text-rose-300 text-[11px]"
        >
          {liveConfirmation ? (
            <CheckSquare size={16} className="text-rose-400 shrink-0 mt-0.5" />
          ) : (
            <Square size={16} className="text-rose-400 shrink-0 mt-0.5" />
          )}
          <span>
            I understand that executing in <strong>LIVE MODE</strong> will place an order with real funds on{" "}
            {account.broker || "broker"}.
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-950/50 border border-rose-500/40 text-rose-300 p-2 rounded text-[11px] flex items-center gap-1.5">
          <ShieldAlert size={14} className="text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <button
        type="button"
        disabled={submitting || isExecutionDisabled}
        onClick={handleConfirmAndExecute}
        className={`w-full py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 text-white shadow-lg transition-all border ${
          isExecutionDisabled
            ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
            : side === "BUY"
            ? "bg-emerald-600 hover:bg-emerald-500 border-emerald-500 shadow-emerald-950/60"
            : "bg-rose-600 hover:bg-rose-500 border-rose-500 shadow-rose-950/60"
        }`}
      >
        <Send size={14} className={submitting ? "animate-pulse" : ""} />
        {submitting
          ? "Executing Trade..."
          : `Confirm & Execute ${side} ${quantity} ${symbol} · ${
              account.mode === "LIVE" ? "⚠ LIVE ORDER" : account.mode === "DEMO" ? "DEMO ORDER" : "PAPER ORDER"
            }`}
      </button>
    </div>
  );
};
