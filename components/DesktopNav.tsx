"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  LayoutDashboard,
  TrendingUp,
  Brain,
  ScanSearch,
  BarChart3,
  Lightbulb,
  Settings,
} from "lucide-react";
import { ACCOUNT_NAV } from "./account/account-nav";
import type { NavItem } from "./layout/AppShell";
import { useIsDesktop } from "@/hooks/use-desktop";
import { cn } from "@/lib/utils";

/**
 * Primary destinations for the general workspace. Account routes intentionally
 * replace these with their account-specific navigation.
 */
const PRIMARY_ITEMS: ReadonlyArray<{
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number | string }>;
  route: string;
  shortcut: string;
}> = [
  { label: "Dashboard", icon: LayoutDashboard, route: "/dashboard", shortcut: "⌘1" },
  { label: "Trading", icon: TrendingUp, route: "/account/terminal", shortcut: "⌘2" },
  { label: "Signals", icon: Brain, route: "/signals", shortcut: "⌘3" },
  { label: "Scanner", icon: ScanSearch, route: "/scanner", shortcut: "⌘4" },
  { label: "Strategy", icon: BarChart3, route: "/strategy-lab", shortcut: "⌘5" },
  { label: "Portfolio", icon: TrendingUp, route: "/portfolio", shortcut: "⌘6" },
  { label: "AI Copilot", icon: Lightbulb, route: "/ai-copilot", shortcut: "⌘7" },
];

/** Routes where the desktop rail is suppressed entirely (no nav needed). */
const RAIL_HIDDEN_ROUTES = new Set<string>(["/"]);

/**
 * macOS-only icons-only navigation rail.
 *
 * Width: 80px (`w-20`). Slim like Finder/Xcode. The web app's
 * `<aside class="w-64">` is suppressed via `app/globals.css` so the user
 * never sees two sidebars at once.
 *
 * Behaviour:
 *   • Suppressed on the marketing home page (`/`) — the page gets full-width.
 *   • General workspace: Back + primary destinations + Settings.
 *   • Account routes: only ACCOUNT_NAV, icons-only, in one scroll region.
 *   • Theme-aware: every surface reads from CSS variables so light/dark
 *     flips from the page flow through the rail automatically.
 */
export default function DesktopNav() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const isDesktop = useIsDesktop();

  // Hidden routes (homepage) — bail out completely.
  if (RAIL_HIDDEN_ROUTES.has(pathname)) return null;

  const inAccount =
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname.startsWith("/developer/");

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <nav
      className={cn(
        "flex h-full min-h-0 w-20 shrink-0 flex-col overflow-hidden border-r border-border bg-card select-none",
      )}
      aria-label="Desktop navigation rail"
      data-account-open={inAccount ? "true" : "false"}
    >
      {/* Traffic-light reservation — Electron positions the macOS controls at
          { x: 16, y: 18 }; the leading 80px is owned by this rail so the
          controls never collide with content. */}
      <div className="h-11 shrink-0" aria-hidden data-slot="traffic-light-reservation" />

      {!inAccount ? (
        <>
          {/* Back row for the general workspace. Account routes keep the rail
              dedicated to their account destinations. */}
          <div className="px-2 pb-1">
            <TooltipButton label="Back" shortcut="⌘[" onClick={handleBack}>
              <ArrowLeft size={18} strokeWidth={2} />
            </TooltipButton>
          </div>
          <Divider />
        </>
      ) : null}

      {!inAccount ? (
        /* Primary destinations — general workspace only. */
        <div className="px-2 py-2">
          <ul className="flex flex-col items-center gap-1">
            {PRIMARY_ITEMS.map((item) => {
              const active =
                pathname === item.route ||
                (item.route !== "/" && pathname.startsWith(`${item.route}/`));
              const Icon = item.icon;
              return (
                <li key={item.route}>
                  <TooltipLink
                    href={item.route}
                    label={item.label}
                    shortcut={item.shortcut}
                    active={active}
                  >
                    <Icon
                      size={18}
                      strokeWidth={1.75}
                      className={active ? "text-primary" : "text-muted-foreground"}
                    />
                  </TooltipLink>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Account routes get one continuous account navigation list instead of
          a second primary list plus a duplicated Settings footer. */}
      {inAccount ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 [scrollbar-width:thin]">
          <ul className="flex flex-col items-center gap-1">
            {ACCOUNT_NAV.flatMap((group) =>
              group.items.map((navItem: NavItem) => {
                const href = navItem.href;
                const active =
                  pathname === href ||
                  (href !== "/" && pathname.startsWith(`${href}/`));
                const Icon = navItem.icon;
                return (
                  <li key={href}>
                    <TooltipLink
                      href={href}
                      label={navItem.label}
                      badge={navItem.badge}
                      active={active}
                    >
                      <Icon
                        size={18}
                        strokeWidth={1.75}
                        className={active ? "text-primary" : "text-muted-foreground"}
                      />
                    </TooltipLink>
                  </li>
                );
              }),
              )}
            </ul>
        </div>
      ) : (
        // No account region on non-account routes — let the layout breathe.
        <div className="flex-1" aria-hidden />
      )}

      {!inAccount ? (
        <>
          <Divider />
          {/* Pinned footer — Settings */}
          <div className="px-2 py-2">
            <TooltipLink
              href="/account/settings"
              label="Settings"
              active={
                pathname === "/account/settings" ||
                pathname.startsWith("/account/settings/")
              }
            >
              <Settings
                size={18}
                strokeWidth={1.75}
                className={
                  pathname === "/account/settings" ||
                  pathname.startsWith("/account/settings/")
                    ? "text-primary"
                    : "text-muted-foreground"
                }
              />
            </TooltipLink>
          </div>
        </>
      ) : null}

      {isDesktop ? (
        <span className="sr-only">
          Desktop navigation. Use ⌘[ to go back. ⌘1–⌘7 jump to primary
          destinations.
        </span>
      ) : null}
    </nav>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   TooltipLink / TooltipButton — small primitives that keep the markup above
   focused on layout. Both render an icon-only control and reveal a tooltip
   on hover/focus that surfaces the label (and optional badge/shortcut) to
   the right of the icon — the macOS sidebar pattern.

   The tooltip is portaled to <body> so it can never be clipped by the rail
   (the rail needs `overflow-hidden` to keep its scroll region bounded, so a
   locally-positioned tooltip would be cut off).
   ──────────────────────────────────────────────────────────────────────── */

interface TooltipLinkProps {
  href: string;
  label: string;
  badge?: string;
  shortcut?: string;
  active?: boolean;
  children: React.ReactNode;
}

function TooltipLink({ href, label, badge, shortcut, active, children }: TooltipLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      data-nav-tooltip={label}
      data-nav-badge={badge ?? ""}
      data-nav-shortcut={shortcut ?? ""}
      className={cn(
        "group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150",
        "hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/60 active:scale-[0.95]",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function TooltipButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-nav-tooltip={label}
      data-nav-shortcut={shortcut ?? ""}
      className={cn(
        "group relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground",
        "transition-colors duration-150 hover:bg-accent hover:text-foreground",
        "focus:outline-none focus:ring-2 focus:ring-ring/60 active:scale-[0.95]",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-border mx-3" aria-hidden />;
}