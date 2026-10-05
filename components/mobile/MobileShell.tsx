"use client";

/**
 * Phase 11 — mobile shell.
 *
 * One navigation bar, five destinations, and a visible sync/freshness indicator.
 * The shell owns no market logic: it renders `MOBILE_TABS` from the navigation
 * model and shows whether the caller's workspace has landed on this device yet.
 *
 * Auth is handled by *navigating*, not by gating: an unauthenticated tab still
 * renders and the destination decides what to show. Hiding tabs behind a spinner
 * produces the "app is broken" feeling that the previous shell had.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOBILE_TABS, tabForPath } from "@/lib/mobile/navigation";
import { useWorkspaceSync } from "@/hooks/use-cross-device-sync";
import type { SyncStatus } from "@/lib/mobile/sync-client";

const STATUS_HINT: Record<SyncStatus, { label: string; tone: string } | null> = {
    idle: null,
    syncing: { label: "Syncing", tone: "text-muted-foreground" },
    offline: { label: "Offline — changes saved on this device", tone: "text-amber-600 dark:text-amber-400" },
    error: { label: "Sync failed — retrying", tone: "text-orange-600 dark:text-orange-400" },
    conflict: { label: "Merged changes from another device", tone: "text-blue-600 dark:text-blue-400" },
};

export function MobileShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() ?? "";
    const activeTab = tabForPath(pathname);
    const { status } = useWorkspaceSync();
    const hint = STATUS_HINT[status];

    return (
        <div className="flex min-h-screen flex-col bg-background pb-16 lg:pb-0">
            {hint && (
                <div
                    role="status"
                    className={cn(
                        "flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1 text-[11px]",
                        hint.tone,
                    )}
                >
                    {status === "offline" ? (
                        <CloudOff className="size-3" aria-hidden />
                    ) : (
                        <RefreshCw
                            className={cn("size-3", status === "syncing" && "animate-spin")}
                            aria-hidden
                        />
                    )}
                    {hint.label}
                </div>
            )}

            <main className="min-h-0 flex-1 overflow-auto safe-bottom">{children}</main>

            <nav
                aria-label="Primary"
                className="fixed inset-x-0 bottom-0 z-50 h-16 border-t border-border bg-card/95 backdrop-blur-sm lg:hidden"
            >
                <ul className="grid h-full grid-cols-5">
                    {MOBILE_TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab.id === tab.id;
                        return (
                            <li key={tab.id} className="flex">
                                <Link
                                    href={tab.href}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "flex w-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                                        isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    <Icon className="size-5" strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
                                    <span>{tab.label}</span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </div>
    );
}
