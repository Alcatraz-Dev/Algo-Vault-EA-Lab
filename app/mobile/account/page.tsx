"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User, Wallet, CreditCard, FileKey2, Settings, Bell, LogOut, Shield, Bot, BarChart2, Zap, ChevronRight, AlertTriangle, Activity } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { database } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/loading-state";
import { useRouter } from "next/navigation";
import { MobileErrorBoundary } from "@/components/mobile/MobileErrorBoundary";

interface UserProfile {
  uid?: string;
  email?: string;
  displayName?: string;
  role?: string;
  createdAt?: number;
  subscription?: { status: string; plan: string; stripeSubscriptionId?: string };
  developerSubscription?: { status: string; plan: string };
  developerApproved?: boolean;
}

interface TradingAccount {
  id: string;
  mt5Account: string;
  broker: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  status: string;
  lastHeartbeatAt: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const ACCOUNT_SECTIONS = [
  { id: "overview", label: "Overview", icon: User },
  { id: "accounts", label: "Trading Accounts", icon: Wallet },
  { id: "licenses", label: "Licenses", icon: FileKey2 },
  { id: "subscriptions", label: "Subscriptions", icon: CreditCard },
  { id: "bots", label: "My Bots", icon: Bot },
  { id: "signals", label: "Signal Access", icon: Zap },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export default function MobileAccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authLoading && user) {
      setLoading(true);
      // Fetch profile
      const profileRef = ref(database, `users/${user.uid}`);
      const profileUnsub = onValue(profileRef, (snap) => {
        if (snap.exists()) setProfile(snap.val());
        else setProfile({ uid: user.uid, email: user.email || "", displayName: user.displayName || "Trader", role: "customer" });
      });

      // Fetch accounts
      const accountsRef = ref(database, `trading_accounts/${user.uid}`);
      const accountsUnsub = onValue(accountsRef, (snap) => {
        const accountData: TradingAccount[] = [];
        if (snap.exists()) {
          const data = snap.val();
          for (const [id, val] of Object.entries(data)) {
            const acc = val as Record<string, unknown>;
            accountData.push({
              id, mt5Account: String(acc.mt5Account || ""), broker: String(acc.broker || ""),
              balance: Number(acc.balance || 0), equity: Number(acc.equity || 0),
              margin: Number(acc.margin || 0), freeMargin: Number(acc.freeMargin || 0),
              marginLevel: Number(acc.marginLevel || 0), status: String(acc.status || ""),
              lastHeartbeatAt: Number(acc.lastHeartbeatAt || 0),
            });
          }
        }
        setAccounts(accountData);
      });

      setLoading(false);
      return () => { profileUnsub(); accountsUnsub(); };
    }
  }, [authLoading, user]);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/");
  };

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-40 h-14 bg-background/80 backdrop-blur-sm border-b border-border flex items-center px-4">
          <h1 className="text-lg font-semibold">Account</h1>
        </header>
        <div className="flex-1 p-4 space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen bg-background items-center justify-center p-8 text-center">
        <User className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold mb-2">Sign in to access your account</h1>
        <Link href="/login"><Button className="w-full sm:w-auto">Sign In</Button></Link>
      </div>
    );
  }

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = accounts.reduce((sum, a) => sum + a.equity, 0);
  const floatingPnl = totalEquity - totalBalance;
  const onlineAccounts = accounts.filter(a => a.status === "online").length;
  const isPro = profile?.subscription?.status === "active";
  const isDev = profile?.role === "developer" || profile?.developerApproved;

  const renderOverview = () => (
    <div className="space-y-4 p-4">
      {/* Profile Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
              <User className="h-7 w-7 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold truncate">{profile?.displayName || "Trader"}</h2>
              <p className="text-sm text-muted-foreground truncate">{profile?.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={isPro ? "default" : "outline"} className={cn(isPro && "bg-emerald-500/10 text-emerald-400")}>
                  {isPro ? "PRO" : "FREE"}
                </Badge>
                {isDev && <Badge variant="outline" className="border-violet-500/30 text-violet-400">Developer</Badge>}
                {profile?.role === "admin" && <Badge variant="destructive" className="text-[10px]">Admin</Badge>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Summary */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Wallet className="h-5 w-5" /> Trading Accounts</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] font-medium uppercase text-muted-foreground">Total Balance</p>
              <p className="font-mono text-xl font-bold mt-1">{formatCurrency(totalBalance)}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] font-medium uppercase text-muted-foreground">Equity</p>
              <p className={cn("font-mono text-xl font-bold mt-1", floatingPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatCurrency(totalEquity)}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] font-medium uppercase text-muted-foreground">Floating P&L</p>
              <p className={cn("font-mono text-xl font-bold mt-1", floatingPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{floatingPnl >= 0 ? "+" : ""}{formatCurrency(floatingPnl)}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] font-medium uppercase text-muted-foreground">Online</p>
              <p className="font-mono text-xl font-bold mt-1 text-emerald-400">{onlineAccounts} / {accounts.length}</p>
            </div>
          </div>
          {accounts.length > 0 && (
            <Link href="/account/trading-access" className="mt-3 block text-sm text-primary hover:underline flex items-center justify-center gap-1">
              View all accounts <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/marketplace"><Button variant="outline" className="h-20 flex flex-col gap-1"><CreditCard className="h-5 w-5" /> Marketplace</Button></Link>
            <Link href="/account/bots"><Button variant="outline" className="h-20 flex flex-col gap-1"><Bot className="h-5 w-5" /> My Bots</Button></Link>
            <Link href="/signals"><Button variant="outline" className="h-20 flex flex-col gap-1"><Zap className="h-5 w-5" /> AI Signals</Button></Link>
            <Link href="/trade-journal"><Button variant="outline" className="h-20 flex flex-col gap-1"><BarChart2 className="h-5 w-5" /> Trade Journal</Button></Link>
            <Link href="/account/licenses"><Button variant="outline" className="h-20 flex flex-col gap-1"><FileKey2 className="h-5 w-5" /> Licenses</Button></Link>
            <Link href="/account/settings"><Button variant="outline" className="h-20 flex flex-col gap-1"><Settings className="h-5 w-5" /> Settings</Button></Link>
          </div>
        </CardContent>
      </Card>

      {/* Risk Status */}
      <Card className={cn(accounts.length > 0 && floatingPnl < -totalBalance * 0.1 && "border-rose-500/30")}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", floatingPnl < -totalBalance * 0.1 ? "bg-rose-500/10" : "bg-emerald-500/10")}>
                {floatingPnl < -totalBalance * 0.1 ? <AlertTriangle className="h-5 w-5 text-rose-400" /> : <Shield className="h-5 w-5 text-emerald-400" />}
              </div>
              <div>
                <h3 className="font-semibold">Risk Status</h3>
                <p className="text-sm text-muted-foreground">{floatingPnl < -totalBalance * 0.1 ? "Drawdown detected" : "All accounts within normal limits"}</p>
              </div>
            </div>
            <Link href="/risk"><Button variant="ghost" size="sm">View Details</Button></Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderAccounts = () => (
    <div className="space-y-3 p-4 pb-20">
      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-1">No trading accounts connected</h3>
            <p className="text-sm text-muted-foreground mb-4">Connect your MT5 account to track balance, equity, and positions.</p>
            <Link href="/account/trading-access"><Button>Connect MT5 Account</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {accounts.map((acc) => (
            <Link key={acc.id} href={`/account/trading-access/${acc.id}`} className="block">
              <Card className={cn("p-3 transition-colors hover:border-primary/30", acc.status !== "online" && "border-rose-500/30")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg", acc.status === "online" ? "bg-emerald-500/10" : "bg-rose-500/10")}>
                      {acc.status === "online" ? <Activity className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-rose-400" />}
                    </div>
                    <div>
                      <p className="font-semibold truncate">{acc.broker}</p>
                      <p className="text-xs text-muted-foreground font-mono">{acc.mt5Account}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">{formatCurrency(acc.balance)}</p>
                    <p className={cn("text-xs font-mono", acc.equity >= acc.balance ? "text-emerald-400" : "text-rose-400")}>{formatCurrency(acc.equity)}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] text-muted-foreground">
                  <div><p className="font-mono font-medium">{acc.marginLevel.toFixed(1)}%</p><p>Margin Level</p></div>
                  <div><p className="font-mono font-medium">{formatCurrency(acc.freeMargin)}</p><p>Free Margin</p></div>
                  <div><p className="font-mono font-medium">{formatCurrency(acc.margin)}</p><p>Used Margin</p></div>
                </div>
              </Card>
            </Link>
          ))}
        </>
      )}
    </div>
  );

  const renderLicenses = () => (
    <div className="p-4 pb-20">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><FileKey2 className="h-5 w-5" /> Licenses</h3>
            <Link href="/account/licenses"><Button variant="ghost" size="sm">View All</Button></Link>
          </div>
          <p className="text-sm text-muted-foreground mb-4">License management is available on the full account page.</p>
          <Link href="/account/licenses"><Button className="w-full">Manage Licenses</Button></Link>
        </CardContent>
      </Card>
    </div>
  );

  const renderSubscriptions = () => (
    <div className="p-4 pb-20">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><CreditCard className="h-5 w-5" /> Subscription</h3>
            <Link href="/pricing"><Button variant="ghost" size="sm">Upgrade</Button></Link>
          </div>
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{isPro ? "Pro Plan" : "Free Plan"}</p>
                <p className="text-sm text-muted-foreground">{isPro ? "Active subscription" : "No active subscription"}</p>
              </div>
              <Badge variant={isPro ? "default" : "outline"} className={cn(isPro && "bg-emerald-500/10 text-emerald-400")}>
                {isPro ? "PRO" : "FREE"}
              </Badge>
            </div>
          </div>
          {!isPro && <Link href="/pricing" className="mt-3 block"><Button className="w-full">Upgrade to Pro</Button></Link>}
        </CardContent>
      </Card>
    </div>
  );

  const renderBots = () => (
    <div className="p-4 pb-20">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><Bot className="h-5 w-5" /> My Bots</h3>
            <Link href="/account/bots"><Button variant="ghost" size="sm">View All</Button></Link>
          </div>
          <p className="text-sm text-muted-foreground mb-4">Bot management is available on the full account page.</p>
          <Link href="/account/bots"><Button className="w-full">Manage Bots</Button></Link>
        </CardContent>
      </Card>
    </div>
  );

  const renderNotifications = () => (
    <div className="p-4 pb-20">
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><Bell className="h-5 w-5" /> Notifications</h3>
          <p className="text-sm text-muted-foreground mb-4">Manage your notification preferences for signals, bots, risk alerts, and more.</p>
          <Link href="/account/settings#notifications"><Button className="w-full">Notification Settings</Button></Link>
        </CardContent>
      </Card>
    </div>
  );

  const renderSettings = () => (
    <div className="p-4 pb-20 space-y-4">
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-4">Account Settings</h3>
          <Link href="/account/settings"><Button variant="outline" className="w-full justify-start gap-3"><Settings className="h-5 w-5" /> General Settings</Button></Link>
          <Link href="/account/settings#security"><Button variant="outline" className="w-full justify-start gap-3 mt-2"><Shield className="h-5 w-5" /> Security</Button></Link>
          <Link href="/account/settings#notifications"><Button variant="outline" className="w-full justify-start gap-3 mt-2"><Bell className="h-5 w-5" /> Notifications</Button></Link>
        </CardContent>
      </Card>
      <Card className="border-rose-500/30">
        <CardContent className="p-4">
          <Button variant="destructive" className="w-full justify-start gap-3" onClick={handleSignOut}>
            <LogOut className="h-5 w-5" /> Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const tabContent: Record<string, () => React.ReactElement> = {
    overview: renderOverview,
    accounts: renderAccounts,
    licenses: renderLicenses,
    subscriptions: renderSubscriptions,
    bots: renderBots,
    signals: () => <div className="p-4 pb-20"><Link href="/signals"><Button className="w-full">View AI Signals</Button></Link></div>,
    notifications: renderNotifications,
    settings: renderSettings,
  };

  return (
    <MobileErrorBoundary>
      <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="h-14 flex items-center justify-between px-4">
          <h1 className="text-lg font-semibold">Account</h1>
        </div>
        
        {/* Tab Navigation */}
        <div className="px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide">
          <div className="flex gap-1 min-w-max">
            {ACCOUNT_SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors touch-target flex items-center gap-1.5",
                  activeTab === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : (
          tabContent[activeTab]()
        )}
      </div>
    </div>
  </MobileErrorBoundary>
);
}