import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { THEME_INIT_ID, THEME_INIT_SCRIPT } from "@/components/theme/theme-init";
import GuideHost from "@/components/guides/GuideHost";
import PwaRegister from "@/components/pwa/PwaRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AlgoVault",
  description: "AI-Powered Trading Platform - Markets, Bots, Signals, Analytics",
  applicationName: "AlgoVault",
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  keywords: ["trading", "forex", "crypto", "bots", "signals", "AI", "MT5", "Expert Advisors"],
  authors: [{ name: "AlgoVault" }],
  creator: "AlgoVault",
  publisher: "AlgoVault",
  formatDetection: { telephone: false },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "AlgoVault",
    title: "AlgoVault - AI-Powered Trading Platform",
    description: "Trade smarter with AI signals, automated bots, and advanced analytics",
    images: [
      { url: "/og-image.png", width: 1200, height: 630, alt: "AlgoVault Trading Platform" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AlgoVault",
    description: "AI-Powered Trading Platform",
    images: ["/og-image.png"],
    creator: "@algovault",
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512x512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    shortcut: "/icons/icon-192x192.svg",
    apple: [
      { url: "/icons/icon-192x192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512x512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    other: [
      { rel: "mask-icon", url: "/icons/icon-192x192.svg", color: "#ff4d00" },
    ],
  },
  manifest: "/manifest.json",
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
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <GuideHost />
        <PwaRegister />
      </body>
    </html>
  );
}
