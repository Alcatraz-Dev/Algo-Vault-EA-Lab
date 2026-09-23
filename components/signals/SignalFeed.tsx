"use client";

import { useState, useMemo } from "react";
import {
    Search,
    SlidersHorizontal,
    ArrowUpDown,
    ChevronDown,
    Loader2,
    Radio,
    Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AISignal, SignalCategory, SignalStatus } from "@/lib/ai-signals/types";
import { useLivePrices } from "@/hooks/useLivePrices";
import SignalCard from "./SignalCard";

type Props = {
    signals: AISignal[];
    loading?: boolean;
    onView?: (signal: AISignal) => void;
    onFollow?: (signalId: string) => Promise<void> | void;
    onTrade?: (signal: AISignal) => Promise<void> | void;
    onComplete?: (signal: AISignal) => Promise<void> | void;
    followedIds?: Set<string>;
    followLoadingIds?: Set<string>;
    tradeLoadingIds?: Set<string>;
    completeLoadingIds?: Set<string>;
};

type SortKey = "confidence" | "riskReward" | "time";

const CATEGORIES: { label: string; value: SignalCategory | "all" }[] = [
    { label: "All", value: "all" },
    { label: "Forex", value: "forex" },
    { label: "Gold", value: "gold" },
    { label: "Indices", value: "indices" },
    { label: "Crypto", value: "crypto" },
];

const STATUS_OPTIONS: { label: string; value: SignalStatus | "all" }[] = [
    { label: "All Status", value: "all" },
    { label: "Active", value: "ACTIVE" },
    { label: "Ready", value: "READY" },
    { label: "Forming", value: "FORMING" },
    { label: "TP1 Hit", value: "TP1_HIT" },
    { label: "TP2 Hit", value: "TP2_HIT" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Stopped", value: "STOPPED" },
    { label: "Cancelled", value: "CANCELLED" },
];

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
    { label: "Confidence", value: "confidence" },
    { label: "Risk/Reward", value: "riskReward" },
    { label: "Time", value: "time" },
];

