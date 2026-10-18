"use client";

import { useEffect, useState } from "react";
import { database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteHeader from "@/components/home/site-header";
import SiteFooter from "@/components/footer/SiteFooter";
import ModernPageHeader from "@/components/ui/modern-page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

const SECTIONS = [
    { id: "introduction", num: "1", title: "Introduction" },
    { id: "information-we-collect", num: "2", title: "Information We Collect" },
    { id: "how-we-use", num: "3", title: "How We Use Your Information" },
    { id: "data-sharing", num: "4", title: "Data Sharing" },
    { id: "data-security", num: "5", title: "Data Security" },
    { id: "data-retention", num: "6", title: "Data Retention" },
    { id: "your-rights", num: "7", title: "Your Rights" },
    { id: "cookies", num: "8", title: "Cookies" },
    { id: "childrens-privacy", num: "9", title: "Children's Privacy" },
    { id: "changes", num: "10", title: "Changes to This Policy" },
    { id: "contact", num: "11", title: "Contact Us" },
] as const;

function SectionNav({ compact = false }: { compact?: boolean }) {
    return (
        <nav aria-label="Privacy policy sections">
            <ol className={compact ? "flex flex-wrap gap-1.5" : "space-y-0.5"}>
                {SECTIONS.map((s) => (
                    <li key={s.id}>
                        <a
                            href={`#${s.id}`}
                            className={
                                compact
                                    ? "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                    : "flex items-baseline gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            }
                        >
                            <span className="font-mono text-xs text-muted-foreground/70">
                                {s.num}
                            </span>
                            <span>{s.title}</span>
                        </a>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

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

    const lastUpdated = "October 18, 2026";

    return (
        <>
            <SiteHeader />
            <main className="min-h-screen bg-background text-foreground">
                <div className="mx-auto max-w-7xl px-6 pt-4 pb-20">
                    <ModernPageHeader
                        backHref="/"
                        backLabel="Home"
                        eyebrow="Legal"
                        title="Privacy Policy"
                        subtitle={`How ${siteName} collects, uses, and safeguards your information across the website, trading tools, Expert Advisors, and the Chrome extension. Last updated: ${lastUpdated}.`}
                        actions={
                            <Badge variant="outline" className="h-7 gap-1.5 px-3 text-muted-foreground">
                                <ShieldCheck size={14} />
                                No sale of personal data
                            </Badge>
                        }
                    />

                    {/* Compact section nav for small screens */}
                    <div className="mt-6 lg:hidden">
                        <SectionNav compact />
                    </div>

                    <div className="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
                        {/* Sidebar section nav */}
                        <aside className="hidden lg:block">
                            <div className="sticky top-20">
                                <Card className="rounded-xl border-border bg-card p-3 shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                                    <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        On this page
                                    </p>
                                    <SectionNav />
                                </Card>
                            </div>
                        </aside>

                        {/* Policy content — readable line length inside the full-width grid */}
                        <Card className="rounded-xl border-border bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.05)] sm:p-8">
                            <div className="max-w-3xl space-y-8 text-sm leading-relaxed text-foreground/80">
                                <section id="introduction" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">1. Introduction</h2>
                                    <p>
                                        Welcome to {siteName} (&quot;Platform&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). We are committed to
                                        protecting your privacy. This Privacy Policy explains how we collect, use, disclose,
                                        and safeguard your information when you use our platform, including our website, services,
                                        trading tools, and Expert Advisors (EAs) for MetaTrader 5.
                                    </p>
                                </section>

                                <section id="information-we-collect" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">2. Information We Collect</h2>
                                    <div className="space-y-4">
                                        <div>
                                            <h3 className="font-medium text-foreground">Account Information</h3>
                                            <p className="mt-1">
                                                When you register an account, we collect your email address, display name, and
                                                password (stored securely via Firebase Authentication). We do not store raw
                                                passwords.
                                            </p>
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-foreground">Payment Information</h3>
                                            <p className="mt-1">
                                                Payments are processed through Stripe. We do not store your credit card number,
                                                CVV, or billing address on our servers. Stripe handles payment data in accordance
                                                with PCI-DSS standards.
                                            </p>
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-foreground">Trading Data</h3>
                                            <p className="mt-1">
                                                When you use the Gateway EA or connect an MT5 account, we receive your MT5
                                                account number, broker name, server, balance, equity, open positions, and
                                                trade history. This data is used solely to provide the trading terminal and
                                                performance tracking features.
                                            </p>
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-foreground">Usage Data</h3>
                                            <p className="mt-1">
                                                We may collect anonymized usage analytics including page views, feature usage,
                                                and error logs to improve the platform.
                                            </p>
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-foreground">Browser Extension Data</h3>
                                            <p className="mt-1">
                                                Our Chrome extension (AlgoVault Trading Intelligence) runs alongside
                                                TradingView charts. When you use it, the extension reads the active
                                                chart&apos;s symbol, timeframe, and visible price context so it can show
                                                market analysis, and it transmits that chart context, your AI
                                                copilot messages, and your authentication token to our servers
                                                to generate AI analysis, signals, and alerts. AI copilot conversations, price alerts, and extension
                                                settings are stored locally in your browser (chrome.storage); a random
                                                install identifier is synced via your Chrome profile solely to enforce
                                                the free daily-signal quota across reinstalls. The extension never
                                                reads your browsing history outside TradingView tabs, and never
                                                handles broker passwords or API secrets &mdash; trade execution is
                                                authenticated with your AlgoVault session and validated server-side.
                                            </p>
                                        </div>
                                    </div>
                                </section>

                                <section id="how-we-use" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">3. How We Use Your Information</h2>
                                    <ul className="list-disc space-y-1.5 pl-5">
                                        <li>To provide and maintain our services</li>
                                        <li>To process transactions and manage licenses</li>
                                        <li>To enable MT5 account connectivity via the Gateway EA</li>
                                        <li>To display trading performance and analytics</li>
                                        <li>To send transactional emails (license confirmations, receipts)</li>
                                        <li>To detect and prevent fraud or abuse</li>
                                        <li>To comply with legal obligations</li>
                                    </ul>
                                </section>

                                <section id="data-sharing" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">4. Data Sharing</h2>
                                    <p>
                                        We do not sell, trade, or rent your personal information to third parties. We may
                                        share data with:
                                    </p>
                                    <ul className="mt-2 list-disc space-y-1.5 pl-5">
                                        <li><strong>Stripe</strong> &mdash; for payment processing</li>
                                        <li><strong>Firebase (Google)</strong> &mdash; for authentication and database hosting</li>
                                        <li><strong>Discord / Telegram</strong> &mdash; only if you voluntarily connect these services for notifications</li>
                                    </ul>
                                </section>

                                <section id="data-security" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">5. Data Security</h2>
                                    <p>
                                        We implement industry-standard security measures including encrypted data transmission
                                        (TLS), secure authentication via Firebase, and server-side validation for all
                                        sensitive operations. However, no method of transmission over the Internet is 100%
                                        secure.
                                    </p>
                                </section>

                                <section id="data-retention" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">6. Data Retention</h2>
                                    <p>
                                        We retain your account information for as long as your account is active. Trading
                                        data and performance records may be retained for analytical purposes. You may
                                        request deletion of your account and associated data by contacting support.
                                    </p>
                                </section>

                                <section id="your-rights" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">7. Your Rights</h2>
                                    <ul className="list-disc space-y-1.5 pl-5">
                                        <li>Access your personal data</li>
                                        <li>Request correction of inaccurate data</li>
                                        <li>Request deletion of your data</li>
                                        <li>Export your data in a portable format</li>
                                        <li>Opt out of non-essential data collection</li>
                                    </ul>
                                </section>

                                <section id="cookies" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">8. Cookies</h2>
                                    <p>
                                        We use essential cookies for authentication and session management. We do not use
                                        third-party advertising cookies.
                                    </p>
                                </section>

                                <section id="childrens-privacy" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">9. Children&apos;s Privacy</h2>
                                    <p>
                                        Our services are not directed to individuals under the age of 18. We do not
                                        knowingly collect personal information from children.
                                    </p>
                                </section>

                                <section id="changes" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">10. Changes to This Policy</h2>
                                    <p>
                                        We may update this Privacy Policy from time to time. We will notify you of any
                                        material changes by posting the new policy on this page with an updated &quot;Last
                                        updated&quot; date.
                                    </p>
                                </section>

                                <section id="contact" className="scroll-mt-24">
                                    <h2 className="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">11. Contact Us</h2>
                                    <p>
                                        If you have any questions about this Privacy Policy, please contact us through
                                        the platform or email our support team.
                                    </p>
                                </section>
                            </div>
                        </Card>
                    </div>
                </div>
            </main>
            <SiteFooter />
        </>
    );
}
