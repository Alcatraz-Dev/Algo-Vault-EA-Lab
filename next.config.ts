import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
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
