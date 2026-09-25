"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Activity, AlertTriangle,
  Bot, Radio, Shield, ChevronRight, RefreshCw,
  Zap, ShieldCheck, AlertCircle
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { database } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/loading-state";
import { MobileErrorBoundary } from "@/components/mobile/MobileErrorBoundary";

interface TradingAccount {
  id: string;
  mt5Account: string;
  broker: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  status: string;
  lastHeartbeatAt: number;
}

interface AlertItem {
  id: string;
  title: string;
  message: string;
  level: "info" | "warning" | "critical";
  createdAt: number;
  read: boolean;
  link?: string;
}

interface BotSummary {
  id: string;
  name: string;
  status: "active" | "paused" | "disconnected";
  symbol: string | null;
  pnl: number;
  drawdown: number;
  lastHeartbeatAt: number | null;
  licenseExpiry?: number;
}

interface SignalSummary {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  timeframe: string;
  confidence: number;
  status: string;
  createdAt: number;
  tier: "FREE" | "PRO";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getRiskStatus(accounts: TradingAccount[]): "normal" | "attention" | "critical" {
  if (accounts.length === 0) return "normal";
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = accounts.reduce((sum, a) => sum + a.equity, 0);
  const drawdownPct = totalBalance > 0 ? ((totalBalance - totalEquity) / totalBalance) * 100 : 0;
  const offlineCount = accounts.filter(a => a.status !== "online").length;
  
  if (drawdownPct > 10 || offlineCount > 0) return "critical";
  if (drawdownPct > 5) return "attention";
  return "normal";
}

export default function MobileHomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [signals, setSignals] = useState<SignalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [riskStatus, setRiskStatus] = useState<"normal" | "attention" | "critical">("normal");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    
    try {
      // Fetch accounts
      const accountsRef = ref(database, `trading_accounts/${user.uid}`);
      const accountsSnap = await new Promise<{ exists: () => boolean; val: () => unknown }>((resolve) => {
        const unsub = onValue(accountsRef, (snap) => { unsub(); resolve(snap); }, { onlyOnce: true });
      });
      
      const accountData: TradingAccount[] = [];
      if (accountsSnap.exists()) {
        const data = accountsSnap.val() as Record<string, unknown>;
        for (const [id, val] of Object.entries(data)) {
          const acc = val as Record<string, unknown>;
          accountData.push({
            id,
            mt5Account: String(acc.mt5Account || ""),
            broker: String(acc.broker || ""),
            balance: Number(acc.balance || 0),
            equity: Number(acc.equity || 0),
            margin: Number(acc.margin || 0),
            freeMargin: Number(acc.freeMargin || 0),
            marginLevel: Number(acc.marginLevel || 0),
            status: String(acc.status || ""),
            lastHeartbeatAt: Number(acc.lastHeartbeatAt || 0),
          });
        }
      }
      setAccounts(accountData);
      setRiskStatus(getRiskStatus(accountData));

      // Fetch alerts
      const alertsRef = ref(database, `alerts/${user.uid}`);
      const alertsSnap = await new Promise<{ exists: () => boolean; val: () => unknown }>((resolve) => {
        const unsub = onValue(alertsRef, (snap) => { unsub(); resolve(snap); }, { onlyOnce: true });
      });
      
      const alertData: AlertItem[] = [];
      if (alertsSnap.exists()) {
        const data = alertsSnap.val() as Record<string, unknown>;
        for (const [id, val] of Object.entries(data)) {
          const a = val as Record<string, unknown>;
          alertData.push({
            id,
            title: String(a.title || ""),
            message: String(a.message || ""),
            level: (a.level as AlertItem["level"]) || "info",
            createdAt: Number(a.createdAt || 0),
            read: Boolean(a.read),
            link: a.link ? String(a.link) : undefined,
          });
        }
      }
      setAlerts(alertData.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10));

