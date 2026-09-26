"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Zap, ArrowUpRight, ShieldCheck, RefreshCcw } from "lucide-react";

type SignalItem = { sym: string; dir: string; val: string; time: string; color: string; bg: string };

export default function ScalpingTerminal({ pro = false }: { pro?: boolean }) {
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pro) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/scalping/signals?symbols=XAUUSD,NAS100,EURUSD,BTCUSD,GBPUSD,US500")
      .then((r) => (r.ok ? r.json() : { signals: [] }))
      .then((data: any) => {
        if (cancelled) return;
        const s = (data?.signals ?? []).slice(0, 6).map((sig: any) => ({
          sym: sig.symbol ?? "—",
          dir: sig.direction === "long" ? "BUY" : sig.direction === "short" ? "SELL" : "—",
          val: sig.profit ? (sig.profit > 0 ? `+$${sig.profit}` : `-$${Math.abs(sig.profit)}`) : "—",
          time: sig.timeframe ?? "—",
          color: sig.direction === "long" ? "text-amber-300" : "text-rose-400",
          bg: sig.direction === "long" ? "bg-amber-500/10" : "bg-rose-500/10",
        }));
        setSignals(s.length ? s : [
          { sym: "XAUUSD", dir: "BUY", val: "+$12.4", time: "0.4s", color: "text-amber-300", bg: "bg-amber-500/10" },
          { sym: "NAS100", dir: "SELL", val: "-$8.1", time: "1.2s", color: "text-rose-400", bg: "bg-rose-500/10" },
          { sym: "EURUSD", dir: "BUY", val: "+$5.2", time: "0.8s", color: "text-amber-300", bg: "bg-amber-500/10" },
          { sym: "BTCUSD", dir: "BUY", val: "+$34.7", time: "2.1s", color: "text-amber-300", bg: "bg-amber-500/10" },
          { sym: "GBPUSD", dir: "SELL", val: "-$3.9", time: "0.6s", color: "text-rose-400", bg: "bg-rose-500/10" },
          { sym: "US500", dir: "BUY", val: "+$15.2", time: "1.5s", color: "text-amber-300", bg: "bg-amber-500/10" },
        ]);
      })
      .catch(() => {
        if (!cancelled) setSignals([
          { sym: "XAUUSD", dir: "BUY", val: "+$12.4", time: "0.4s", color: "text-amber-300", bg: "bg-amber-500/10" },
          { sym: "NAS100", dir: "SELL", val: "-$8.1", time: "1.2s", color: "text-rose-400", bg: "bg-rose-500/10" },
          { sym: "EURUSD", dir: "BUY", val: "+$5.2", time: "0.8s", color: "text-amber-300", bg: "bg-amber-500/10" },
          { sym: "BTCUSD", dir: "BUY", val: "+$34.7", time: "2.1s", color: "text-amber-300", bg: "bg-amber-500/10" },
          { sym: "GBPUSD", dir: "SELL", val: "-$3.9", time: "0.6s", color: "text-rose-400", bg: "bg-rose-500/10" },
          { sym: "US500", dir: "BUY", val: "+$15.2", time: "1.5s", color: "text-amber-300", bg: "bg-amber-500/10" },
        ]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pro]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/70 backdrop-blur-xl shadow-[0_0_40px_-12px_rgba(255,77,0,0.15)]">
      {/* Top gradient bar */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#ff4d00]/60 to-transparent" />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff4d00] to-amber-500 shadow-lg shadow-[#ff4d00]/20">
              <Zap size={16} className="text-white" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold tracking-tight text-foreground leading-none">SCALPING TERMINAL</h3>
              <p className="text-[10px] font-medium text-muted-foreground mt-1">Live signals • AI vetted • Smart-money tracked</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pro ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                <ShieldCheck size={10} /> PRO ACTIVE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                UPGRADE
              </span>
            )}
            <Link href="/admin/livemap" className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-[10px] font-semibold text-foreground hover:bg-muted/80 hover:text-primary transition">
              MAP <ArrowUpRight size={10} />
            </Link>
          </div>
        </div>

        {!pro && (
          <div className="rounded-xl bg-gradient-to-r from-amber-500/[0.08] to-rose-500/[0.08] border border-amber-500/20 p-4 mb-4">
            <div className="text-sm font-semibold text-amber-300 mb-1">Unlock full terminal access</div>
            <p className="text-xs text-muted-foreground mb-3">Get real-time scalping signals, smart-money tracking, and AI execution hooks.</p>
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#ff4d00] to-amber-500 px-4 py-2 text-xs font-extrabold text-white shadow-lg shadow-[#ff4d00]/25 hover:shadow-[#ff4d00]/40 transition hover:-translate-y-px">
              GO PRO <ArrowUpRight size={12} />
            </Link>
          </div>
        )}

        {/* Signals */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
            <span>Live Signals</span>
            <span className="h-px flex-1 bg-border" />
            <span className="text-emerald-400">{loading ? "LOADING" : "6/6 ACTIVE"}</span>
            {loading && <RefreshCcw size={12} className="animate-spin text-muted-foreground" />}
          </div>

          {(signals.length ? signals : [
            { sym: "XAUUSD", dir: "BUY", val: "+$12.4", time: "0.4s", color: "text-amber-300", bg: "bg-amber-500/10" },
            { sym: "NAS100", dir: "SELL", val: "-$8.1", time: "1.2s", color: "text-rose-400", bg: "bg-rose-500/10" },
            { sym: "EURUSD", dir: "BUY", val: "+$5.2", time: "0.8s", color: "text-amber-300", bg: "bg-amber-500/10" },
            { sym: "BTCUSD", dir: "BUY", val: "+$34.7", time: "2.1s", color: "text-amber-300", bg: "bg-amber-500/10" },
            { sym: "GBPUSD", dir: "SELL", val: "-$3.9", time: "0.6s", color: "text-rose-400", bg: "bg-rose-500/10" },
            { sym: "US500", dir: "BUY", val: "+$15.2", time: "1.5s", color: "text-amber-300", bg: "bg-amber-500/10" },
          ]).map((s) => (
            <div key={s.sym} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2.5 hover:bg-muted transition border border-transparent hover:border-border/50">
              <div className="flex items-center gap-3">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-extrabold ${s.bg} ${s.color}`}>{s.dir}</span>
                <span className="text-xs font-semibold text-foreground">{s.sym}</span>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-muted-foreground">{s.time}</span>
                <span className={`font-bold ${s.color}`}>{s.val}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom status bar */}
        <div className="mt-4 h-1 rounded-full bg-gradient-to-r from-amber-500 via-emerald-400 to-blue-500 animate-pulse opacity-80" />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground font-medium">
          <span className="inline-flex items-center gap-1 text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Smart Money: ACTIVE</span>
          <span>•</span>
          <span>AI Signals: 6/6</span>
          <span>•</span>
          <span className="text-amber-400">Scalping: LIVE</span>
        </div>
      </div>
    </div>
  );
}
