/**
 * Pro Market Radar View
 *
 * Multi-symbol watch radar — scans a configurable watchlist and reports the
 * market state, setup status, and alert conditions for each instrument.
 *
 * Users can add/remove symbols from the radar. The list persists in
 * chrome.storage.local so it survives extension restarts.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  ScanEye,
  RefreshCw,
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Bell,
  BellOff,
} from "lucide-react";
import { fetchMarketRadar } from "@/api/pro";
import type { MarketRadarItem, MarketRadarResponse, SetupRadarStatus } from "@/types/pro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* ── storage helpers ─────────────────────────────────────────────────── */

const RADAR_STORAGE_KEY = "proMarketRadarSymbols";
const DEFAULT_SYMBOLS = ["XAUUSD", "EURUSD", "BTCUSD", "NQ1!", "ES1!"];

async function loadSavedSymbols(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(RADAR_STORAGE_KEY, (result) => {
      const saved = result[RADAR_STORAGE_KEY];
      resolve(Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_SYMBOLS);
    });
  });
}

async function saveSymbols(symbols: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [RADAR_STORAGE_KEY]: symbols }, () => resolve());
  });
}

/* ── helpers ──────────────────────────────────────────────────────────── */

const MARKET_STATE_CFG = {
  BULLISH: {
    icon: <TrendingUp size={10} />,
    color: "text-positive",
    bg: "bg-positive/10",
    label: "Bull",
  },
  BEARISH: {
    icon: <TrendingDown size={10} />,
    color: "text-negative",
    bg: "bg-negative/10",
    label: "Bear",
  },
  RANGE: {
    icon: <Minus size={10} />,
    color: "text-muted-foreground",
    bg: "bg-secondary",
    label: "Range",
  },
  TRANSITION: {
    icon: <Activity size={10} />,
    color: "text-warning",
    bg: "bg-warning/10",
    label: "Trans.",
  },
};

const SETUP_STATE_COLORS: Record<SetupRadarStatus, string> = {
  WAITING: "text-muted-foreground",
  FORMING: "text-warning",
  CONFIRMATION: "text-foreground",
  ACTIVE: "text-positive",
  INVALIDATED: "text-negative",
  EXPIRED: "text-muted-foreground",
};

function RadarRow({
  item,
  currentSymbol,
  onSelect,
}: {
  item: MarketRadarItem;
  currentSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  const ms = MARKET_STATE_CFG[item.marketState] ?? MARKET_STATE_CFG.RANGE;
  const setupColor = SETUP_STATE_COLORS[item.setupState] ?? "text-muted-foreground";
  const isCurrent = item.symbol === currentSymbol;
  const hasAlert = item.alertStatus === "ACTIVE";
  const ageMin = item.lastUpdateMs ? Math.floor((Date.now() - item.lastUpdateMs) / 60000) : null;

  return (
    <button
      onClick={() => onSelect(item.symbol)}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
        isCurrent
          ? "bg-brand/10 border border-brand/30"
          : "bg-secondary border border-border hover:border-muted-foreground/30"
      }`}
    >
      {/* symbol */}
      <div className="w-16 shrink-0">
        <p className="font-numeric text-[11px] font-bold text-foreground leading-tight">{item.symbol}</p>
        <p className="text-[10px] text-muted-foreground">{item.timeframe}</p>
      </div>

      {/* market state */}
      <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${ms.color} ${ms.bg}`}>
        {ms.icon}
        {ms.label}
      </div>

      {/* setup state */}
      <span className={`text-[10px] font-semibold flex-1 ${setupColor}`}>
        {item.setupState}
      </span>

      {/* conditions */}
      <span className="font-numeric text-[10px] text-muted-foreground shrink-0">{item.matchedConditions}</span>

      {/* alert */}
      {hasAlert ? (
        <Bell size={10} className="text-warning shrink-0" />
      ) : (
        <BellOff size={10} className="text-muted-foreground shrink-0" />
      )}

      {/* strategy + age */}
      <div className="shrink-0 text-right">
        <p className="text-[10px] text-muted-foreground truncate max-w-[64px]">{item.strategyName}</p>
        {ageMin !== null && (
          <p className="font-numeric text-[10px] text-muted-foreground">{ageMin}m ago</p>
        )}
      </div>
    </button>
  );
}

/* ── main view ────────────────────────────────────────────────────────── */

interface Props {
  symbol: string;
  timeframe: string;
  onSelectSymbol?: (symbol: string) => void;
}

