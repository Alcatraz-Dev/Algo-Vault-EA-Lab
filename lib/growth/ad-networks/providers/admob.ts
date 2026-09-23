/**
 * AdMob mobile provider abstraction.
 * IMPORTANT: AdMob is for native mobile applications (iOS/Android), NOT for Next.js web.
 * This abstraction exists so the future mobile app can share the monetization model.
 */
import { AdNetworkProvider } from "../types";

export class AdMobProvider implements AdNetworkProvider {
  type = "ADMOB" as const;
  private initialized = false;

  async initialize(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    this.initialized = Boolean(config.appId) || Boolean(config.adUnitId);
    return { ok: this.initialized, error: this.initialized ? undefined : "AdMob not configured (ADMOB_APP_ID / ADMOB_AD_UNIT_ID missing)" };
  }

  async getAd(placementKey: string, options?: Record<string, unknown>): Promise<{ ok: boolean; html?: string; error?: string; isConfigured?: boolean }> {
    return { ok: false, isConfigured: false, error: "AdMob does not serve ads to web browsers. Use native mobile SDK for AdMob." };
  }

  async renderAd(placementKey: string, container?: HTMLElement | null): Promise<{ ok: boolean; rendered: boolean; error?: string }> {
    return { ok: false, rendered: false, error: "AdMob requires native mobile SDK (iOS/Android). Do not render AdMob inside Next.js web application." };
  }

  async trackImpression(placementKey: string, eventId?: string): Promise<{ counted: boolean }> {
    return { counted: false };
  }

  async trackClick(placementKey: string, eventId?: string, targetUrl?: string): Promise<{ counted: boolean; redirectUrl?: string }> {
    return { counted: false, redirectUrl: "#" };
  }

  async reportRevenue(placementKey: string, amount: number, currency?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
    return { ok: false, error: "AdMob revenue reporting requires server-side AdMob API." };
  }

  async destroy(): Promise<void> {
    this.initialized = false;
  }
}
