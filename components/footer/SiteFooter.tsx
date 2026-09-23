"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { FooterNativeAd } from "@/components/growth/FooterNativeAd";
import { FooterAffiliateLink } from "@/components/growth/FooterAffiliateLink";

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
                <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
                    <div className="col-span-2 md:col-span-1">
                        <p className="text-sm font-bold">{siteName}</p>
                        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                            Algorithmic trading tools and strategies for MetaTrader 5.
                        </p>
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
                                <Link href="/live" className="text-xs text-muted-foreground hover:text-foreground transition">
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
