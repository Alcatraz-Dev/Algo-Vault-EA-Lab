"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    AlertTriangle,
    ArrowLeft,
    Calendar,
    CheckCircle2,
    Clock,
    DollarSign,
    ExternalLink,
    Filter,
    Flame,
    Globe,
    Info,
    Loader2,
    Radio,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
} from "lucide-react";
import { EconomicNewsItem } from "@/app/api/calendar/route";
import TradingViewEconomicCalendar from "@/components/tradingview/TradingViewEconomicCalendar";

export default function EconomicCalendarPage() {
    const [events, setEvents] = useState<EconomicNewsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedImpact, setSelectedImpact] = useState<"All" | "High" | "Medium">("All");
    const [selectedCurrency, setSelectedCurrency] = useState<string>("All");

    async function loadCalendar(isRefresh = false) {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const res = await fetch("/api/calendar");
            const data = await res.json();

            if (data.success && Array.isArray(data.events)) {
                setEvents(data.events);
            }
        } catch (err) {
            console.error("CALENDAR FETCH ERROR:", err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    useEffect(() => {
        loadCalendar();
    }, []);

    const filteredEvents = events.filter((evt) => {
        const matchesImpact = selectedImpact === "All" || evt.impact === selectedImpact;
        const matchesCurrency = selectedCurrency === "All" || evt.currency === selectedCurrency;
        return matchesImpact && matchesCurrency;
    });

    return (
        <main className="min-h-screen bg-background text-foreground">
            
            {/* Background Ambient Blur */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-[-250px] h-[550px] w-[550px] -translate-x-1/2 rounded-full bg-red-600/10 blur-[130px]" />
                <div className="absolute bottom-[-200px] right-[-100px] h-[450px] w-[450px] rounded-full bg-amber-600/10 blur-[130px]" />
            </div>

            {/* Header Section */}
            <section className="border-b border-border/30" data-guide="page-header">
                <div className="mx-auto max-w-7xl px-6 py-10">
                    
                    {/* Back Button matching Purchases page style */}
                    <Link
                        href="/account"
                        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                    >
                        <ArrowLeft size={16} />
                        Back to Account
                    </Link>

                    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-border/30 bg-muted/5 px-3 py-1.5 text-xs text-muted-foreground">
                                <Calendar size={13} />
                                Economic Impact & News Telemetry
                            </div>

                            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
                                Economic Calendar & EA News Filter
                            </h1>

                            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                                Real-time forex news releases, high-impact event schedule, and automated EA pause recommendations to protect account equity.
                            </p>
                        </div>

                        {/* Controls & Refresh */}
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => loadCalendar(true)}
                                disabled={refreshing}
                                className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/10 hover:text-foreground disabled:opacity-50"
                            >
                                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                                <span>{refreshing ? "Updating..." : "Refresh Calendar"}</span>
                            </button>
                        </div>
                    </div>

                    {/* Controls Bar */}
                    <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border/30 pt-6">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-xs text-muted-foreground font-medium">Impact Filter:</span>
                            {(["All", "High", "Medium"] as const).map((imp) => (
                                <button
                                    key={imp}
                                    type="button"
                                    onClick={() => setSelectedImpact(imp)}
                                    className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium transition ${
                                        selectedImpact === imp
                                            ? "border-border bg-muted/10 text-foreground font-semibold shadow-md"
                                            : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/5"
                                    }`}
                                >
                                    {imp === "High" ? "🔴 High Impact Only" : imp}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Currency:</span>
                            <select
                                value={selectedCurrency}
                                onChange={(e) => setSelectedCurrency(e.target.value)}
                                className="rounded-xl border border-border/30 bg-card px-3 py-1.5 text-xs text-foreground focus:outline-none"
                            >
                                <option value="All">All Currencies</option>
                                <option value="USD">USD (US Dollar)</option>
                                <option value="EUR">EUR (Euro)</option>
                                <option value="GBP">GBP (British Pound)</option>
                                <option value="JPY">JPY (Japanese Yen)</option>
                                <option value="AUD">AUD (Australian Dollar)</option>
                            </select>
                        </div>
                    </div>

                </div>
            </section>

            {/* Main Table Content */}
            <div className="mx-auto max-w-7xl px-6 py-10">
                <section className="mb-8 border border-border/30 bg-muted/50 p-4">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                            <p className="text-sm font-semibold text-foreground">Live TradingView economic calendar</p>
                            <p className="mt-1 text-xs text-muted-foreground">Live releases and market-moving events powered by TradingView.</p>
                        </div>
                        <a href="https://www.tradingview.com/economic-calendar/" target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:text-cyan-100">Open TradingView</a>
                    </div>
                    <TradingViewEconomicCalendar />
                </section>
                {loading ? (
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-16 text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">Loading economic releases...</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-2xl border border-border/30 bg-muted/50 backdrop-blur-xl">
                        <table className="w-full text-left text-xs text-muted-foreground">
                            <thead className="border-b border-border/30 bg-muted/5 font-semibold text-foreground">
                                <tr>
                                    <th className="p-4">Time (UTC)</th>
                                    <th className="p-4">Currency</th>
                                    <th className="p-4">Event Description</th>
                                    <th className="p-4">Impact</th>
                                    <th className="p-4">Forecast</th>
                                    <th className="p-4">Previous</th>
                                    <th className="p-4">Actual</th>
                                    <th className="p-4 text-right">EA Action Recommendation</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredEvents.map((evt) => (
                                    <tr key={evt.id} className="hover:bg-muted transition">
                                        <td className="p-4 font-mono text-muted-foreground font-medium">
                                            {evt.timeUtc}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-1.5 font-semibold text-foreground">
                                                <span>{evt.flag}</span>
                                                <span>{evt.currency}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 font-semibold text-foreground">
                                            {evt.title}
                                        </td>
                                        <td className="p-4">
                                            <span
                                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 ${
                                                    evt.impact === "High"
                                                        ? "border border-red-500/30 bg-red-500/10 text-red-400"
                                                        : "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                                                }`}
                                            >
                                                <span
                                                    className={`h-1.5 w-1.5 rounded-full ${
                                                        evt.impact === "High" ? "bg-red-400 animate-pulse" : "bg-amber-400"
                                                    }`}
                                                />
                                                {evt.impact}
                                            </span>
                                        </td>
                                        <td className="p-4 font-mono text-muted-foreground">{evt.forecast}</td>
                                        <td className="p-4 font-mono text-muted-foreground">{evt.previous}</td>
                                        <td className="p-4 font-mono text-emerald-400 font-bold">
                                            {evt.actual || "Pending"}
                                        </td>
                                        <td className="p-4 text-right">
                                            <span
                                                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-bold whitespace-nowrap shrink-0 ${
                                                    evt.eaActionAdvice === "PAUSE EA"
                                                        ? "border-red-500/40 bg-red-500/20 text-red-300"
                                                        : "border-amber-500/40 bg-amber-500/20 text-amber-300"
                                                }`}
                                            >
                                                <AlertTriangle size={13} />
                                                {evt.eaActionAdvice}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </main>
    );
}
