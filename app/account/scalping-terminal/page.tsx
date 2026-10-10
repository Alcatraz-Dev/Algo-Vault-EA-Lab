"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Lock, Terminal } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { ProScalpingTerminal } from "@/components/pro-scalping-terminal/ProScalpingTerminal";
import AccountShell from "@/components/account/AccountShell";

export default function ScalpTerminalPage() {
    const router = useRouter();
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasPro, setHasPro] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const { hasSubscription } = await onSubscriptionChange(user.uid);
                setHasPro(hasSubscription);
            } catch {
                setHasPro(false);
            } finally {
                setLoading(false);
            }
        })();
    }, [user]);

    // Never let the subscription check block the page forever: if the server
    // endpoint does not respond within 6s, fall through so the user still sees
    // what state they're in instead of a permanent spinner.
    useEffect(() => {
        if (loading && user) {
            const timer = setTimeout(() => setLoading(false), 6000);
            return () => clearTimeout(timer);
        }
    }, [loading, user]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
                <div className="flex items-center gap-3 text-muted-foreground">
                    <span className="animate-spin">⟳</span>
                    <span className="text-sm">Verifying Pro access...</span>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <AccountShell
                title="Pro Scalping Terminal"
                subtitle="The full chart, overlays, replay, order flow, intelligence and journal"
                onBack={() => void router.push("/account")}
            >
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
                    <Lock className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Sign in to open the Pro Scalping Terminal</p>
                    <a
                        href="/login?redirect=/account/scalping-terminal"
                        className="rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
                    >
                        Sign In
                    </a>
                </div>
            </AccountShell>
        );
    }

    if (!hasPro) {
        return (
            <AccountShell
                title="Pro Scalping Terminal"
                subtitle="The full chart, overlays, replay, order flow, intelligence and journal"
                onBack={() => void router.push("/account")}
            >
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
                    <span className="text-amber-400">&#128274;</span>
                    <h3 className="text-xl font-semibold text-foreground">Pro Scalping Terminal</h3>
                    <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
                        The Pro terminal is reserved for paid subscribers. It adds the full chart, Smart
                        Money overlays, replay, order flow, intelligence fabric and a trade journal tied
                        to every signal.
                    </p>
                    <div className="flex flex-wrap justify-center gap-3">
                        <a href="/account/subscribe" className="rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90">
                            Upgrade to Pro
                        </a>
                        <a href="/pricing" className="rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted">
                            View pricing
                        </a>
                    </div>
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell
            title="Pro Scalping Terminal"
            subtitle="Full chart + overlays + replay + order flow + intelligence + journal"
            onBack={() => void router.push("/account")}
            hideSidebar
            fullscreen
        >
            <ProScalpingTerminal />
        </AccountShell>
    );
}

export { ProScalpingTerminal };
