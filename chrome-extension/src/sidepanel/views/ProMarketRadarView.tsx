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
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Bull",
  },
  BEARISH: {
    icon: <TrendingDown size={10} />,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    label: "Bear",
  },
  RANGE: {
    icon: <Minus size={10} />,
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    label: "Range",
  },
  TRANSITION: {
    icon: <Activity size={10} />,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Trans.",
  },
};

const SETUP_STATE_COLORS: Record<SetupRadarStatus, string> = {
  WAITING: "text-ink-faint",
  FORMING: "text-amber-400",
  CONFIRMATION: "text-blue-400",
  ACTIVE: "text-emerald-400",
  INVALIDATED: "text-rose-400",
  EXPIRED: "text-ink-faint",
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
  const setupColor = SETUP_STATE_COLORS[item.setupState] ?? "text-ink-faint";
  const isCurrent = item.symbol === currentSymbol;
  const hasAlert = item.alertStatus === "ACTIVE";
  const ageMin = item.lastUpdateMs ? Math.floor((Date.now() - item.lastUpdateMs) / 60000) : null;

  return (
    <button
      onClick={() => onSelect(item.symbol)}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
        isCurrent
          ? "bg-brand-500/10 border border-brand-500/30"
          : "bg-raised border border-edge hover:border-edge/80"
      }`}
    >
      {/* symbol */}
      <div className="w-16 shrink-0">
        <p className="font-mono text-[11px] font-bold text-ink leading-tight">{item.symbol}</p>
        <p className="text-[9px] text-ink-faint">{item.timeframe}</p>
      </div>

      {/* market state */}
      <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${ms.color} ${ms.bg}`}>
        {ms.icon}
        {ms.label}
      </div>

      {/* setup state */}
      <span className={`text-[9px] font-semibold flex-1 ${setupColor}`}>
        {item.setupState}
      </span>

      {/* conditions */}
      <span className="text-[9px] text-ink-mute tabular-nums shrink-0">{item.matchedConditions}</span>

      {/* alert */}
      {hasAlert ? (
        <Bell size={9} className="text-amber-400 shrink-0" />
      ) : (
        <BellOff size={9} className="text-ink-faint shrink-0" />
      )}

      {/* strategy + age */}
      <div className="shrink-0 text-right">
        <p className="text-[9px] text-ink-faint truncate max-w-[64px]">{item.strategyName}</p>
        {ageMin !== null && (
          <p className="text-[8px] text-ink-faint tabular-nums">{ageMin}m ago</p>
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
      <div className="flex items-center gap-2 border-b border-edge bg-card px-3 py-2">
        <ScanEye size={13} className="text-brand-400" />
        <span className="text-[11px] font-semibold text-ink">Market Radar</span>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="ml-auto rounded p-1 text-ink-mute hover:text-ink transition-colors"
          title="Add symbol"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={() => load(watchlist)}
          disabled={loading || watchlist.length === 0}
          className="rounded p-1 text-ink-mute hover:text-ink disabled:opacity-40 transition-colors"
          title="Refresh scan"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* add symbol bar */}
      {showAdd && (
        <div className="flex items-center gap-2 border-b border-edge bg-raised px-3 py-2 animate-fade-in">
          <input
            autoFocus
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSymbol();
              if (e.key === "Escape") setShowAdd(false);
            }}
            placeholder="Symbol (e.g. GBPUSD)"
            className="flex-1 rounded border border-edge bg-base px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-brand-500"
          />
          <button
            onClick={addSymbol}
            className="rounded bg-brand-500/20 px-2 py-1 text-[10px] font-semibold text-brand-400"
          >
            Add
          </button>
          <button
            onClick={() => setShowAdd(false)}
            className="rounded p-1 text-ink-mute hover:text-ink"
          >
            <X size={11} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {/* loading */}
        {loading && watchlist.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-3">
            <RefreshCw size={14} className="animate-spin text-brand-400" />
            <p className="text-[10px] text-ink-mute">Scanning {watchlist.length} symbols…</p>
          </div>
        )}

        {/* error */}
        {error && !loading && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 mx-1">
            <p className="text-[10px] text-rose-400">{error}</p>
            <button
              onClick={() => load(watchlist)}
              className="mt-1.5 text-[10px] text-rose-300 hover:text-rose-200"
            >
              Retry →
            </button>
          </div>
        )}

        {/* empty watchlist */}
        {watchlist.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ScanEye size={24} className="text-ink-faint" />
            <p className="text-[11px] font-medium text-ink">No symbols in radar</p>
            <p className="text-[10px] text-ink-mute">Press + to add symbols to your watchlist.</p>
          </div>
        )}

        {/* legend row */}
        {watchlist.length > 0 && !loading && (
          <div className="flex items-center gap-2 px-3 py-1 text-[8px] text-ink-faint font-semibold uppercase tracking-widest border-b border-edge">
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
                className="flex items-center gap-2 rounded-lg bg-raised border border-edge px-3 py-2.5 opacity-50"
              >
                <span className="font-mono text-[11px] font-bold text-ink">{sym}</span>
                <span className="text-[9px] text-ink-faint ml-1">pending…</span>
                <button
                  onClick={() => removeSymbol(sym)}
                  className="ml-auto text-ink-faint hover:text-rose-400 transition-colors"
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
                className="absolute right-1 top-1 hidden group-hover:flex items-center justify-center rounded p-0.5 text-ink-faint hover:text-rose-400 transition-colors bg-card border border-edge"
                title={`Remove ${sym}`}
              >
                <X size={9} />
              </button>
            </div>
          );
        })}

        {data && !loading && (
          <p className="text-center text-[9px] text-ink-faint pt-1">
            Last scan: {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        )}
      </div>
    </div>
  );
}
