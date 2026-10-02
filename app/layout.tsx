import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { THEME_INIT_ID, THEME_INIT_SCRIPT } from "@/components/theme/theme-init";
import GuideHost from "@/components/guides/GuideHost";
import PwaRegister from "@/components/pwa/PwaRegister";
import ExtensionInstallBinding from "@/components/extension/ExtensionInstallBinding";
import {
  StructuredData,
  ALGOVAULT_ORGANIZATION_SCHEMA,
  ALGOVAULT_WEBSITE_SCHEMA,
  ALGOVAULT_SOFTWARE_SCHEMA,
} from "@/components/seo/StructuredData";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AlgoVault - AI-Powered Trading Platform & Strategy Marketplace",
    template: "%s | AlgoVault",
  },
  description: "Institutional AI-powered trading platform, MT5 Expert Advisors, Smart Money market intelligence, scalping terminal, and strategy marketplace.",
  applicationName: "AlgoVault",
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  keywords: [
    "AlgoVault",
    "trading platform",
    "AI trading terminal",
    "Smart Money Concepts",
    "MT5 Expert Advisors",
    "forex signals",
    "backtesting engine",
    "scalping terminal",
    "market intelligence",
    "crypto trading bots",
  ],
  authors: [{ name: "AlgoVault" }],
  creator: "AlgoVault",
  publisher: "AlgoVault",
  formatDetection: { telephone: false },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://algovault.app"),
  alternates: {
    canonical: "./",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "AlgoVault",
    title: "AlgoVault - AI-Powered Trading Platform & Strategy Marketplace",
    description: "Trade smarter with AI market intelligence, automated MetaTrader 5 Expert Advisors, and real-time Smart Money liquidity analytics.",
    images: [
      { url: "/og-image.png", width: 1200, height: 630, alt: "AlgoVault Trading Platform" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AlgoVault - AI-Powered Trading Platform",
    description: "Institutional AI trading platform, EAs, scalping terminal & market intelligence.",
    images: ["/og-image.png"],
    creator: "@algovault",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/logos/logo.png", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    other: [
      { rel: "mask-icon", url: "/logos/logo.png", color: "#ff4d00" },
    ],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AlgoVault",
    startupImage: [
      { url: "/splash/splash-750x1334.svg", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/splash/splash-1170x2532.svg", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1290x2796.svg", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-2048x2732.svg", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#ff4d00",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id={THEME_INIT_ID}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <link rel="preconnect" href="https://api.telegram.org" />
        <link rel="preconnect" href="https://discord.com" />
        <StructuredData type="Organization" data={ALGOVAULT_ORGANIZATION_SCHEMA} id="jsonld-org" />
        <StructuredData type="WebSite" data={ALGOVAULT_WEBSITE_SCHEMA} id="jsonld-website" />
        <StructuredData type="SoftwareApplication" data={ALGOVAULT_SOFTWARE_SCHEMA} id="jsonld-app" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <GuideHost />
        <PwaRegister />
        <ExtensionInstallBinding />
      </body>
    </html>
  );
}

