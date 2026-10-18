"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bell,
  Brain,
  ChartLine,
  CheckCircle2,
  CircuitBoard,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  Gauge,
  Globe,
  LayoutGrid,
  Loader2,
  Lock,
  MousePointerClick,
  PlayCircle,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const CHROME_WEB_STORE_SEARCH =
  "https://chromewebstore.google.com/search/algovault%20trading%20intelligence";

interface ProAccessResponse {
  success: boolean;
  access: "granted" | "denied";
  subscription?: {
    plan?: string;
    status?: string;
    currentPeriodEnd?: number | null;
  };
  reason?: string;
  upgrade?: boolean;
  message?: string;
  userId?: string;
  timestamp?: number;
}

interface ExtensionHealthResponse {
  success: boolean;
  flags: Record<string, boolean>;
  timestamp: number;
}

interface FeatureSpec {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

const PRO_FEATURES: FeatureSpec[] = [
  {
    id: "tradingViewProExtension",
    title: "AI Chart Copilot",
    description:
      "Ask the copilot anything about the current chart. It reads your TradingView context, the AlgoVault Market Intelligence layer, and replies with traceable reasoning.",
    icon: Brain,
  },
  {
    id: "aiChartCopilot",
    title: "Evidence-based Analysis",
    description:
      "Every conclusion comes with underlying evidence — market structure, liquidity sweeps, indicator confluences, and conflicting signals. No black-box predictions.",
    icon: BadgeCheck,
  },
  {
    id: "setupRadar",
    title: "AI Setup Radar",
    description:
      "Continuously monitors your active TradingView chart for forming, confirmed, and invalidated setups using the AlgoVault Setup Memory lifecycle.",
    icon: Radar,
  },
  {
    id: "smartAlerts",
    title: "Smart Alerts",
    description:
      "Deterministic alerts from real indicator conditions with AI explanations and prioritization. Never invents market events.",
    icon: Bell,
  },
  {
    id: "aiIndicatorGenerator",
    title: "AI Indicator Generator",
    description:
      "Describe what you need in natural language. Generate, validate, and save Pine Script indicators directly to your AlgoVault library.",
    icon: CircuitBoard,
  },
  {
    id: "aiStrategyGenerator",
    title: "AI Strategy Generator",
    description:
      "Generate complete strategies from descriptions and send them straight to the AlgoVault backtesting engine — no duplicate infrastructure.",
    icon: Workflow,
  },
];

function chromeRuntimeAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { chrome?: { runtime?: { id?: string } } })
      .chrome?.runtime?.id === "string"
  );
}

