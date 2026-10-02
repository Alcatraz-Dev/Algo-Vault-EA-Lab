import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
];

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: "/:path*",
      headers: securityHeaders,
    },
    {
      source: "/api/growth/cron/:path*",
      headers: [
        {
          key: "x-cron-secret",
          value: process.env.CRON_SECRET || "",
        },
      ],
    },
  ],
};

export default nextConfig;
