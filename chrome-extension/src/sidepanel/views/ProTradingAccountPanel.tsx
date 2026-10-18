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
    bg: "bg-positive/15",
    text: "text-positive",
    border: "border-positive/30",
    icon: <CheckCircle2 size={13} />,
  },
  CONNECTED: {
    label: "CONNECTED",
    bg: "bg-positive/15",
    text: "text-positive",
    border: "border-positive/30",
    icon: <CheckCircle2 size={13} />,
  },
  ACCOUNT_DETECTED: {
    label: "ACCOUNT DETECTED",
    bg: "bg-brand/10",
    text: "text-brand-foreground",
    border: "border-brand/40",
    icon: <Activity size={13} />,
  },
  READ_ONLY: {
    label: "READ ONLY",
    bg: "bg-warning/15",
    text: "text-warning",
    border: "border-warning/30",
    icon: <Lock size={13} />,
  },
  EXECUTION_UNAVAILABLE: {
    label: "EXECUTION UNAVAILABLE",
    bg: "bg-warning/15",
    text: "text-warning",
    border: "border-warning/30",
    icon: <AlertOctagon size={13} />,
  },
  LIMITED: {
    label: "LIMITED CAPABILITY",
    bg: "bg-warning/15",
    text: "text-warning",
    border: "border-warning/30",
    icon: <AlertOctagon size={13} />,
  },
  AUTHENTICATION_REQUIRED: {
    label: "AUTH REQUIRED",
    bg: "bg-negative/15",
    text: "text-negative",
    border: "border-negative/30",
    icon: <Lock size={13} />,
  },
  ERROR: {
    label: "ACCOUNT ERROR",
    bg: "bg-negative/15",
    text: "text-negative",
    border: "border-negative/30",
    icon: <ShieldAlert size={13} />,
  },
  NOT_CONNECTED: {
    label: "NOT CONNECTED",
    bg: "bg-secondary/30",
    text: "text-muted-foreground",
    border: "border-border/40",
    icon: <Lock size={13} />,
  },
};

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">{label}</span>
      <span className={`text-foreground ${mono ? "font-numeric" : ""}`}>{value}</span>
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
    ? "bg-negative/20 text-negative border-negative/40"
    : account.mode === "PAPER"
    ? "bg-positive/15 text-positive border-positive/30"
    : account.mode === "DEMO"
    ? "bg-warning/15 text-warning border-warning/30"
    : "bg-secondary/40 text-foreground border-border/50";

  return (
    <div className="bg-card/80 border border-border rounded-xl p-3 space-y-3 text-xs">
      {/* Header + freshness */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={14} />
          <span className="font-semibold text-foreground uppercase tracking-wider">Trading Account</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-numeric text-[10px] text-muted-foreground">{timeLabel}</span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-1 hover:bg-secondary/80 rounded-lg text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh account status"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── TRADINGVIEW connection ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-24">TradingView</span>
        <span
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
            tvConnected
              ? "bg-positive/15 text-positive border-positive/30"
              : "bg-secondary text-muted-foreground border-border"
          }`}
        >
          {tvConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
          {tvConnected ? "Connected" : "Not connected"}
        </span>
        {account.tradingView.mcpState && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-secondary text-muted-foreground border-border">
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
          <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Mode</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${modeTone}`}>
            {isLive && <span className="h-1.5 w-1.5 rounded-full bg-negative" />}
            {modeLabel(account.mode)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Execution</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              executionEnabled
                ? "bg-positive/15 text-positive border-positive/30"
                : "bg-warning/15 text-warning border-warning/30"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${executionEnabled ? "bg-positive" : "bg-warning"}`}
            />
            {executionEnabled ? "Available" : "Unavailable"}
          </span>
        </div>
      </div>

      {/* Account state badge */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${stateCfg.bg} ${stateCfg.text} ${stateCfg.border}`}
        >
          {stateCfg.icon}
          {stateCfg.label}
        </span>
        {account.currency && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-secondary text-foreground border-border">
            {account.currency}
          </span>
        )}
      </div>

      {/* ── LIVE ACCOUNT warning (persistent, §21) ───────────────────── */}
      {(isLive || (modeUnreported && executionEnabled)) && (
        <div className="bg-negative/10 border border-negative/30 text-negative p-2 rounded-lg text-[11px] flex items-start gap-2">
          <ShieldAlert size={14} className="text-negative shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block text-negative">LIVE ACCOUNT</span>
            {isLive
              ? "Orders placed from this ticket are routed to a live account. Double-check every risk parameter before confirming."
              : "No source reported whether this account is paper or live — treat it as LIVE. TradingView MCP does not expose account mode."}
          </div>
        </div>
      )}

      {/* ── capability limitation (§28) ──────────────────────────────── */}
      {account.unsupportedReason && !executionEnabled && (
        <div className="bg-warning/10 border border-warning/20 text-warning p-2 rounded-lg text-[11px]">
          <div className="font-medium text-warning mb-0.5">Capability limitation</div>
          {account.unsupportedReason}
        </div>
      )}

      {/* ── financials (only when reported) ──────────────────────────── */}
      {(account.balance !== null || account.equity !== null) ? (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border text-[11px]">
          {account.balance !== null && (
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase">Balance</span>
              <span className="font-semibold text-foreground flex items-center gap-1">
                <Wallet size={11} />
                {account.currency ? `${account.currency} ` : ""}
                {account.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {account.equity !== null && (
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase">Equity</span>
              <span className="font-semibold text-foreground">
                {account.currency ? `${account.currency} ` : ""}
                {account.equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {account.marginFree !== null && (
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase">Free margin</span>
              <span className="font-medium text-foreground">{account.marginFree.toFixed(2)}</span>
            </div>
          )}
          {account.marginLevel !== null && (
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase">Margin level</span>
              <span className="font-medium text-foreground">{account.marginLevel.toFixed(2)}%</span>
            </div>
          )}
        </div>
      ) : (
        <div className="pt-1 border-t border-border text-[11px] text-muted-foreground">
          Account information unavailable — balance, equity and margin are not reported by the
          connected source.
        </div>
      )}

      {/* ── data surfaces ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/60 text-[10px] text-muted-foreground">
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
            className={`px-1.5 py-0.5 rounded-full border ${
              ok
                ? "bg-positive/10 text-positive border-positive/25"
                : "bg-secondary text-muted-foreground border-border"
            }`}
          >
            {label}: {ok ? "live" : "unavailable"}
          </span>
        ))}
      </div>

      <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1 border-t border-border/60">
        <span>Sync freshness</span>
        <span className="font-numeric text-muted-foreground">{timeLabel}</span>
      </div>
    </div>
  );
};