      // Fetch bots
      const botsRef = ref(database, `user_bots_index/${user.uid}`);
      const botsSnap = await new Promise<{ exists: () => boolean; val: () => unknown }>((resolve) => {
        const unsub = onValue(botsRef, (snap) => { unsub(); resolve(snap); }, { onlyOnce: true });
      });
      
      const botData: BotSummary[] = [];
      if (botsSnap.exists()) {
        const botIds = Object.keys(botsSnap.val() || {});
        for (const botId of botIds.slice(0, 10)) {
          const botSnap = await new Promise<{ exists: () => boolean; val: () => unknown }>((resolve) => {
            const unsub = onValue(ref(database, `user_bots/${botId}`), (snap) => { unsub(); resolve(snap); }, { onlyOnce: true });
          });
          if (botSnap.exists()) {
            const b = botSnap.val() as Record<string, unknown>;
            botData.push({
              id: botId,
              name: String(b.name || "Unknown Bot"),
              status: (b.status as BotSummary["status"]) || "disconnected",
              symbol: b.symbol ? String(b.symbol) : null,
              pnl: Number(b.currentPnl || 0),
              drawdown: Number(b.maxDrawdown || 0),
              lastHeartbeatAt: b.lastHeartbeatAt ? Number(b.lastHeartbeatAt) : null,
              licenseExpiry: b.licenseExpiry ? Number(b.licenseExpiry) : undefined,
            });
          }
        }
      }
      setBots(botData);

      // Fetch recent signals
      const signalsRef = ref(database, "aiSignals");
      const signalsSnap = await new Promise<{ exists: () => boolean; val: () => unknown }>((resolve) => {
        const unsub = onValue(signalsRef, (snap) => { unsub(); resolve(snap); }, { onlyOnce: true });
      });
      
