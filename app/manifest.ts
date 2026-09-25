import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AlgoVault",
    short_name: "AlgoVault",
    description: "AI-Powered Trading Platform - Markets, Bots, Signals, Analytics",
    start_url: "/",
    display: "standalone",
    background_color: "#111111",
    theme_color: "#ff4d00",
    orientation: "portrait-primary",
    scope: "/",
    icons: [
      {
        src: "/icons/icon-72x72.svg",
        sizes: "72x72",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-96x96.svg",
        sizes: "96x96",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-128x128.svg",
        sizes: "128x128",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-144x144.svg",
        sizes: "144x144",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-152x152.svg",
        sizes: "152x152",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-192x192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-384x384.svg",
        sizes: "384x384",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512x512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/home-desktop.png",
        sizes: "1920x1080",
        type: "image/png",
        form_factor: "wide",
        label: "AlgoVault Desktop Dashboard",
      },
      {
        src: "/screenshots/home-mobile.png",
        sizes: "390x844",
        type: "image/png",
        form_factor: "narrow",
        label: "AlgoVault Mobile Home",
      },
    ],
    categories: ["finance", "business", "productivity"],
    shortcuts: [
      {
        name: "AI Signals",
        short_name: "Signals",
        description: "View AI-generated trading signals",
        url: "/signals",
        icons: [{ src: "/icons/signal-shortcut.svg", sizes: "192x192", type: "image/svg+xml" }],
      },
      {
        name: "My Bots",
        short_name: "Bots",
        description: "Manage your trading bots",
        url: "/account/bots",
        icons: [{ src: "/icons/bot-shortcut.svg", sizes: "192x192", type: "image/svg+xml" }],
      },
      {
        name: "Market Scanner",
        short_name: "Scanner",
        description: "Scan markets for opportunities",
        url: "/scanner",
        icons: [{ src: "/icons/scanner-shortcut.svg", sizes: "192x192", type: "image/svg+xml" }],
      },
    ],
    related_applications: [],
    prefer_related_applications: false,
  };
}