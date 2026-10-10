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
  Brain,
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
  ShieldCheck,
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
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import SiteLogo from "@/components/ui/site-logo";
import { cn } from "@/lib/utils";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { ACCOUNT_NAV } from "./account-nav";

/**
 * Candel workspace navigation. The Candel area is its own product surface, so
 * it gets its own nav group instead of the generic account menu.
 */
const CANDEL_NAV: NavGroup[] = [
  {
    label: "Candels",
    items: [
      { href: "/account/candels", label: "My Candels", icon: Bot },
      { href: "/account/candels/builder", label: "Builder", icon: Zap },
      { href: "/account/candels/approvals", label: "Approvals", icon: ShieldCheck },
      { href: "/account/candels/memory", label: "Memory", icon: Brain },
      { href: "/account/candels/activity", label: "Activity", icon: Activity },
      { href: "/account/candels/automations", label: "Automations", icon: GitBranch },
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
  eyebrow?: React.ReactNode;
  onBack?: () => void;
  headerActions?: React.ReactNode;
  hideSidebar?: boolean;
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