      const signalData: SignalSummary[] = [];
      if (signalsSnap.exists()) {
        const data = signalsSnap.val() as Record<string, unknown>;
        for (const [, val] of Object.entries(data)) {
          const s = val as Record<string, unknown>;
          if (s.status === "READY" || s.status === "ACTIVE") {
            signalData.push({
              id: String(s.id || ""),
              symbol: String(s.symbol || ""),
              direction: (s.direction as "BUY" | "SELL") || "BUY",
              timeframe: String(s.timeframe || ""),
              confidence: Number(s.confidence || 0),
              status: String(s.status || ""),
              createdAt: Number(s.createdAt || 0),
              tier: (s.tier as "FREE" | "PRO") || "FREE",
            });
          }
        }
      }
      setSignals(signalData.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5));

    } catch (error) {
      console.error("[MobileHome] Fetch error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authLoading && user) fetchData();
  }, [authLoading, user, fetchData]);

  const handleRefresh = () => fetchData(true);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = accounts.reduce((sum, a) => sum + a.equity, 0);
  const floatingPnl = totalEquity - totalBalance;
  const onlineAccounts = accounts.filter(a => a.status === "online").length;
  const unreadAlerts = alerts.filter(a => !a.read && (a.level === "warning" || a.level === "critical")).length;
  const activeBots = bots.filter(b => b.status === "active").length;
  const activeSignals = signals.filter(s => s.status === "READY" || s.status === "ACTIVE").length;

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-3/4 rounded" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
          <Skeleton className="h-6 w-1/2 rounded" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen bg-background items-center justify-center p-8 text-center">
        <Shield className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold mb-2">Sign in to AlgoVault</h1>
        <p className="text-muted-foreground mb-6 max-w-xs">Access your trading command center with live data, bots, and signals.</p>
        <Link href="/login"><Button className="w-full sm:w-auto">Sign In</Button></Link>
      </div>
    );
  }

  return (
    <MobileErrorBoundary>
      <div className="flex flex-col min-h-screen bg-background">
      {/* Pull to refresh indicator */}
      <div className="h-2" />
      
      <div className="p-4 space-y-4 pb-24">
        {/* Account Status Card */}
        <Card className={cn("relative overflow-hidden", riskStatus === "critical" && "border-rose-500/30", riskStatus === "attention" && "border-amber-500/30")}>
          <div className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-lg">Account Status</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{accounts.length} connected {accounts.length === 1 ? "account" : "accounts"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge 
                  variant={riskStatus === "normal" ? "default" : riskStatus === "attention" ? "secondary" : "destructive"}
                  className={cn("gap-1", riskStatus === "normal" && "bg-emerald-500/10 text-emerald-400", riskStatus === "attention" && "bg-amber-500/10 text-amber-400", riskStatus === "critical" && "bg-rose-500/10 text-rose-400")}
                >
                  {riskStatus === "normal" && <ShieldCheck className="h-3 w-3" />}
                  {riskStatus === "attention" && <AlertTriangle className="h-3 w-3" />}
                  {riskStatus === "critical" && <AlertCircle className="h-3 w-3" />}
                  <span className="capitalize">{riskStatus}</span>
                </Badge>
              </div>
            </div>
            
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Total Balance</p>
                <p className="font-mono text-xl font-bold mt-1">{formatCurrency(totalBalance)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Equity</p>
                <p className={cn("font-mono text-xl font-bold mt-1", floatingPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatCurrency(totalEquity)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Floating P&L</p>
                <p className={cn("font-mono text-xl font-bold mt-1", floatingPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{floatingPnl >= 0 ? "+" : ""}{formatCurrency(floatingPnl)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Online</p>
                <p className="font-mono text-xl font-bold mt-1 text-emerald-400">{onlineAccounts} / {accounts.length}</p>
              </div>
            </div>

            {accounts.length > 0 && (
              <Link href="/account" className="mt-4 block">
                <div className="rounded-lg border border-border/30 p-3 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>View all accounts</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>
              </Link>
            )}
          </div>
        </Card>

        {/* Quick Actions / Status Grid */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/bots" className="group">
            <Card className="h-full p-4 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-violet-500/10"><Bot className="h-5 w-5 text-violet-400" /></div>
                  <div>
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">My Bots</p>
                    <p className="font-semibold">{bots.length}</p>
                  </div>
                </div>
                <Badge variant={activeBots > 0 ? "default" : "outline"} className={activeBots > 0 ? "bg-emerald-500/10 text-emerald-400" : ""}>
                  {activeBots} Active
                </Badge>
              </div>
            </Card>
          </Link>

          <Link href="/signals" className="group">
            <Card className="h-full p-4 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-emerald-500/10"><Radio className="h-5 w-5 text-emerald-400" /></div>
                  <div>
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">AI Signals</p>
                    <p className="font-semibold">{signals.length}</p>
                  </div>
                </div>
                <Badge variant={activeSignals > 0 ? "default" : "outline"} className={activeSignals > 0 ? "bg-emerald-500/10 text-emerald-400" : ""}>
                  {activeSignals} Ready
                </Badge>
              </div>
            </Card>
          </Link>

          <Link href="/markets" className="group">
            <Card className="h-full p-4 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-sky-500/10"><Activity className="h-5 w-5 text-sky-400" /></div>
                  <div>
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">Markets</p>
                    <p className="font-semibold">Scanner</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
          </Link>

          <Link href="/trade-journal" className="group">
            <Card className="h-full p-4 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-amber-500/10"><TrendingUp className="h-5 w-5 text-amber-400" /></div>
                  <div>
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">Journal</p>
                    <p className="font-semibold">Analytics</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
          </Link>
        </div>

        {/* Active Bots */}
        {bots.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Bot className="h-5 w-5 text-violet-400" />
                  Active Bots
                </h3>
                <Link href="/bots" className="text-sm text-primary hover:underline">View all</Link>
              </div>
              <div className="space-y-2">
                {bots.slice(0, 3).map((bot) => (
                  <Link key={bot.id} href={`/bots/${bot.id}`} className="block">
                    <div className="rounded-lg border border-border/30 p-3 transition-colors hover:bg-muted/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn("p-2 rounded-lg flex-shrink-0",
                            bot.status === "active" && "bg-emerald-500/10",
                            bot.status === "paused" && "bg-amber-500/10",
                            bot.status === "disconnected" && "bg-rose-500/10"
                          )}>
                            <Bot className={cn("h-4 w-4",
                              bot.status === "active" && "text-emerald-400",
                              bot.status === "paused" && "text-amber-400",
                              bot.status === "disconnected" && "text-rose-400"
                            )} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{bot.name}</p>
                            <p className="text-xs text-muted-foreground">{bot.symbol || "Multi-symbol"}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={cn("font-mono font-semibold", bot.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {bot.pnl >= 0 ? "+" : ""}{formatCurrency(bot.pnl)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">DD: {bot.drawdown.toFixed(1)}%</p>
                        </div>
                      </div>
                      {/* eslint-disable-next-line react/no-impure-render */}
                      {bot.licenseExpiry && bot.licenseExpiry < Date.now() + 7 * 86400000 && (
                        <Badge variant="destructive" className="mt-2 text-[10px]">License expires soon</Badge>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Signals */}
        {signals.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Radio className="h-5 w-5 text-emerald-400" />
                  Latest Signals
                </h3>
                <Link href="/signals" className="text-sm text-primary hover:underline">View all</Link>
              </div>
              <div className="space-y-2">
                {signals.slice(0, 3).map((signal) => (
                  <Link key={signal.id} href={`/signals/${signal.id}`} className="block">
                    <div className="rounded-lg border border-border/30 p-3 transition-colors hover:bg-muted/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", signal.direction === "BUY" ? "bg-emerald-500/10" : "bg-rose-500/10")}>
                            {signal.direction === "BUY" ? (
                              <TrendingUp className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-rose-400" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{signal.symbol}</p>
                            <p className="text-xs text-muted-foreground">{signal.timeframe} • {signal.tier} • {signal.confidence}%</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={cn(
                          signal.status === "READY" && "border-emerald-500/30 text-emerald-400",
                          signal.status === "ACTIVE" && "border-sky-500/30 text-sky-400"
                        )}>
                          {signal.status}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Critical Alerts */}
        {alerts.filter(a => a.level === "critical" || a.level === "warning").length > 0 && (
          <Card className="border-rose-500/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-400" />
                  Important Alerts
                  {unreadAlerts > 0 && <Badge variant="destructive" className="text-[10px]">{unreadAlerts}</Badge>}
                </h3>
                <Link href="/alerts" className="text-sm text-primary hover:underline">View all</Link>
              </div>
              <div className="space-y-2">
                {alerts.filter(a => a.level === "critical" || a.level === "warning").slice(0, 3).map((alert) => (
                  <Link key={alert.id} href={alert.link || "/alerts"} className="block">
                    <div className={cn("rounded-lg p-3 border", alert.level === "critical" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5")}>
                      <div className="flex items-start gap-2">
                        <div className={cn("flex-shrink-0 mt-0.5",
                          alert.level === "critical" && "text-rose-400",
                          alert.level === "warning" && "text-amber-400"
                        )}>
                          {alert.level === "critical" ? <AlertCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm">{alert.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.message}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{formatTimeAgo(alert.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty state when no data */}
        {accounts.length === 0 && bots.length === 0 && signals.length === 0 && alerts.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Welcome to AlgoVault</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
                Connect your MT5 account, explore the marketplace, or generate AI signals to get started.
              </p>
              <div className="flex gap-3 justify-center">
                <Link href="/account/trading-access"><Button>Connect MT5</Button></Link>
                <Link href="/marketplace"><Button variant="outline">Browse Marketplace</Button></Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Refresh button */}
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh Data
          </Button>
        </div>
      </div>
    </div>
  </MobileErrorBoundary>
);
}