import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { StructuredData } from "@/components/seo/StructuredData";

const SITE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://algovault.app";

export const metadata: Metadata = {
  title: "AlgoVault MCP",
  description: "Model Context Protocol (MCP) server for AlgoVault Intelligence Cloud.",
  alternates: {
    canonical: "/docs/mcp",
  },
};

export default function McpDocsPage() {
  const breadcrumbsSchema = {
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Documentation", item: `${SITE_URL}/docs` },
      { "@type": "ListItem", position: 3, name: "MCP", item: `${SITE_URL}/docs/mcp` },
    ],
  };

  return (
    <main className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <StructuredData type="BreadcrumbList" data={breadcrumbsSchema} id="jsonld-mcp-docs-breadcrumb" />
      <article className="max-w-4xl mx-auto space-y-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/docs" className="hover:text-warning transition-colors">Documentation</Link>
          <span>/</span>
          <span className="text-foreground font-medium">MCP</span>
        </nav>

        <header className="border-b border-muted pb-6">
          <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-muted text-warning border border-border mb-3">
            Developer
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            AlgoVault MCP Server
          </h1>
          <p className="mt-4 text-foreground text-lg leading-relaxed">
            First-party Model Context Protocol (MCP) server providing read-only access to AlgoVault Intelligence Cloud capabilities.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Status</h2>
          <p className="text-foreground"><strong>Implemented</strong> - Read-only MCP server with Streamable HTTP transport.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Transport</h2>
          <p className="text-foreground">
            <strong>Streamable HTTP</strong> via MCP SDK. Endpoint: <code className="bg-muted px-1.5 py-0.5 rounded">POST /api/mcp</code>
          </p>
          <p className="text-sm text-muted-foreground">
            Uses the official @modelcontextprotocol/sdk with StreamableHTTPServerTransport. Session management is handled by the transport.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Authentication</h2>
          <p className="text-foreground">
            API key required via <code className="bg-muted px-1.5 py-0.5 rounded">Authorization: Bearer &lt;API_KEY&gt;</code> header. Keys are authenticated using the existing Intelligence Cloud API key system with scope enforcement and tenant isolation.
          </p>
          <p className="text-foreground">
            Create API keys in the <Link href="/developer/dashboard" className="text-warning hover:underline">Developer Dashboard</Link>.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Available Tools</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-muted">
                  <th className="text-left py-2 pr-4 text-muted-foreground">Tool</th>
                  <th className="text-left py-2 text-muted-foreground">Description</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>get_market_data</code></td><td className="py-2">Get market data for a symbol</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>get_market_graph</code></td><td className="py-2">Get market graph structure</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>get_indicators</code></td><td className="py-2">Get technical indicators</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>get_analytics</code></td><td className="py-2">Get analytics data</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>get_smart_money</code></td><td className="py-2">Get Smart Money analysis</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>list_research_jobs</code></td><td className="py-2">List research jobs</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>get_research_job</code></td><td className="py-2">Get a research job by ID</td></tr>
                <tr className="border-b border-muted/50"><td className="py-2 pr-4"><code>validate_strategy</code></td><td className="py-2">Validate a trading strategy</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">All tools are read-only. No write operations, trade execution, or bot management tools are exposed.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Configuration Example</h2>
          <div className="bg-muted/50 rounded-lg p-4 overflow-x-auto">
            <pre className="text-sm text-foreground"><code>{JSON.stringify({
  "mcpServers": {
    "algovault": {
      "url": SITE_URL + "/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}, null, 2)}</code></pre>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Known Limitations</h2>
          <ul className="list-disc list-inside space-y-2 text-foreground">
            <li>Read-only access only - no trade execution, bot deployment, or administrative operations</li>
            <li>Requires valid API key with appropriate scopes</li>
            <li>Rate limiting applies via Intelligence Cloud pipeline</li>
            <li>Some account/position data requires user binding on the API key</li>
          </ul>
        </section>

        <section className="bg-card/40 border border-muted rounded-lg p-6">
          <h3 className="text-lg font-bold text-foreground mb-2">Related</h3>
          <div className="flex flex-col gap-2">
            <Link href="/docs/api" className="text-sm text-warning hover:underline">API Documentation →</Link>
            <Link href="/docs/sdk" className="text-sm text-warning hover:underline">SDK Documentation →</Link>
            <Link href="/developer/dashboard" className="text-sm text-warning hover:underline">Get API Keys →</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
