import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download, Monitor, Apple } from "lucide-react";

export const metadata: Metadata = {
  title: "How AlgoVault Works — Trading Platform & Desktop App",
  description: "Learn how AlgoVault works: marketplace discovery, market analysis, strategy testing, MT5 connections, desktop apps, and onboarding.",
  alternates: {
    canonical: "/how-it-works",
  },
  openGraph: {
    title: "How AlgoVault Works",
    description: "Explore the platform, test strategies, connect MT5, and download desktop apps.",
  },
};

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero intro */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-[#0b0c0e] via-[#111318] to-[#0b0c0e]">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-8 md:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-extrabold tracking-[-0.04em] text-foreground md:text-6xl">
              How AlgoVault Works
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground md:text-xl">
              AlgoVault is an AI-powered trading platform and strategy marketplace. It connects research, validation, execution, and intelligence into one workspace — available on the web and desktop.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/marketplace" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 transition">Explore Marketplace</Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-lg bg-card border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:border-primary/30 transition">View Pricing</Link>
              <Link href="/how-it-works#desktop" className="inline-flex items-center gap-2 rounded-lg bg-card border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:border-primary/30 transition">Desktop Apps</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-16 md:px-8 md:py-24 space-y-24">
        {/* A. Introduction */}
        <section aria-label="Introduction">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Introduction</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            AlgoVault combines a strategy marketplace, AI market intelligence, backtesting validation, a scalping terminal, and MT5 gateway integration. It is designed for traders, researchers, and developers who need a verifiable, transparent workflow from idea to execution. The desktop applications bring the same workspace to your desktop with native window controls, persistent preferences, and offline-resilient connection states.
          </p>
        </section>

        {/* B. Marketplace */}
        <section aria-label="Marketplace" id="marketplace">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Explore the Marketplace</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Discover trading bots, indicators, and other tools built for MetaTrader 5. Products include free and paid offerings, one-time purchases, and subscription-based access. Each product page includes verified performance data, methodology links, and clear compatibility notes.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
            <li>Free indicators and community strategies</li>
            <li>Paid Expert Advisors (EAs) and toolkits</li>
            <li>Subscription-based signals and intelligence feeds</li>
            <li>Verified performance reports linked to each product</li>
          </ul>
          <div className="mt-6">
            <Link href="/marketplace" className="text-sm font-semibold text-primary hover:text-primary/80 underline underline-offset-4">Browse the Marketplace →</Link>
          </div>
        </section>

        {/* C. Analyze */}
        <section aria-label="Market Analysis">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Analyze the Markets</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            The Pro Terminal provides real-time charts, technical indicators, Smart Money Concepts analytics, and market intelligence feeds. Use the scanner to identify patterns, the replay engine to study historical scenarios, and the intelligence bar to observe live conditions.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Pro Terminal", desc: "Real-time charts, indicators, and execution interface.", href: "/live" },
              { title: "AI Intelligence", desc: "Smart Money and market intelligence feeds.", href: "/ai-copilot" },
              { title: "Market Scanner", desc: "Pattern discovery and signal detection.", href: "/scanner" },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="rounded-xl border border-border bg-card p-4 text-sm hover:border-primary/30 transition">
                <span className="font-semibold text-foreground">{item.title}</span>
                <span className="block mt-1 text-muted-foreground">{item.desc}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* D. Test Strategies */}
        <section aria-label="Test Strategies">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Test Strategies</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Backtesting evaluates strategy behavior against historical data. Results are statistical and do not guarantee future performance. The platform clearly distinguishes between historical validation and live results, and requires users to review methodology documentation before deploying any strategy.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
            <li>Backtest configurations with reproducible parameters</li>
            <li>Historical validation reports linked to strategy pages</li>
            <li>Explicit disclaimers that past performance is not predictive</li>
          </ul>
          <div className="mt-6">
            <Link href="/backtests" className="text-sm font-semibold text-primary hover:text-primary/80 underline underline-offset-4">Open Backtests →</Link>
          </div>
        </section>

        {/* E. Connect Trading Platforms */}
        <section aria-label="Connect Trading Platforms">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Connect Trading Platforms</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            AlgoVault supports MetaTrader 5 connections through the gateway and execution bridge. You can connect demo or live accounts, view connection status, and manage orders through the Pro Terminal. Universal broker compatibility is not claimed; supported brokers are documented in <Link href="/docs/integrations/tradingview-execution-bridge" className="text-primary underline underline-offset-2">integration documentation</Link>.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
            <li>MT5 gateway with demo and live account support</li>
            <li>Connection status indicators in the desktop and web apps</li>
            <li>Prerequisites: validated MT5 account and enabled gateway access</li>
          </ul>
        </section>

        {/* F. Manage Workspace */}
        <section aria-label="Workspace">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Manage Your Workspace</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Create or sign in to your account to save preferences, manage subscriptions, access licenses, and view purchase history. Pro subscriptions unlock premium features such as AI Copilot, performance arena access, and advanced signals.
          </p>
          <div className="mt-4 flex gap-3">
            <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 text-sm font-semibold hover:border-primary/30 transition">Sign In</Link>
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 text-sm font-semibold hover:border-primary/30 transition">Subscription Plans</Link>
          </div>
        </section>

        {/* G. Desktop */}
        <section aria-label="Desktop apps" id="desktop">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Use AlgoVault on Desktop</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Download the desktop application for Windows and macOS. The desktop build embeds the production Next.js workspace inside a native Electron shell with custom chrome, native menus, tray icon, connection overlay, and persistent preferences. Builds are available as preview releases; final stable releases will be published after CI verification and signing.
          </p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <Monitor className="h-8 w-8 text-primary" />
                <div>
                  <h3 className="font-bold text-foreground">Windows App</h3>
                  <p className="text-xs text-muted-foreground">x64 · Windows 10+</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Native window chrome, menus, tray, and connection overlay. Download the .exe installer once the preview build completes verification.</p>
              <Link href="/downloads/releases.json" className="mt-4 inline-block text-sm font-semibold text-primary hover:text-primary/80 underline underline-offset-4">View release manifest →</Link>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <Apple className="h-8 w-8 text-primary" />
                <div>
                  <h3 className="font-bold text-foreground">macOS App</h3>
                  <p className="text-xs text-muted-foreground">Apple Silicon + Intel · macOS 13+</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Universal .dmg package with embedded workspace. Preview status; final package produced after macOS runner verification.</p>
              <Link href="/downloads/releases.json" className="mt-4 inline-block text-sm font-semibold text-primary hover:text-primary/80 underline underline-offset-4">View release manifest →</Link>
            </div>
          </div>
        </section>

        {/* H. Getting Started */}
        <section aria-label="Getting Started">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Getting Started</h2>
          <ol className="mt-6 space-y-4">
            {[
              "Create an account at /login or /register.",
              "Explore the marketplace and add a product or strategy to your workspace.",
              "Open the Pro Terminal at /live to review charts and indicators.",
              "Run a backtest at /backtests or review historical validation.",
              "Connect your MT5 account through the gateway when ready.",
              "Download the desktop app from the homepage download section once preview builds are verified."
            ].map((step, i) => (
              <li key={i} className="flex gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-extrabold text-primary">{i + 1}</span>
                <span className="text-sm leading-relaxed text-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6">
            <Link href="/" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">Back to Homepage</Link>
          </div>
        </section>

        {/* I. FAQ */}
        <section aria-label="FAQ">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Frequently Asked Questions</h2>
          <dl className="mt-6 space-y-6">
            {[
              { q: "Is AlgoVault financial advice?", a: "No. AlgoVault provides research tooling, validation, and execution interfaces. It does not provide financial advice or guarantee results." },
              { q: "What platforms does it support?", a: "Web browsers, Windows (x64 desktop app), and macOS (Apple Silicon + Intel desktop app). MT5 gateway integration is supported; universal broker compatibility is not claimed." },
              { q: "Is the desktop app required?", a: "No. The full workspace is available in the web app. The desktop app provides native chrome, persistent preferences, and offline-resilient connection states." },
              { q: "How are desktop builds published?", a: "The desktop-release CI workflow builds on windows-latest and macos-latest runners. Artifacts are published as GitHub Releases; the homepage connects to the release manifest at /downloads/releases.json." },
              { q: "What does Preview mean?", a: "Preview builds have passed local packaging but may not have completed full CI verification or signing. Stable releases require verified artifacts, signing credentials, and completed CI checks." },
            ].map((item, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <dt className="font-semibold text-foreground">{item.q}</dt>
                <dd className="mt-2 text-sm text-muted-foreground">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Call to action */}
        <section className="rounded-2xl border border-border bg-gradient-to-br from-[#0b0c0e] to-[#111318] p-8 shadow-xl md:p-12">
          <h2 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">Ready to start?</h2>
          <p className="mt-3 text-muted-foreground">Explore the marketplace, open the terminal, or download the desktop app when preview builds complete verification.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">Explore Marketplace</Link>
            <Link href="/live" className="inline-flex items-center gap-2 rounded-lg bg-card border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:border-primary/30 transition">Open Pro Terminal</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
