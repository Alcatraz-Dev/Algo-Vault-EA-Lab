"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
} from "lucide-react";
import type { MarketCandle } from "@/lib/market-data/types";

type Position = {
  type: "LONG" | "SHORT";
  entry: number;
};

const CONTRACT_SIZE = 100; // XAUUSD: USD per 1.0 price unit per 1.0 lot
const PAPER_LOT = 0.1; // paper lot size
const MIN_CURSOR = 40; // bars required for context before the "live" edge

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function MarketReplaySection() {
  const [candles, setCandles] = useState<MarketCandle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("H1");

  const [cursor, setCursor] = useState(MIN_CURSOR);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState<Position | null>(null);
  const [realizedPnl, setRealizedPnl] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/analytics/ohlc?symbol=XAUUSD&timeframe=H1&limit=240`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.candles) || data.candles.length === 0) {
        throw new Error(data.error || "No candles returned by the provider feed");
      }
      setCandles(data.candles);
      setSymbol(data.symbol || "XAUUSD");
      setTimeframe(data.timeframe || "H1");
      setCursor(Math.min(MIN_CURSOR, data.candles.length));
      setPosition(null);
      setRealizedPnl(0);
      setWins(0);
      setLosses(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load historical candles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer the initial fetch so no state is set synchronously within the effect.
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const total = candles?.length ?? 0;

  useEffect(() => {
    if (!playing || total === 0) return;
    const timer = setInterval(() => {
      setCursor((prev) => {
        if (prev >= total) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 900 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, total]);

  const visible = useMemo(() => {
    if (!candles || candles.length === 0) return { bars: [] as MarketCandle[], min: 0, max: 0 };
    const start = Math.max(0, cursor - 60);
    const bars = candles.slice(start, Math.max(start + 1, cursor));
    const lows = bars.map((c) => c.low);
    const highs = bars.map((c) => c.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const pad = (max - min) * 0.08 || 1;
    return { bars, min: min - pad, max: max + pad };
  }, [candles, cursor]);

  const currentPrice = visible.bars.length > 0 ? visible.bars[visible.bars.length - 1].close : 0;

  const openLong = () => {
    if (position || total === 0) return;
    setPosition({ type: "LONG", entry: currentPrice });
  };

  const openShort = () => {
    if (position || total === 0) return;
    setPosition({ type: "SHORT", entry: currentPrice });
  };

  const closePosition = () => {
    if (!position || total === 0) return;
    const diff =
      position.type === "LONG"
        ? currentPrice - position.entry
        : position.entry - currentPrice;
    const pnl = diff * CONTRACT_SIZE * PAPER_LOT;
    setRealizedPnl((prev) => prev + pnl);
    if (pnl >= 0) setWins((w) => w + 1);
    else setLosses((l) => l + 1);
    setPosition(null);
  };

  const reset = () => {
    setPlaying(false);
    setCursor(Math.min(MIN_CURSOR, total));
    setPosition(null);
    setRealizedPnl(0);
    setWins(0);
    setLosses(0);
  };

  const tradesClosed = wins + losses;

  return (
    <section className="border-b border-border bg-background py-24 md:py-32">
      <div className="page-container">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-primary">
              Market Replay
            </p>
            <h2 className="mt-3 font-display text-4xl font-normal leading-[1.05] tracking-tight text-foreground md:text-5xl lg:text-6xl">
              Replay Real History
              <br />
              <span className="text-primary">Bar by Bar</span>
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Step through real historical candles from the platform feed with no look-ahead. This
              is a paper simulation — nothing here is connected to a broker.
            </p>
          </div>
          <Link
            href="/trade-replay"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition hover:text-primary md:mt-0"
          >
            Full Replay Studio
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="mt-10 rounded-lg border border-border bg-card p-5 shadow-sm md:p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-border rounded-lg px-6 py-14 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Requesting historical H1 candles from the provider feed…
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-negative/40 px-6 py-14 text-center">
              <p className="text-sm font-medium text-negative">Candles unavailable</p>
              <p className="max-w-md text-xs text-muted-foreground">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
              >
                <RefreshCw size={13} />
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3 font-mono text-sm">
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 font-bold text-primary">
                    {symbol} · {timeframe}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    Real historical candles from the provider feed
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCursor((p) => Math.max(MIN_CURSOR, p - 1));
                      setPlaying(false);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-muted"
                    aria-label="Step back one bar"
                  >
                    <SkipBack size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaying((p) => !p)}
                    className="flex h-9 w-12 items-center justify-center rounded-md bg-primary font-bold text-background transition hover:bg-primary/90 disabled:opacity-50"
                    disabled={cursor >= total}
                    aria-label={playing ? "Pause replay" : "Play replay"}
                  >
                    {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCursor((p) => Math.min(total, p + 1));
                      setPlaying(false);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-muted"
                    aria-label="Step forward one bar"
                  >
                    <SkipForward size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-muted"
                    aria-label="Reset replay"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                    aria-label="Replay speed"
                  >
                    {[1, 2, 5, 10].map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    {position ? (
                      <button
                        type="button"
                        onClick={closePosition}
                        className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/20 px-4 py-2 text-sm font-semibold text-warning transition hover:bg-warning/30"
                      >
                        Close Position
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={openLong}
                          className="flex items-center gap-1 rounded-md bg-positive px-4 py-2 text-sm font-semibold text-background transition hover:bg-positive/90 disabled:opacity-50"
                        >
                          <TrendingUp size={14} />
                          Buy
                        </button>
                        <button
                          type="button"
                          onClick={openShort}
                          className="flex items-center gap-1 rounded-md bg-negative px-4 py-2 text-sm font-semibold text-background transition hover:bg-negative/90 disabled:opacity-50"
                        >
                          <TrendingDown size={14} />
                          Sell
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Scrubber */}
              <div className="space-y-1.5 font-mono text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Bars visible: {visible.bars.length} · Edge at {cursor} of {total}
                  </span>
                  <span className="font-bold text-foreground">
                    {symbol} @ {formatPrice(currentPrice)}
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_CURSOR}
                  max={Math.max(MIN_CURSOR, total)}
                  value={Math.min(Math.max(cursor, MIN_CURSOR), Math.max(MIN_CURSOR, total))}
                  onChange={(e) => {
                    setCursor(Number(e.target.value));
                    setPlaying(false);
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                  aria-label="Replay position"
                />
              </div>

              {/* Chart */}
              <div className="relative h-64 overflow-hidden rounded-lg border border-border bg-background/95 p-3">
                <div className="flex items-center justify-between border-b border-border/40 pb-2 font-mono text-[11px] text-muted-foreground">
                  <span>No look-ahead — future bars hidden</span>
                  <span className="font-semibold text-primary">
                    {playing ? "ADVANCING" : "PAUSED"}
                  </span>
                </div>

                <div className="relative mt-2 flex h-[calc(100%-2.25rem)] items-end justify-between gap-px">
                  {visible.bars.map((candle, idx) => {
                    const range = visible.max - visible.min || 1;
                    const y = (value: number) =>
                      ((value - visible.min) / range) * 100;
                    const up = candle.close >= candle.open;
                    const bodyTop = y(Math.max(candle.open, candle.close));
                    const bodyBottom = y(Math.min(candle.open, candle.close));
                    const wickTop = y(candle.high);
                    const wickBottom = y(candle.low);
                    const isLast = idx === visible.bars.length - 1;
                    return (
                      <div
                        key={idx}
                        className="relative flex h-full flex-1 items-end justify-center"
                        title={`${new Date(candle.timestamp).toISOString()} · O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close}`}
                      >
                        {/* wick */}
                        <div
                          className="absolute w-px bg-muted-foreground/50"
                          style={{ top: `${wickTop}%`, height: `${wickBottom - wickTop}%` }}
                        />
                        {/* body */}
                        <div
                          className={`w-[60%] ${
                            up ? "bg-positive" : "bg-negative"
                          } ${isLast ? "opacity-90 ring-1 ring-primary" : ""}`}
                          style={{
                            top: `${bodyTop}%`,
                            height: `${Math.max(bodyBottom - bodyTop, 3)}%`,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Scorecard */}
              <div className="flex flex-col gap-2 border-t border-border pt-3 font-mono text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground">
                  <span>
                    Paper P/L:{" "}
                    <strong
                      className={
                        realizedPnl >= 0 ? "text-positive" : "text-negative"
                      }
                    >
                      {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
                    </strong>{" "}
                    <span className="text-muted-foreground/60">
                      (0.1 lot · simulated)
                    </span>
                  </span>
                  <span>
                    Closed: <strong className="text-foreground">{tradesClosed}</strong>
                  </span>
                  <span>
                    Wins:{" "}
                    <strong className="text-positive">{wins}</strong>
                  </span>
                  <span>
                    Losses:{" "}
                    <strong className="text-negative">{losses}</strong>
                  </span>
                </div>
                {position && (
                  <span className="font-semibold text-foreground">
                    Active: {position.type} @ {formatPrice(position.entry)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          Paper simulation on real historical candles · Source: /api/analytics/ohlc
        </p>
      </div>
    </section>
  );
}