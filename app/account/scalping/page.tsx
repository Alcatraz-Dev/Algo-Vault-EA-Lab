"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ProScalpingTerminal } from "@/components/pro-scalping-terminal/ProScalpingTerminal";
import AccountShell from "@/components/account/AccountShell";

/**
 * Account scalping terminal — the same real terminal as
 * /account/scalping-terminal, mounted inside the account shell.
 *
 * The terminal itself gates on the auth token; the deterministic radar /
 * signal / analysis endpoints enforce Pro or admin access server-side and the
 * panels surface that verdict instead of guessing it here.
 */
export default function AccountScalpingPage() {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
        });
        return () => unsub();
    }, []);

    return (
        <AccountShell title="Scalping Terminal" subtitle="Live radar, signals, MTF intelligence and replay">
            {loading ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    Loading terminal…
                </div>
            ) : !user ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-10 text-center">
                    <Lock className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Sign in to open the scalping terminal</p>
                    <a
                        href="/login?redirect=/account/scalping"
                        className="rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
                    >
                        Sign In
                    </a>
                </div>
            ) : (
                <ProScalpingTerminal />
            )}
        </AccountShell>
    );
}
