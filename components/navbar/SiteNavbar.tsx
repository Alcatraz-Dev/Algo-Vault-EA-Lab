"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Brain,
  Calculator,
  Clock,
  Copy,
  CreditCard,
  Eye,
  FileKey2,
  FileText,
  Gift,
  GitBranch,
  LineChart,
  LogOut,
  Menu,
  Radio,
  Settings,
  Shield,
  Sparkles,
  Wallet,
  X,
  Zap,
  Crown,
  Target,
} from "lucide-react";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteLogo from "@/components/ui/site-logo";
import { useRouter } from "next/navigation";
import { onSubscriptionChange } from "@/lib/subscription";
import ThemeToggle from "@/components/theme/theme-toggle";

const NAV_ITEMS = [
  { icon: Zap, label: "AI Signals", href: "/signals" },
  { icon: Activity, label: "Scanner", href: "/scanner" },
  { icon: Brain, label: "AI Copilot", href: "/ai-copilot" },
  { icon: Sparkles, label: "Insights", href: "/insights" },
  { icon: GitBranch, label: "Workflow Automation", href: "/workflows" },
  { icon: Clock, label: "AI History", href: "/ai-historical" },
  { icon: FileText, label: "Reports", href: "/report-generator" },
  { icon: Eye, label: "Signal Transparency", href: "/signal-transparency" },
  { icon: Shield, label: "Verified Perf", href: "/verified-performance" },
  { icon: CreditCard, label: "Purchases", href: "/account/purchases" },
  { icon: FileKey2, label: "Licenses", href: "/account/licenses" },
  { icon: Sparkles, label: "TradingView", href: "/account/tradingview" },
  { icon: LineChart, label: "Live", href: "/live" },
  { icon: BarChart3, label: "Backtests", href: "/backtests" },
  { icon: Copy, label: "Copy Trading", href: "/copy-trading" },
  { icon: Radio, label: "Sessions", href: "/tools/sessions" },
  { icon: Wallet, label: "Compare", href: "/compare" },
  { icon: Gift, label: "Affiliates", href: "/account/affiliate" },
  { icon: Calculator, label: "Tools", href: "/account/tools" },
  { icon: Target, label: "Goals", href: "/goals" },
  { icon: Settings, label: "Settings", href: "/account/settings" },
];

const PRO_NAV_ITEMS = [
  { icon: Radio, label: "Pro Signals", href: "/signals/pro" },
  { icon: Zap, label: "Upgrade Pro", href: "/pricing" },
  { icon: Crown, label: "Pro Features", href: "/account/subscribe" },
];

export default function SiteNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hasPro, setHasPro] = useState(false);
  const [siteName, setSiteName] = useState("AlgoVault");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
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
    if (!user) {
      return;
    }
    const check = async () => {
      try {
        const { hasSubscription } = await onSubscriptionChange(user.uid);
        setHasPro(hasSubscription);
      } catch {
        setHasPro(false);
      } finally {
      }
    };
    check();
  }, [user]);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/");
  };

  const isActive = (href: string) => {
    if (href === "/account") return pathname === "/account";
    return pathname?.startsWith(href) ?? false;
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="page-container flex items-center justify-between py-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <SiteLogo size={18} />
          <span className="text-lg font-bold tracking-tight">{siteName}</span>
          {hasPro && (
            <span className="ml-2 rounded-full border border-primary/40 bg-accent-muted px-2 py-0.5 text-xs font-bold text-primary">
              PRO
            </span>
          )}
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ icon: Icon, label, href }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                isActive(href)
                  ? "bg-accent-muted text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
          {PRO_NAV_ITEMS.map(({ icon: Icon, label, href }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                isActive(href)
                  ? "bg-accent-muted text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user && (
            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                <UserIcon />
              </div>
              <span className="text-sm text-muted-foreground">
                {user.email?.split("@")[0]}
              </span>
            </div>
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground md:hidden"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-background/90 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-border bg-card p-4">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
            <nav className="space-y-1">
              {NAV_ITEMS.map(({ icon: Icon, label, href }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                    isActive(href)
                      ? "bg-accent-muted font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              ))}
              {PRO_NAV_ITEMS.map(({ icon: Icon, label, href }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-primary transition-colors hover:bg-muted"
                >
                  <Icon size={16} />
                  {label}
                </Link>
              ))}
              {user && (
                <>
                  <div className="my-3 border-t border-border pt-3">
                    <div className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
                      <div className="h-6 w-6 rounded-full bg-muted" />
                      <span className="truncate">{user.email}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { handleSignOut(); setMobileOpen(false); }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <LogOut size={16} />
                    Sign Out
                  </button>
                </>
              )}
            </nav>
          </aside>
        </div>
      )}
    </nav>
  );
}

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}