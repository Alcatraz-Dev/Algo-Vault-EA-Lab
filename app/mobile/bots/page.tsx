"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bot, AlertTriangle, Clock, Zap, ChevronRight, RefreshCw, Activity, AlertCircle } from "lucide-react";
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

interface UserBot {
  id: string;
  ownerId: string;
  type: "marketplace" | "custom";
  name: string;
  platform: string;
  symbol: string | null;
  timeframe: string | null;
  magicNumber: string | null;
  commentFilter: string | null;
  productId: string | null;
  licenseId: string | null;
  mt5Account: string | null;
  gatewayInstallationId: string | null;
  mapping: Record<string, unknown> | null;
  status: "active" | "paused" | "disconnected";
  online: boolean;
  lastHeartbeatAt: number | null;
  description?: string;
  createdAt: number;
  updatedAt: number;
  currentPnl?: number;
  maxDrawdown?: number;
  licenseExpiry?: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return "Never";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getBotStatus(bot: UserBot): "active" | "paused" | "disconnected" | "warning" {
  if (bot.licenseExpiry && bot.licenseExpiry < Date.now()) return "disconnected";
  if (bot.licenseExpiry && bot.licenseExpiry < Date.now() + 7 * 86400000) return "warning";
  if (!bot.online) return "disconnected";
  return bot.status;
}

export default function MobileBotsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [bots, setBots] = useState<UserBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);

  const fetchBots = useCallback(async () => {
    if (!user) return;
    try {
      const indexRef = ref(database, `user_bots_index/${user.uid}`);
      const indexSnap = await new Promise<any>((resolve) => {
        const unsub = onValue(indexRef, (s) => { unsub(); resolve(s); }, { onlyOnce: true });
      });
      
      const botData: UserBot[] = [];
      if (indexSnap.exists()) {
        const botIds = Object.keys(indexSnap.val() || {});
        for (const botId of botIds) {
          const botSnap = await new Promise<any>((resolve) => {
            const unsub = onValue(ref(database, `user_bots/${botId}`), (s) => { unsub(); resolve(s); }, { onlyOnce: true });
          });
          if (botSnap.exists()) {
            const b = botSnap.val();
            botData.push({ ...b, id: botId });
          }
        }
      }
      setBots(botData.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    } catch (error) {
      console.error("[MobileBots] Fetch error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authLoading && user) fetchBots();
  }, [authLoading, user, fetchBots]);

  const handleRefresh = () => fetchBots();

  const activeBots = bots.filter(b => getBotStatus(b) === "active").length;
  const pausedBots = bots.filter(b => getBotStatus(b) === "paused").length;
  const warningBots = bots.filter(b => getBotStatus(b) === "warning").length;
  const disconnectedBots = bots.filter(b => getBotStatus(b) === "disconnected").length;
  const totalPnl = bots.reduce((sum, b) => sum + (b.currentPnl || 0), 0);

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-40 h-14 bg-background/80 backdrop-blur-sm border-b border-border flex items-center px-4">
          <h1 className="text-lg font-semibold">My Bots</h1>
        </header>
        <div className="flex-1 p-4 space-y-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen bg-background items-center justify-center p-8 text-center">
        <Bot className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold mb-2">Sign in to view your bots</h1>
        <Link href="/login"><Button className="w-full sm:w-auto">Sign In</Button></Link>
      </div>
    );
  }

  return (
    <MobileErrorBoundary>
      <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="h-14 flex items-center justify-between px-4">
          <h1 className="text-lg font-semibold">My Bots</h1>
          <div className="flex items-center gap-2">
            <Link href="/account/bots/new" className="hidden sm:flex">
              <Button size="sm" className="gap-1"><Bot className="h-4 w-4" /> Add Bot</Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing} className="h-9 w-9">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-3 py-3 border-b border-border bg-muted/30 grid grid-cols-4 gap-2 text-center">
          <div>
            <p className="font-mono font-bold text-lg text-emerald-400">{activeBots}</p>
            <p className="text-[10px] text-muted-foreground">Active</p>
          </div>
          <div>
            <p className="font-mono font-bold text-lg text-amber-400">{pausedBots}</p>
            <p className="text-[10px] text-muted-foreground">Paused</p>
          </div>
          <div>
            <p className="font-mono font-bold text-lg text-rose-400">{disconnectedBots + warningBots}</p>
            <p className="text-[10px] text-muted-foreground">Issues</p>
          </div>
          <div>
            <p className={cn("font-mono font-bold text-lg", totalPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}</p>
            <p className="text-[10px] text-muted-foreground">Total P&L</p>
          </div>
        </div>
      </header>

      {/* Bot List */}
      <div className="flex-1 overflow-auto p-3 pb-20">
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : bots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground p-4">
            <Bot className="h-12 w-12 mb-3 opacity-50" />
            <h3 className="font-semibold mb-1">No bots connected</h3>
            <p className="text-sm mb-4 max-w-xs">Connect your MT5 account and add a bot from the marketplace or create a custom one.</p>
            <div className="flex gap-3">
              <Link href="/marketplace"><Button>Browse Marketplace</Button></Link>
              <Link href="/account/bots/new"><Button variant="outline">Add Custom Bot</Button></Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {bots.map((bot) => {
              const status = getBotStatus(bot);
              const statusConfig = {
                active: { icon: Activity, variant: "success" as const, label: "Active", bg: "bg-emerald-500/10", color: "text-emerald-400" },
                paused: { icon: ChevronRight, variant: "warning" as const, label: "Paused", bg: "bg-amber-500/10", color: "text-amber-400" },
                disconnected: { icon: AlertCircle, variant: "destructive" as const, label: "Disconnected", bg: "bg-rose-500/10", color: "text-rose-400" },
                warning: { icon: AlertTriangle, variant: "warning" as const, label: "License Expiring", bg: "bg-amber-500/10", color: "text-amber-400" },
              }[status];

              const StatusIcon = statusConfig.icon;

              return (
                <Link key={bot.id} href={`/bots/${bot.id}`} className="block">
                  <Card className={cn("p-3 transition-colors hover:border-primary/30", status === "warning" && "border-amber-500/30", status === "disconnected" && "border-rose-500/30")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={cn("p-2 rounded-lg flex-shrink-0", statusConfig.bg)}>
                          <StatusIcon className={cn("h-5 w-5", statusConfig.color)} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold truncate">{bot.name}</h3>
                            {bot.type === "marketplace" && <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-400">Marketplace</Badge>}
                            {bot.type === "custom" && <Badge variant="outline" className="text-[10px]">Custom</Badge>}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="font-mono">{bot.symbol || "Multi"}</span>
                            <span>•</span>
                            <span>{bot.timeframe || "Multi"}</span>
                            <span>•</span>
                            <span>Magic: {bot.magicNumber || "—"}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={statusConfig.variant} className="text-[10px]">
                              {statusConfig.label}
                            </Badge>
                            {bot.licenseExpiry && bot.licenseExpiry < Date.now() + 7 * 86400000 && (
                              <Badge variant="destructive" className="text-[10px]">Expires {new Date(bot.licenseExpiry).toLocaleDateString()}</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right min-w-[80px]">
                        <p className={cn("font-mono font-semibold text-sm", (bot.currentPnl || 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {bot.currentPnl && bot.currentPnl >= 0 ? "+" : ""}{bot.currentPnl ? formatCurrency(bot.currentPnl) : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">DD: {bot.maxDrawdown ? bot.maxDrawdown.toFixed(1) : "—"}%</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{bot.online ? <span className="flex items-center gap-1 text-emerald-400"><Activity className="h-2.5 w-2.5" /> Online</span> : <span className="flex items-center gap-1 text-rose-400"><AlertCircle className="h-2.5 w-2.5" /> Offline</span>}</p>
                        <p className="text-[10px] text-muted-foreground">Updated {formatTimeAgo(bot.lastHeartbeatAt || bot.updatedAt)}</p>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

        {/* Add bot button for mobile */}
        <div className="pt-4 pb-8 sm:hidden">
          <Link href="/account/bots/new"><Button className="w-full gap-2"><Bot className="h-4 w-4" /> Add New Bot</Button></Link>
        </div>
      </div>
    </div>
  </MobileErrorBoundary>
);
}