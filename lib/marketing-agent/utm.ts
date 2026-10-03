/**
 * Marketing Agent — UTM attribution (§34).
 *
 * Integrates with the existing growth attribution surface: every creative
 * variant can carry its own `utm_content` so downstream analytics (which
 * already records source/medium/content on click events) can attribute a click
 * to a specific variant.
 *
 * Pure module: no I/O. URL building never invents a host — the caller passes
 * the site origin or an approved relative path.
 */

import type { MarketingLanguage, MarketingPlatform } from "./collections";
import type { UtmParameters } from "./types";

const PLATFORM_SOURCE: Record<string, string> = {
  TIKTOK: "tiktok",
  INSTAGRAM_REELS: "instagram",
  INSTAGRAM_STORIES: "instagram",
  INSTAGRAM_FEED: "instagram",
  YOUTUBE_SHORTS: "youtube",
  YOUTUBE: "youtube",
  FACEBOOK: "facebook",
  LINKEDIN: "linkedin",
  X: "x",
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function buildUtm(input: {
  platform: MarketingPlatform;
  campaignName: string;
  creativeId: string;
  variantKey?: string;
  language?: MarketingLanguage;
  medium?: string;
}): UtmParameters {
  const utm: UtmParameters = {
    utm_source: PLATFORM_SOURCE[input.platform] ?? input.platform.toLowerCase(),
    utm_medium: input.medium ?? "social",
    utm_campaign: slug(input.campaignName || "campaign"),
    utm_content: slug([input.creativeId, input.variantKey ?? "default", input.language ?? "en"].join("_")),
  };
  if (input.language) utm.utm_term = input.language;
  return utm;
}

/** Append UTM to a path or absolute URL. Never double-appends (§34). */
export function applyUtm(target: string, utm: UtmParameters): string {
  if (!target) return "";
  const hasQuery = target.includes("?");
  const base = target;
  const params = Object.entries(utm)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  if (!params) return base;
  // If the URL already carries utm_source, replace the whole query.
  if (/utm_source=/i.test(base)) {
    const path = base.split("?")[0];
    return `${path}?${params}`;
  }
  return `${base}${hasQuery ? "&" : "?"}${params}`;
}

/** Parse UTM back out for verification before publishing (§55). */
export function readUtm(url: string): Partial<UtmParameters> {
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return {};
  const search = new URLSearchParams(url.slice(qIndex + 1));
  const out: Partial<UtmParameters> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = search.get(key);
    if (v) out[key] = v;
  }
  return out;
}

export function hasRequiredUtm(utm: UtmParameters): boolean {
  return !!(utm.utm_source && utm.utm_medium && utm.utm_campaign && utm.utm_content);
}
