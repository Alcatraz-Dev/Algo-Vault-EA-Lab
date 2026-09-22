"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, ArrowLeft, Tag, Plus, Trash2, X, Palette,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type TradeTag = { id: string; name: string; color: string; trades: string[]; createdAt: number };

const COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

export default function TradeTagsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [tags, setTags] = useState<TradeTag[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [newName, setNewName] = useState("");
    const [newColor, setNewColor] = useState(COLORS[0]);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchTags = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/trade-tags", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setTags(json.tags || []);
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchTags()); }, [user, fetchTags]);

    const createTag = async () => {
        if (!user || !newName.trim()) return;
        setCreating(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/trade-tags", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName.trim(), color: newColor }),
            });
            setNewName("");
            setShowForm(false);
            fetchTags();
        } catch {} finally { setCreating(false); }
    };

    const deleteTag = async (tagId: string) => {
        if (!user || !confirm("Delete this tag?")) return;
        const token = await user.getIdToken();
        await fetch("/api/trade-tags", {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ tagId }),
        });
        fetchTags();
    };

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
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Trade Tags</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Create custom tags to organize and filter your trades</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowForm(!showForm)}
                        className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-violet-500 transition"
                    >
                        {showForm ? <X size={13} /> : <Plus size={13} />} {showForm ? "Cancel" : "New Tag"}
                    </button>
                </div>

                {showForm && (
                    <div className="mb-6 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
                        <h3 className="mb-3 text-sm font-semibold text-foreground">Create Tag</h3>
                        <div className="space-y-3">
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Tag name (e.g., Trend Follow, Scalp, Breakout)"
                                className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none"
                                onKeyDown={(e) => e.key === "Enter" && createTag()}
                            />
                            <div>
                                <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Color</p>
                                <div className="flex gap-2">
                                    {COLORS.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setNewColor(c)}
                                            className={cn(
                                                "h-7 w-7 rounded-full transition-all",
                                                newColor === c ? "ring-2 ring-border ring-offset-2 ring-offset-background scale-110" : "hover:scale-110"
                                            )}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={createTag}
                                disabled={!newName.trim() || creating}
                                className="rounded-xl bg-violet-600 px-6 py-2.5 text-xs font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50"
                            >
                                {creating ? "Creating..." : "Create Tag"}
                            </button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : tags.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Tag size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No tags yet</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">Create tags to organize your trades by strategy, setup, or market condition</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {tags.map((tag) => (
                            <div
                                key={tag.id}
                                className="group rounded-2xl border border-border/30 bg-muted/50 p-5 transition-all hover:bg-muted"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-4 w-4 rounded-full" style={{ backgroundColor: tag.color }} />
                                        <span className="text-sm font-semibold text-foreground">{tag.name}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => deleteTag(tag.id)}
                                        className="rounded-lg p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                    {tag.trades.length} trade{tag.trades.length !== 1 ? "s" : ""} tagged
                                </p>
                                <p className="text-[9px] text-muted-foreground">Created {new Date(tag.createdAt).toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
