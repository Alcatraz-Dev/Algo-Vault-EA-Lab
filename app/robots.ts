// AlgoVault - Native Robots Configuration
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://algovault.app";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/*",
          "/account",
          "/account/*",
          "/auth",
          "/auth/*",
          "/checkout",
          "/checkout/*",
          "/api",
          "/api/*",
          "/dashboard",
          "/dashboard/*",
          "/trade-journal",
          "/trade-journal/*",
          "/trade-management",
          "/trade-management/*",
          "/trade-replay",
          "/trade-replay/*",
          "/portfolio",
          "/portfolio/*",
          "/workflows",
          "/workflows/*",
          "/strategy-lab",
          "/strategy-lab/*",
          "/risk",
          "/risk/*",
          "/goals",
          "/goals/*",
          "/alert-center",
          "/alert-center/*",
          "/reports",
          "/reports/*",
          "/report-generator",
          "/report-generator/*",
          "/execution-analytics",
          "/execution-analytics/*",
          "/equity-curve",
          "/equity-curve/*",
          "/r/*",
          "/login",
          "/register",
          "/statement",
          "/trading",
          "/trading/*",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
