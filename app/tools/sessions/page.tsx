"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Clock, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

const SESSIONS = [
    {
        name: "Sydney",
        flag: "🇦🇺",
        openHour: 22, // UTC
        closeHour: 7,
        color: "bg-cyan-500",
        textColor: "text-cyan-400",
        borderColor: "border-cyan-500/20",
    },
    {
        name: "Tokyo",
        flag: "🇯🇵",
        openHour: 0,
        closeHour: 9,
        color: "bg-rose-500",
        textColor: "text-rose-400",
        borderColor: "border-rose-500/20",
    },
    {
        name: "London",
        flag: "🇬🇧",
        openHour: 7,
        closeHour: 16,
        color: "bg-violet-500",
        textColor: "text-violet-400",
        borderColor: "border-violet-500/20",
    },
    {
        name: "New York",
        flag: "🇺🇸",
        openHour: 12,
        closeHour: 21,
        color: "bg-amber-500",
        textColor: "text-amber-400",
        borderColor: "border-amber-500/20",
    },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function isSessionActive(session: typeof SESSIONS[0], hour: number): boolean {
    if (session.openHour < session.closeHour) {
        return hour >= session.openHour && hour < session.closeHour;
    }
    return hour >= session.openHour || hour < session.closeHour;
}

function getOverlapCount(hour: number): number {
    return SESSIONS.filter((s) => isSessionActive(s, hour)).length;
}

export default function TradingSessionsPage() {
    const [currentUTC, setCurrentUTC] = useState(0);

    useEffect(() => {
        const tick = () => setCurrentUTC(new Date().getUTCHours() + new Date().getUTCMinutes() / 60);
        tick();
        const interval = setInterval(tick, 60000);
        return () => clearInterval(interval);
    }, []);

    const currentHour = Math.floor(currentUTC);

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6" data-guide="page-header">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Trading Sessions</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Visualize overlapping trading sessions and best times to trade</p>
                </div>

                {/* Current Time */}
                <div className="mb-6 rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                                <Clock size={18} className="text-violet-400" />
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current UTC Time</p>
                                <p className="font-mono text-xl font-bold text-foreground">
                                    {String(Math.floor(currentUTC)).padStart(2, "0")}:{String(Math.floor((currentUTC % 1) * 60)).padStart(2, "0")}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active Sessions</p>
                            <div className="mt-1 flex gap-1.5">
                                {SESSIONS.filter((s) => isSessionActive(s, currentHour)).map((s) => (
                                    <span key={s.name} className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-medium", s.color + "/10", s.textColor)}>
                                        {s.flag} {s.name}
                                    </span>
                                ))}
                                {SESSIONS.filter((s) => isSessionActive(s, currentHour)).length === 0 && (
                                    <span className="text-xs text-muted-foreground">Market Closed</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Session Timeline */}
                <div className="mb-6 rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <h2 className="mb-4 text-sm font-semibold text-foreground">24-Hour Session Timeline (UTC)</h2>

                    {/* Hour labels */}
                    <div className="mb-2 flex">
                        <div className="w-24 shrink-0" />
                        <div className="flex flex-1">
                            {HOURS.map((h) => (
                                <div key={h} className={cn("flex-1 text-center text-[9px] font-mono", h === currentHour ? "text-violet-400 font-bold" : "text-muted-foreground")}>
                                    {String(h).padStart(2, "0")}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Sessions */}
                    {SESSIONS.map((session) => (
                        <div key={session.name} className="mb-2 flex items-center">
                            <div className="w-24 shrink-0 pr-3">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-sm">{session.flag}</span>
                                    <span className={cn("text-xs font-semibold", session.textColor)}>{session.name}</span>
                                </div>
                            </div>
                            <div className="flex flex-1 gap-[1px]">
                                {HOURS.map((h) => {
                                    const active = isSessionActive(session, h);
                                    const isCurrent = h === currentHour;
                                    return (
                                        <div
                                            key={h}
                                            className={cn(
                                                "flex-1 h-8 rounded-sm transition-all",
                                                active ? session.color + (isCurrent ? "" : "/60") : "bg-muted",
                                                isCurrent && "ring-1 ring-border/30"
                                            )}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {/* Overlap row */}
                    <div className="mt-3 flex items-center">
                        <div className="w-24 shrink-0 pr-3">
                            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Overlap</span>
                        </div>
                        <div className="flex flex-1 gap-[1px]">
                            {HOURS.map((h) => {
                                const count = getOverlapCount(h);
                                const isCurrent = h === currentHour;
                                return (
                                    <div
                                        key={h}
                                        className={cn(
                                            "flex-1 h-6 flex items-center justify-center rounded-sm text-[8px] font-bold transition-all",
                                            count >= 3 ? "bg-amber-500 text-foreground" :
                                            count === 2 ? "bg-emerald-500/60 text-foreground" :
                                            count === 1 ? "bg-muted/30 text-muted-foreground" :
                                            "bg-muted/50 text-muted-foreground",
                                            isCurrent && "ring-1 ring-border/30"
                                        )}
                                    >
                                        {count > 0 ? count : ""}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-500" /> 3+ Sessions</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-500/60" /> 2 Sessions</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-muted/30" /> 1 Session</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-muted/50" /> Closed</span>
                    </div>
                </div>

                {/* Best Times */}
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-5">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                            <Globe size={14} /> Best Times to Trade
                        </h3>
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">London/New York Overlap</span>
                                <span className="font-mono font-bold text-emerald-400">12:00–16:00 UTC</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">London Session Open</span>
                                <span className="font-mono font-bold text-emerald-400">07:00–09:00 UTC</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">NY Session Open</span>
                                <span className="font-mono font-bold text-emerald-400">12:00–14:00 UTC</span>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.04] p-5">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-400">
                            <Clock size={14} /> Times to Avoid
                        </h3>
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Session Gaps</span>
                                <span className="font-mono font-bold text-rose-400">21:00–22:00 UTC</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Asian Lunch</span>
                                <span className="font-mono font-bold text-rose-400">04:00–06:00 UTC</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Sunday Open</span>
                                <span className="font-mono font-bold text-rose-400">22:00–00:00 UTC</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
