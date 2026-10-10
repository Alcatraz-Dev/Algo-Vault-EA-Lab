"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AppShell } from "@/components/layout/AppShell";
import { ACCOUNT_NAV } from "./account-nav";
import { CANDEL_NAV } from "@/components/candel/candel-nav";

export default function AccountShell({
  children,
  title = "Account",
  subtitle,
  eyebrow,
  onBack,
  hideSidebar,
  fullscreen,
  headerActions: extraHeaderActions,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  eyebrow?: React.ReactNode;
  onBack?: () => void;
  headerActions?: React.ReactNode;
  hideSidebar?: boolean;
  fullscreen?: boolean;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [navSearch, setNavSearch] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsub();
  }, []);

  const headerActions = (
    <div className="flex items-center gap-3">
      {extraHeaderActions}
      <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
        </span>
        {user ? "Signed in" : "Signed out"}
      </span>
    </div>
  );

  // The Candel pages live inside the account shell but use the Candel nav.
  const navGroups = pathname?.startsWith("/account/candels") ? CANDEL_NAV : ACCOUNT_NAV;

  const filteredNav = navSearch.trim()
    ? navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            item.label.toLowerCase().includes(navSearch.toLowerCase())
          ),
        }))
        .filter((group) => group.items.length > 0)
    : navGroups;

  return (
    <AppShell
      navGroups={filteredNav}
      title={title}
      subtitle={subtitle}
      eyebrow={eyebrow}
      onBack={onBack}
      headerActions={headerActions}
      role="account"
      maxWidth="max-w-7xl"
      navSearch={navSearch}
      onNavSearch={setNavSearch}
      hideSidebar={hideSidebar}
      fullscreen={fullscreen}
    >
      {children}
    </AppShell>
  );
}
