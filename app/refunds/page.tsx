"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";

export default function RefundPolicyPage() {
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        const settingsRef = ref(database, "settings/siteName");
        const unsub = onValue(settingsRef, (snap) => {
            const val = snap.val();
            if (val && typeof val === "string") setSiteName(val);
        });
        return () => unsub();
    }, []);

    const lastUpdated = "September 13, 2026";

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-3xl px-6 py-16 md:px-8">
                <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition">
                    &larr; Back to Home
                </Link>

                <h1 className="mt-8 text-3xl font-bold">Refund Policy</h1>
                <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>

                <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground/80">
                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">1. General Policy</h2>
                        <p>
                            We want you to be satisfied with your purchase from {siteName}. Due to the digital
                            nature of our products (software, Expert Advisors, and trading tools), refunds
                            are handled according to the conditions outlined below.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">2. Eligibility for Refund</h2>
                        <p>You may be eligible for a full refund if:</p>
                        <ul className="list-disc list-inside space-y-1.5 mt-2">
                            <li>You request a refund within <strong>14 days</strong> of your initial purchase.</li>
                            <li>The EA product has a demonstrable technical defect that prevents it from functioning, and our support team is unable to resolve it within a reasonable timeframe.</li>
                            <li>You were charged incorrectly or experienced a duplicate charge.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">3. Non-Refundable Situations</h2>
                        <p>Refunds will <strong>not</strong> be issued in the following cases:</p>
                        <ul className="list-disc list-inside space-y-1.5 mt-2">
                            <li>Requests made more than 14 days after purchase.</li>
                            <li>Losses incurred from trading activities or EA performance.</li>
                            <li>Change of mind after the EA has been downloaded and used.</li>
                            <li>Subscription-based services after the billing period has started.</li>
                            <li>Donations or voluntary contributions.</li>
                            <li>Products purchased during sales or promotional events (unless defective).</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">4. How to Request a Refund</h2>
                        <ol className="list-decimal list-inside space-y-1.5">
                            <li>Contact our support team via the platform or email.</li>
                            <li>Provide your order number and the email used for purchase.</li>
                            <li>Describe the reason for your refund request.</li>
                            <li>Our team will review your request within <strong>3 business days</strong>.</li>
                            <li>If approved, the refund will be processed to your original payment method within <strong>5-10 business days</strong>.</li>
                        </ol>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">5. Subscriptions &amp; Recurring Payments</h2>
                        <ul className="list-disc list-inside space-y-1.5">
                            <li>You may cancel your subscription at any time from your account settings.</li>
                            <li>Cancellation takes effect at the end of the current billing period.</li>
                            <li>No partial refunds are issued for unused portions of a billing period.</li>
                            <li>If you experience a billing error, contact us within 7 days for correction.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">6. Chargebacks</h2>
                        <p>
                            We encourage you to contact us directly before initiating a chargeback with your
                            bank. Chargebacks without prior contact may result in suspension of your account
                            and licenses. We are committed to resolving issues promptly and fairly.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">7. License Revocation</h2>
                        <p>
                            Upon a successful refund, your product license will be immediately revoked and
                            you must cease use of the EA and any associated materials.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">8. Contact</h2>
                        <p>
                            For refund requests or questions about this policy, please reach out through
                            the platform support channels or email our support team.
                        </p>
                    </section>
                </div>

                <div className="mt-12 border-t border-border pt-6 text-center">
                    <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition">
                        &larr; Return to {siteName}
                    </Link>
                </div>
            </div>
        </div>
    );
}
