import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { StructuredData } from "@/components/seo/StructuredData";

const SITE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://algovault.app";

export const metadata: Metadata = {
  title: "AlgoVault Intelligence Cloud API",
  description: "Public REST API for market intelligence, indicators, smart money analysis, research, and account data.",
  alternates: {
    canonical: "/docs/api",
  },
};

export default function ApiDocsPage() {
  const breadcrumbsSchema = {
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Documentation", item: `${SITE_URL}/docs` },
      { "@type": "ListItem", position: 3, name: "API", item: `${SITE_URL}/docs/api` },
    ],
  };

  return (
    <main className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <StructuredData type="BreadcrumbList" data={breadcrumbsSchema} id="jsonld-api-docs-breadcrumb" />
      <article className="max-w-4xl mx-auto space-y-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/docs" className="hover:text-warning transition-colors">Documentation</Link>
          <span>/</span>
          <span className="text-foreground font-medium">API</span>
        </nav>

        <header className="border-b border-muted pb-6">
          <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-muted text-warning border border-border mb-3">
            Developer
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            Intelligence Cloud API
          </h1>
          <p className="mt-4 text-foreground text-lg leading-relaxed">
            REST API for AlgoVault's Intelligence Cloud providing market intelligence, indicators, smart money analysis, analytics, strategy validation, research jobs, and account data.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">What it provides</h2>
          <ul className="list-disc list-inside space-y-2 text-foreground">
            <li><strong>Market</strong> - Real-time market data, market graph, and relationships</li>
            <li><strong>Indicators</strong> - Technical indicator snapshots</li>
            <li><strong>Analytics</strong> - Portfolio analytics</li>
            <li><strong>Smart Money</strong> - Smart money concept analysis</li>
            <li><strong>Strategies</strong> - Strategy validation</li>
            <li><strong>Research</strong> - Research job listing, creation, and retrieval</li>
            <li><strong>Accounts</strong> - Account and position data (with user binding)</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Authentication</h2>
          <p className="text-foreground">
            All requests to <code className="bg-muted px-1.5 py-0.5 rounded">/api/v1/*</code> require API key authentication via the Intelligence Cloud pipeline using the <code className="bg-muted px-1.5 py-0.5 rounded">Authorization: Bearer &lt;API_KEY&gt;</code> header.
          </p>
          <p className="text-foreground">
            API keys are created and managed through the <Link href="/developer/dashboard" className="text-warning hover:underline">Developer Dashboard</Link>. Keys are tenant-bound, scope-based, and hashed server-side. Secrets are shown only once at creation.
          </p>
          <p className="text-foreground">
            See <Link href="/docs/api-keys" className="text-warning hover:underline">API Keys documentation</Link> for details on scopes, ownership, and legacy compatibility.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Available Endpoints</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-muted">
                  <th className="text-left py-2 pr-4 text-muted-foreground">Method</th>
                  <th className="text-left py-2 pr-4 text-muted-foreground">Path</th>
                  <th className="text-left py-2 text-muted-foreground">Description</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/market</code></td><td className="py-2">Market data</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/market/graph</code></td><td className="py-2">Market graph</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/market/relationships</code></td><td className="py-2">Market relationships</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/indicators</code></td><td className="py-2">Indicators</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/analytics</code></td><td className="py-2">Analytics</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/smart-money</code></td><td className="py-2">Smart money</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">POST</td><td className="py-2 pr-4"><code>/api/v1/strategies/validate</code></td><td className="py-2">Strategy validation</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/research</code></td><td className="py-2">List research jobs</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">POST</td><td className="py-2 pr-4"><code>/api/v1/research</code></td><td className="py-2">Create research job</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/research/[jobId]</code></td><td className="py-2">Get research job</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/accounts</code></td><td className="py-2">Accounts (user-bound)</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4">GET</td><td className="py-2 pr-4"><code>/api/v1/positions</code></td><td className="py-2">Positions (user-bound)</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">OpenAPI Specification</h2>
          <p className="text-foreground">
            The complete, machine-readable API contract is available at <Link href="/docs/api/openapi.yaml" className="text-warning hover:underline"><code>docs/api/openapi.yaml</code></Link> (also viewable in the repository at <code>docs/api/openapi.yaml</code>).
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Rate Limits & Usage</h2>
          <p className="text-foreground">
            Rate limiting and usage metering are enforced by the Intelligence Cloud pipeline based on your API key and tenant. When rate limited, responses may include <code>Retry-After</code> headers. Contact support for quota increases.
          </p>
        </section>

        <section className="bg-card/40 border border-muted rounded-lg p-6">
          <h3 className="text-lg font-bold text-foreground mb-2">Get Started</h3>
          <p className="text-sm text-muted-foreground mb-4">
            1. Get API keys from the Developer Dashboard. 2. Use the <Link href="/docs/sdk" className="text-warning hover:underline">TypeScript SDK</Link> or make direct HTTP requests. 3. Start building with our APIs.
          </p>
          <div className="flex gap-4">
            <Link href="/developer/dashboard" className="text-sm text-warning hover:underline">Developer Dashboard →</Link>
            <Link href="/docs/sdk" className="text-sm text-warning hover:underline">SDK Documentation →</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