export default function ProTradingExtensionPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [proStatus, setProStatus] = useState<ProAccessResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [healthFlags, setHealthFlags] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const fetchProStatus = useCallback(async () => {
    if (!user) {
      setStatusLoading(false);
      return;
    }
    setStatusLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/extension/pro-access", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as ProAccessResponse;
      setProStatus(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load Pro status"
      );
    } finally {
      setStatusLoading(false);
    }
  }, [user]);

  const fetchHealth = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/extension/pro-feature-flag", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as ExtensionHealthResponse;
      if (data?.flags && typeof data.flags === "object") {
        setHealthFlags(data.flags);
      }
    } catch {
      // health is optional
    }
  }, [user]);

  useEffect(() => {
    void fetchProStatus();
    void fetchHealth();
  }, [fetchProStatus, fetchHealth]);

  useEffect(() => {
    setExtensionConnected(chromeRuntimeAvailable());
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    await fetchProStatus();
    await fetchHealth();
    setRefreshing(false);
  }, [user, fetchProStatus, fetchHealth]);

  const isPro = proStatus?.access === "granted";
  const subscription = proStatus?.subscription;
  const isExpired =
    subscription?.status === "expired" ||
    subscription?.status === "cancelled" ||
    subscription?.status === "past_due";

  const activeFeatureCount = useMemo(
    () => Object.values(healthFlags).filter(Boolean).length,
    [healthFlags]
  );

  return (
    <AccountShell
      title="Pro Trading Extension"
      subtitle="AI chart copilot for TradingView that lives directly beside your chart. Get traceable analysis, smart alerts, and Pine Script generation powered by AlgoVault intelligence."
      eyebrow={
        <Badge
          variant={isPro && !isExpired ? "default" : "secondary"}
          className="px-2 py-1 font-semibold uppercase tracking-wider"
        >
          <Lock className="mr-1 h-3 w-3" />
          {isPro && !isExpired ? "Pro Active" : "Pro Required"}
        </Badge>
      }
    >
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-xl border bg-card p-6 sm:p-8 lg:p-10">
          <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[--primary-text]" />
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  AlgoVault Pro
                </span>
              </div>
              <div className="space-y-4">
                <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
                  AlgoVault Pro Trading Intelligence
                </h1>
                <p className="max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
                  TradingView + TradingView MCP + AlgoVault Market Intelligence + AI — one professional trading intelligence environment that lives directly beside your chart.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {isPro && !isExpired ? (
                  <>
                    <Button size="lg" className="gap-2" render={<a href={CHROME_WEB_STORE_SEARCH} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" />Get the Extension<ExternalLink className="h-3.5 w-3.5 opacity-80" /></a>} nativeButton={false} />
                    <Button variant="outline" size="lg" className="gap-2" render={<Link href="/strategy-lab"><ChartLine className="h-4 w-4" />Open Strategy Lab</Link>} nativeButton={false} />
                  </>
                ) : (
                  <>
                    <Button size="lg" className="gap-2" render={<Link href="/pricing"><Sparkles className="h-4 w-4" />Upgrade to Pro<ArrowRight className="h-3.5 w-3.5" /></Link>} nativeButton={false} />
                    <Button variant="outline" size="lg" className="gap-2" render={<Link href="/ai-copilot"><Eye className="h-4 w-4" />Preview the AI Copilot</Link>} nativeButton={false} />
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-6 pt-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                  <span>Chrome, Edge, Brave (Chromium 116+)</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                  <span>Server-side Pro enforcement</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                  <span>Works with TradingView</span>
                </div>
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
              <div className="relative aspect-[16/10] overflow-hidden rounded-xl border bg-muted/30 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.5)]">
                <Image
                  src="/extension-sidepanel.png"
                  alt="AlgoVault Pro Trading Extension side panel on TradingView"
                  fill
                  className="object-cover object-left-top"
                  sizes="(max-width: 1024px) 100vw, 560px"
                  priority
                />
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1.8fr_1fr]">
          <div className="space-y-8">
            {/* Features */}
            <section className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    Pro Extension Features
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    The extension connects your TradingView context to AlgoVault's intelligence stack with traceable, evidence-based analysis.
                  </p>
                </div>
                <Badge variant="outline" className="font-medium">
                  {activeFeatureCount}/{PRO_FEATURES.length} live
                </Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {PRO_FEATURES.map((feature) => {
                  const Icon = feature.icon;
                  const live = healthFlags[feature.id] ?? true;
                  return (
                    <Card key={feature.id} className="group h-full transition-colors hover:border-foreground/15">
                      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[--primary]/10 text-[--primary-text]">
                          <Icon className="h-5 w-5" />
                        </div>
                        <Badge
                          variant={live ? "default" : "secondary"}
                          className="font-medium uppercase tracking-wide"
                        >
                          {live ? "Live" : "Soon"}
                        </Badge>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <CardTitle className="text-base">{feature.title}</CardTitle>
                        <CardDescription className="text-sm leading-relaxed">
                          {feature.description}
                        </CardDescription>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* How it works */}
            <section className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">
                  How It Works
                </h2>
                <p className="text-sm text-muted-foreground">
                  The extension reads your live TradingView chart context and enriches it with AlgoVault's market intelligence and AI reasoning.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  {
                    icon: Globe,
                    step: "01",
                    title: "TradingView Detection",
                    body: "Symbol, exchange, and timeframe are read live from the active chart.",
                  },
                  {
                    icon: Cpu,
                    step: "02",
                    title: "TradingView MCP",
                    body: "Optional connection enriches context with screener, news, watchlists, and technicals.",
                  },
                  {
                    icon: Gauge,
                    step: "03",
                    title: "Market Intelligence",
                    body: "Reuses AlgoVault's engine for structure, liquidity, regime, and multi-timeframe analysis.",
                  },
                  {
                    icon: Sparkles,
                    step: "04",
                    title: "AI Layer",
                    body: "Structured analysis with explicit evidence and conflicting signals — never a black box.",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Card key={item.step} className="h-full">
                      <CardContent className="flex gap-4 p-5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-sm font-semibold">
                          {item.step}
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-[--primary-text]" />
                            <h3 className="text-sm font-semibold">
                              {item.title}
                            </h3>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {item.body}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* Free vs Pro */}
            <section className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Free vs Pro
                </h2>
                <p className="text-sm text-muted-foreground">
                  The extension is useful without a subscription. Pro unlocks the AI surfaces that are enforced server-side.
                </p>
              </div>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Capability</TableHead>
                        <TableHead className="text-center">Free</TableHead>
                        <TableHead className="text-center pr-6">Pro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { name: "Chart analysis, market verdict & MTF alignment", free: true, pro: true },
                        { name: "Price alerts from the chart overlay", free: true, pro: true },
                        { name: "Demo (paper) trading ticket", free: true, pro: true },
                        { name: "AI Daily Signals (3 per day, server-enforced quota)", free: true, pro: true },
                        { name: "AI Chart Copilot with per-symbol memory", free: false, pro: true },
                        { name: "Setup Radar, Smart Alerts & pre-trade checklist", free: false, pro: true },
                        { name: "Pine Script indicator & strategy generators", free: false, pro: true },
                        { name: "MT5 execution bridge with confirmations & receipts", free: false, pro: true },
                      ].map((row) => (
                        <TableRow key={row.name}>
                          <TableCell className="pl-6 text-sm">{row.name}</TableCell>
                          <TableCell className="text-center">
                            {row.free ? (
                              <CheckCircle2 className="mx-auto h-4 w-4 text-[--positive]" />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center pr-6">
                            <CheckCircle2 className="mx-auto h-4 w-4 text-[--positive]" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
          </div>

          <aside className="space-y-6">
            {/* Entitlement */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Entitlement</CardTitle>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={refresh}
                  disabled={refreshing || !user}
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                  />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {authLoading || statusLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking your subscription…
                  </div>
                ) : !user ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Sign in to view your Pro entitlement.
                    </p>
                    <Button variant="outline" className="w-full" render={<Link href="/login">Sign in</Link>} nativeButton={false} />
                  </div>
                ) : error ? (
                  <div className="flex items-start gap-2 rounded-lg border border-[--negative]/30 bg-[--negative]/5 p-3 text-sm text-[--negative]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3",
                        isPro && !isExpired
                          ? "border-[--primary]/30 bg-[--primary]/5"
                          : "border-border bg-muted/30"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          isPro && !isExpired
                            ? "bg-[--primary]/15 text-[--primary-text]"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {isPro && !isExpired ? (
                          <ShieldCheck className="h-4 w-4" />
                        ) : (
                          <Lock className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">
                            {isPro && !isExpired
                              ? "Pro access granted"
                              : isPro && isExpired
                              ? "Pro expired"
                              : "No Pro subscription"}
                          </p>
                          {isPro && !isExpired && (
                            <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {isPro && !isExpired && subscription?.plan
                            ? `Plan: ${subscription.plan} · Status: ${subscription.status ?? "active"}`
                            : isPro && isExpired
                            ? "Your subscription has lapsed. Renew to restore extension access."
                            : "Upgrade to Pro to unlock the full extension feature set."}
                        </p>
                      </div>
                    </div>
                    {(!isPro || isExpired) && (
                      <Button className="w-full gap-2" render={<Link href="/pricing">{isExpired ? "Renew Pro" : "Upgrade to Pro"}<ArrowRight className="h-3.5 w-3.5" /></Link>} nativeButton={false} />
                    )}
                  </div>
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Entitlement is verified server-side. Client-side checks cannot unlock Pro features.
                </p>
              </CardContent>
            </Card>

            {/* Browser Extension */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Browser Extension</CardTitle>
                <Badge variant={extensionConnected ? "default" : "secondary"}>
                  {extensionConnected ? "Detected" : "Not Installed"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {extensionConnected
                    ? "AlgoVault extension is installed and connected on this browser. Open TradingView to get started."
                    : "Install the Chrome extension to dock AlgoVault Pro Trading Intelligence next to TradingView."}
                </p>
                <div className="space-y-2">
                  <Button variant="outline" className="w-full gap-2" render={<a href={CHROME_WEB_STORE_SEARCH} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" />Open in Chrome Web Store<ExternalLink className="h-3.5 w-3.5 opacity-60" /></a>} nativeButton={false} />
                  {extensionConnected && (
                    <Button variant="ghost" className="w-full gap-2" render={<Link href="/account/tradingview"><Activity className="h-4 w-4" />Manage Installation</Link>} nativeButton={false} />
                  )}
                </div>
                <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                  <h4 className="text-sm font-semibold">Requirements</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                      Chrome, Edge, Brave, or any Chromium 116+
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                      Active AlgoVault Pro subscription
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                      TradingView account (free or paid)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[--positive]" />
                      Optional: TradingView MCP for richer context
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* What it doesn't do */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-[--primary-text]" />
                  Safety & Transparency
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[--positive]" />
                    <span>Never places trades automatically — every action requires your explicit confirmation.</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[--positive]" />
                    <span>Never handles broker passwords or API secrets — authenticated through your AlgoVault session.</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[--positive]" />
                    <span>Decision support only — not financial advice. No guaranteed trading outcomes.</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[--positive]" />
                    <span>Respects privacy — only accesses TradingView tabs and requires explicit consent.</span>
                  </li>
                </ul>
                <Button variant="link" className="h-auto p-0" render={<Link href="/privacy" className="gap-1">View Privacy Policy<ExternalLink className="h-3 w-3" /></Link>} nativeButton={false} />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AccountShell>
  );
}
