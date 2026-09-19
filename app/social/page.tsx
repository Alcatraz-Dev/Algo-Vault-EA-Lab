"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2, Shield, Heart, MessageCircle, Plus, Send, TrendingUp, TrendingDown, Target, Lightbulb, Award } from "lucide-react";
import SiteNavbar from "@/components/navbar/SiteNavbar";
import { cn } from "@/lib/utils";

type Post = {
    id: string; userId: string; displayName: string; avatarUrl?: string;
    type: "trade" | "analysis" | "idea" | "result";
    symbol?: string; direction?: "BUY" | "SELL";
    entryPrice?: number; stopLoss?: number; takeProfit?: number;
    result?: "win" | "loss" | "breakeven"; pnl?: number;
    title: string; content: string; tags?: string[];
    likes: number; comments: number; likedByUser: boolean; createdAt: number;
};

const TYPE_CONFIG = {
    trade: { label: "Trade Idea", icon: Target, color: "text-blue-400", bg: "bg-blue-500/10" },
    analysis: { label: "Analysis", icon: TrendingUp, color: "text-violet-400", bg: "bg-violet-500/10" },
    idea: { label: "Market Idea", icon: Lightbulb, color: "text-amber-400", bg: "bg-amber-500/10" },
    result: { label: "Result", icon: Award, color: "text-emerald-400", bg: "bg-emerald-500/10" },
};

export default function SocialPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);

    const [formType, setFormType] = useState<Post["type"]>("idea");
    const [formSymbol, setFormSymbol] = useState("XAUUSD");
    const [formDirection, setFormDirection] = useState<"BUY" | "SELL">("BUY");
    const [formTitle, setFormTitle] = useState("");
    const [formContent, setFormContent] = useState("");
    const [formEntry, setFormEntry] = useState("");
    const [formSL, setFormSL] = useState("");
    const [formTP, setFormTP] = useState("");
    const [formTags, setFormTags] = useState("");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchPosts = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/social?limit=50", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setPosts(json.posts || []);
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) fetchPosts(); }, [user, fetchPosts]);

    const createPost = async () => {
        if (!user || !formTitle || !formContent) return;
        setCreating(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/social", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: formType, symbol: formType === "trade" ? formSymbol : undefined,
                    direction: formType === "trade" ? formDirection : undefined,
                    entryPrice: formEntry ? Number(formEntry) : undefined,
                    stopLoss: formSL ? Number(formSL) : undefined,
                    takeProfit: formTP ? Number(formTP) : undefined,
                    title: formTitle, content: formContent,
                    tags: formTags ? formTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
                }),
            });
            setShowCreate(false); setFormTitle(""); setFormContent(""); setFormEntry(""); setFormSL(""); setFormTP(""); setFormTags("");
            fetchPosts();
        } catch {} finally { setCreating(false); }
    };

    const toggleLike = async (postId: string) => {
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch("/api/social/like", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ postId }),
        });
        const json = await res.json();
        setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, likedByUser: json.liked, likes: p.likes + (json.liked ? 1 : -1) } : p));
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</a></div></div>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNavbar />
            <div className="mx-auto max-w-3xl px-4 py-8">
                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Social Feed</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Share ideas, analysis, and trade setups</p>
                    </div>
                    <button type="button" onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-violet-500 transition">
                        <Plus size={14} /> New Post
                    </button>
                </div>

                {showCreate && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
                        <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
                            <h2 className="mb-4 text-lg font-semibold text-foreground">New Post</h2>
                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    {(Object.entries(TYPE_CONFIG) as [Post["type"], typeof TYPE_CONFIG.idea][]).map(([key, cfg]) => {
                                        const Icon = cfg.icon;
                                        return (
                                            <button key={key} type="button" onClick={() => setFormType(key)} className={cn("flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition", formType === key ? `border-violet-500/40 ${cfg.bg} ${cfg.color}` : "border-border/30 bg-muted/50 text-muted-foreground")}>
                                                <Icon size={13} /> {cfg.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {formType === "trade" && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <select value={formSymbol} onChange={(e) => setFormSymbol(e.target.value)} className="rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                            {["XAUUSD", "EURUSD", "GBPUSD", "BTCUSD", "ETHUSD", "US30", "NAS100"].map((s) => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                        <select value={formDirection} onChange={(e) => setFormDirection(e.target.value as "BUY" | "SELL")} className="rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                            <option value="BUY">BUY</option><option value="SELL">SELL</option>
                                        </select>
                                        <input type="number" step="any" value={formEntry} onChange={(e) => setFormEntry(e.target.value)} placeholder="Entry price" className="rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                        <input type="number" step="any" value={formSL} onChange={(e) => setFormSL(e.target.value)} placeholder="Stop Loss" className="rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                        <input type="number" step="any" value={formTP} onChange={(e) => setFormTP(e.target.value)} placeholder="Take Profit" className="col-span-2 rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                    </div>
                                )}
                                <input type="text" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Title" className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                <textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} placeholder="Share your analysis..." rows={4} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none resize-none" />
                                <input type="text" value={formTags} onChange={(e) => setFormTags(e.target.value)} placeholder="Tags (comma-separated)" className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                <div className="flex gap-3">
                                    <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-border/30 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancel</button>
                                    <button type="button" onClick={createPost} disabled={creating || !formTitle || !formContent} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                                        {creating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Post
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : posts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/30 p-16 text-center">
                        <MessageCircle size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No posts yet. Be the first to share!</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {posts.map((post) => {
                            const config = TYPE_CONFIG[post.type];
                            const Icon = config.icon;
                            return (
                                <div key={post.id} className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="h-9 w-9 rounded-full bg-violet-500/20 flex items-center justify-center text-sm font-bold text-violet-400">
                                            {post.displayName.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-foreground">{post.displayName}</p>
                                            <p className="text-[10px] text-muted-foreground">{new Date(post.createdAt).toLocaleString()}</p>
                                        </div>
                                        <span className={cn("ml-auto flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium", config.bg, config.color)}>
                                            <Icon size={10} /> {config.label}
                                        </span>
                                    </div>
                                    {post.symbol && (
                                        <div className="mb-3 flex items-center gap-2">
                                            <span className="rounded bg-muted/30 px-2 py-0.5 font-mono text-xs text-foreground">{post.symbol}</span>
                                            <span className={cn("text-xs font-bold", post.direction === "BUY" ? "text-emerald-400" : "text-rose-400")}>{post.direction}</span>
                                            {post.entryPrice && <span className="text-[10px] text-muted-foreground">@ {post.entryPrice}</span>}
                                            {post.stopLoss && <span className="text-[10px] text-rose-400/60">SL: {post.stopLoss}</span>}
                                            {post.takeProfit && <span className="text-[10px] text-emerald-400/60">TP: {post.takeProfit}</span>}
                                        </div>
                                    )}
                                    <h3 className="text-base font-semibold text-foreground mb-1">{post.title}</h3>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{post.content}</p>
                                    {post.tags && post.tags.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            {post.tags.map((tag) => <span key={tag} className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>)}
                                        </div>
                                    )}
                                    <div className="mt-3 flex items-center gap-4 border-t border-border/20 pt-3">
                                        <button type="button" onClick={() => toggleLike(post.id)} className={cn("flex items-center gap-1.5 text-xs transition", post.likedByUser ? "text-rose-400" : "text-muted-foreground hover:text-rose-400")}>
                                            <Heart size={14} fill={post.likedByUser ? "currentColor" : "none"} /> {post.likes}
                                        </button>
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><MessageCircle size={14} /> {post.comments}</span>
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
