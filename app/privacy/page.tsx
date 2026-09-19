"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";

export default function PrivacyPolicyPage() {
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

                <h1 className="mt-8 text-3xl font-bold">Privacy Policy</h1>
                <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>

                <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground/80">
                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">1. Introduction</h2>
                        <p>
                            Welcome to {siteName} (&quot;Platform&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). We are committed to
                            protecting your privacy. This Privacy Policy explains how we collect, use, disclose,
                            and safeguard your information when you use our platform, including our website, services,
                            trading tools, and Expert Advisors (EAs) for MetaTrader 5.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">2. Information We Collect</h2>
                        <div className="space-y-3">
                            <div>
                                <h3 className="font-medium text-foreground">Account Information</h3>
                                <p>
                                    When you register an account, we collect your email address, display name, and
                                    password (stored securely via Firebase Authentication). We do not store raw
                                    passwords.
                                </p>
                            </div>
                            <div>
                                <h3 className="font-medium text-foreground">Payment Information</h3>
                                <p>
                                    Payments are processed through Stripe. We do not store your credit card number,
                                    CVV, or billing address on our servers. Stripe handles payment data in accordance
                                    with PCI-DSS standards.
                                </p>
                            </div>
                            <div>
                                <h3 className="font-medium text-foreground">Trading Data</h3>
                                <p>
                                    When you use the Gateway EA or connect an MT5 account, we receive your MT5
                                    account number, broker name, server, balance, equity, open positions, and
                                    trade history. This data is used solely to provide the trading terminal and
                                    performance tracking features.
                                </p>
                            </div>
                            <div>
                                <h3 className="font-medium text-foreground">Usage Data</h3>
                                <p>
                                    We may collect anonymized usage analytics including page views, feature usage,
                                    and error logs to improve the platform.
                                </p>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">3. How We Use Your Information</h2>
                        <ul className="list-disc list-inside space-y-1.5">
                            <li>To provide and maintain our services</li>
                            <li>To process transactions and manage licenses</li>
                            <li>To enable MT5 account connectivity via the Gateway EA</li>
                            <li>To display trading performance and analytics</li>
                            <li>To send transactional emails (license confirmations, receipts)</li>
                            <li>To detect and prevent fraud or abuse</li>
                            <li>To comply with legal obligations</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">4. Data Sharing</h2>
                        <p>
                            We do not sell, trade, or rent your personal information to third parties. We may
                            share data with:
                        </p>
                        <ul className="list-disc list-inside space-y-1.5 mt-2">
                            <li><strong>Stripe</strong> &mdash; for payment processing</li>
                            <li><strong>Firebase (Google)</strong> &mdash; for authentication and database hosting</li>
                            <li><strong>Discord / Telegram</strong> &mdash; only if you voluntarily connect these services for notifications</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">5. Data Security</h2>
                        <p>
                            We implement industry-standard security measures including encrypted data transmission
                            (TLS), secure authentication via Firebase, and server-side validation for all
                            sensitive operations. However, no method of transmission over the Internet is 100%
                            secure.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">6. Data Retention</h2>
                        <p>
                            We retain your account information for as long as your account is active. Trading
                            data and performance records may be retained for analytical purposes. You may
                            request deletion of your account and associated data by contacting support.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">7. Your Rights</h2>
                        <ul className="list-disc list-inside space-y-1.5">
                            <li>Access your personal data</li>
                            <li>Request correction of inaccurate data</li>
                            <li>Request deletion of your data</li>
                            <li>Export your data in a portable format</li>
                            <li>Opt out of non-essential data collection</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">8. Cookies</h2>
                        <p>
                            We use essential cookies for authentication and session management. We do not use
                            third-party advertising cookies.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">9. Children&apos;s Privacy</h2>
                        <p>
                            Our services are not directed to individuals under the age of 18. We do not
                            knowingly collect personal information from children.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">10. Changes to This Policy</h2>
                        <p>
                            We may update this Privacy Policy from time to time. We will notify you of any
                            material changes by posting the new policy on this page with an updated &quot;Last
                            updated&quot; date.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">11. Contact Us</h2>
                        <p>
                            If you have any questions about this Privacy Policy, please contact us through
                            the platform or email our support team.
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
