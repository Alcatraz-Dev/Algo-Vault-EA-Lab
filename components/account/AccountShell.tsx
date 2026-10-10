"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AppShell } from "@/components/layout/AppShell";
import { ACCOUNT_NAV } from "./account-nav";

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
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  onBack?: () => void;
  headerActions?: React.ReactNode;
  hideSidebar?: boolean;
  fullscreen?: boolean;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [navSearch, setNavSearch] = useState("");

  // Every account page is a sub-page, so the header always offers a way back:
  // the caller's explicit destination when given, otherwise real history, with
  // the account dashboard as the fallback for deep links opened in a fresh tab.
  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/account");
  };

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

  // Candel pages share the account sidebar instead of swapping it out: their
  // links are the "AI Workspace" group, so entering a Candel keeps the whole
  // navigation available (AppShell expands the group holding the active page).
  const navGroups = ACCOUNT_NAV;

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
      onBack={handleBack}
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
