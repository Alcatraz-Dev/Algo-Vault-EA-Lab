"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Terminal } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";

export default function AccountScalpingTerminalLitePage() {
    const router = useRouter();
    const [user, setUser] = useState<FirebaseUser | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    if (!user) {
        return (
            <AccountShell
                title="Free Scalping Terminal (Lite)"
                subtitle="Live radar + signals + engine feed — free forever"
                onBack={() => void router.push("/account")}
            >
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-10 text-center">
                    <Lock className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Sign in to open the Lite terminal</p>
                    <a
                        href="/login?redirect=/account/scalping-terminal-lite"
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
            title="Free Scalping Terminal (Lite)"
            subtitle="Live radar + signals + engine feed — free forever"
            onBack={() => void router.push("/account")}
            eyebrow={
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Lite
                </span>
            }
        >
            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-8 text-center">
                <Terminal className="size-8 text-primary" />
                <p className="text-sm font-medium text-foreground">Free Scalping Terminal (Lite)</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                    Live radar, qualifying signals and the deterministic engine feed — free forever.
                </p>
                <a
                    href="/scalping-terminal"
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                >
                    Open Lite Terminal
                </a>
            </div>
        </AccountShell>
    );
}
