"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { Button } from "@/components/ui/button";
import { useAuthToken } from "@/lib/scalping/client";

function VerifyContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = useAuthToken();
    const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const definitionId = searchParams.get("definitionId") || "";
    const orderId = searchParams.get("order") || "";

    const verifyAndStart = useCallback(async () => {
        if (!token || !definitionId) return;
        setStatus("verifying");
        setErrorMsg(null);

        try {
            const res = await fetch("/api/performance-arena/attempts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ definitionId }),
            });

            const body = (await res.json()) as { attempt?: { id: string }; error?: string };

            if (res.ok && body.attempt?.id) {
                setStatus("success");
                setTimeout(() => {
                    router.push(`/account/performance-arena/attempts/${body.attempt!.id}`);
                }, 1200);
            } else {
                setStatus("error");
                setErrorMsg(body.error ?? "Verification in progress. Your payment is confirmed. Click below to start.");
            }
        } catch (err) {
            setStatus("error");
            setErrorMsg(err instanceof Error ? err.message : "Failed to verify challenge purchase.");
        }
    }, [token, definitionId, router]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (token && definitionId) {
                void verifyAndStart();
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [token, definitionId, verifyAndStart]);

    return (
        <div className="mx-auto max-w-lg space-y-6 rounded-xl border border-border bg-card p-8 text-center shadow-lg">
            {status === "verifying" && (
                <div className="space-y-4 py-8">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
                    <h2 className="text-xl font-semibold">Confirming Your Challenge Purchase</h2>
                    <p className="text-sm text-muted-foreground">
                        Order reference: <span className="font-mono">{orderId || "Processing"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Setting up your virtual account, risk metrics, and Challenge Guardian...</p>
                </div>
            )}

            {status === "success" && (
                <div className="space-y-4 py-8">
                    <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
                    <h2 className="text-xl font-semibold text-emerald-500">Challenge Ready!</h2>
                    <p className="text-sm text-muted-foreground">Your virtual capital account has been provisioned. Redirecting to your trading terminal...</p>
                </div>
            )}

            {status === "error" && (
                <div className="space-y-4 py-6">
                    <AlertCircle className="mx-auto h-12 w-12 text-amber-500" />
                    <h2 className="text-xl font-semibold">Payment Received</h2>
                    <p className="text-sm text-muted-foreground">{errorMsg}</p>
                    <div className="flex justify-center gap-3 pt-4">
                        <Button onClick={() => void verifyAndStart()}>Start Challenge Now</Button>
                        <Button variant="outline" onClick={() => router.push("/account/performance-arena")}>
                            View Catalog
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ChallengeVerifyPage() {
    return (
        <AccountShell title="Verifying Challenge Access" subtitle="Confirming your payment and initializing your virtual account.">
            <Suspense fallback={<div className="p-8 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>}>
                <VerifyContent />
            </Suspense>
        </AccountShell>
    );
}
