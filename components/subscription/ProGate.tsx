"use client";

import { useEffect, useState } from "react";
import { Lock, Zap } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";

export default function ProGate({
    children,
}: {
    children: React.ReactNode;
}) {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasPro, setHasPro] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) {
                setLoading(false);
            }
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) {
            return;
        }

        const checkSubscription = async () => {
            try {
                const { hasSubscription } = await onSubscriptionChange(user.uid);
                setHasPro(hasSubscription);
            } catch {
                setHasPro(false);
            } finally {
                setLoading(false);
            }
        };

        checkSubscription();
    }, [user]);

    if (loading) {
        return (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-muted/30 p-10">
                <Zap className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-muted/30 p-10 text-center">
                <Lock className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">Sign in to access this feature</h3>
                <p className="mt-2 text-sm text-muted-foreground">Pro features require an active subscription.</p>
                <a href="/login?redirect=/account/subscribe" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90">
                    Sign In
                </a>
            </div>
        );
    }

    if (!hasPro) {
        return (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-muted/30 p-10 text-center">
                <Lock className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">Pro Feature</h3>
                <p className="mt-2 text-sm text-muted-foreground">This feature requires a Pro or Enterprise subscription.</p>
                <a href="/account/subscribe" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90">
                    Upgrade Now
                </a>
            </div>
        );
    }

    return <>{children}</>;
}