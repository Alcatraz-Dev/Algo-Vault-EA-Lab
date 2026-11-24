"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database, isFirebaseClientConfigured } from "@/lib/firebase";

type AdminGuardProps = {
    children: ReactNode;
};

export default function AdminGuard({
    children,
}: AdminGuardProps) {
    const router = useRouter();

    const [checking, setChecking] = useState(true);
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        if (!isFirebaseClientConfigured()) return;

        let unsubscribeProfile: (() => void) | null = null;

        const unsubscribeAuth = onAuthStateChanged(
            auth,
            (user) => {
                if (!user) {
                    router.replace("/login");
                    return;
                }

                const userRef = ref(
                    database,
                    `users/${user.uid}`
                );

                unsubscribeProfile = onValue(
                    userRef,
                    (snapshot) => {
                        if (!snapshot.exists()) {
                            router.replace("/account");
                            return;
                        }

                        const profile = snapshot.val();

                        if (profile?.role !== "admin") {
                            router.replace("/account");
                            return;
                        }

                        setAllowed(true);
                        setChecking(false);
                    },
                    (error) => {
                        console.error(
                            "ADMIN ROLE CHECK ERROR:",
                            error
                        );

                        router.replace("/account");
                    }
                );
            }
        );

        return () => {
            unsubscribeAuth();

            if (unsubscribeProfile) {
                unsubscribeProfile();
            }
        };
    }, [router]);

    // Without Firebase there is no way to prove an admin role. Never render the
    // protected children — and say why instead of spinning forever.
    if (!isFirebaseClientConfigured()) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
                <p className="text-center text-sm text-muted-foreground">
                    Firebase is not configured in this environment.
                </p>
            </main>
        );
    }

    if (checking || !allowed) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border/40 border-t-white" />

                    <p className="mt-4 text-sm text-foreground/70">
                        Checking permissions...
                    </p>
                </div>
            </main>
        );
    }

    return <>{children}</>;
}