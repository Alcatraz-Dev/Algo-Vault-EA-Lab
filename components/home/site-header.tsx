"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    BarChart3,
    CreditCard,
    FileKey2,
    Gift,
    LineChart,
    LogOut,
    Menu,
    Settings,
    Sparkles,
    Wallet,
    X,
} from "lucide-react";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import { onSubscriptionChange } from "@/lib/subscription";
import SiteLogo from "@/components/ui/site-logo";
import ThemeToggle from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type SiteSettings = {
    siteName?: string;
};

const publicLinks: { href: string; label: string; badge?: string }[] = [
    { href: "/marketplace", label: "Marketplace" },
    { href: "/backtests", label: "Backtests" },
    { href: "/live", label: "Live", badge: "●" },
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
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const desktopContent = document.querySelector<HTMLElement>("[data-desktop-content]");
        const scrollTarget: EventTarget = desktopContent ?? window;
        const onScroll = () =>
            setScrolled(desktopContent ? desktopContent.scrollTop > 8 : window.scrollY > 8);
        onScroll();
        scrollTarget.addEventListener("scroll", onScroll, { passive: true });
        return () => scrollTarget.removeEventListener("scroll", onScroll);
    }, []);

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
        <header
            data-home-site-header=""
            className={`sticky top-0 z-50 border-b border-border bg-background/90 text-foreground backdrop-blur-md transition-shadow duration-200 motion-reduce:transition-none ${scrolled ? "shadow-md" : "shadow-none"}`}
        >            <div className="mx-auto flex min-h-14 w-full max-w-350 items-center justify-between gap-6">
                <Link href="/" className="flex shrink-0 items-center gap-3">
                    <SiteLogo size={19} />
                    <div className="flex items-center gap-2 font-semibold tracking-tight text-foreground">
                        {siteName}
                        {hasPro && (
                            <Badge
                                variant="outline"
                                className="border-primary/40 bg-accent-muted px-2 font-bold text-primary"
                            >
                                PRO
                            </Badge>
                        )}
                    </div>
                </Link>

                <nav className="hidden items-center gap-5 text-sm text-muted-foreground xl:flex">
                    {publicLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={`transition hover:text-foreground ${isActive(link.href) ? "text-foreground font-medium" : ""} inline-flex items-center gap-1`}
                        >
                            {link.label}
                            {link.badge && (
                                <span className="h-1.5 w-1.5 rounded-full bg-positive animate-pulse motion-reduce:animate-none" />
                            )}
                        </Link>
                    ))}
                </nav>
                <div className="flex shrink-0 items-center gap-2">
                    <ThemeToggle />
                    {user ? (
                        <div className="hidden items-center gap-2 md:flex">
                            <Button render={<Link href="/account" />} variant="ghost" className="text-muted-foreground hover:text-foreground">
                                Account
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleSignOut}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                Sign out
                            </Button>
                        </div>
                    ) : (
                        <>
                            <Button
                                render={<Link href="/login" />}
                                variant="ghost"
                                className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
                            >
                                Sign in
                            </Button>
                            <Button
                                render={<Link href="/register" />}
                                className="hidden md:inline-flex"
                            >
                                Get Started
                            </Button>
                        </>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setOpen((v) => !v)}
                        className="h-9 w-9 rounded-full border-border text-muted-foreground hover:border-primary/50 hover:text-foreground xl:hidden"
                        aria-label="Toggle navigation menu"
                    >
                        {open ? <X size={18} /> : <Menu size={18} />}
                    </Button>
                </div>
            </div>

            {open && (
                <div className="border-t border-border bg-background px-6 py-4 xl:hidden">
                    <nav>
                        <ul className="menu menu-sm w-full p-0">
                            {publicLinks.map((link) => (
                                <li key={link.href}>
                                    <Link
                                        href={link.href}
                                        onClick={() => setOpen(false)}
                                        aria-current={isActive(link.href) ? "page" : undefined}
                                        className={isActive(link.href) ? "menu-active font-medium" : "text-muted-foreground"}
                                    >
                                        <span>{link.label}</span>
                                        {link.badge && (
                                            <span className="h-1.5 w-1.5 rounded-full bg-positive animate-pulse motion-reduce:animate-none" />
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        {user && (
                            <>
                                <div className="mt-2 border-t border-border pt-2">
                                    <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Account
                                    </p>
                                </div>
                                <ul className="menu menu-sm w-full p-0">
                                    {accountLinks.map((link) => (
                                        <li key={link.href}>
                                            <Link
                                                href={link.href}
                                                onClick={() => setOpen(false)}
                                                aria-current={isActive(link.href) ? "page" : undefined}
                                                className={isActive(link.href) ? "menu-active font-medium" : "text-muted-foreground"}
                                            >
                                                <link.icon size={15} />
                                                <span>{link.label}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        <div className="mt-3 flex gap-2 px-1">
                            {user ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleSignOut}
                                    className="h-10 flex-1"
                                >
                                    <LogOut size={15} />
                                    Sign out
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        render={<Link href="/login" />}
                                        variant="outline"
                                        onClick={() => setOpen(false)}
                                        className="h-10 flex-1"
                                    >
                                        Sign in
                                    </Button>
                                    <Button
                                        render={<Link href="/register" />}
                                        onClick={() => setOpen(false)}
                                        className="h-10 flex-1"
                                    >
                                        Get Started
                                    </Button>
                                </>
                            )}
                        </div>
                    </nav>
                </div>
            )}
        </header>
    );
}
