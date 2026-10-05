"use client";

import { useState, useEffect } from "react";
import { Clock, Globe, Zap, Crown, Sparkles, ArrowUpRight, AlertTriangle } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";
import Link from "next/link";

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

const VOL_COLORS: Record<string, string> = {
    Low: "text-info bg-info/10 border-info/20",
    Medium: "text-warning bg-warning/10 border-warning/20",
    High: "text-negative bg-negative/10 border-negative/20",
};

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
        <ToolPageShell
            title="Session Overlap Detector"
            description="Find the highest-liquidity windows where sessions intersect. Pro adds best-window pair suggestions, calendar export and saved schedules."
            badge="lite"
            icon={Globe}
            backHref="/tools"
            proHeadline="Pro turns overlap detection into a live trading aid: best-window pairs, calendar export, and saved schedules."
            proFeatures={[
                "Best-window pair suggestions (highest volatility)",
                "Save overlap schedule to your account",
                "Calendar export (.ics)",
                "Per-pair overlap strength",
            ]}
        >
            {/* Current UTC */}
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
                <div className="flex items-center gap-3">
                    <Clock size={18} className="text-primary" />
                    <div>
                        <p className="text-xs text-muted-foreground">Current UTC Time</p>
                        <p className="font-mono text-xl font-bold text-foreground">{String(utcHour).padStart(2, "0")}:{String(new Date().getUTCMinutes()).padStart(2, "0")}</p>
                    </div>
                </div>
            </div>

            {/* Session Status */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {SESSIONS.map((s) => {
                    const open = isSessionOpen(s);
                    return (
                        <div key={s.code} className={cn("rounded-2xl border p-4 transition-all", open ? "border-positive/20 bg-positive/[0.04]" : "border-border bg-card")}>
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-sm font-semibold text-foreground">{s.name}</span>
                                <span className={cn("flex items-center gap-1 text-[10px] font-medium", open ? "text-positive" : "text-muted-foreground")}>
                                    <span className={cn("h-1.5 w-1.5 rounded-full", open ? "bg-positive animate-pulse" : "bg-muted/60")} />
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
            <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Globe size={15} className="text-primary" /> 24-Hour Overlap Map</h2>
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
                                        count === 1 && "bg-info/20",
                                        count === 2 && "bg-warning/30",
                                        count === 3 && "bg-warning/40",
                                        count === 4 && "bg-negative/50",
                                        isNow && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                                    )}
                                    title={`${h}:00 UTC — ${active.join(", ") || "No sessions"}`}
                                />
                                <span className={cn("text-[8px] font-mono", isNow ? "text-primary font-bold" : "text-muted-foreground")}>{h}</span>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-muted/50 border border-border/40" /> None</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-info/20" /> 1 Session</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-warning/30" /> 2 Sessions</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-warning/40" /> 3 Sessions</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-negative/50" /> 4 Sessions</span>
                </div>
            </div>

            {/* Best Overlap Windows (Lite — top 5 by hours, no per-pair ranking) */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Zap size={15} className="text-warning" /> Best Overlap Windows</h2>
                <div className="space-y-3">
                    {overlaps.sort((a, b) => b.hours.length - a.hours.length).slice(0, 5).map((o, i) => (
                        <div key={i} className="flex items-center gap-4 rounded-md border border-border bg-muted p-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-warning/10">
                                <Zap size={16} className="text-warning" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-foreground">{o.sessions.join(" + ")}</p>
                                <p className="text-[10px] text-muted-foreground">
                                    {o.hours.length} hour{o.hours.length > 1 ? "s" : ""} — {o.hours[0]}:00 to {o.hours[o.hours.length - 1] + 1}:00 UTC
                                </p>
                            </div>
                            <div className="text-right">
                                <span className={cn("rounded-md border px-2.5 py-1 text-[10px] font-medium", o.sessions.length >= 3 ? "border-negative/20 bg-negative/10 text-negative" : "border-warning/20 bg-warning/10 text-warning")}>
                                    {o.sessions.length >= 3 ? "BEST" : "GOOD"}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="rounded-2xl border border-warning/15 bg-warning/[0.04] p-3 text-xs text-warning">
                <AlertTriangle size={12} className="mr-1 inline" />
                Overlapping sessions provide the highest liquidity and tightest spreads. Trade major pairs during London + New York overlap (13:00–17:00 UTC) for best execution.
            </div>

            {/* Pro upsell row */}
            <div className="grid gap-3 md:grid-cols-3">
                <ProTile
                    title="Best-Window Pairs"
                    description="See which pairs historically performed best in each overlap window."
                />
                <ProTile
                    title="Calendar Export"
                    description="Export your overlap schedule as an .ics file to your calendar."
                />
                <ProTile
                    title="Saved Schedules"
                    description="Save your favorite overlap windows to your account for one-click access."
                />
            </div>
        </ToolPageShell>
    );
}

function ProTile({ title, description }: { title: string; description: string }) {
    return (
        <Link
            href="/pricing"
            className="group flex flex-col gap-2 rounded-2xl border border-dashed border-primary/25 bg-primary/[0.03] p-4 transition hover:border-primary/40 hover:bg-primary/[0.05]"
        >
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    <Crown className="size-2.5" />
                    Pro
                </span>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary transition group-hover:gap-1.5">
                <Sparkles className="size-3" />
                Unlock
                <ArrowUpRight className="size-3" />
            </span>
        </Link>
    );
}