/**
 * Centralized URL configuration
 * 
 * Determines the canonical site URL based on environment
 * - Production: use SITE_URL or NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_APP_URL if configured
 * - Preview/Dev: use deployment URL from Vercel if available, otherwise fallback
 * Never trusts arbitrary Host headers for canonical URLs
 */

const FALLBACK_URL = "https://algovault.app";

function getSiteUrl(): string {
  // Check for explicitly configured site URLs (in order of preference)
  if (process.env.SITE_URL) {
    return process.env.SITE_URL;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  // Vercel deployment URLs
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    // Only use VERCEL_URL for non-production if no production URL is set
    if (process.env.VERCEL_ENV !== "production") {
      return `https://${process.env.VERCEL_URL}`;
    }
  }
  
  // If no configuration, fall back to default for backwards compatibility
  // but log a warning in development
  if (process.env.NODE_ENV === "development") {
    console.warn("No SITE_URL configured. Using fallback URL. Set SITE_URL or NEXT_PUBLIC_APP_URL in environment variables.");
  }
  
  return FALLBACK_URL;
}

const SITE_URL = getSiteUrl();

export function getCanonicalUrl(path: string = "/"): string {
  try {
    // Ensure path starts with /
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(normalizedPath, SITE_URL);
    // Only allow http/https
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return new URL(normalizedPath, FALLBACK_URL).toString();
    }
    return url.toString();
  } catch {
    // Fallback to safe construction
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${SITE_URL.replace(/\/$/, "")}${normalizedPath}`;
  }
}

export function getSiteOrigin(): string {
  try {
    const url = new URL(SITE_URL);
    return url.origin;
  } catch {
    return FALLBACK_URL;
  }
}

export { SITE_URL };

export default {
  SITE_URL,
  getCanonicalUrl,
  getSiteOrigin,
};
