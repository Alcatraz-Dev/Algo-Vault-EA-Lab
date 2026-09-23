/**
 * AdSense web provider abstraction.
 * Configuration comes from environment variables.
 * NEVER hardcode publisher IDs.
 */
import { AdNetworkProvider, Platform } from "../types";

function isAdSenseEnabled(): boolean {
    return process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID !== undefined &&
           process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID !== "" &&
           process.env.ADSENSE_ENABLED === "true";
}

export class AdSenseProvider implements AdNetworkProvider {
    type = "ADSENSE" as const;
    private initialized = false;
    private clientId: string;

    constructor() {
        this.clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID ?? "";
        this.initialized = isAdSenseEnabled();
    }

    async initialize(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
        this.clientId = config.clientId ? String(config.clientId) : this.clientId;
        this.initialized = isAdSenseEnabled();
        if (!this.initialized) {
            return { ok: false, error: "AdSense not configured (NEXT_PUBLIC_ADSENSE_CLIENT_ID or ADSENSE_ENABLED missing)" };
        }
        return { ok: true };
    }

    async getAd(placementKey: string, options?: Record<string, unknown>): Promise<{ ok: boolean; html?: string; error?: string; isConfigured?: boolean }> {
        if (!this.initialized) {
            return { ok: false, isConfigured: false, error: "AdSense not configured (ADSENSE_ENABLED=false or missing client ID)" };
        }
        const clientId = options?.clientId ? String(options.clientId) : this.clientId;
        return {
            ok: true,
            html: `<ins class="adsbygoogle" style="display:block;" data-ad-client="${clientId}" data-ad-slot="${String(options?.slot || placementKey)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`,
            isConfigured: true,
        };
    }

    async renderAd(placementKey: string, container?: HTMLElement | null): Promise<{ ok: boolean; rendered: boolean; error?: string }> {
        if (!container) return { ok: true, rendered: false, error: "No container element provided (safe fallback)" };
        if (!this.initialized) return { ok: true, rendered: false, error: "AdSense not configured" };
        try {
            if (typeof (window as unknown as { adsbygoogle?: unknown[] }) !== "undefined") {
                (window as unknown as { adsbygoogle: unknown[] }).adsbygoogle = (window as unknown as { adsbygoogle: unknown[] }).adsbygoogle || [];
                (window as unknown as { adsbygoogle: unknown[] }).adsbygoogle.push({});
            }
            return { ok: true, rendered: true };
        } catch {
            return { ok: false, rendered: false, error: "AdSense render failed" };
        }
    }

    async trackImpression(placementKey: string, eventId?: string): Promise<{ counted: boolean }> {
        return { counted: this.initialized };
    }

    async trackClick(placementKey: string, eventId?: string, targetUrl?: string): Promise<{ counted: boolean; redirectUrl?: string }> {
        return { counted: this.initialized, redirectUrl: targetUrl || "#" };
    }

    async reportRevenue(placementKey: string, amount: number, currency?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
        return { ok: false, error: "Revenue reporting handled server-side via AdSense API" };
    }

    async destroy(): Promise<void> {
        this.initialized = false;
    }
}

export const adSenseSupportedPlatforms: Platform[] = ["WEB"];
