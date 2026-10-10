"use client";

/**
 * Marketing / account-shell Scalping Terminal card.
 *
 * Renders the real deterministic scanner output from /api/scalping/signals —
 * the same engine the Pro Scalping Terminal uses. Nothing is fabricated: when
 * the scanner has no qualifying setup, the card says so instead of showing
 * placeholder rows, and status labels always reflect the actual fetch state.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { Zap, ArrowUpRight, ShieldCheck, RefreshCcw, WifiOff } from "lucide-react";
import { auth } from "@/lib/firebase";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";

const SIGNAL_SYMBOLS = "XAUUSD,NAS100,EURUSD,BTCUSD,GBPUSD,US500";
const POLL_MS = 30_000;

export default function ScalpingTerminal({ pro = false }: { pro?: boolean }) {
  const [signals, setSignals] = useState<TerminalSignal[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setSignedIn(Boolean(user)));
    return () => unsub();
  }, []);

  const load = useCallback(async (cancelledRef: { current: boolean }) => {
    // Yield a microtask first so no state is set synchronously inside effects.
    await Promise.resolve();
    if (!signedIn) {
      setSignals([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/scalping/signals?symbols=${SIGNAL_SYMBOLS}`, {
        cache: "no-store",
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      });
      const data = (await res.json().catch(() => null)) as
        | { signals?: TerminalSignal[]; rejected?: unknown[]; error?: string }
        | null;
      if (cancelledRef.current) return;
      if (!res.ok) {
        setError(data?.error ?? `Signal scan failed (${res.status}).`);
        setSignals([]);
        setRejectedCount(0);
      } else {
        setError(null);
        setSignals(data?.signals ?? []);
        setRejectedCount(data?.rejected?.length ?? 0);
      }
    } catch {
      if (!cancelledRef.current) {
        setError("Could not reach the signal scanner.");
        setSignals([]);
        setRejectedCount(0);
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    const cancelledRef = { current: false };
    const run = () => void load(cancelledRef);
    // First tick + poll both run from timers so no state is set synchronously
    // inside the effect body.
    const initial = setTimeout(run, 0);
    const id = signedIn ? setInterval(run, POLL_MS) : null;
    return () => {
      cancelledRef.current = true;
      clearTimeout(initial);
      if (id) clearInterval(id);
    };
  }, [load, signedIn]);

  const statusLabel = !signedIn
    ? "SIGN IN"
    : loading && signals.length === 0
      ? "SYNCING"
      : error
        ? "OFFLINE"
        : signals.length > 0
          ? `${signals.length} ACTIVE`
          : "NO SETUPS";

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card">
      {/* Top accent bar */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-primary/50" />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Zap size={16} className="text-primary" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold tracking-tight text-foreground leading-none">SCALPING TERMINAL</h3>
              <p className="text-micro font-medium text-muted-foreground mt-1">Live signals • AI vetted • Smart-money tracked</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pro ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2.5 py-0.5 text-micro font-bold text-positive border border-positive/20">
                <ShieldCheck size={10} /> PRO ACTIVE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-micro font-bold text-warning border border-warning/20">
                UPGRADE
              </span>
            )}
            <Link href="/account/scalping-terminal-lite" className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-micro font-semibold text-foreground hover:bg-muted/80 hover:text-primary transition">
              TERMINAL <ArrowUpRight size={10} />
            </Link>
          </div>
        </div>

        {!pro && (
          <div className="rounded-lg bg-warning-muted border border-warning/20 p-4 mb-4">
            <div className="text-sm font-semibold text-warning mb-1">Unlock full terminal access</div>
            <p className="text-xs text-muted-foreground mb-3">Get real-time scalping signals, smart-money tracking, and AI execution hooks.</p>
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/80">
              GO PRO <ArrowUpRight size={12} />
            </Link>
          </div>
        )}

        {/* Signals */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-micro uppercase tracking-widest font-bold text-muted-foreground mb-2">
            <span>Live Signals</span>
            <span className="h-px flex-1 bg-border" />
            <span className={error ? "text-negative" : "text-positive"}>{statusLabel}</span>
            {loading && <RefreshCcw size={12} className="animate-spin text-muted-foreground" />}
          </div>

          {!signedIn ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
              <p className="text-xs font-medium text-foreground">Sign in for live scanner output</p>
              <p className="text-micro text-muted-foreground mt-1">Signals are produced per account by the deterministic scanner.</p>
              <Link href="/login?redirect=/account/scalping-terminal-lite" className="mt-2 inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-micro font-semibold text-background transition hover:opacity-90">
                SIGN IN <ArrowUpRight size={10} />
              </Link>
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-3">
              <WifiOff size={13} className="mt-0.5 shrink-0 text-warning" />
              <p className="text-micro leading-relaxed text-warning">{error}</p>
            </div>
          ) : signals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
              <p className="text-xs font-medium text-foreground">No qualifying setups right now</p>
              <p className="text-micro text-muted-foreground mt-1">
                The scanner publishes a signal only when its confidence and R:R gates pass
                {rejectedCount > 0 ? ` — ${rejectedCount} symbol${rejectedCount !== 1 ? "s" : ""} scanned below the gates.` : "."}
              </p>
            </div>
          ) : (
            signals.slice(0, 6).map((s) => {
              const long = s.direction === "long";
              const color = long ? "text-positive" : "text-negative";
              const bg = long ? "bg-positive/10" : "bg-negative/10";
              return (
                <div key={s.id} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2.5 hover:bg-muted transition border border-transparent hover:border-border/50" title={`Entry ${s.entry} · SL ${s.stop} · TP ${s.target}`}>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex h-6 w-9 items-center justify-center rounded-md text-micro font-extrabold ${bg} ${color}`}>{long ? "BUY" : "SELL"}</span>
                    <span className="text-xs font-semibold text-foreground">{s.symbol}</span>
                    <span className="rounded border border-border px-1 py-0.5 font-numeric text-micro text-muted-foreground">{s.timeframe}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-numeric">
                    <span className="text-muted-foreground">R:R {s.riskReward.toFixed(1)}</span>
                    <span className={`font-bold ${color}`}>{Math.round(s.confidence)}%</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom status bar */}
        <div className="mt-4 h-1 rounded-full bg-warning animate-pulse opacity-80" />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-micro text-muted-foreground font-medium">
          <span className="inline-flex items-center gap-1 text-positive">
            <span className={`h-1.5 w-1.5 rounded-full ${!signedIn || error ? "bg-warning" : "bg-positive animate-pulse"}`} />
            Scanner: {!signedIn ? "IDLE" : error ? "UNREACHABLE" : "DETERMINISTIC"}
          </span>
          <span>•</span>
          <span>Signals: {signedIn && !error ? `${signals.length}/6` : "—"}</span>
          <span>•</span>
          <span className="text-warning">Full terminal: /account/scalping-terminal-lite</span>
        </div>
      </div>
    </div>
  );
}
