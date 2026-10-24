import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { StructuredData } from "@/components/seo/StructuredData";

const SITE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://algovault.app";

export const metadata: Metadata = {
  title: "AlgoVault TypeScript SDK",
  description: "Official TypeScript SDK for the AlgoVault Intelligence Cloud API.",
  alternates: {
    canonical: "/docs/sdk",
  },
};

export default function SdkDocsPage() {
  const breadcrumbsSchema = {
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Documentation", item: `${SITE_URL}/docs` },
      { "@type": "ListItem", position: 3, name: "SDK", item: `${SITE_URL}/docs/sdk` },
    ],
  };

  return (
    <main className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <StructuredData type="BreadcrumbList" data={breadcrumbsSchema} id="jsonld-sdk-docs-breadcrumb" />
      <article className="max-w-4xl mx-auto space-y-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/docs" className="hover:text-warning transition-colors">Documentation</Link>
          <span>/</span>
          <span className="text-foreground font-medium">SDK</span>
        </nav>

        <header className="border-b border-muted pb-6">
          <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-muted text-warning border border-border mb-3">
            Developer
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            TypeScript SDK
          </h1>
          <p className="mt-4 text-foreground text-lg leading-relaxed">
            Official typed TypeScript SDK for the AlgoVault Intelligence Cloud API.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">What it does</h2>
          <p className="text-foreground">
            The AlgoVault TypeScript SDK provides a typed, ergonomic client for interacting with the Intelligence Cloud API. It handles authentication, request serialization, error handling, timeouts, and safe retry behavior.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Installation</h2>
          <p className="text-foreground">
            The SDK is available in the repository at <code className="bg-muted px-1.5 py-0.5 rounded">packages/algovault-sdk/</code>. It is not yet published to npm.
          </p>
          <div className="bg-muted/50 rounded-lg p-4">
            <code className="text-sm">npm install @algovault/sdk</code>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Quick Start</h2>
          <div className="bg-muted/50 rounded-lg p-4 overflow-x-auto">
            <pre className="text-sm text-foreground"><code>{`import { AlgoVault } from '@algovault/sdk';

const client = new AlgoVault({
  apiKey: process.env.ALGOVAULT_API_KEY!,
});

const market = await client.market.get({ symbol: 'EURUSD', timeframe: '1H' });
const indicators = await client.indicators.get({ symbol: 'EURUSD', timeframe: '1H' });
`}</code></pre>
          </div>
          <p className="text-sm text-muted-foreground">
            <strong>Security:</strong> Never expose API keys in browser/client-side code. Use environment variables on the server side only.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Supported Endpoints</h2>
          <ul className="list-disc list-inside space-y-2 text-foreground">
            <li><code>client.market.get/graph/relationships</code> - Market data and structure</li>
            <li><code>client.indicators.get</code> - Technical indicators</li>
            <li><code>client.analytics.get</code> - Analytics</li>
            <li><code>client.smartMoney.get</code> - Smart money analysis</li>
            <li><code>client.strategies.validate</code> - Strategy validation</li>
            <li><code>client.research.list/create/get</code> - Research jobs</li>
            <li><code>client.accounts.get/positions</code> - Accounts and positions</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Error Handling & Retries</h2>
          <ul className="list-disc list-inside space-y-2 text-foreground">
            <li>Typed errors: <code>AlgoVaultAuthError</code>, <code>AlgoVaultRateLimitError</code>, <code>AlgoVaultTimeoutError</code>, <code>AlgoVaultNetworkError</code></li>
            <li>Automatic retry for rate-limited GET requests with <code>Retry-After</code> support (bounded retries)</li>
            <li><strong>No automatic retry</strong> for non-idempotent POST requests (e.g., research creation) for safety</li>
            <li>Request timeouts with configurable duration</li>
            <li>Request cancellation via <code>AbortSignal</code></li>
          </ul>
        </section>

        <section className="bg-card/40 border border-muted rounded-lg p-6">
          <h3 className="text-lg font-bold text-foreground mb-2">Resources</h3>
          <div className="flex flex-col gap-2">
            <Link href="/docs/api" className="text-sm text-warning hover:underline">API Reference →</Link>
            <span className="text-sm text-muted-foreground">Package source: <code>packages/algovault-sdk/</code></span>
          </div>
        </section>
      </article>
    </main>
  );
}
