"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
    BarChart3,
    FileText,
    FlaskConical,
    LayoutDashboard,
    Megaphone,
    Radio,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { cn } from "@/lib/utils";

const SECTIONS = [
    { label: "Overview", href: "/admin/growth", icon: LayoutDashboard },
    { label: "Campaigns", href: "/admin/growth/campaigns", icon: Megaphone },
    { label: "Content", href: "/admin/growth/content", icon: FileText },
    { label: "Channels", href: "/admin/growth/channels", icon: Radio },
    { label: "Reports", href: "/admin/growth/reports", icon: BarChart3 },
    { label: "Experiments", href: "/admin/growth/experiments", icon: FlaskConical },
];

/**
 * Growth admin shell. AdminShell owns the app navigation; this layout adds the
 * section tab bar as the ONLY in-content navigation control. Pages below this
 * layout must not render their own shell or back links.
 */
export default function AdminGrowthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    return (
        <AdminShell title="Growth" subtitle="Campaigns, content, channels and reports">
            <nav
                className="mb-6 flex flex-wrap gap-2"
                role="tablist"
                aria-label="Growth sections"
            >
                {SECTIONS.map((s) => {
                    const active =
                        pathname === s.href || (s.href !== "/admin/growth" && pathname?.startsWith(`${s.href}/`));
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