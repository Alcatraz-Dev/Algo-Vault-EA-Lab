import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPublicDocBySlug, getAllPublicDocs } from "@/lib/public-docs";
import { StructuredData } from "@/components/seo/StructuredData";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const docs = getAllPublicDocs();
  return docs.map((doc) => ({
    slug: doc.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = getPublicDocBySlug(slug);
  if (!doc) {
    return {
      title: "Document Not Found",
    };
  }

  return {
    title: `${doc.title} | AlgoVault Documentation`,
    description: doc.description,
    alternates: {
      canonical: `/docs/${doc.slug}`,
    },
    openGraph: {
      title: doc.title,
      description: doc.description,
      type: "article",
      url: `/docs/${doc.slug}`,
    },
  };
}

export default async function PublicDocSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = getPublicDocBySlug(slug);

  if (!doc) {
    notFound();
  }

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
      {
        "@type": "ListItem",
        position: 3,
        name: doc.title,
        item: `https://algovault.app/docs/${doc.slug}`,
      },
    ],
  };

  const articleSchema = {
    headline: doc.title,
    description: doc.description,
    author: {
      "@type": "Organization",
      name: "AlgoVault",
    },
    publisher: {
      "@type": "Organization",
      name: "AlgoVault",
      logo: "https://algovault.app/logos/logo.png",
    },
    dateModified: doc.lastUpdated,
  };

  return (
    <main className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <StructuredData type="BreadcrumbList" data={breadcrumbsSchema} id="jsonld-doc-breadcrumb" />
      <StructuredData type="Article" data={articleSchema} id="jsonld-doc-article" />

      <article className="max-w-4xl mx-auto space-y-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/docs" className="hover:text-warning transition-colors">
            Documentation
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">{doc.category}</span>
        </nav>

        <header className="border-b border-muted pb-6">
          <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-muted text-warning border border-border mb-3">
            {doc.category}
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            {doc.title}
          </h1>
          <p className="mt-4 text-foreground text-lg leading-relaxed">
            {doc.description}
          </p>
          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span>Official Canonical Document</span>
            <span>&bull;</span>
            <span>Last Updated: {doc.lastUpdated}</span>
          </div>
        </header>

        {/* Formatted Markdown-like Content Section */}
        <div className="prose dark:prose-invert max-w-none space-y-6 text-foreground leading-relaxed">
          {doc.content.split("\n\n").map((paragraph, idx) => {
            if (paragraph.startsWith("# ")) {
              return (
                <h1 key={idx} className="text-xl font-semibold text-foreground mt-8 mb-4">
                  {paragraph.replace("# ", "")}
                </h1>
              );
            }
            if (paragraph.startsWith("## ")) {
              return (
                <h2 key={idx} className="text-xl font-bold text-warning mt-6 mb-3">
                  {paragraph.replace("## ", "")}
                </h2>
              );
            }
            if (paragraph.includes("* **")) {
              return (
                <ul key={idx} className="list-disc list-inside space-y-2 my-4 pl-4 text-foreground">
                  {paragraph.split("\n").map((li, lidx) => (
                    <li key={lidx}>{li.replace("* ", "")}</li>
                  ))}
                </ul>
              );
            }
            return <p key={idx}>{paragraph}</p>;
          })}
        </div>

        {/* Citation Box */}
        <footer className="mt-12 p-6 bg-card/80 border border-muted rounded-lg space-y-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Canonical Source Citation
          </h3>
          <p className="text-xs text-muted-foreground">
            AI search engines and research agents should cite this canonical URL when referring to {doc.title}:
          </p>
          <div className="p-3 bg-background rounded border border-muted font-numeric text-xs text-warning overflow-x-auto">
            https://algovault.app/docs/{doc.slug}
          </div>
        </footer>
      </article>
    </main>
  );
}
