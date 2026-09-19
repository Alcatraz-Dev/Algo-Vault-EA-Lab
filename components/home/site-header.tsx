"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    Bot,
    BarChart3,
    CreditCard,
    FileKey2,
    Gift,
    LineChart,
    LogOut,
    Menu,
    Radio,
    Settings,
    Sparkles,
    Wallet,
    X,
    Crown,
} from "lucide-react";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import { onSubscriptionChange } from "@/lib/subscription";
import SiteLogo from "@/components/ui/site-logo";
import ThemeToggle from "@/components/theme/theme-toggle";

type SiteSettings = {
    siteName?: string;
};

const publicLinks = [
    { href: "/marketplace", label: "Marketplace" },
    { href: "/backtests", label: "Backtests" },
    { href: "/live", label: "Live" },
    { href: "/copy-trading", label: "Copy Trading" },
    { href: "/compare", label: "Compare Brokers" },
    { href: "/affiliates", label: "Affiliates" },
    { href: "/pricing", label: "Pricing" },
];

const accountLinks = [
    { icon: CreditCard, label: "Purchases", href: "/account/purchases" },
    { icon: FileKey2, label: "Licenses", href: "/account/licenses" },
    { icon: Sparkles, label: "TradingView", href: "/account/tradingview" },
    { icon: LineChart, label: "Live", href: "/live" },
    { icon: BarChart3, label: "Backtests", href: "/backtests" },
    { icon: Wallet, label: "Brokers", href: "/compare" },
    { icon: Gift, label: "Affiliates", href: "/account/affiliate" },
    { icon: Settings, label: "Settings", href: "/account/settings" },
];

export default function SiteHeader() {
    const pathname = usePathname();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [settings, setSettings] = useState<SiteSettings>({});
    const [user, setUser] = useState<User | null>(null);
    const [hasPro, setHasPro] = useState(false);

    useEffect(() => {
        const unsubscribe = onValue(ref(database, "settings"), (snapshot) => {
            const data = snapshot.val();
            if (data && typeof data === "object") {
                setSettings(data);
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        return onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) setHasPro(false);
        });
    }, []);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        onSubscriptionChange(user.uid).then(({ hasSubscription }) => {
            if (!cancelled) setHasPro(hasSubscription);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [user]);

    const siteName = settings.siteName || "AlgoVault";

    const isActive = (href: string) => {
        if (href === "/account") return pathname === "/account";
        return pathname?.startsWith(href) ?? false;
    };

    async function handleSignOut() {
        await signOut(auth);
        router.push("/");
        setOpen(false);
    }

    return (
        <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                <Link href="/" className="flex items-center gap-3">
                    <SiteLogo size={19} />
                    <div className="flex items-center gap-2 font-semibold tracking-tight">
                        {siteName}
                        {hasPro && (
                            <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold text-foreground">
                                PRO
                            </span>
                        )}
                    </div>
                </Link>

                <nav className="hidden items-center gap-7 text-sm text-muted-foreground xl:flex">
                    {publicLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={`transition hover:text-foreground ${isActive(link.href) ? "text-foreground font-medium" : ""}`}
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>

                <div className="flex items-center gap-3">
                    <ThemeToggle />
                    {user ? (
                        <div className="hidden items-center gap-2 md:flex">
                            <Link
                                href="/account"
                                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                            >
                                Account
                            </Link>
                            <button
                                type="button"
                                onClick={handleSignOut}
                                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                            >
                                Sign out
                            </button>
                        </div>
                    ) : (
                        <>
                            <Link
                                href="/login"
                                className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground md:block"
                            >
                                Sign in
                            </Link>
                            <Link
                                href="/register"
                                className="hidden rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2 text-sm font-semibold text-foreground shadow-lg shadow-violet-500/20 transition hover:from-violet-500 hover:to-violet-400 md:block"
                            >
                                Get Started
                            </Link>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground xl:hidden"
                        aria-label="Toggle navigation menu"
                    >
                        {open ? <X size={18} /> : <Menu size={18} />}
                    </button>
                </div>
            </div>

            {open && (
                <div className="border-t border-border bg-background px-6 py-4 lg:hidden">
                    <nav className="flex flex-col gap-1">
                        {publicLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={() => setOpen(false)}
                                className={`rounded-lg px-3 py-2.5 text-sm transition hover:bg-muted hover:text-foreground ${isActive(link.href) ? "bg-muted text-foreground font-medium" : "text-muted-foreground"}`}
                            >
                                {link.label}
                            </Link>
                        ))}
                        {user && (
                            <>
                                <div className="my-2 border-t border-border pt-2">
                                    <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Account
                                    </p>
                                </div>
                                {accountLinks.map((link) => (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        onClick={() => setOpen(false)}
                                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-muted hover:text-foreground ${isActive(link.href) ? "bg-muted text-foreground font-medium" : "text-muted-foreground"}`}
                                    >
                                        <link.icon size={15} />
                                        {link.label}
                                    </Link>
                                ))}
                                <div className="my-2 border-t border-border pt-2" />
                            </>
                        )}
                        <div className="mt-2 flex gap-2">
                            {user ? (
                                <button
                                    type="button"
                                    onClick={handleSignOut}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground"
                                >
                                    <LogOut size={15} />
                                    Sign out
                                </button>
                            ) : (
                                <>
                                    <Link
                                        href="/login"
                                        className="flex-1 rounded-lg border border-border px-3 py-2.5 text-center text-sm text-muted-foreground"
                                    >
                                        Sign in
                                    </Link>
                                    <Link
                                        href="/register"
                                        className="flex-1 rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 px-3 py-2.5 text-center text-sm font-semibold text-foreground shadow-lg shadow-violet-500/20"
                                    >
                                        Get Started
                                    </Link>
                                </>
                            )}
                        </div>
                    </nav>
                </div>
            )}
        </header>
    );
}
