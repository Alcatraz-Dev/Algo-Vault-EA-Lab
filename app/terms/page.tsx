"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";

export default function TermsPage() {
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

                <h1 className="mt-8 text-3xl font-bold">Terms &amp; Conditions</h1>
                <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>

                <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground/80">
                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
                        <p>
                            By accessing or using {siteName} (&quot;Platform&quot;), you agree to be bound by these
                            Terms &amp; Conditions. If you do not agree, do not use the Platform.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">2. Description of Service</h2>
                        <p>
                            {siteName} provides algorithmic trading tools, Expert Advisors (EAs) for MetaTrader 5,
                            a web-based trading terminal, performance tracking, copy trading, and related services.
                            We act as a technology platform and do not manage funds or execute trades on your behalf.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">3. Account Registration</h2>
                        <p>
                            You must provide accurate and complete information when creating an account. You are
                            responsible for maintaining the confidentiality of your credentials and for all
                            activities under your account.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">4. Licenses &amp; Purchases</h2>
                        <ul className="list-disc list-inside space-y-1.5">
                            <li>Bot licenses grant access to a specific EA product for your MT5 account.</li>
                            <li>Trading Access licenses grant permission to use the web trading terminal.</li>
                            <li>Licenses are non-transferable and tied to your account.</li>
                            <li>We reserve the right to revoke licenses for terms violations.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">5. Trading Disclaimer</h2>
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 mb-3">
                            <p className="font-medium text-amber-600 dark:text-amber-400">
                                Important Risk Warning
                            </p>
                        </div>
                        <p>
                            Trading financial instruments involves significant risk. Past performance is not
                            indicative of future results. You acknowledge that:
                        </p>
                        <ul className="list-disc list-inside space-y-1.5 mt-2">
                            <li>You may lose some or all of your invested capital.</li>
                            <li>Automated trading systems carry additional risks including software errors and connectivity issues.</li>
                            <li>We do not guarantee any specific returns or trading results.</li>
                            <li>You are solely responsible for your trading decisions.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">6. Prohibited Activities</h2>
                        <p>You agree not to:</p>
                        <ul className="list-disc list-inside space-y-1.5 mt-2">
                            <li>Share, resell, or redistribute our EAs or licenses</li>
                            <li>Reverse engineer, decompile, or disassemble our software</li>
                            <li>Use the Platform for any illegal or unauthorized purpose</li>
                            <li>Attempt to gain unauthorized access to other accounts or systems</li>
                            <li>Interfere with or disrupt the Platform or servers</li>
                            <li>Use automated scripts to abuse the Platform</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">7. Intellectual Property</h2>
                        <p>
                            All content, code, EAs, strategies, and materials on the Platform are the intellectual
                            property of {siteName}. Your purchase grants a limited, non-exclusive license to use
                            the product, not ownership of the underlying intellectual property.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">8. Limitation of Liability</h2>
                        <p>
                            To the maximum extent permitted by law, {siteName} shall not be liable for any
                            indirect, incidental, special, consequential, or punitive damages, including but
                            not limited to loss of profits, data, or trading capital, arising from your use
                            of the Platform.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">9. Indemnification</h2>
                        <p>
                            You agree to indemnify and hold {siteName} harmless from any claims, losses, or
                            damages arising from your use of the Platform or violation of these Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">10. Termination</h2>
                        <p>
                            We may suspend or terminate your access to the Platform at any time, with or
                            without cause, including for terms violations. Upon termination, your license
                            to use the Platform ceases immediately.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">11. Governing Law</h2>
                        <p>
                            These Terms shall be governed by and construed in accordance with applicable laws.
                            Any disputes shall be resolved through good-faith negotiation before pursuing
                            legal remedies.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">12. Changes to Terms</h2>
                        <p>
                            We reserve the right to modify these Terms at any time. Continued use of the
                            Platform after changes constitutes acceptance of the updated Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-3">13. Contact</h2>
                        <p>
                            For questions about these Terms, please contact us through the platform support
                            channels.
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
