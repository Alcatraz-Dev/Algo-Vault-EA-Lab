/**
 * Ad Network Provider Abstraction — platform-independent for WEB / IOS / ANDROID.
 */
export type AdNetworkType = "ADSENSE" | "ADMOB" | "CUSTOM";
export type Platform = "WEB" | "IOS" | "ANDROID";

export interface AdNetworkProvider {
  type: AdNetworkType;
  initialize(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
  getAd(placementKey: string, options?: Record<string, unknown>): Promise<{ ok: boolean; html?: string; error?: string; isConfigured?: boolean }>;
  renderAd(placementKey: string, container?: HTMLElement | null): Promise<{ ok: boolean; rendered: boolean; error?: string }>;
  trackImpression(placementKey: string, eventId?: string): Promise<{ counted: boolean }>;
  trackClick(placementKey: string, eventId?: string, targetUrl?: string): Promise<{ counted: boolean; redirectUrl?: string }>;
  reportRevenue(placementKey: string, amount: number, currency?: string): Promise<{ ok: boolean; id?: string; error?: string }>;
  destroy(): Promise<void>;
}

export const PROVIDER_TYPES: AdNetworkType[] = ["ADSENSE", "ADMOB", "CUSTOM"];
