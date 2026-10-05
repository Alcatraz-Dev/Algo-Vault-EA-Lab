"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  LogOut,
  Menu,
  Search,
  Settings,
  User,
  X,
} from "lucide-react";
import { signOut, onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { ref, onValue } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import SiteLogo from "@/components/ui/site-logo";
import ThemeToggle from "@/components/theme/theme-toggle";
import { NotificationsMenu } from "@/components/layout/NotificationsMenu";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  badge?: string;
  pro?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * AppShell — canonical authenticated application shell.
 * Grouped sidebar + topbar (notifications, account, theme) + mobile drawer.
 * Account and Admin shells render through this component.
 */
export function AppShell({
  children,
  navGroups,
  title,
  subtitle,
  eyebrow,
  onBack,
  headerActions,
  maxWidth = "max-w-7xl",
  padding = true,
  role = "app",
  hideSidebar,
  fullscreen,
  navSearch,
  onNavSearch,
}: {
  children: ReactNode;
  navGroups: NavGroup[];
  title?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  onBack?: () => void;
  headerActions?: ReactNode;
  maxWidth?: string;
  padding?: boolean;
  hideSidebar?: boolean;
  role?: "app" | "account" | "admin";
  fullscreen?: boolean;
  /** Current sidebar search query (controlled externally). */
  navSearch?: string;
  /** Called when the user changes the sidebar search input. */
  onNavSearch?: (q: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [siteName, setSiteName] = useState("AlgoVault");
  const accountRef = useRef<HTMLDivElement | null>(null);
  const [internalNavSearch, setInternalNavSearch] = useState("");
  const searchValue = navSearch !== undefined ? navSearch : internalNavSearch;
  const handleSearch = onNavSearch ?? setInternalNavSearch;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    const settingsRef = ref(database, "settings/siteName");
    const unsub = onValue(settingsRef, (snap) => {
      const val = snap.val();
      if (val && typeof val === "string") setSiteName(val);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/");
  };

  const isActive = (href: string) => {
    if (href === "/account") return pathname === "/account";
    if (href === "/admin") return pathname === "/admin";
    return pathname?.startsWith(href) ?? false;
  };

  const displayedGroups = searchValue.trim()
    ? navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            item.label.toLowerCase().includes(searchValue.toLowerCase())
          ),
        }))
        .filter((group) => group.items.length > 0)
    : navGroups;

  const navInner = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Primary">
      {displayedGroups.length === 0 ? (
        <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">
          No navigation items found
        </p>
      ) : (
        displayedGroups.map((group) => (
        <div key={group.label}>
          <p className="px-2.5 pb-1.5 text-micro font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group/item relative flex h-8 items-center gap-2.5 rounded-button px-2.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon
                    size={15}
                    className={cn(
                      "shrink-0",
                      active ? "text-primary" : "text-muted-foreground group-hover/item:text-foreground"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                  {item.badge ? (
                    <span
                      className={cn(
                        "ml-auto inline-flex h-4 shrink-0 items-center rounded-[4px] border px-1 text-[8px] font-bold uppercase leading-none tracking-wide",
                        item.badge.toUpperCase() === "PRO"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                          : item.badge.toUpperCase() === "LITE"
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-secondary text-muted-foreground"
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))
    )}
    </nav>
  );

  const sidebarFooter = (
    <div className="border-t border-border p-3">
      <div className="flex items-center gap-2.5 rounded-button px-2 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <User size={15} className="text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-medium text-foreground">
            {user?.displayName || user?.email?.split("@")[0] || "Trader"}
          </p>
          <p className="truncate text-meta text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <div className="mt-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleSignOut}
        >
          <LogOut size={13} className="mr-1.5" />
          Sign out
        </Button>
      </div>
    </div>
  );

  const sidebarInner = (
    <>
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <SiteLogo size={16} />
          <div>
            <p className="text-body font-semibold leading-none text-foreground">{siteName}</p>
            <p className="mt-0.5 text-micro text-muted-foreground">
              {role === "admin" ? "Administration" : role === "account" ? "Customer Area" : "Trading Platform"}
            </p>
          </div>
        </Link>
      </div>
      {/* Sidebar search */}
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search navigation…"
            className="h-7 w-full rounded-button border border-border bg-muted/40 pl-7 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {searchValue ? (
            <button
              type="button"
              onClick={() => handleSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
      </div>
      {navInner}
      {sidebarFooter}
    </>
  );

  const headerRight = (
    <div className="flex items-center gap-1.5">
      {headerActions}
      <NotificationsMenu key={user?.uid ?? "signed-out"} user={user} />
      <ThemeToggle />
      {/* Account menu */}
      <div ref={accountRef} className="relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAccountOpen((o) => !o)}
          aria-label="Account menu"
          className={cn(
            "h-9 w-9 rounded-button transition-colors",
            accountOpen && "bg-muted"
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <User size={12} />
          </span>
        </Button>
        {accountOpen ? (
          <div className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-card-lg border border-border bg-popover py-1 shadow-lg">
            <div className="border-b border-border px-3 py-3">
              <p className="truncate text-meta font-semibold text-foreground">
                {user?.displayName || "Account"}
              </p>
              <p className="truncate text-micro text-muted-foreground">{user?.email}</p>
            </div>
            <div className="p-1">
              <Link
                href={role === "admin" ? "/admin" : "/account"}
                onClick={() => setAccountOpen(false)}
                className="flex items-center gap-2 rounded-button px-2.5 py-2 text-body-sm text-foreground transition-colors hover:bg-muted"
              >
                <Settings size={14} className="text-muted-foreground" />
                {role === "admin" ? "Admin home" : "Account home"}
              </Link>
              {user ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-negative hover:bg-negative/10"
                  onClick={() => {
                    setAccountOpen(false);
                    handleSignOut();
                  }}
                >
                  <LogOut size={14} className="mr-2" />
                  Sign out
                </Button>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setAccountOpen(false)}
                  className="flex items-center gap-2 rounded-button px-2.5 py-2 text-body-sm text-foreground transition-colors hover:bg-muted"
                >
                  <LogOut size={14} className="text-muted-foreground" />
                  Sign in
                </Link>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      {hideSidebar || fullscreen ? null : (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
          {sidebarInner}
        </aside>
      )}

      {/* Mobile drawer */}
      {mobileOpen && !hideSidebar && !fullscreen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex w-64 shrink-0 flex-col border-r border-border bg-card">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 h-8 w-8 rounded-button"
              aria-label="Close navigation menu"
            >
              <X size={16} />
            </Button>
            {sidebarInner}
          </aside>
        </div>
      ) : null}

      {/* Content column */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6" data-guide="page-header">
          <div className="flex min-w-0 items-center gap-3">
            {hideSidebar || fullscreen ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(true)}
                className="lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu size={16} />
              </Button>
            )}
            {onBack ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label="Go back"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
              </Button>
            ) : null}
            <div className="min-w-0" data-guide="page-header">
              {title || eyebrow ? (
                <div className="flex min-w-0 items-center gap-2">
                  {title ? (
                    <h1 className="truncate text-xl font-medium tracking-tight text-foreground">
                      {title}
                    </h1>
                  ) : null}
                  {eyebrow ? (
                    <span className="shrink-0 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                      {eyebrow}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {subtitle ? (
                <p className="hidden truncate text-body-sm text-muted-foreground sm:block">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {headerRight}
        </header>

        {/* Page content */}
        <main
          className={cn(
            "flex-1 animate-page-enter",
            padding &&
              (fullscreen
                ? "w-full min-w-0 px-3 py-3 sm:px-4 sm:py-4"
                : `${maxWidth} px-4 py-6 sm:px-6 lg:px-8`)
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}