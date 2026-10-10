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

import { AuthRequired } from "@/components/ui/auth-required";

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
            <AccountShell title="Portfolio Intelligence"><AuthRequired /></AccountShell>
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
