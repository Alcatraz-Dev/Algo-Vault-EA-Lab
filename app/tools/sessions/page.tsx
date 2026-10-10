"use client";

import { useState, useEffect } from "react";
import { Clock, Globe, Crown, Sparkles, ArrowUpRight } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";
import Link from "next/link";

const SESSIONS = [
    { name: "Sydney", flag: "🇦🇺", openHour: 22, closeHour: 7, color: "bg-info", textColor: "text-info", borderColor: "border-info/20" },
    { name: "Tokyo", flag: "🇯🇵", openHour: 0, closeHour: 9, color: "bg-negative", textColor: "text-negative", borderColor: "border-negative/20" },
    { name: "London", flag: "🇬🇧", openHour: 7, closeHour: 16, color: "bg-primary", textColor: "text-primary", borderColor: "border-primary/20" },
    { name: "New York", flag: "🇺🇸", openHour: 12, closeHour: 21, color: "bg-warning", textColor: "text-warning", borderColor: "border-warning/20" },
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
        <ToolPageShell
            title="Trading Sessions"
            description="24-hour session grid with active highlights and best/avoid windows. Pro adds live alerts, per-session pair suggestions and historical performance."
            badge="lite"
            icon={Clock}
            backHref="/tools"
            proHeadline="Pro turns the static grid into a live trading aid: alerts, per-session pair suggestions, and history."
            proFeatures={[
                "Live session alerts (push / Telegram)",
                "Per-session pair recommendation",
                "Save your preferred sessions",
                "Historical session performance",
            ]}
        >
            {/* Current Time + Active Sessions */}
            <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                            <Clock size={18} className="text-primary" />
                        </div>
                        <div>
                            <p className="text-micro uppercase tracking-wider text-muted-foreground">Current UTC Time</p>
                            <p className="font-numeric text-xl font-bold text-foreground">
                                {String(Math.floor(currentUTC)).padStart(2, "0")}:{String(Math.floor((currentUTC % 1) * 60)).padStart(2, "0")}
                            </p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-micro uppercase tracking-wider text-muted-foreground">Active Sessions</p>
                        <div className="mt-1 flex gap-1.5">
                            {SESSIONS.filter((s) => isSessionActive(s, currentHour)).map((s) => (
                                <span key={s.name} className={cn("rounded-full px-2.5 py-0.5 text-micro font-medium", s.textColor, "bg-muted")}>
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
            <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">24-Hour Session Timeline (UTC)</h2>

                <div className="mb-2 flex">
                    <div className="w-24 shrink-0" />
                    <div className="flex flex-1">
                        {HOURS.map((h) => (
                            <div key={h} className={cn("flex-1 text-center text-micro font-numeric", h === currentHour ? "text-primary font-bold" : "text-muted-foreground")}>
                                {String(h).padStart(2, "0")}
                            </div>
                        ))}
                    </div>
                </div>

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
                                            active ? session.color + (isCurrent ? "" : "/60") : "bg-muted/40",
                                            isCurrent && "ring-1 ring-border/30",
                                        )}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}

                <div className="mt-3 flex items-center">
                    <div className="w-24 shrink-0 pr-3">
                        <span className="text-micro font-semibold uppercase text-muted-foreground">Overlap</span>
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
                                        count >= 3 ? "bg-warning text-background" : "bg-muted/30 text-muted-foreground",
                                        isCurrent && "ring-1 ring-border/30",
                                    )}
                                >
                                    {count > 0 ? count : ""}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-4 text-micro text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-warning" /> 3+ Sessions</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-primary/40" /> 1–2 Sessions</span>
                </div>
            </div>

            {/* Best / Avoid windows (Lite) */}
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-positive/15 bg-positive/[0.04] p-5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-positive">
                        <Globe size={14} /> Best Times to Trade
                    </h3>
                    <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">London/New York Overlap</span>
                            <span className="font-numeric font-bold text-positive">12:00–16:00 UTC</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">London Session Open</span>
                            <span className="font-numeric font-bold text-positive">07:00–09:00 UTC</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">NY Session Open</span>
                            <span className="font-numeric font-bold text-positive">12:00–14:00 UTC</span>
                        </div>
                    </div>
                </div>
                <div className="rounded-lg border border-negative/15 bg-negative/[0.04] p-5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-negative">
                        <Clock size={14} /> Times to Avoid
                    </h3>
                    <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Session Gaps</span>
                            <span className="font-numeric font-bold text-negative">21:00–22:00 UTC</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Asian Lunch</span>
                            <span className="font-numeric font-bold text-negative">04:00–06:00 UTC</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Sunday Open</span>
                            <span className="font-numeric font-bold text-negative">22:00–00:00 UTC</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Pro upsell row */}
            <div className="grid gap-3 md:grid-cols-3">
                <ProTile
                    title="Live Alerts"
                    description="Get a push / Telegram alert when London opens or when London/NY overlap starts."
                />
                <ProTile
                    title="Per-Session Pairs"
                    description="See which pairs historically performed best inside each session."
                />
                <ProTile
                    title="Save Favorites"
                    description="Bookmark the sessions you trade and keep them pinned on your dashboard."
                />
            </div>
        </ToolPageShell>
    );
}

function ProTile({ title, description }: { title: string; description: string }) {
    return (
        <Link
            href="/pricing"
            className="group flex flex-col gap-2 rounded-lg border border-dashed border-primary/25 bg-primary/[0.03] p-4 transition hover:border-primary/40 hover:bg-primary/[0.05]"
        >
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider text-primary">
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