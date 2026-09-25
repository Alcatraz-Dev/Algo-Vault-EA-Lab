"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, Star, TrendingUp, TrendingDown, Minus, Filter, ChevronRight, RefreshCw, BarChart2, Radio, AlertCircle } from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/loading-state";
import { Separator } from "@/components/ui/separator";
import { MobileErrorBoundary } from "@/components/mobile/MobileErrorBoundary";

interface MarketQuote {
  symbol: string;
  bid: number;
  ask: number;
  change?: number;
  changePct?: number;
  high?: number;
  low?: number;
  spread?: number;
  volatility?: "low" | "normal" | "high" | "extreme";
  regime?: string;
  signalStatus?: "none" | "watch" | "active";
  isFavorite?: boolean;
  timestamp?: number;
  error?: string;
}

const MAJOR_SYMBOLS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD",
  "EURGBP", "EURJPY", "GBPJPY", "XAUUSD", "XAGUSD",
  "BTCUSD", "ETHUSD", "NAS100", "US30", "SPX500", "GER40", "UK100", "JPN225",
];

const SYMBOL_NAMES: Record<string, string> = {
  EURUSD: "Euro / US Dollar",
  GBPUSD: "British Pound / US Dollar",
  USDJPY: "US Dollar / Japanese Yen",
  USDCHF: "US Dollar / Swiss Franc",
  AUDUSD: "Australian Dollar / US Dollar",
  USDCAD: "US Dollar / Canadian Dollar",
  NZDUSD: "New Zealand Dollar / US Dollar",
  EURGBP: "Euro / British Pound",
  EURJPY: "Euro / Japanese Yen",
  GBPJPY: "British Pound / Japanese Yen",
  XAUUSD: "Gold / US Dollar",
  XAGUSD: "Silver / US Dollar",
  BTCUSD: "Bitcoin / US Dollar",
  ETHUSD: "Ethereum / US Dollar",
  NAS100: "NASDAQ 100",
  US30: "Dow Jones 30",
  SPX500: "S&P 500",
  GER40: "DAX 40",
  UK100: "FTSE 100",
  JPN225: "Nikkei 225",
};

function formatPrice(symbol: string, price: number): string {
  const decimals = symbol.includes("JPY") ? 3 : symbol.includes("XAU") || symbol.includes("XAG") ? 2 : 5;
  return price.toFixed(decimals);
}

function formatChangePct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

const CATEGORY_SYMBOLS: Record<string, string[]> = {
  forex: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"],
  crypto: ["BTCUSD", "ETHUSD"],
  indices: ["NAS100", "US30", "SPX500", "GER40", "UK100", "JPN225"],
  metals: ["XAUUSD", "XAGUSD"],
  favorites: [],
};

async function fetchQuotes(symbols: string[]): Promise<Record<string, { bid: number; ask: number; price: number }>> {
  try {
    const response = await fetch(`/api/signals/quotes?symbols=${symbols.join(",")}`);
    if (!response.ok) throw new Error("Failed to fetch quotes");
    const data = await response.json();
    if (!data.success) throw new Error(data.error || "Failed to fetch quotes");
    
    const quotes: Record<string, { bid: number; ask: number; price: number }> = {};
    for (const [symbol, price] of Object.entries(data.prices || {})) {
      if (typeof price === "number" && Number.isFinite(price)) {
        const spread = price * 0.0002;
        quotes[symbol] = { bid: price, ask: price + spread, price };
      }
    }
    return quotes;
  } catch (error) {
    console.error("[MobileMarkets] Failed to fetch quotes:", error);
    return {};
  }
}

