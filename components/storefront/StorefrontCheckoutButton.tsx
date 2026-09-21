"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { Loader2 } from "lucide-react";

type Props = {
    accountId: string;
    stripeProductId: string;
    stripePriceId: string;
    mode: "payment" | "subscription";
    label?: string;
    disabled?: boolean;
};

/**
 * Renders a Buy / Subscribe button for a connected-account product on the
 * developer's public storefront. Creates the Checkout Session server-side
 * (`/api/store/checkout`) where the connected account, price and application
 * fee are all verified/computed — the client only supplies references.
 */
export default function StorefrontCheckoutButton({
    accountId,
    stripeProductId,
    stripePriceId,
    mode,
    label,
    disabled,
}: Props) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    async function handleClick() {
        setError("");
        const user = auth.currentUser;
        if (!user) {
            router.push(`/login?redirect=/store/${encodeURIComponent(accountId)}`);
            return;
        }

        setBusy(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/store/checkout", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    accountId,
                    stripeProductId,
                    stripePriceId,
                    mode,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.error || "Unable to start checkout.");
            }
            if (!data.checkoutUrl) {
                throw new Error("Stripe checkout URL was not returned.");
            }
            // Stripe Checkout is external — hard navigation is intended.
            window.location.href = data.checkoutUrl;
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to start payment. Please try again."
            );
            setBusy(false);
        }
    }

    const text =
        label ||
        (mode === "subscription" ? "Subscribe" : "Buy Now");

    return (
        <div className="flex flex-col gap-1.5">
            <button
                type="button"
                onClick={handleClick}
                disabled={busy || disabled}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50"
            >
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                {busy ? "Opening checkout…" : text}
            </button>
            {error ? (
                <p className="text-[11px] text-rose-400">{error}</p>
            ) : null}
        </div>
    );
}