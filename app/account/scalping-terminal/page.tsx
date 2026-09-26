"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Lock, Terminal, Zap, RefreshCcw, ShieldCheck } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { Badge } from "@/components/ui/badge";
import { ProScalpingTerminal } from "@/components/pro-scalping-terminal/ProScalpingTerminal";

export default function ScalpTerminalPage() {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasPro, setHasPro] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); if (!u) setLoading(false); });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try { const { hasSubscription } = await onSubscriptionChange(user.uid); setHasPro(hasSubscription); } catch { setHasPro(false); } finally { setLoading(false); }
        })();
    }, [user]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
                <div className="flex items-center gap-3 text-muted-foreground"><RefreshCcw className="h-5 w-5 animate-spin" /><span className="text-sm">Verifying Pro access...</span></div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-background text-foreground">
                <div className="max-w-5xl mx-auto px-6 py-8">
                    <a href="/login?redirect=/account/scalping-terminal" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-8"><ArrowLeft className="h-3.5 w-3.5" /> Back to Account</a>
                    <div className="flex h-96 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center p-8">
                        <Lock className="h-10 w-10 text-muted-foreground mb-4" />
                        <h3 className="text-xl font-semibold">Sign in to access the Pro Scalping Terminal</h3>
                        <p className="mt-2 text-sm text-muted-foreground">This workspace requires an active Pro subscription.</p>
                        <a href="/login?redirect=/account/scalping-terminal" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90">Sign In</a>
                    </div>
                </div>
            </div>
        );
    }

    if (!hasPro) {
        return (
            <div className="min-h-screen bg-background text-foreground">
                <div className="max-w-5xl mx-auto px-6 py-8">
                    <a href="/account" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-8"><ArrowLeft className="h-3.5 w-3.5" /> Back to Account</a>
                    <div className="flex h-96 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center p-8">
                        <Zap className="h-10 w-10 text-amber-400 mb-4" />
                        <h3 className="text-xl font-semibold">Pro Scalping Terminal</h3>
                        <p className="mt-2 text-sm text-muted-foreground">Requires Pro or Enterprise subscription.</p>
                        <div className="mt-6 flex gap-3">
                            <a href="/account/subscribe" className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90">Upgrade Now</a>
                            <a href="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted">View Pricing</a>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Top header bar */}
            <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
                <div className="mx-auto max-w-[1600px] px-4 md:px-6 flex items-center justify-between h-14 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <a href="/account" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition hover:bg-white/5" aria-label="Back"><ArrowLeft className="h-3.5 w-3.5" /> Account</a>
                        <span className="text-border">|</span>
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Terminal className="h-3.5 w-3.5" /></div>
                            <div className="min-w-0 leading-none">
                                <h1 className="text-sm font-semibold truncate">AlgoVault Pro</h1>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 truncate">
                                    <span>Scalping Terminal</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[10px] h-5">Pro</Badge>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1600px] px-4 md:px-6 py-4 md:py-6">
                <ProScalpingTerminal />

                {/* Bottom evidence banner */}
                <div className="mt-4 rounded-xl border border-white/[0.08] bg-card p-4 flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                        <h3 className="text-xs font-semibold">Evidence-based only</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1">Every observation comes from the existing AlgoVault market-data, MTF, intelligence, and AI evidence pipelines. The AI never invents prices, indicators, structures, liquidity, setups, news, or historical statistics. If evidence is missing, the terminal explicitly shows insufficient evidence.</p>
                    </div>
                </div>
            </main>
        </div>
    );
}
