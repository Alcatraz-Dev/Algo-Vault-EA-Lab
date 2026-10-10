import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getAllPublicDocs } from "@/lib/public-docs";
import { StructuredData } from "@/components/seo/StructuredData";

export const metadata: Metadata = {
  title: "Public Documentation & Methodology Hub",
  description: "Explore canonical methodology docs for AlgoVault AI Market Intelligence, Smart Money Concepts, Scalping Terminal, and MetaTrader 5 EA Backtesting.",
  alternates: {
    canonical: "/docs",
  },
};

export default function PublicDocsPage() {
  const docs = getAllPublicDocs();
  const categories = Array.from(new Set(docs.map((d) => d.category)));

  const breadcrumbsSchema = {
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://algovault.app",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Documentation",
        item: "https://algovault.app/docs",
      },
    ],
  };

  return (
    <main className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <StructuredData type="BreadcrumbList" data={breadcrumbsSchema} id="jsonld-docs-breadcrumb" />
      
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="border-b border-muted pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-warning/10 text-warning border border-warning/20 mb-4">
            Official Knowledge Hub
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            AlgoVault Documentation & Methodologies
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-3xl">
            Authoritative, machine-readable specifications and guides covering AlgoVault AI Market Intelligence, Smart Money Concepts, Scalping Terminal architecture, and Backtesting frameworks.
          </p>
        </header>

        {/* Categories & Doc Cards */}
        {categories.map((cat) => {
          const categoryDocs = docs.filter((d) => d.category === cat);
          return (
            <section key={cat} className="space-y-4">
              <h2 className="text-2xl font-bold text-warning tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-warning"></span>
                {cat}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {categoryDocs.map((doc) => (
                  <Link
                    key={doc.slug}
                    href={`/docs/${doc.slug}`}
                    className="group block p-6 bg-card/60 hover:bg-card rounded-lg border border-muted hover:border-warning/50 transition-all duration-200"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-xl font-semibold text-foreground group-hover:text-warning transition-colors">
                        {doc.title}
                      </h3>
                    </div>
                    <p className="text-muted-foreground text-sm line-clamp-2 mb-4">
                      {doc.description}
                    </p>
                    <div className="flex items-center text-xs font-medium text-warning group-hover:translate-x-1 transition-transform">
                      Read Documentation &rarr;
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {/* AI & Machine Readable Notice */}
        <section className="bg-card/40 border border-muted rounded-lg p-6 mt-12">
          <h3 className="text-lg font-bold text-foreground mb-2">AI Search & Agent Access</h3>
          <p className="text-sm text-muted-foreground">
            AI search engines, answer bots, and automated systems can fetch machine-readable summaries at{" "}
            <Link href="/llms.txt" className="text-warning underline hover:text-warning">
              /llms.txt
            </Link>{" "}
            and full AI knowledge definitions at{" "}
            <Link href="/ai-search.txt" className="text-warning underline hover:text-warning">
              /ai-search.txt
            </Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
