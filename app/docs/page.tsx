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
    <main className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <StructuredData type="BreadcrumbList" data={breadcrumbsSchema} id="jsonld-docs-breadcrumb" />
      
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="border-b border-slate-800 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20 mb-4">
            Official Knowledge Hub
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
            AlgoVault Documentation & Methodologies
          </h1>
          <p className="mt-4 text-lg text-slate-400 max-w-3xl">
            Authoritative, machine-readable specifications and guides covering AlgoVault AI Market Intelligence, Smart Money Concepts, Scalping Terminal architecture, and Backtesting frameworks.
          </p>
        </header>

        {/* Categories & Doc Cards */}
        {categories.map((cat) => {
          const categoryDocs = docs.filter((d) => d.category === cat);
          return (
            <section key={cat} className="space-y-4">
              <h2 className="text-2xl font-bold text-orange-400 tracking-wide flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                {cat}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {categoryDocs.map((doc) => (
                  <Link
                    key={doc.slug}
                    href={`/docs/${doc.slug}`}
                    className="group block p-6 bg-slate-900/60 hover:bg-slate-900 rounded-xl border border-slate-800 hover:border-orange-500/50 transition-all duration-200"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-xl font-semibold text-slate-100 group-hover:text-orange-400 transition-colors">
                        {doc.title}
                      </h3>
                    </div>
                    <p className="text-slate-400 text-sm line-clamp-2 mb-4">
                      {doc.description}
                    </p>
                    <div className="flex items-center text-xs font-medium text-orange-400 group-hover:translate-x-1 transition-transform">
                      Read Documentation &rarr;
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {/* AI & Machine Readable Notice */}
        <section className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 mt-12">
          <h3 className="text-lg font-bold text-slate-200 mb-2">AI Search & Agent Access</h3>
          <p className="text-sm text-slate-400">
            AI search engines, answer bots, and automated systems can fetch machine-readable summaries at{" "}
            <Link href="/llms.txt" className="text-orange-400 underline hover:text-orange-300">
              /llms.txt
            </Link>{" "}
            and full AI knowledge definitions at{" "}
            <Link href="/ai-search.txt" className="text-orange-400 underline hover:text-orange-300">
              /ai-search.txt
            </Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
