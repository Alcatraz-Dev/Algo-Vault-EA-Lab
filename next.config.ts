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
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
];

const nextConfig: NextConfig = {
  // `playwright` is an OPTIONAL runtime dependency of the browser-capture
  // provider (lib/marketing-agent/browser/providers.ts): the code probes for
  // it inside try/catch and degrades to NOT_CONFIGURED when absent. Marking it
  // external keeps Turbopack from statically resolving (and failing on) an
  serverExternalPackages: [
    // Direct server-side packages
    "playwright",
    "firebase-admin",
    "stripe",
    // firebase-admin transitive deps that are pure-ESM or use dynamic require().
    // Turbopack must NOT bundle these — let Node.js resolve them natively.
    "firebase-admin/app",
    "firebase-admin/auth",
    "firebase-admin/database",
    "firebase-admin/firestore",
    "firebase-admin/storage",
    "jwks-rsa",
    "jose",
    "google-auth-library",
    "google-gax",
    "node-fetch",
    "@google-cloud/firestore",
    "@google-cloud/storage",
    "lru-memoizer",
  ],
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
