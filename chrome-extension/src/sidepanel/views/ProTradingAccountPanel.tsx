import React from "react";
import {
  ShieldAlert,
  CheckCircle2,
  AlertOctagon,
  RefreshCw,
  Wallet,
  Activity,
  Lock,
  Layers,
} from "lucide-react";
import { TradingViewAccountInfo, AccountState } from "@/types/execution";

interface Props {
  account: TradingViewAccountInfo;
  onRefresh: () => void;
  refreshing: boolean;
}

const STATE_CONFIG: Record<
  AccountState,
  { label: string; bg: string; text: string; border: string; icon: React.ReactNode }
> = {
  TRADING_ENABLED: {
    label: "TRADING ENABLED",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    icon: <CheckCircle2 size={13} />,
  },
  CONNECTED: {
    label: "CONNECTED",
    bg: "bg-sky-500/15",
    text: "text-sky-400",
    border: "border-sky-500/30",
    icon: <CheckCircle2 size={13} />,
  },
  ACCOUNT_DETECTED: {
    label: "ACCOUNT DETECTED",
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/30",
    icon: <Activity size={13} />,
  },
  READ_ONLY: {
    label: "READ ONLY",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
    icon: <Lock size={13} />,
  },
  EXECUTION_UNAVAILABLE: {
    label: "MCP READ-ONLY (EXECUTION UNAVAILABLE)",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
    icon: <AlertOctagon size={13} />,
  },
  LIMITED: {
    label: "LIMITED CAPABILITY",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
    icon: <AlertOctagon size={13} />,
  },
  AUTHENTICATION_REQUIRED: {
    label: "AUTH REQUIRED",
    bg: "bg-rose-500/15",
    text: "text-rose-400",
    border: "border-rose-500/30",
    icon: <Lock size={13} />,
  },
  ERROR: {
    label: "ACCOUNT ERROR",
    bg: "bg-rose-500/15",
    text: "text-rose-400",
    border: "border-rose-500/30",
    icon: <ShieldAlert size={13} />,
  },
  NOT_CONNECTED: {
    label: "NOT CONNECTED",
    bg: "bg-slate-700/30",
    text: "text-slate-400",
    border: "border-slate-600/40",
    icon: <Lock size={13} />,
  },
};

export const ProTradingAccountPanel: React.FC<Props> = ({ account, onRefresh, refreshing }) => {
  const stateCfg = STATE_CONFIG[account.accountState] || STATE_CONFIG.NOT_CONNECTED;
  const isLive = account.mode === "LIVE";
  const isDemo = account.mode === "DEMO";

  const secondsAgo = Math.floor((Date.now() - account.lastSyncTimestamp) / 1000);
  const timeLabel = secondsAgo < 5 ? "Just now" : `${secondsAgo}s ago`;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-cyan-400" />
          <span className="font-semibold text-slate-200 uppercase tracking-wider">Trading Account</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
          title="Refresh account status"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin text-cyan-400" : ""} />
        </button>
      </div>

      {/* Account Mode & State Badges */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Mode Badge */}
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isLive
              ? "bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse"
              : isDemo
              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
          }`}
        >
          {isLive ? "● LIVE ACCOUNT" : isDemo ? "● DEMO ACCOUNT" : "● PAPER TRADING"}
        </span>

        {/* State Badge */}
        <span
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${stateCfg.bg} ${stateCfg.text} ${stateCfg.border}`}
        >
          {stateCfg.icon}
          {stateCfg.label}
        </span>
      </div>

      {/* Live Trading Warning Banner if Live */}
      {isLive && (
        <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-2 rounded text-[11px] flex items-start gap-2">
          <ShieldAlert size={14} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block text-rose-200">LIVE ACCOUNT WARNING</span>
            Orders placed in LIVE mode execute against real funds. Double-check all risk parameters.
          </div>
        </div>
      )}

      {/* Demo Account Notice */}
      {isDemo && (
        <div className="bg-amber-950/30 border border-amber-500/20 text-amber-300/90 p-2 rounded text-[11px] flex items-start gap-2">
          <Activity size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block text-amber-200">Broker Demo Account</span>
            You are connected to a broker demo account via MT5 Gateway. Orders use real market prices but no real funds.
          </div>
        </div>
      )}

      {/* MCP Read-Only Context Notice */}
      {account.accountState === "EXECUTION_UNAVAILABLE" && (
        <div className="bg-amber-950/30 border border-amber-500/20 text-amber-300/90 p-2 rounded text-[11px]">
          <div className="font-medium text-amber-200 mb-0.5">TradingView MCP Limitation</div>
          TradingView MCP supports read-only market intelligence. To execute trades, start the AlgoVault MT5 Gateway server.
        </div>
      )}

      {/* Account Details & Balance */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800 text-[11px]">
        <div>
          <span className="text-slate-400 block text-[10px]">BROKER / SOURCE</span>
          <span className="font-medium text-slate-200">{account.broker || "TradingView"}</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px]">ACCOUNT ID</span>
          <span className="font-mono text-slate-300">{account.accountId || "N/A"}</span>
        </div>

        {account.balance !== null && account.balance !== undefined && (
          <div>
            <span className="text-slate-400 block text-[10px]">BALANCE</span>
            <span className="font-semibold text-slate-100 flex items-center gap-1">
              <Wallet size={11} className="text-cyan-400" />
              {account.currency || "$"} {account.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {account.equity !== null && account.equity !== undefined && (
          <div>
            <span className="text-slate-400 block text-[10px]">EQUITY</span>
            <span className="font-semibold text-slate-100">
              {account.currency || "$"} {account.equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </div>

      {/* Sync Freshness Footnote */}
      <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-slate-800/60">
        <span>Sync Freshness:</span>
        <span className="font-mono text-slate-400">{timeLabel}</span>
      </div>
    </div>
  );
};
