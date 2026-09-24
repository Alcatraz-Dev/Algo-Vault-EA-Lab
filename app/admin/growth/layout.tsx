"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
    BarChart3,
    ClipboardCheck,
    FileText,
    FlaskConical,
    LayoutDashboard,
    Lightbulb,
    Megaphone,
    Radio,
    ShieldCheck,
    Workflow,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { cn } from "@/lib/utils";

const SECTIONS = [
    { label: "Overview", href: "/admin/growth", icon: LayoutDashboard },
    { label: "Campaigns", href: "/admin/growth/campaigns", icon: Megaphone },
    { label: "Content", href: "/admin/growth/content", icon: FileText },
    { label: "Channels", href: "/admin/growth/channels", icon: Radio },
    { label: "Opportunities", href: "/admin/growth/opportunities", icon: Lightbulb },
    { label: "Loop", href: "/admin/growth/loop", icon: Workflow },
    { label: "Workflows", href: "/admin/growth/workflows", icon: ClipboardCheck },
    { label: "Approvals", href: "/admin/growth/approvals", icon: ShieldCheck },
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
                className="mb-6 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                                "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition",
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