"use client";

import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ProScalpingTerminal } from "@/components/pro-scalping-terminal/ProScalpingTerminal";
import AdminShell from "@/components/admin/AdminShell";

/**
 * Admin scalping terminal — the same real terminal the account side gets,
 * mounted inside the admin shell. Admin accounts bypass the Pro gate on the
 * radar / signals / analysis endpoints server-side, so every panel works with
 * the admin's own credentials.
 */
export default function AdminScalpingPage() {
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
        <AdminShell title="Scalping Terminal" subtitle="Live radar, signals, MTF intelligence and replay">
            {loading ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Terminal className="mr-2 size-4 animate-pulse" />
                    Loading terminal…
                </div>
            ) : !user ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-10 text-center">
                    <Terminal className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Admin sign-in required</p>
                    <a
                        href="/login?redirect=/admin/scalping"
                        className="rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
                    >
                        Sign In
                    </a>
                </div>
            ) : (
                <ProScalpingTerminal />
            )}
        </AdminShell>
    );
}
