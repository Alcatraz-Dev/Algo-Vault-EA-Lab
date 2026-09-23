"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
    CreditCard,
    DollarSign,
    Globe,
    LayoutDashboard,
    Megaphone,
    MousePointer,
    Settings,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { cn } from "@/lib/utils";

const SECTIONS = [
    { label: "Overview", href: "/admin/monetization", icon: LayoutDashboard },
    { label: "Ad Networks", href: "/admin/monetization/ad-networks", icon: Globe },
    { label: "Placements", href: "/admin/monetization/placements", icon: MousePointer },
    { label: "Ads", href: "/admin/monetization/ads", icon: Megaphone },
    { label: "Affiliate", href: "/admin/monetization/affiliate", icon: CreditCard },
    { label: "Revenue", href: "/admin/monetization/revenue", icon: DollarSign },
    { label: "Settings", href: "/admin/monetization/settings", icon: Settings },
];

/**
 * Monetization admin shell. AdminShell owns the app navigation; this layout adds
 * the section tab bar as the ONLY in-content navigation control. Pages below
 * this layout must not render their own shell or back links.
 */
export default function AdminMonetizationLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    return (
        <AdminShell title="Monetization" subtitle="Ad networks, placements, ads, affiliate offers and revenue">
            <nav
                className="mb-6 flex flex-wrap gap-2"
                role="tablist"
                aria-label="Monetization sections"
            >
                {SECTIONS.map((s) => {
                    const active =
                        pathname === s.href || (s.href !== "/admin/monetization" && pathname?.startsWith(`${s.href}/`));
                    return (
                        <Link
                            key={s.href}
                            href={s.href}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition",
                                active
                                    ? "border-border bg-muted/60 text-foreground"
                                    : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                            )}
                        >
                            <s.icon size={14} className={active ? "text-primary" : "text-muted-foreground"} />
                            {s.label}
                        </Link>
                    );
                })}
            </nav>
            {children}
        </AdminShell>
    );
}