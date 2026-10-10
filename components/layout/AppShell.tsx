"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ChevronDown,
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
import { CommandPalette } from "@/components/layout/CommandPalette";
import { useShellHeaderHeight, shellHeaderStyle } from "@/components/layout/use-shell-header-height";
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

/** localStorage key holding the labels of collapsed sidebar groups. */
const NAV_COLLAPSED_KEY = "algovault.nav.collapsed";

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
  const [commandOpen, setCommandOpen] = useState(false);
  const [siteName, setSiteName] = useState("AlgoVault");
  const accountRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const headerHeight = useShellHeaderHeight(headerRef);
  const [internalNavSearch, setInternalNavSearch] = useState("");
  const searchValue = navSearch !== undefined ? navSearch : internalNavSearch;
  const handleSearch = onNavSearch ?? setInternalNavSearch;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Restore collapsed sidebar groups from the previous session.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot localStorage hydration: SSR has no storage, so the persisted collapsed state must be read after mount. */
    try {
      const raw = window.localStorage.getItem(NAV_COLLAPSED_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setCollapsedGroups(
          Object.fromEntries(
            parsed
              .filter((label): label is string => typeof label === "string")
              .map((label) => [label, true])
          )
        );
      }
    } catch {
      /* ignore malformed or unavailable storage */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        window.localStorage.setItem(
          NAV_COLLAPSED_KEY,
          JSON.stringify(Object.keys(next).filter((key) => next[key]))
        );
      } catch {
        /* ignore write failure */
      }
      return next;
    });
  };

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

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

  const navHrefs = navGroups.flatMap((group) => group.items.map((item) => item.href));

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === "/account" || href === "/admin") return false;
    if (!(pathname?.startsWith(`${href}/`) ?? false)) return false;
    // A more specific entry inside this one owns the current page (e.g. "Tool
    // calls" inside the Candel library), so the parent must not also light up.
    return !navHrefs.some(
      (other) =>
        other !== href &&
        other.startsWith(`${href}/`) &&
        (pathname === other || pathname?.startsWith(`${other}/`) === true)
    );
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

  const searching = searchValue.trim().length > 0;

  const renderChip = (item: NavItem) => {
    if (item.pro) {
      return (
        <span className="ml-auto inline-flex h-2.5 shrink-0 items-center rounded-md border border-primary/30 bg-primary/10 px-0.5 text-[8px] font-bold uppercase leading-none tracking-wide text-foreground">
          Pro
        </span>
      );
    }
    if (!item.badge) return null;
    const tone =
      item.badge.toUpperCase() === "PRO"
        ? "border-warning/40 bg-warning/10 text-warning-foreground"
        : item.badge.toUpperCase() === "LITE"
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-border bg-secondary text-muted-foreground";
    return (
      <span
        className={cn(
          "ml-auto inline-flex h-2.5 shrink-0 items-center rounded-md border px-0.5 text-[8px] font-bold uppercase leading-none tracking-wide",
          tone
        )}
      >
        {item.badge}
      </span>
    );
  };

  const navInner = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Primary">
      {displayedGroups.length === 0 ? (
        <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">
          No navigation items found
        </p>
      ) : (
        displayedGroups.map((group) => {
          const hasActive = group.items.some((item) => isActive(item.href));
          // While searching, and for the group holding the current page, keep
          // the group open regardless of the stored collapsed state.
          const expanded = searching || hasActive || !collapsedGroups[group.label];
          return (
            <div key={group.label} className="py-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between gap-2 rounded-button px-2.5 py-1 text-micro font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <span>{group.label}</span>
                <ChevronDown
                  size={12}
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                    expanded ? "rotate-0" : "-rotate-90"
                  )}
                />
              </button>
              <div
                className={cn(
                  "grid transition-[grid-template-rows,visibility] duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none",
                  expanded ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
                )}
              >
                <div className="overflow-hidden">
                  <div className="space-y-0.5 pt-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={`${group.label}:${item.href}:${item.label}`}
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "group/item relative flex h-8 items-center gap-2.5 rounded-button px-2.5 text-xs font-medium transition-colors",
                            active
                              ? "bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {active ? (
                            <span
                              aria-hidden="true"
                              className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                            />
                          ) : null}
                          <Icon
                            size={15}
                            className={cn(
                              "shrink-0",
                              active
                                ? "text-primary"
                                : "text-muted-foreground group-hover/item:text-foreground"
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                          {renderChip(item)}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </nav>
  );

  const sidebarFooter = (
    <div className="border-t border-border p-3">
      {!authReady ? (
        <div className="flex items-center gap-2.5 rounded-button px-2 py-2" aria-hidden="true">
          <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-24 rounded bg-muted" />
            <div className="h-2 w-32 rounded bg-muted" />
          </div>
        </div>
      ) : user ? (
        <>
          <div className="flex items-center gap-2.5 rounded-button px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <User size={15} className="text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-medium text-foreground">
                {user.displayName || user.email?.split("@")[0] || "Trader"}
              </p>
              <p className="truncate text-meta text-muted-foreground">{user.email}</p>
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
        </>
      ) : (
        <div className="rounded-button px-2 py-2">
          <p className="text-body-sm font-medium text-foreground">Not signed in</p>
          <p className="mt-0.5 text-meta text-muted-foreground">
            Sign in to access your account.
          </p>
          <Button
            variant="default"
            size="sm"
            className="mt-2 w-full"
            onClick={() => router.push("/login")}
          >
            Sign in
          </Button>
        </div>
      )}
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
      <style>{`
        input[type="search"]::-webkit-search-cancel-button,
        input[type="search"]::-webkit-search-decoration {
          -webkit-appearance: none;
          appearance: none;
        }
      `}</style>
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
            className="h-7 w-full rounded-full border border-border bg-muted/40 pl-7 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none"
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

  // Terminal surfaces (fullscreen / sidebar-less) keep the topbar compact so the
  // chart keeps its vertical space; every other page gets the full title band.
  const compactHeader = Boolean(fullscreen || hideSidebar);

  // One control language for the whole topbar: hairline chip on the card surface,
  // muted icon that brightens on hover, a bigger touch target on phones and a
  // visible keyboard focus ring (DESIGN §14).
  const controlChip =
    "h-10 w-10 shrink-0 rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:w-9";

  const headerRight = (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {headerActions}
      {/* Command palette: labelled control from md up, icon chip on phones. */}
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        aria-label="Open command palette"
        className="hidden h-9 items-center gap-2 rounded-pill border border-border bg-card px-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:inline-flex"
      >
        <Search size={14} aria-hidden="true" />
        <span>Search</span>
        <kbd className="ml-1 rounded border border-border bg-background px-1 py-0.5 text-micro font-medium">
          ⌘K
        </kbd>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setCommandOpen(true)}
        aria-label="Open command palette"
        className={cn("md:hidden", controlChip)}
      >
        <Search size={16} />
      </Button>
      <NotificationsMenu key={user?.uid ?? "signed-out"} user={user} compact />
      <ThemeToggle compact />
      {/* Account menu */}
      <div ref={accountRef} className="relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAccountOpen((o) => !o)}
          aria-label="Account menu"
          aria-expanded={accountOpen}
          title="Account menu"
          className={cn(controlChip, accountOpen && "bg-muted text-foreground")}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground sm:h-7 sm:w-7">
            <User size={13} />
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
    <div
      className="flex min-h-screen bg-background text-foreground"
      style={shellHeaderStyle(headerHeight)}
    >
      {/* Desktop sidebar */}
      {hideSidebar || fullscreen ? null : (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
          {sidebarInner}
        </aside>
      )}

      {/* Mobile drawer */}
      {hideSidebar || fullscreen ? null : (
        <div
          className={cn(
            "fixed inset-0 z-50 transition-[visibility] duration-200 motion-reduce:transition-none lg:hidden",
            mobileOpen ? "visible" : "invisible pointer-events-none"
          )}
          aria-hidden={!mobileOpen}
        >
          <div
            className={cn(
              "absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none",
              mobileOpen ? "opacity-100" : "opacity-0"
            )}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={cn(
              "relative flex h-full w-64 shrink-0 flex-col border-r border-border bg-card shadow-lg transition-transform duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none",
              mobileOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
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
      )}

      {/* Content column */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Topbar — page header: back/menu controls, title block, global actions.
            Translucent + blurred instead of a bottom border, so the title stands on
            its own (the sticky chrome may blur content passing underneath). */}
        <header
          ref={headerRef}
          data-guide="page-header"
          className={cn(
            "sticky top-0 z-40 bg-background/85 backdrop-blur-xl",
            compactHeader ? "px-3 py-2.5 sm:px-4" : "px-4 py-3 sm:px-6 sm:py-4"
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2",
              !compactHeader && "flex-wrap gap-x-3 gap-y-2.5 lg:flex-nowrap"
            )}
          >
            <div className="flex shrink-0 items-center gap-1.5">
              {compactHeader ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen(true)}
                  className={cn("lg:hidden", controlChip)}
                  aria-label="Open navigation menu"
                  title="Open navigation menu"
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
                  title="Go back"
                  className={controlChip}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            {title || subtitle || eyebrow ? (
              <div
                className={cn(
                  "min-w-0",
                  // On small screens the title takes its own full-width row under the
                  // controls, so a long page name never collapses into an ellipsis.
                  !compactHeader && "order-last w-full lg:order-none lg:w-auto lg:flex-1"
                )}
              >
                {eyebrow ? (
                  <div className="mb-1 flex min-w-0 items-center gap-2 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                    {eyebrow}
                  </div>
                ) : null}
                {title ? (
                  <h1
                    className={cn(
                      "truncate font-semibold tracking-tight text-foreground",
                      compactHeader ? "text-base sm:text-lg" : "text-xl sm:text-2xl"
                    )}
                  >
                    {title}
                  </h1>
                ) : null}
                {subtitle ? (
                  <p
                    className={cn(
                      "truncate text-muted-foreground",
                      compactHeader ? "hidden text-meta sm:block" : "mt-1 text-body-sm"
                    )}
                  >
                    {subtitle}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="ml-auto flex items-center gap-1.5">{headerRight}</div>
          </div>
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

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        groups={navGroups}
        role={role}
      />
    </div>
  );
}