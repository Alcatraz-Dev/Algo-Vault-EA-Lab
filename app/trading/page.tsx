"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TradingRedirectPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/account/trading");
    }, [router]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
            Redirecting to Trading Terminal…
        </div>
    );
}
