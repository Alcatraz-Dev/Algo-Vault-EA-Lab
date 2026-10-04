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
  Wifi,
  WifiOff,
} from "lucide-react";
import type { TradingViewAccountInfo, AccountState } from "@/types/execution";
import { accountAgeLabel } from "@/services/tv-account-service";
import { modeLabel } from "@/services/trade-ticket";

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
    label: "EXECUTION UNAVAILABLE",
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

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <span className="text-slate-400 block text-[10px] uppercase tracking-wider">{label}</span>
      <span className={`text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export const ProTradingAccountPanel: React.FC<Props> = ({ account, onRefresh, refreshing }) => {
  const stateCfg = STATE_CONFIG[account.accountState] || STATE_CONFIG.NOT_CONNECTED;
  const isLive = account.mode === "LIVE";
  const modeUnreported = account.mode === "UNKNOWN";
  const executionEnabled =
    account.accountState === "TRADING_ENABLED" && account.tradingEnabled;

  const tvConnected = account.tradingView.chartConnected || account.connectionStatus === "CONNECTED";
  const timeLabel = accountAgeLabel(account);

  const modeTone = isLive
    ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
    : account.mode === "PAPER"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : account.mode === "DEMO"
    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : "bg-slate-700/40 text-slate-300 border-slate-600/50";

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-3 text-xs">
      {/* Header + freshness */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-cyan-400" />
          <span className="font-semibold text-slate-200 uppercase tracking-wider">Trading Account</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-500">{timeLabel}</span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
            title="Refresh account status"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin text-cyan-400" : ""} />
          </button>
        </div>
      </div>

      {/* ── TRADINGVIEW connection ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 w-24">TradingView</span>
        <span
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
            tvConnected
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-slate-800 text-slate-400 border-slate-700"
          }`}
        >
          {tvConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
          {tvConnected ? "Connected" : "Not connected"}
        </span>
        {account.tradingView.mcpState && (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium border bg-slate-800 text-slate-400 border-slate-700">
            MCP: {account.tradingView.mcpState}
          </span>
        )}
      </div>

      {/* ── BROKER / ACCOUNT / MODE / STATUS ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <Row label="Broker" value={account.broker || "Not detected"} />
        <Row
          label="Account"
          value={account.accountIdMasked || "Account information unavailable"}
          mono
        />
        <div>
          <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Mode</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${modeTone}`}>
            {isLive && <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />}
            {modeLabel(account.mode)}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Execution</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
              executionEnabled
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/15 text-amber-400 border-amber-500/30"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${executionEnabled ? "bg-emerald-400" : "bg-amber-400"}`}
            />
            {executionEnabled ? "Available" : "Unavailable"}
          </span>
        </div>
      </div>

      {/* Account state badge */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${stateCfg.bg} ${stateCfg.text} ${stateCfg.border}`}
        >
          {stateCfg.icon}
          {stateCfg.label}
        </span>
        {account.currency && (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium border bg-slate-800 text-slate-300 border-slate-700">
            {account.currency}
          </span>
        )}
      </div>

      {/* ── LIVE ACCOUNT warning (persistent, §21) ───────────────────── */}
      {(isLive || (modeUnreported && executionEnabled)) && (
        <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-2 rounded text-[11px] flex items-start gap-2">
          <ShieldAlert size={14} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block text-rose-200">LIVE ACCOUNT</span>
            {isLive
              ? "Orders placed from this ticket are routed to a live account. Double-check every risk parameter before confirming."
              : "No source reported whether this account is paper or live — treat it as LIVE. TradingView MCP does not expose account mode."}
          </div>
        </div>
      )}

      {/* ── capability limitation (§28) ──────────────────────────────── */}
      {account.unsupportedReason && !executionEnabled && (
        <div className="bg-amber-950/30 border border-amber-500/20 text-amber-300/90 p-2 rounded text-[11px]">
          <div className="font-medium text-amber-200 mb-0.5">Capability limitation</div>
          {account.unsupportedReason}
        </div>
      )}

      {/* ── financials (only when reported) ──────────────────────────── */}
      {(account.balance !== null || account.equity !== null) ? (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800 text-[11px]">
          {account.balance !== null && (
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Balance</span>
              <span className="font-semibold text-slate-100 flex items-center gap-1">
                <Wallet size={11} className="text-cyan-400" />
                {account.currency ? `${account.currency} ` : ""}
                {account.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {account.equity !== null && (
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Equity</span>
              <span className="font-semibold text-slate-100">
                {account.currency ? `${account.currency} ` : ""}
                {account.equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {account.marginFree !== null && (
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Free margin</span>
              <span className="font-medium text-slate-200">{account.marginFree.toFixed(2)}</span>
            </div>
          )}
          {account.marginLevel !== null && (
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Margin level</span>
              <span className="font-medium text-slate-200">{account.marginLevel.toFixed(2)}%</span>
            </div>
          )}
        </div>
      ) : (
        <div className="pt-1 border-t border-slate-800 text-[11px] text-slate-500">
          Account information unavailable — balance, equity and margin are not reported by the
          connected source.
        </div>
      )}

      {/* ── data surfaces ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800/60 text-[9px] text-slate-400">
        <span className="uppercase tracking-wider w-full mb-0.5">Data surfaces</span>
        {(
          [
            ["Positions", account.dataAvailability.positions],
            ["Pending orders", account.dataAvailability.pendingOrders],
            ["Execution history", account.dataAvailability.executionHistory],
          ] as Array<[string, boolean]>
        ).map(([label, ok]) => (
          <span
            key={label}
            className={`px-1.5 py-0.5 rounded border ${
              ok
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                : "bg-slate-800 text-slate-500 border-slate-700"
            }`}
          >
            {label}: {ok ? "live" : "unavailable"}
          </span>
        ))}
      </div>

      <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-slate-800/60">
        <span>Sync freshness</span>
        <span className="font-mono text-slate-400">{timeLabel}</span>
      </div>
    </div>
  );
};
