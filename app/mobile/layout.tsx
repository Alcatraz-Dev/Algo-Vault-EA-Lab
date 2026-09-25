"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BarChart2, Radio, Bot, User, Menu, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

const NAV_ITEMS = [
  { href: "/mobile/home", label: "Home", icon: Home },
  { href: "/mobile/markets", label: "Markets", icon: BarChart2 },
  { href: "/mobile/signals", label: "Signals", icon: Radio },
  { href: "/mobile/bots", label: "Bots", icon: Bot },
  { href: "/mobile/account", label: "Account", icon: User },
] as const;

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const userRef = useRef<unknown>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      userRef.current = u;
    });
    // Set mounted after the effect runs to avoid synchronous state update
    setTimeout(() => setMounted(true), 0);
    return () => unsub();
  }, []);

  const isActive = (href: string) => {
    if (href === "/mobile/home") return pathname === "/mobile/home" || pathname === "/mobile";
    return pathname?.startsWith(href) ?? false;
  };

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1" />
        <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-card border-t border-border" aria-label="Mobile navigation (loading)">
          <div className="flex h-full items-center justify-around" />
        </nav>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-16 lg:pb-0">
      {/* Header for mobile - only on non-home pages or when needed */}
      {(pathname !== "/mobile/home" && pathname !== "/mobile") && (
        <header className="sticky top-0 z-40 h-14 bg-background/80 backdrop-blur-sm border-b border-border flex items-center justify-between px-4">
          <h1 className="text-lg font-semibold truncate">
            {NAV_ITEMS.find((item) => isActive(item.href))?.label || "AlgoVault"}
          </h1>
          <div className="flex items-center gap-2" />
        </header>
      )}

      <main className="flex-1 min-h-0 overflow-auto safe-bottom">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-card border-t border-border lg:hidden"
        role="navigation"
        aria-label="Primary navigation"
      >
        <div className="flex h-full items-center justify-around">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-2 touch-target transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={22} className={cn(active && "fill-current")} aria-hidden="true" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* More Menu Sheet - for secondary items */}
      {showMore && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowMore(false)}
            aria-hidden="true"
          />
          <div className="absolute bottom-16 left-4 right-4 max-w-sm mx-auto">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xl animate-slide-up">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">More</h2>
                <button
                  onClick={() => setShowMore(false)}
                  className="p-1 rounded-lg hover:bg-muted transition"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <nav className="space-y-2">
                <Link
                  href="/scanner"
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition touch-target"
                >
                  <Radio size={20} className="text-muted-foreground" />
                  <span>Market Scanner</span>
                </Link>
                <Link
                  href="/ai-copilot"
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition touch-target"
                >
                  <Bot size={20} className="text-muted-foreground" />
                  <span>AI Copilot</span>
                </Link>
                <Link
                  href="/workflows"
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition touch-target"
                >
                  <ChevronDown size={20} className="text-muted-foreground" />
                  <span>Workflows</span>
                </Link>
                <Link
                  href="/trade-journal"
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition touch-target"
                >
                  <BarChart2 size={20} className="text-muted-foreground" />
                  <span>Trade Journal</span>
                </Link>
                <Link
                  href="/strategy-lab"
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition touch-target"
                >
                  <Bot size={20} className="text-muted-foreground" />
                  <span>Strategy Lab</span>
                </Link>
                <Link
                  href="/marketplace"
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition touch-target"
                >
                  <Home size={20} className="text-muted-foreground" />
                  <span>Marketplace</span>
                </Link>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Floating action button for More on home screen */}
      {pathname === "/mobile/home" || pathname === "/mobile" ? (
        <button
          onClick={() => setShowMore(true)}
          className="fixed bottom-20 right-4 z-40 lg:hidden rounded-full bg-primary p-3 shadow-xl touch-target transition-transform hover:scale-105 active:scale-95"
          aria-label="More options"
          aria-expanded={showMore}
        >
          <Menu size={24} className="text-primary-foreground" />
        </button>
      ) : null}
    </div>
  );
}