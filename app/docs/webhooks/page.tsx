import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { StructuredData } from "@/components/seo/StructuredData";

const SITE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://algovault.app";

export const metadata: Metadata = {
  title: "AlgoVault Webhooks",
  description: "Webhook integration status and documentation for AlgoVault.",
  alternates: {
    canonical: "/docs/webhooks",
  },
};

export default function WebhooksDocsPage() {
  const breadcrumbsSchema = {
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Documentation", item: `${SITE_URL}/docs` },
      { "@type": "ListItem", position: 3, name: "Webhooks", item: `${SITE_URL}/docs/webhooks` },
    ],
  };

  return (
    <main className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <StructuredData type="BreadcrumbList" data={breadcrumbsSchema} id="jsonld-webhooks-docs-breadcrumb" />
      <article className="max-w-4xl mx-auto space-y-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/docs" className="hover:text-warning transition-colors">Documentation</Link>
          <span>/</span>
          <span className="text-foreground font-medium">Webhooks</span>
        </nav>

        <header className="border-b border-muted pb-6">
          <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-muted text-warning border border-border mb-3">
            Developer
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            Webhooks
          </h1>
          <p className="mt-4 text-foreground text-lg leading-relaxed">
            Webhook delivery and integration status for AlgoVault.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Current State</h2>
          <p className="text-foreground">
            Webhook functionality exists in several forms across the platform:
          </p>
          <ul className="list-disc list-inside space-y-2 text-foreground">
            <li><strong>Workflow webhooks</strong> - Trigger workflows via webhook endpoints with secret-based authentication</li>
            <li><strong>Pine alert webhooks</strong> - Send alerts to configured webhook URLs</li>
            <li><strong>Discord webhooks</strong> - Integration for Discord notifications</li>
            <li><strong>Stripe webhooks</strong> - Payment event processing (verified webhook signatures)</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Planned: Public API Webhooks</h2>
          <p className="text-foreground">
            A unified public webhook delivery platform for the Intelligence Cloud API is <strong>planned</strong> but not yet implemented as a documented, self-serve feature. When available, it will include:
          </p>
          <ul className="list-disc list-inside space-y-2 text-foreground">
            <li>Event type subscriptions (market alerts, research completions, etc.)</li>
            <li>Endpoint registration and management via API/portal</li>
            <li>Signature verification using cryptographic signing</li>
            <li>Configurable retry behavior with exponential backoff</li>
            <li>Delivery guarantees and monitoring</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-warning">Security Notes</h2>
          <p className="text-foreground">
            Always verify webhook signatures. Use HTTPS endpoints. Store webhook secrets securely. If implementing custom webhook integrations now, use the existing workflow webhook system which supports secret validation.
          </p>
        </section>

        <section className="bg-card/40 border border-muted rounded-lg p-6">
          <h3 className="text-lg font-bold text-foreground mb-2">Current Integrations</h3>
          <p className="text-sm text-muted-foreground mb-4">
            For current webhook use cases, refer to workflow automation and alerting documentation in the general docs.
          </p>
          <div className="flex gap-4">
            <Link href="/docs/workflow-automation" className="text-sm text-warning hover:underline">Workflow Automation →</Link>
            <Link href="/docs/api" className="text-sm text-warning hover:underline">API Documentation →</Link>
          </div>
        </section>
      </article>
    </main>
  );
}
