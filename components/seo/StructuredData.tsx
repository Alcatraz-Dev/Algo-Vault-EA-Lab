import React from "react";

export type SchemaOrgType =
  | "Organization"
  | "WebSite"
  | "SoftwareApplication"
  | "Product"
  | "BreadcrumbList"
  | "FAQPage"
  | "Article";

interface StructuredDataProps {
  type: SchemaOrgType;
  data: Record<string, unknown>;
  id?: string;
}

export function StructuredData({ type, data, id }: StructuredDataProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": type,
    ...data,
  };

  return (
    <script
      id={id || `jsonld-${type.toLowerCase()}`}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export const ALGOVAULT_ORGANIZATION_SCHEMA = {
  name: "AlgoVault",
  legalName: "AlgoVault Trading Technologies",
  url: "https://algovault.app",
  logo: "https://algovault.app/logos/logo.png",
  description: "Institutional AI-Powered Trading Platform, Strategy Marketplace, Market Intelligence & Automated Execution Suite.",
  sameAs: [
    "https://twitter.com/algovault",
    "https://t.me/algovault",
    "https://github.com/algovault",
  ],
  contactPoint: {
    "@type": "ContactPoint",
    email: "security@algovault.app",
    contactType: "customer support",
    availableLanguage: ["English"],
  },
};

export const ALGOVAULT_WEBSITE_SCHEMA = {
  name: "AlgoVault",
  url: "https://algovault.app",
  description: "AI-Powered Trading Platform - Markets, EAs, Signals, Smart Money Analytics & Strategy Lab.",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: "https://algovault.app/marketplace?q={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

export const ALGOVAULT_SOFTWARE_SCHEMA = {
  name: "AlgoVault AI Trading Platform",
  operatingSystem: "Web, MT5, Windows, macOS, iOS, Android",
  applicationCategory: "FinancialApplication",
  offers: {
    "@type": "Offer",
    price: "0.00",
    priceCurrency: "USD",
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.9",
    ratingCount: "1280",
  },
};
