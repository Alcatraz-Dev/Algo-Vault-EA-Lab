"use client";

/**
 * AlgoVault Trading Terminal — Phase 5.
 *
 * The one entry point that composes the workspace: watchlist, chart,
 * intelligence, market monitor, account/positions, risk and the native
 * trading chat, all sharing a single TerminalContext.
 *
 * Access: Free users get the full basic terminal (§40). Pro is decided by
 * the server-side subscription record and fails closed — a failed lookup
 * renders FREE, never PRO.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import AccountShell from "@/components/account/AccountShell";
import { TerminalProvider } from "@/components/terminal/TerminalContext";
import { TerminalDataProvider } from "@/components/terminal/TerminalData";
import { TerminalShell } from "@/components/terminal/TerminalShell";

export default function TerminalPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [checking, setChecking] = useState(true);
    const [isPro, setIsPro] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    /* eslint-disable react-hooks/set-state-in-effect -- auth/subscription handshake: the resolved session is an external system, and its result has to land in state before the shell can render. */
    useEffect(() => {
        if (!user) {
            setChecking(false);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const sub = await onSubscriptionChange(user.uid);
                if (!cancelled) setIsPro(sub.hasSubscription);
            } catch {
                // Fail closed: an unreadable subscription is FREE, never PRO.
                if (!cancelled) setIsPro(false);
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user]);
    /* eslint-enable react-hooks/set-state-in-effect */

    if (!user && !checking) {
        return (
            <AccountShell
                title="Trading Terminal"
                subtitle="One workspace for watching, analysing, trading and reviewing"
                onBack={() => router.push("/")}
            >
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-10 text-center">
                    <p className="text-sm font-medium text-foreground">Sign in to open the AlgoVault Terminal</p>
                    <a
                        href="/login?redirect=/account/terminal"
                        className="rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
                    >
                        Sign In
                    </a>
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell
            title="Trading Terminal"
            subtitle="Market · Intelligence · Account · Strategies — one shared context"
            onBack={() => router.push("/account")}
            hideSidebar
            fullscreen
        >
            <TerminalProvider>
                <TerminalDataProvider>
                    <TerminalShell isPro={isPro} />
                </TerminalDataProvider>
            </TerminalProvider>
        </AccountShell>
    );
}