export default function MobileMarketsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [filteredQuotes, setFilteredQuotes] = useState<MarketQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "forex" | "crypto" | "indices" | "metals" | "favorites">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);

  const fetchMarketData = useCallback(async () => {
    if (!user) return;
    setError(null);
    if (!refreshing) setLoading(true);
    setRefreshing(true);
    
    try {
      const quoteData = await fetchQuotes(MAJOR_SYMBOLS);
      const now = Date.now();
      const newQuotes: MarketQuote[] = MAJOR_SYMBOLS.map((sym) => {
        const q = quoteData[sym];
        if (!q) {
          return {
            symbol: sym,
            bid: 0,
            ask: 0,
            isFavorite: ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD"].includes(sym),
            error: "Price unavailable",
          };
        }
        const mid = (q.bid + q.ask) / 2;
        // Calculate change from mid price (would need previous close in real implementation)
        const change = 0; // Would need previous close
        const changePct = 0;
        return {
          symbol: sym,
          bid: q.bid,
          ask: q.ask,
          change,
          changePct,
          high: mid * 1.01,
          low: mid * 0.99,
          spread: (q.ask - q.bid) * 10000,
          volatility: "normal" as const,
          regime: "RANGING",
          signalStatus: "none" as const,
          isFavorite: ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD"].includes(sym),
          timestamp: now,
        };
      });
      setQuotes(newQuotes);
      setFilteredQuotes(newQuotes);
    } catch (err) {
      console.error("[MobileMarkets] Fetch error:", err);
      setError("Failed to load market data. Pull to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, refreshing]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authLoading && user) fetchMarketData();
  }, [authLoading, user, fetchMarketData]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let filtered = quotes;
    if (search) {
      const s = search.toUpperCase();
      filtered = filtered.filter(sym => sym.symbol.includes(s) || SYMBOL_NAMES[sym.symbol]?.toUpperCase().includes(s));
    }
    if (category !== "all") {
      const catSymbols = category === "favorites" 
        ? quotes.filter(s => s.isFavorite).map(s => s.symbol)
        : CATEGORY_SYMBOLS[category] || [];
      filtered = filtered.filter(s => catSymbols.includes(s.symbol));
    }
    setFilteredQuotes(filtered);
  }, [search, category, quotes]);

  const toggleFavorite = (symbol: string) => {
    setQuotes(prev => prev.map(s => s.symbol === symbol ? { ...s, isFavorite: !s.isFavorite } : s));
    setFilteredQuotes(prev => prev.map(s => s.symbol === symbol ? { ...s, isFavorite: !s.isFavorite } : s));
  };

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-40 h-14 bg-background/80 backdrop-blur-sm border-b border-border flex items-center px-4">
          <h1 className="text-lg font-semibold">Markets</h1>
        </header>
        <div className="flex-1 p-4 space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen bg-background items-center justify-center p-8 text-center">
        <BarChart2 className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold mb-2">Sign in to view markets</h1>
        <Link href="/login"><Button className="w-full sm:w-auto">Sign In</Button></Link>
      </div>
    );
  }

  const categories = [
    { id: "all", label: "All", icon: null },
    { id: "forex", label: "Forex", icon: null },
    { id: "crypto", label: "Crypto", icon: null },
    { id: "indices", label: "Indices", icon: null },
    { id: "metals", label: "Metals", icon: null },
    { id: "favorites", label: "Favorites", icon: Star },
  ];

  return (
    <MobileErrorBoundary>
      <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="h-14 flex items-center justify-between px-4">
          <h1 className="text-lg font-semibold">Markets</h1>
          <Button variant="ghost" size="icon" onClick={fetchMarketData} disabled={refreshing} className="h-9 w-9">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
        
        {/* Search */}
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbols..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 text-sm"
              aria-label="Search markets"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 min-w-max">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id as typeof category)}
                className={cn(
                  "whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors touch-target",
                  category === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {cat.icon && <cat.icon className="inline h-3 w-3 mr-1" />}
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Symbol List */}
      <div className="flex-1 overflow-auto p-3 pb-20">
        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground p-4">
            <AlertCircle className="h-12 w-12 mb-3 opacity-50 text-rose-400" />
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchMarketData}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
            <Search className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">No symbols found</p>
            <p className="text-xs mt-1">Try adjusting your search or filter</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredQuotes.map((sym) => (
              <Link key={sym.symbol} href={`/markets/${sym.symbol}`} className="block">
                <Card className="p-3 transition-colors hover:border-primary/30 active:bg-muted/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm truncate max-w-[100px]">{sym.symbol}</span>
                        <span className="text-[10px] text-muted-foreground hidden sm:inline">{SYMBOL_NAMES[sym.symbol]}</span>
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(sym.symbol); }}
                        className={cn("p-1 rounded-lg transition-colors touch-target", sym.isFavorite ? "text-amber-400 fill-current" : "text-muted-foreground hover:text-amber-400")}
                        aria-label={sym.isFavorite ? "Remove from favorites" : "Add to favorites"}
                        aria-pressed={sym.isFavorite}
                      >
                        <Star className={cn("h-4 w-4", sym.isFavorite && "fill-current")} />
                      </button>
                    </div>
                    <div className="text-right min-w-[80px]">
                      {sym.error ? (
                        <p className="font-mono font-semibold text-sm text-rose-400">{sym.error}</p>
                      ) : (
                        <>
                          <p className="font-mono font-semibold text-sm">{formatPrice(sym.symbol, sym.bid)}</p>
                          <p className={cn("font-mono text-[10px]", (sym.changePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {formatChangePct(sym.changePct ?? 0)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="mt-2 flex items-center justify-between pt-2 border-t border-border/30">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className={cn(
                        (sym.volatility ?? "normal") === "high" && "border-rose-500/30 text-rose-400",
                        (sym.volatility ?? "normal") === "extreme" && "border-rose-500 text-rose-400 bg-rose-500/10",
                        (sym.volatility ?? "normal") === "low" && "border-emerald-500/30 text-emerald-400"
                      )}>
                        {(sym.volatility ?? "normal").charAt(0).toUpperCase() + (sym.volatility ?? "normal").slice(1)} Vol
                      </Badge>
                      <Badge variant="outline" className="border-border/30">
                        {(sym.regime ?? "RANGING").replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {sym.signalStatus === "active" && (
                        <Badge variant="default" className="bg-emerald-500/10 text-emerald-400 text-[10px] gap-1">
                          <Radio className="h-3 w-3" />
                          Signal
                        </Badge>
                      )}
                      {sym.signalStatus === "watch" && (
                        <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-[10px]">
                          Watch
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Floating action to scroll to top */}
      {filteredQuotes.length > 10 && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-20 right-4 z-40 lg:hidden rounded-full bg-primary p-3 shadow-xl touch-target transition-transform hover:scale-105"
          aria-label="Scroll to top"
        >
          <ChevronRight className="h-5 w-5 text-primary-foreground rotate-90" />
        </button>
      )}
    </div>
  </MobileErrorBoundary>
);
}