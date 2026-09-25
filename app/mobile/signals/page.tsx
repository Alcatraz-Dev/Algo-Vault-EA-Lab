"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Radio, TrendingUp, TrendingDown, Target,
  Clock, Shield, Star, Zap, RefreshCw, CheckCircle2
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
import { Separator } from "@/components/ui/separator";
import { MobileErrorBoundary } from "@/components/mobile/MobileErrorBoundary";

interface AISignal {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  timeframe: string;
  tier: "FREE" | "PRO";
  category: string;
  entry: number;
  stopLoss: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  confidence: number;
  strength: string;
  marketRegime: string;
  riskReward: number;
  status: string;
  analysis: Record<string, unknown>;
  confidenceBreakdown: Record<string, unknown>;
  reasoning: string;
  currentPrice: number;
  distanceToEntry: number;
  distanceToSL: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  engineVersion: string;
  strategyVersion: string;
}

function formatPrice(symbol: string, price: number): string {
  const decimals = symbol.includes("JPY") ? 3 : symbol.includes("XAU") || symbol.includes("BTC") ? 2 : 5;
  return price.toFixed(decimals);
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

function getRegimeLabel(regime: string): string {
  return regime.replace(/_/g, " ").toLowerCase();
}

export default function MobileSignalsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signals, setSignals] = useState<AISignal[]>([]);
  const [filteredSignals, setFilteredSignals] = useState<AISignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ready" | "active" | "completed" | "free" | "pro">("all");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);

  const fetchSignals = useCallback(async () => {
    if (!user) return;
    try {
      const signalsRef = ref(database, "aiSignals");
      const snap = await new Promise<any>((resolve) => {
        const unsub = onValue(signalsRef, (s) => { unsub(); resolve(s); }, { onlyOnce: true });
      });
      
      const signalData: AISignal[] = [];
      if (snap.exists()) {
        snap.forEach((child: { val: () => unknown; key: string }) => {
          const s = child.val() as AISignal;
          if (s && s.id) signalData.push(s);
        });
      }
      setSignals(signalData.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error("[MobileSignals] Fetch error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  const getStatusVariant = (status: string): "default" | "success" | "warning" | "destructive" | "outline" => {
    switch (status) {
      case "READY": return "success";
      case "ACTIVE": return "outline";
      case "WIN": return "success";
      case "LOSS": return "destructive";
      case "BREAKEVEN": return "warning";
      default: return "default";
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authLoading && user) fetchSignals();
  }, [authLoading, user, fetchSignals]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let filtered = signals;
    switch (filter) {
      case "ready": filtered = filtered.filter(s => s.status === "READY"); break;
      case "active": filtered = filtered.filter(s => s.status === "ACTIVE"); break;
      case "completed": filtered = filtered.filter(s => s.status === "WIN" || s.status === "LOSS" || s.status === "BREAKEVEN"); break;
      case "free": filtered = filtered.filter(s => s.tier === "FREE"); break;
      case "pro": filtered = filtered.filter(s => s.tier === "PRO"); break;
    }
    setFilteredSignals(filtered);
  }, [filter, signals]);

  const handleRefresh = () => fetchSignals();

  const readyCount = signals.filter(s => s.status === "READY").length;
  const activeCount = signals.filter(s => s.status === "ACTIVE").length;
  const completedCount = signals.filter(s => s.status === "WIN" || s.status === "LOSS" || s.status === "BREAKEVEN").length;
  const winCount = signals.filter(s => s.status === "WIN").length;
  const lossCount = signals.filter(s => s.status === "LOSS").length;
  const winRate = completedCount > 0 ? ((winCount / completedCount) * 100).toFixed(1) : "0";

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-40 h-14 bg-background/80 backdrop-blur-sm border-b border-border flex items-center px-4">
          <h1 className="text-lg font-semibold">AI Signals</h1>
        </header>
        <div className="flex-1 p-4 space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen bg-background items-center justify-center p-8 text-center">
        <Radio className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold mb-2">Sign in to view signals</h1>
        <Link href="/login"><Button className="w-full sm:w-auto">Sign In</Button></Link>
      </div>
    );
  }

  const filters = [
    { id: "all", label: "All", count: signals.length },
    { id: "ready", label: "Ready", count: readyCount },
    { id: "active", label: "Active", count: activeCount },
    { id: "completed", label: "Completed", count: completedCount },
    { id: "free", label: "Free", count: signals.filter(s => s.tier === "FREE").length },
    { id: "pro", label: "Pro", count: signals.filter(s => s.tier === "PRO").length },
  ] as const;

  return (
    <MobileErrorBoundary>
      <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="h-14 flex items-center justify-between px-4">
          <h1 className="text-lg font-semibold">AI Signals</h1>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing} className="h-9 w-9">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="font-mono font-bold text-lg text-emerald-400">{winRate}%</p>
              <p className="text-[10px] text-muted-foreground">Win Rate</p>
            </div>
            <div>
              <p className="font-mono font-bold text-lg">{readyCount + activeCount}</p>
              <p className="text-[10px] text-muted-foreground">Open</p>
            </div>
            <div>
              <p className="font-mono font-bold text-lg">{completedCount}</p>
              <p className="text-[10px] text-muted-foreground">Closed</p>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 min-w-max">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors touch-target",
                  filter === f.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {f.label} <span className={cn("ml-1.5 text-[10px] font-normal", filter === f.id ? "opacity-90" : "opacity-70")}>({f.count})</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Signal List */}
      <div className="flex-1 overflow-auto p-3 pb-20">
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : filteredSignals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
            <Radio className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">No signals found</p>
            <p className="text-xs mt-1">Try a different filter or check back later</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSignals.map((signal) => (
              <Link key={signal.id} href={`/signals/${signal.id}`} className="block">
                <Card className={cn("p-3 transition-colors hover:border-primary/30", signal.status === "READY" && "border-emerald-500/20", signal.status === "ACTIVE" && "border-sky-500/20")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn("p-2 rounded-lg flex-shrink-0", signal.direction === "BUY" ? "bg-emerald-500/10" : "bg-rose-500/10")}>
                        {signal.direction === "BUY" ? <TrendingUp className="h-5 w-5 text-emerald-400" /> : <TrendingDown className="h-5 w-5 text-rose-400" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold truncate">{signal.symbol}</span>
                          <Badge variant="outline" className={cn(
                            signal.tier === "PRO" && "border-violet-500/30 text-violet-400",
                            signal.tier === "FREE" && "border-emerald-500/30 text-emerald-400"
                          )}>
                            {signal.tier}
                          </Badge>
                          <Badge variant="outline" className="border-border/30">{signal.timeframe}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{signal.reasoning || "AI-generated signal based on market structure and momentum"}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 min-w-[70px]">
                      <Badge variant={getStatusVariant(signal.status)}>
                        {signal.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{formatTimeAgo(signal.createdAt)}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/30 grid grid-cols-4 gap-3 text-center">
                    <div>
                      <p className="font-mono text-sm font-semibold">{formatPrice(signal.symbol, signal.entry)}</p>
                      <p className="text-[10px] text-muted-foreground">Entry</p>
                    </div>
                    <div>
                      <p className="font-mono text-sm font-semibold text-rose-400">{formatPrice(signal.symbol, signal.stopLoss)}</p>
                      <p className="text-[10px] text-muted-foreground">SL</p>
                    </div>
                    <div>
                      <p className="font-mono text-sm font-semibold text-emerald-400">{signal.tp1 ? formatPrice(signal.symbol, signal.tp1) : "—"}</p>
                      <p className="text-[10px] text-muted-foreground">TP1</p>
                    </div>
                    <div>
                      <p className="font-mono text-sm font-semibold">{signal.riskReward.toFixed(1)}R</p>
                      <p className="text-[10px] text-muted-foreground">R:R</p>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      {getRegimeLabel(signal.marketRegime)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Target className="h-3 w-3" />
                      {signal.confidence}%
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTimeAgo(signal.updatedAt)}
                    </span>
                    <Badge variant="outline" className={cn(
                      signal.strength === "STRONG" && "border-emerald-500/30 text-emerald-400",
                      signal.strength === "MODERATE" && "border-amber-500/30 text-amber-400",
                      "border-border/30"
                    )}>
                      {signal.strength}
                    </Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  </MobileErrorBoundary>
);
}