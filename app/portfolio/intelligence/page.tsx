"use client";

/**
 * Portfolio Intelligence Command Center route (Phase 15 §25).
 * Responsive: the same component serves desktop and mobile — the correlation
 * matrix scrolls horizontally and the grids collapse, it is never a shrunken
 * desktop layout.
 */

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { Loader2, Shield } from "lucide-react";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import PortfolioIntelligence from "@/components/portfolio/PortfolioIntelligence";

export default function PortfolioIntelligencePage() {
    const [user, setUser] = useState<User | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setReady(true);
        });
        return () => unsub();
    }, []);

    if (!ready) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Portfolio Intelligence">
                    <div className="flex flex-1 items-center justify-center">
                        <Loader2 className="size-6 animate-spin text-primary" />
                    </div>
                </AccountShell>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Portfolio Intelligence">
                    <div className="flex flex-1 flex-col items-center justify-center gap-3">
                        <Shield className="size-8 text-muted-foreground" />
                        <h1 className="text-sm font-semibold text-foreground">Sign in required</h1>
                        <p className="max-w-sm text-center text-xs text-muted-foreground">
                            Portfolio intelligence is computed server-side from your connected accounts. Nothing about your
                            portfolio is available without authentication.
                        </p>
                    </div>
                </AccountShell>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Portfolio Intelligence" subtitle="Exposure, correlation, concentration, risk budgets and capital allocation across your whole book">
                <PortfolioIntelligence />
            </AccountShell>
        </div>
    );
}
