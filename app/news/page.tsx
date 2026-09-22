"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, RefreshCw, ArrowLeft, ExternalLink, TrendingUp, TrendingDown,
    Minus, Newspaper, Globe, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type NewsItem = {
    id: string; title: string; summary: string; source: string; url: string;
    publishedAt: number; category: string; sentiment: "bullish" | "bearish" | "neutral";
    symbols: string[];
};

const CATEGORIES = [
    { value: "all", label: "All", icon: Globe },
    { value: "macro", label: "Macro", icon: Zap },
    { value: "market", label: "Markets", icon: TrendingUp },
    { value: "earnings", label: "Earnings", icon: Newspaper },
];

const SENTIMENT_CONFIG = {
    bullish: { label: "Bullish", icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    bearish: { label: "Bearish", icon: TrendingDown, color: "text-rose-400", bg: "bg-rose-500/10" },
    neutral: { label: "Neutral", icon: Minus, color: "text-muted-foreground", bg: "bg-muted" },
};

export default function NewsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [news, setNews] = useState<NewsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [category, setCategory] = useState("all");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/analytics/news?category=${category}`, { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setNews(json.news || []);
        } catch {} finally { setLoading(false); }
    }, [user, category]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link></div></div>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Market News</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Financial headlines and market sentiment</p>
                    </div>
                    <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50">
                        <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                    </button>
                </div>

                {/* Category Tabs */}
                <div className="mb-6 flex gap-2 rounded-xl border border-border/30 bg-muted/50 p-1">
                    {CATEGORIES.map((cat) => {
                        const Icon = cat.icon;
                        return (
                            <button
                                key={cat.value}
                                type="button"
                                onClick={() => setCategory(cat.value)}
                                className={cn(
                                    "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium transition-all",
                                    category === cat.value
                                        ? "bg-violet-600 text-foreground shadow-lg shadow-violet-500/20"
                                        : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
                                )}
                            >
                                <Icon size={14} /> {cat.label}
                            </button>
                        );
                    })}
                </div>

                {loading && news.length === 0 ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : news.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Newspaper size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No news available for this category</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {news.map((item) => {
                            const sent = SENTIMENT_CONFIG[item.sentiment];
                            const SentIcon = sent.icon;
                            const timeAgo = getTimeAgo(item.publishedAt);

                            return (
                                <div key={item.id} className="group rounded-2xl border border-border/30 bg-muted/50 p-5 transition-all hover:border-border/20 hover:bg-muted">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", sent.bg, sent.color)}>
                                                    <SentIcon size={10} /> {sent.label}
                                                </span>
                                                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{item.source}</span>
                                                <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
                                            </div>
                                            <h3 className="text-sm font-semibold text-foreground group-hover:text-violet-400 transition">{item.title}</h3>
                                            {item.summary && <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{item.summary}</p>}
                                            {item.symbols.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {item.symbols.map((sym) => (
                                                        <span key={sym} className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{sym}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        {item.url && item.url !== "#" && (
                                            <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-2 flex-shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-violet-400 transition">
                                                <ExternalLink size={14} />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function getTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
