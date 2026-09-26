"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
   LineChart,
   LogOut,
   Menu,
   Plug,
   Settings,
   Cpu,
   RotateCcw,
   Target,
   Tag,
   TrendingUp,
   Wallet,
   X,
   Zap,
} from "lucide-react";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteLogo from "@/components/ui/site-logo";
import { cn } from "@/lib/utils";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";

const ACCOUNT_NAV: NavGroup[] = [
  {
    label: "Account",
    items: [
      { icon: CreditCard, label: "Purchases", href: "/account/purchases" },
      { icon: FileKey2, label: "Licenses", href: "/account/licenses" },
      { icon: FileCode2, label: "Set Files", href: "/account/setfiles" },
      { icon: Globe, label: "Trading Access", href: "/account/trading-access" },
      { icon: Gift, label: "Affiliates", href: "/account/affiliate" },
      { icon: Zap, label: "Upgrade", href: "/pricing" },
      { icon: Settings, label: "Settings", href: "/account/settings" },
      { icon: Activity, label: "Account Health", href: "/account/account-health" },
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
      { icon: Plug, label: "My Plugins", href: "/account/plugins" },
      { icon: Cpu, label: "Active Agents", href: "/account/agents" },
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
  },
{
        label: "Trading",
        items: [
          { icon: Bot, label: "My Bots", href: "/account/bots" },
          { icon: GitBranch, label: "Workflow Automation", href: "/account/workflows" },
          { icon: Zap, label: "AI Signals", href: "/signals" },
          { icon: LineChart, label: "Trading Studio", href: "/account/tradingview" },
          { icon: RotateCcw, label: "Trade Replay", href: "/trade-replay" },
          { icon: FlaskConical, label: "Strategy Lab", href: "/strategy-lab" },
          { icon: Target, label: "Smart Management", href: "/trade-management" },
          { icon: Bell, label: "Alert Center", href: "/alert-center" },
          { icon: BarChart3, label: "Backtests", href: "/backtests" },
          { icon: Activity, label: "Live Accounts", href: "/account/live" },
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
  onBack,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("AlgoVault");

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
      <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
        </span>
        {user ? "Signed in" : "Signed out"}
      </span>
    </div>
  );

  return (
    <AppShell
      navGroups={ACCOUNT_NAV}
      title={title}
      subtitle={subtitle}
      onBack={onBack}
      headerActions={headerActions}
      role="account"
      maxWidth="max-w-7xl"
    >
      {children}
    </AppShell>
  );
}