function SkeletonCard() {
    return (
        <div className="rounded-2xl border border-border/20 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
            <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 animate-pulse rounded-xl bg-muted/20" />
                <div className="flex-1 space-y-2">
                    <div className="h-4 w-20 animate-pulse rounded bg-muted/20" />
                    <div className="h-3 w-14 animate-pulse rounded bg-muted/20" />
                </div>
                <div className="h-6 w-12 animate-pulse rounded-full bg-muted/20" />
            </div>
            <div className="space-y-2 mb-4">
                <div className="h-2 w-full animate-pulse rounded-full bg-muted/20" />
            </div>
            <div className="rounded-xl border border-border/20 p-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex justify-between">
                        <div className="h-3 w-12 animate-pulse rounded bg-muted/20" />
                        <div className="h-3 w-20 animate-pulse rounded bg-muted/20" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function formatRelativeTime(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
}

export default function SignalFeed({
    signals,
    loading = false,
    onView,
    onFollow,
    onTrade,
    onComplete,
    followedIds,
    followLoadingIds,
    tradeLoadingIds,
    completeLoadingIds,
}: Props) {
    const [activeCategory, setActiveCategory] = useState<SignalCategory | "all">("all");
    const [statusFilter, setStatusFilter] = useState<SignalStatus | "all">("all");
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<SortKey>("confidence");
    const [statusOpen, setStatusOpen] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);

    // Collect unique symbols from visible signals for live price polling
    const symbols = useMemo(() => [...new Set(signals.map((s) => s.symbol))], [signals]);
    const { prices, lastUpdatedAt, isLive } = useLivePrices(symbols, {
        intervalMs: 10_000,
        enabled: symbols.length > 0,
    });

    const filtered = useMemo(() => {
        let result = [...signals];

        if (activeCategory !== "all") {
            result = result.filter((s) => s.category === activeCategory);
        }
        if (statusFilter !== "all") {
            result = result.filter((s) => s.status === statusFilter);
        }
        if (search.trim()) {
            const q = search.toLowerCase().trim();
            result = result.filter((s) => s.symbol.toLowerCase().includes(q));
        }

        result.sort((a, b) => {
            switch (sort) {
                case "confidence": return b.confidence - a.confidence;
                case "riskReward": return b.riskReward - a.riskReward;
                case "time": return b.createdAt - a.createdAt;
            }
        });

        return result;
    }, [signals, activeCategory, statusFilter, search, sort]);

    return (
        <div className="space-y-4">
            {/* Category Tabs */}
            <div className="flex items-center gap-1 rounded-xl border border-border/20 p-1">
                {CATEGORIES.map((cat) => (
                    <button
                        key={cat.value}
                        onClick={() => setActiveCategory(cat.value)}
                        className={cn(
                            "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                            activeCategory === cat.value
                                ? "bg-amber-500/10 text-amber-400 shadow-sm"
                                : "text-foreground/70 hover:text-foreground/70"
                        )}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Filters Row */}
            <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/50" />
                    <input
                        type="text"
                        placeholder="Search symbol..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 w-full rounded-lg border border-border/20 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-amber-500/30 bg-background/50"
                    />
                </div>

                {/* Status Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => { setStatusOpen(!statusOpen); setSortOpen(false); }}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-border/20 px-3 text-xs text-muted-foreground transition-colors hover:border-border/40 hover:text-foreground/80"
                    >
                        <SlidersHorizontal size={12} />
                        {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "All Status"}
                        <ChevronDown size={12} />
                    </button>
                    {statusOpen && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-border/20 bg-background p-1 shadow-xl backdrop-blur-xl">
                            {STATUS_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => { setStatusFilter(opt.value); setStatusOpen(false); }}
                                    className={cn(
                                        "flex w-full items-center rounded-lg px-3 py-1.5 text-xs transition-colors",
                                        statusFilter === opt.value
                                            ? "bg-amber-500/10 text-amber-400"
                                            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Sort Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => { setSortOpen(!sortOpen); setStatusOpen(false); }}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-border/20 px-3 text-xs text-muted-foreground transition-colors hover:border-border/40 hover:text-foreground/80"
                    >
                        <ArrowUpDown size={12} />
                        {SORT_OPTIONS.find((o) => o.value === sort)?.label}
                        <ChevronDown size={12} />
                    </button>
                    {sortOpen && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-xl border border-border/20 bg-background p-1 shadow-xl backdrop-blur-xl">
                            {SORT_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => { setSort(opt.value); setSortOpen(false); }}
                                    className={cn(
                                        "flex w-full items-center rounded-lg px-3 py-1.5 text-xs transition-colors",
                                        sort === opt.value
                                            ? "bg-amber-500/10 text-amber-400"
                                            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Click-away overlay for dropdowns */}
            {(statusOpen || sortOpen) && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => { setStatusOpen(false); setSortOpen(false); }}
                />
            )}

            {/* Signal Count + Live Indicator */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs text-foreground/70">
                    <Radio size={12} className="text-amber-400" />
                    <span>
                        <span className="font-bold text-foreground">{filtered.length}</span> signal{filtered.length !== 1 ? "s" : ""}
                    </span>
                </div>

                {/* Live price indicator */}
                {isLive && lastUpdatedAt > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        <Activity className="h-2.5 w-2.5 animate-pulse" />
                        Prices live · {formatRelativeTime(lastUpdatedAt)}
                    </span>
                )}
            </div>

            {/* Signals Grid */}
            {loading ? (
                <div className="grid gap-3 md:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-border/20 py-16">
                    <div className="mb-3 rounded-full bg-foreground/10 p-3">
                        <Radio size={24} className="text-foreground/50" />
                    </div>
                    <p className="text-sm font-medium text-foreground/70">No signals yet</p>
                    <p className="text-xs text-foreground/50">
                        {search ? "Try a different search" : "Signals will appear here when detected"}
                    </p>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
                    {filtered.map((signal) => (
                        <SignalCard
                            key={signal.id}
                            signal={signal}
                            viewHref={`/signals/${signal.id}`}
                            onView={onView ? () => onView(signal) : undefined}
                            onFollow={onFollow}
                            onTrade={onTrade}
                            onComplete={onComplete}
                            isFollowed={followedIds?.has(signal.id) ?? false}
                            followLoading={followLoadingIds?.has(signal.id) ?? false}
                            tradeLoading={tradeLoadingIds?.has(signal.id) ?? false}
                            completeLoading={completeLoadingIds?.has(signal.id) ?? false}
                            currentPrice={prices[signal.symbol] ?? 0}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
