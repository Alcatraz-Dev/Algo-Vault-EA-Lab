// AlgoVault - Native Dynamic Sitemap Architecture
import type { MetadataRoute } from "next";
import { adminDatabase } from "@/lib/firebase-admin";
import { getAllPublicDocs } from "@/lib/public-docs";

export type SitemapProduct = {
  id: string;
  slug?: string;
  updatedAt?: number;
};

async function getPublicProductsForSitemap(): Promise<SitemapProduct[]> {
  try {
    const snap = await adminDatabase.ref("bots").get();
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, Record<string, unknown>>;
    return Object.entries(val).map(([id, item]) => ({
      id,
      slug: typeof item.slug === "string" ? item.slug : undefined,
      updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : undefined,
    }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://algovault.app";
  const now = new Date();

  // Core static public pages
  const staticRoutes: Array<{ url: string; changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly"; priority: number }> = [
    { url: `${baseUrl}`, changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/marketplace`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/pricing`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/insights`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/news`, changeFrequency: "daily", priority: 0.7 },
    { url: `${baseUrl}/compare`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/broker-compare`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/strategy-compare`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/verified-performance`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/live-performance`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/signal-transparency`, changeFrequency: "daily", priority: 0.7 },
    { url: `${baseUrl}/economic-calendar`, changeFrequency: "daily", priority: 0.7 },
    { url: `${baseUrl}/tools`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/spreads`, changeFrequency: "daily", priority: 0.6 },
    { url: `${baseUrl}/mobile`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/store`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/donate`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${baseUrl}/privacy`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/terms`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/refunds`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((r) => ({
    url: r.url,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Public Documentation routes
  const docEntries: MetadataRoute.Sitemap = getAllPublicDocs().map((doc) => ({
    url: `${baseUrl}/docs/${doc.slug}`,
    lastModified: new Date(doc.lastUpdated),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  // Dynamic Marketplace product entries
  const products = await getPublicProductsForSitemap();
  const productEntries: MetadataRoute.Sitemap = products.map((prod) => ({
    url: `${baseUrl}/marketplace/${prod.slug || prod.id}`,
    lastModified: prod.updatedAt ? new Date(prod.updatedAt) : now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticEntries, ...docEntries, ...productEntries];
}
