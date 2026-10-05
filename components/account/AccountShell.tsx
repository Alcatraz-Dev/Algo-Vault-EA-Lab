"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ScalpingTerminal from "@/components/live/ScalpingTerminal";
import {
   Activity,
   AlertTriangle,
   ArrowLeft,
   BarChart3,
   Bell,
   Bot,
   Calculator,
   Calendar,
   Code,
   Copy,
   CreditCard,
   Crown,
   DollarSign,
   FileCode2,
   FileKey2,
   FileText,
   FlaskConical,
   Gift,
   GitBranch,
   Globe,
   LayoutDashboard,
   LineChart,
   LogOut,
   Menu,
   MonitorSmartphone,
   Plug,
   Radio,
   Search,
   Settings,
   Cpu,
   RotateCcw,
   Shield,
   Target,
   Tag,
   Trophy,
   TrendingUp,
   Users,
   Wallet,
   X,
   Zap,
   Terminal,
} from "lucide-react";
// Zap is reused for the AI Execution nav entry (no new icon dependency).
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteLogo from "@/components/ui/site-logo";
import { cn } from "@/lib/utils";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";

const ACCOUNT_NAV: NavGroup[] = [
  {
    // Overview leads the sidebar: home and the custom dashboard are the two
    // entry points users open most, before any category below.
    label: "Overview",
    items: [
      { icon: LayoutDashboard, label: "Account Home", href: "/account" },
      { icon: LayoutDashboard, label: "Custom Dashboard", href: "/dashboard" },
    ],
  },
  {
    label: "Account",
    items: [
      { icon: CreditCard, label: "Purchases", href: "/account/purchases" },
      { icon: FileKey2, label: "Licenses", href: "/account/licenses" },
      { icon: FileCode2, label: "Set Files", href: "/account/setfiles" },
      { icon: Globe, label: "Trading Access", href: "/account/trading-access" },
      { icon: Gift, label: "Affiliates", href: "/account/affiliate" },
      { icon: Zap, label: "Upgrade", href: "/pricing" },
      { icon: Zap, label: "Scalping Terminal (Lite)", href: "/account/lite-scalping-terminal", badge: "LITE" },
      { icon: Zap, label: "Pro Scalping Terminal", href: "/account/scalping-terminal", badge: "PRO" },
      { icon: Settings, label: "Settings", href: "/account/settings" },
      { icon: Activity, label: "Account Health", href: "/account/account-health" },
      { icon: MonitorSmartphone, label: "Pro Trading Extension", href: "/account/pro-trading-extension", badge: "PRO" },
      { icon: Trophy, label: "Performance Arena", href: "/account/performance-arena" },
    ],
  },
  {
    label: "Tools",
    items: [
      { icon: Calculator, label: "Calculators", href: "/tools/calculators" },
      { icon: Target, label: "Goals", href: "/goals" },
      { icon: Bell, label: "Alerts", href: "/alerts" },
      { icon: Zap, label: "Tool Alerts", href: "/alerts/tools" },
      { icon: Bell, label: "Alert History", href: "/alerts/history" },
      { icon: Tag, label: "Trade Tags", href: "/tags" },
      { icon: Globe, label: "Pip Reference", href: "/tools/pip-reference" },
      { icon: DollarSign, label: "Broker Fees", href: "/tools/broker-fees" },
      { icon: Globe, label: "Session Overlap", href: "/tools/overlap" },
    ],
  },
  {
    label: "Developer",
    items: [
      { icon: Code, label: "Dashboard", href: "/developer/dashboard" },
      { icon: Crown, label: "Subscription", href: "/developer/subscription" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { icon: Users, label: "AI Trading Teams", href: "/account/ai-trading-teams", badge: "PRO" },
      { icon: Plug, label: "My Plugins", href: "/account/plugins" },
      { icon: Cpu, label: "Active Agents", href: "/account/agents" },
      { icon: BarChart3, label: "Analysis", href: "/account/analysis" },
      { icon: BarChart3, label: "Market Intelligence", href: "/account/market-intelligence", badge: "PRO" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { icon: FileText, label: "Statement", href: "/statement" },
      { icon: TrendingUp, label: "Spreads", href: "/spreads" },
      { icon: Zap, label: "News", href: "/news" },
      { icon: Calendar, label: "Economic Calendar", href: "/economic-calendar" },
      { icon: Globe, label: "Sessions", href: "/tools/sessions" },
      { icon: TrendingUp, label: "Fibonacci", href: "/tools/fibonacci" },
      { icon: Target, label: "Currency Strength", href: "/tools/currency-strength" },
      { icon: AlertTriangle, label: "Risk of Ruin", href: "/tools/risk-of-ruin" },
      { icon: Activity, label: "Equity Curve", href: "/equity-curve" },
    ],
  },  {
    label: "Trading",
    items: [
      { icon: Terminal, label: "Trading Terminal", href: "/account/trading" },
      { icon: Zap, label: "AI Execution", href: "/account/ai-execution" },
      { icon: Bot, label: "My Bots", href: "/account/bots" },
          { icon: GitBranch, label: "Workflow Automation", href: "/account/workflows", badge: "PRO" },
          { icon: Zap, label: "AI Signals", href: "/signals" },
          { icon: LineChart, label: "Trading Studio", href: "/account/tradingview" },
          { icon: RotateCcw, label: "Trade Replay", href: "/trade-replay" },
          { icon: FlaskConical, label: "Strategy Lab", href: "/strategy-lab" },
          { icon: Target, label: "Smart Management", href: "/trade-management" },
          { icon: Bell, label: "Alert Center", href: "/alert-center" },
          { icon: BarChart3, label: "Backtests", href: "/backtests" },
          { icon: Radio, label: "Live Performance", href: "/live-performance" },
          { icon: Shield, label: "Verified Performance", href: "/verified-performance" },
          { icon: Activity, label: "Live Intelligence", href: "/account/live" },
          { icon: Globe, label: "Live Map", href: "/account/livemap" },
          { icon: Copy, label: "Copy Trading", href: "/copy-trading" },
          { icon: Wallet, label: "Compare Brokers", href: "/compare" },
          { icon: Activity, label: "Scanner", href: "/scanner" },
        ],
      },
];

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
  /** Rendered inline with the page title (e.g. the small Pro badge). */
  eyebrow?: React.ReactNode;
  onBack?: () => void;
  /** Extra content injected into the topbar alongside the status pill. */
  headerActions?: React.ReactNode;
  /** Hide the account sidebar; let the page own the full viewport. */
  hideSidebar?: boolean;
  /** Edge-to-edge content: no sidebar, no max width, compact padding. */
  fullscreen?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("AlgoVault");
  const [navSearch, setNavSearch] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
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

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/");
  };

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

  // Filter nav groups by search query
  const filteredNav = navSearch.trim()
    ? ACCOUNT_NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.label.toLowerCase().includes(navSearch.toLowerCase())
        ),
      })).filter((group) => group.items.length > 0)
    : ACCOUNT_NAV;

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