export function ProMarketRadarView({ symbol, timeframe, onSelectSymbol }: Props) {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [data, setData] = useState<MarketRadarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  // Load watchlist from storage on mount
  useEffect(() => {
    loadSavedSymbols().then(setWatchlist);
  }, []);

  const load = useCallback(
    async (symbols: string[]) => {
      if (symbols.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchMarketRadar(symbols, timeframe);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Radar scan failed");
      } finally {
        setLoading(false);
      }
    },
    [timeframe]
  );

  // Auto-scan on watchlist change
  useEffect(() => {
    if (watchlist.length > 0) load(watchlist);
  }, [watchlist, load]);

  const addSymbol = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym || watchlist.includes(sym)) {
      setNewSymbol("");
      setShowAdd(false);
      return;
    }
    const next = [...watchlist, sym];
    setWatchlist(next);
    saveSymbols(next);
    setNewSymbol("");
    setShowAdd(false);
  };

  const removeSymbol = (sym: string) => {
    const next = watchlist.filter((s) => s !== sym);
    setWatchlist(next);
    saveSymbols(next);
    // Remove from data too
    setData((d) =>
      d ? { ...d, items: d.items.filter((i) => i.symbol !== sym) } : d
    );
  };

  // Build a map from the server results for easy lookup
  const resultMap = new Map<string, MarketRadarItem>(
    (data?.items ?? []).map((i) => [i.symbol, i])
  );

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <ScanEye size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Market Radar</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setShowAdd((v) => !v)}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Add symbol"
        >
          <Plus size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => load(watchlist)}
          disabled={loading || watchlist.length === 0}
          className="text-muted-foreground hover:text-foreground"
          title="Refresh scan"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* add symbol bar */}
      {showAdd && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <Input
            autoFocus
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSymbol();
              if (e.key === "Escape") setShowAdd(false);
            }}
            placeholder="Symbol (e.g. GBPUSD)"
            className="h-7 flex-1 px-2 font-numeric text-[11px]"
          />
          <Button
            variant="brand"
            size="sm"
            onClick={addSymbol}
            className="h-7 px-2 text-[11px]"
          >
            Add
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowAdd(false)}
          >
            <X size={11} />
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {/* loading */}
        {loading && watchlist.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-3">
            <RefreshCw size={14} className="animate-spin text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground">Scanning {watchlist.length} symbols…</p>
          </div>
        )}

        {/* error */}
        {error && !loading && (
          <div className="mx-1">
            <Alert variant="destructive">
              <AlertDescription className="text-[11px]">
                {error}
                <button
                  onClick={() => load(watchlist)}
                  className="mt-1.5 block text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Retry →
                </button>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* empty watchlist */}
        {watchlist.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ScanEye size={24} className="text-muted-foreground" />
            <p className="text-[11px] font-medium text-foreground">No symbols in radar</p>
            <p className="text-[10px] text-muted-foreground">Press + to add symbols to your watchlist.</p>
          </div>
        )}

        {/* legend row */}
        {watchlist.length > 0 && !loading && (
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider border-b border-border">
            <span className="w-16">Symbol</span>
            <span className="w-12">State</span>
            <span className="flex-1">Setup</span>
            <span>Cond.</span>
            <span>Alert</span>
            <span className="text-right w-16">Strategy</span>
          </div>
        )}

        {/* symbol rows */}
        {watchlist.map((sym) => {
          const item = resultMap.get(sym);
          if (!item) {
            // Symbol not returned by server yet — show skeleton
            return (
              <div
                key={sym}
                className="flex items-center gap-2 rounded-xl bg-secondary border border-border px-3 py-2.5"
              >
                <span className="font-numeric text-[11px] font-bold text-foreground">{sym}</span>
                <span className="text-[10px] text-muted-foreground ml-1">pending…</span>
                <button
                  onClick={() => removeSymbol(sym)}
                  className="ml-auto text-muted-foreground transition-colors hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={`Remove ${sym}`}
                >
                  <X size={10} />
                </button>
              </div>
            );
          }
          return (
            <div key={sym} className="relative group">
              <RadarRow
                item={item}
                currentSymbol={symbol}
                onSelect={onSelectSymbol ?? (() => {})}
              />
              <button
                onClick={() => removeSymbol(sym)}
                className="absolute right-1 top-1 hidden group-hover:flex items-center justify-center rounded border border-border bg-card p-0.5 text-muted-foreground transition-colors hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={`Remove ${sym}`}
              >
                <X size={9} />
              </button>
            </div>
          );
        })}

        {data && !loading && (
          <p className="text-center text-[10px] text-muted-foreground pt-1">
            Last scan: {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        )}
      </div>
    </div>
  );
}
