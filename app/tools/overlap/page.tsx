"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Clock, Globe, Zap, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Session = {
    name: string; code: string; city: string;
    openUtc: number; closeUtc: number;
    volatility: "Low" | "Medium" | "High";
    pairs: string[];
};

const SESSIONS: Session[] = [
    { name: "Sydney", code: "SYD", city: "Sydney", openUtc: 22, closeUtc: 7, volatility: "Low", pairs: ["AUDUSD", "NZDUSD", "AUDJPY"] },
    { name: "Tokyo", code: "TYO", city: "Tokyo", openUtc: 0, closeUtc: 9, volatility: "Medium", pairs: ["USDJPY", "AUDJPY", "EURJPY"] },
    { name: "London", code: "LON", city: "London", openUtc: 8, closeUtc: 17, volatility: "High", pairs: ["EURUSD", "GBPUSD", "EURGBP", "XAUUSD"] },
    { name: "New York", code: "NYC", city: "New York", openUtc: 13, closeUtc: 22, volatility: "High", pairs: ["EURUSD", "GBPUSD", "US30", "NAS100", "XAUUSD"] },
];

const VOL_COLORS: Record<string, string> = { Low: "text-blue-400 bg-blue-500/10 border-blue-500/20", Medium: "text-amber-400 bg-amber-500/10 border-amber-500/20", High: "text-rose-400 bg-rose-500/10 border-rose-500/20" };

function getOverlapHours() {
    const overlaps: { sessions: string[]; hours: number[]; label: string }[] = [];

    for (let h = 0; h < 24; h++) {
        const active: string[] = [];
        for (const s of SESSIONS) {
            const isOpen = s.openUtc < s.closeUtc
                ? h >= s.openUtc && h < s.closeUtc
                : h >= s.openUtc || h < s.closeUtc;
            if (isOpen) active.push(s.code);
        }
        if (active.length >= 2) {
            const existing = overlaps.find((o) => o.sessions.join() === active.join());
            if (existing) {
                existing.hours.push(h);
            } else {
                overlaps.push({ sessions: [...active], hours: [h], label: active.join(" + ") });
            }
        }
    }

    return overlaps;
}

export default function OverlapDetectorPage() {
    const [utcHour, setUtcHour] = useState(new Date().getUTCHours());

    useEffect(() => {
        const timer = setInterval(() => setUtcHour(new Date().getUTCHours()), 60000);
        return () => clearInterval(timer);
    }, []);

    const overlaps = getOverlapHours();

    const isSessionOpen = (s: Session) =>
        s.openUtc < s.closeUtc
            ? utcHour >= s.openUtc && utcHour < s.closeUtc
            : utcHour >= s.openUtc || utcHour < s.closeUtc;

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6" data-guide="page-header">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Session Overlap Detector</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Find the best times to trade — overlaps = higher liquidity</p>
                </div>

                {/* Current UTC Time */}
                <div className="mb-6 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
                    <div className="flex items-center gap-3">
                        <Clock size={18} className="text-violet-400" />
                        <div>
                            <p className="text-xs text-muted-foreground">Current UTC Time</p>
                            <p className="font-mono text-xl font-bold text-foreground">{String(utcHour).padStart(2, "0")}:{String(new Date().getUTCMinutes()).padStart(2, "0")}</p>
                        </div>
                    </div>
                </div>

                {/* Session Status */}
                <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {SESSIONS.map((s) => {
                        const open = isSessionOpen(s);
                        return (
                            <div key={s.code} className={cn("rounded-2xl border p-4 transition-all", open ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-border/30 bg-muted/50")}>
                                <div className="mb-3 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-foreground">{s.name}</span>
                                    <span className={cn("flex items-center gap-1 text-[10px] font-medium", open ? "text-emerald-400" : "text-muted-foreground")}>
                                        <span className={cn("h-1.5 w-1.5 rounded-full", open ? "bg-emerald-400 animate-pulse" : "bg-muted/50")} />
                                        {open ? "OPEN" : "CLOSED"}
                                    </span>
                                </div>
                                <p className="text-[10px] text-muted-foreground">{s.openUtc}:00 – {s.closeUtc}:00 UTC</p>
                                <div className={cn("mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium", VOL_COLORS[s.volatility])}>
                                    {s.volatility} Vol
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">{s.pairs.join(", ")}</p>
                            </div>
                        );
                    })}
                </div>

                {/* Overlap Map */}
                <div className="mb-8 rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Globe size={15} className="text-violet-400" /> 24-Hour Overlap Map</h2>
                    <div className="grid grid-cols-24 gap-1">
                        {Array.from({ length: 24 }, (_, h) => {
                            const active: string[] = [];
                            for (const s of SESSIONS) {
                                const isOpen = s.openUtc < s.closeUtc
                                    ? h >= s.openUtc && h < s.closeUtc
                                    : h >= s.openUtc || h < s.closeUtc;
                                if (isOpen) active.push(s.code);
                            }
                            const count = active.length;
                            const isNow = h === utcHour;

                            return (
                                <div key={h} className="flex flex-col items-center gap-1">
                                    <div
                                        className={cn(
                                            "h-10 w-full rounded-md transition-all",
                                            count === 0 && "bg-muted/50",
                                            count === 1 && "bg-blue-500/20",
                                            count === 2 && "bg-amber-500/30",
                                            count === 3 && "bg-orange-500/40",
                                            count === 4 && "bg-rose-500/50",
                                            isNow && "ring-2 ring-violet-400 ring-offset-1 ring-offset-[#080c13]",
                                        )}
                                        title={`${h}:00 UTC — ${active.join(", ") || "No sessions"}`}
                                    />
                                    <span className={cn("text-[8px] font-mono", isNow ? "text-violet-400 font-bold" : "text-muted-foreground")}>{h}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-muted/50 border border-border/40" /> None</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-blue-500/20" /> 1 Session</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-amber-500/30" /> 2 Sessions</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-orange-500/40" /> 3 Sessions</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-rose-500/50" /> 4 Sessions</span>
                    </div>
                </div>

                {/* Best Overlap Windows */}
                <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Zap size={15} className="text-amber-400" /> Best Overlap Windows</h2>
                    <div className="space-y-3">
                        {overlaps.sort((a, b) => b.hours.length - a.hours.length).slice(0, 5).map((o, i) => (
                            <div key={i} className="flex items-center gap-4 rounded-xl border border-border/30 bg-muted p-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                                    <Zap size={16} className="text-amber-400" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-foreground">{o.sessions.join(" + ")}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                        {o.hours.length} hour{o.hours.length > 1 ? "s" : ""} — {o.hours[0]}:00 to {o.hours[o.hours.length - 1] + 1}:00 UTC
                                    </p>
                                </div>
                                <div className="text-right">
                                    <span className={cn("rounded-lg border px-2.5 py-1 text-[10px] font-medium", o.sessions.length >= 3 ? "border-rose-500/20 bg-rose-500/10 text-rose-400" : "border-amber-500/20 bg-amber-500/10 text-amber-400")}>
                                        {o.sessions.length >= 3 ? "BEST" : "GOOD"}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-6 rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-[11px] text-amber-400/60">
                    <AlertTriangle size={12} className="mr-1 inline" />
                    Overlapping sessions provide the highest liquidity and tightest spreads. Trade major pairs during London + New York overlap (13:00–17:00 UTC) for best execution.
                </div>
            </div>
        </div>
    );
}
