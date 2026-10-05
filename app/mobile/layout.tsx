import type { Metadata, Viewport } from "next";
import { MobileShell } from "@/components/mobile/MobileShell";
import { MobileErrorBoundary } from "@/components/mobile/MobileErrorBoundary";

/**
 * `/mobile` — the mobile surface.
 *
 * Phase 11 replaced the bespoke layout (which owned its own tab list and auth
 * subscription) with `MobileShell`, which reads the shared navigation model and
 * the shared sync state. Nothing about market logic lives here.
 */

export const metadata: Metadata = {
    title: { default: "AlgoVault", template: "%s · AlgoVault" },
    applicationName: "AlgoVault",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AlgoVault" },
    formatDetection: { telephone: false },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    viewportFit: "cover",
    themeColor: [
        { media: "(prefers-color-scheme: dark)", color: "#09090b" },
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    ],
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
    return (
        <MobileErrorBoundary>
            <MobileShell>{children}</MobileShell>
        </MobileErrorBoundary>
    );
}
