"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { FooterNativeAd } from "@/components/growth/FooterNativeAd";
import { FooterAffiliateLink } from "@/components/growth/FooterAffiliateLink";

import SiteLogo from "@/components/ui/site-logo";

export default function SiteFooter() {
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        const settingsRef = ref(database, "settings/siteName");
        const unsub = onValue(settingsRef, (snap) => {
            const val = snap.val();
            if (val && typeof val === "string") setSiteName(val);
        });
        return () => unsub();
    }, []);

    const currentYear = new Date().getFullYear();

    return (
        <footer className="border-t border-border bg-background">
            <div className="mx-auto max-w-7xl px-6 pt-6 md:px-8">
                <FooterNativeAd />
                <FooterAffiliateLink />
            </div>
            <div className="mx-auto max-w-7xl px-6 py-12 md:px-8">
                <div className="footer">
                    <div>
                        <div className="flex items-center gap-2">
                            <SiteLogo size={22} />
                            <span className="text-sm font-bold">{siteName}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                            Research, validation, and risk-gated execution for MetaTrader 5.
                        </p>
                        <p className="mt-3 max-w-56 text-xs leading-5 text-muted-foreground">
                            Trading involves risk. Research tooling — never financial advice or a promise of profit.
                        </p>
                    </div>

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Research
                        </p>
                        <ul className="space-y-2">
                            <li>
                                <Link href="/strategy-lab" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Strategy Lab
                                </Link>
                            </li>
                            <li>
                                <Link href="/scanner" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Market Scanner
                                </Link>
                            </li>
                            <li>
                                <Link href="/market-intelligence" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Market Intelligence
                                </Link>
                            </li>
                            <li>
                                <Link href="/signals" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Signals
                                </Link>
                            </li>
                            <li>
                                <Link href="/live" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Live Console
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Platform
                        </p>
                        <ul className="space-y-2">
                            <li>
                                <Link href="/marketplace" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Marketplace
                                </Link>
                            </li>
                            <li>
                                <Link href="/account/live" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Live Performance
                                </Link>
                            </li>
                            <li>
                                <Link href="/backtests" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Backtests
                                </Link>
                            </li>
                            <li>
                                <Link href="/pricing" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Pricing
                                </Link>
                            </li>
                            <li>
                                <Link href="/how-it-works" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    How It Works
                                </Link>
                            </li>
                            <li>
                                <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Desktop App
                                </Link>
                            </li>
                            <li>
                                <Link href="/docs" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Documentation
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Roadmap (Upcoming)
                        </p>
                        <ul className="space-y-2">
                            <li>
                                <span className="text-xs text-muted-foreground">Developer Platform</span>
                            </li>
                            <li>
                                <span className="text-xs text-muted-foreground">MCP Integrations</span>
                            </li>
                            <li>
                                <span className="text-xs text-muted-foreground">SDKs & API</span>
                            </li>
                            <li>
                                <span className="text-xs text-muted-foreground">Automation & Webhooks</span>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Account
                        </p>
                        <ul className="space-y-2">
                            <li>
                                <Link href="/account/purchases" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Purchases
                                </Link>
                            </li>
                            <li>
                                <Link href="/account/licenses" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Licenses
                                </Link>
                            </li>
                            <li>
                                <Link href="/account/settings" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Settings
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Resources
                        </p>
                        <ul className="space-y-2">
                            <li>
                                <Link href="/copy-trading" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Copy Trading
                                </Link>
                            </li>
                            <li>
                                <Link href="/compare" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Compare Brokers
                                </Link>
                            </li>
                            <li>
                                <Link href="/affiliates" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Affiliates
                                </Link>
                            </li>
                            <li>
                                <Link href="/docs" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Documentation
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Legal
                        </p>
                        <ul className="space-y-2">
                            <li>
                                <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Privacy Policy
                                </Link>
                            </li>
                            <li>
                                <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Terms &amp; Conditions
                                </Link>
                            </li>
                            <li>
                                <Link href="/refunds" className="text-xs text-muted-foreground hover:text-foreground transition">
                                    Refund Policy
                                </Link>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="mt-10 border-t border-border pt-6 flex flex-col items-center justify-between gap-3 sm:flex-row">
                    <p className="text-xs text-muted-foreground">
                        &copy; {currentYear} {siteName}. All rights reserved.
                    </p>
                    <div className="flex gap-4">
                        <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">
                            Privacy
                        </Link>
                        <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">
                            Terms
                        </Link>
                        <Link href="/refunds" className="text-xs text-muted-foreground hover:text-foreground transition">
                            Refunds
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
