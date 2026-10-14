/**
 * External link allowlist.
 *
 * `openExternal` and `ExternalLink` only open origins on this list. Blocked
 * origins are a local, harmless error in the renderer — they never fire the
 * OS opener and never leak a security message.
 */
export interface AllowlistRule {
  origin: string;
  wildcard: boolean;
}

export const ALLOWED_ORIGINS: AllowlistRule[] = [
  { origin: 'https://tradingview.com', wildcard: false },
  { origin: 'https://www.tradingview.com', wildcard: false },
  { origin: 'https://telegram.org', wildcard: false },
  { origin: 'https://algovault.com', wildcard: false },
  { origin: 'https://algovault.app', wildcard: false },
  { origin: 'https://github.com', wildcard: false },
  { origin: 'https://discord.com', wildcard: false },
  { origin: 'https://discord.gg', wildcard: false },
];

/** Returns true only for allowlisted HTTP(S) origins. */
export function isOriginAllowlisted(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    if (ALLOWED_ORIGINS.some((rule) => rule.origin === parsed.origin)) return true;
    if (parsed.hostname.endsWith('.algovault.com')) return true;
    if (parsed.hostname.endsWith('.algovault.app')) return true;
    if (parsed.hostname === 'tradingview.com' || parsed.hostname.endsWith('.tradingview.com')) return true;
    if (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.com')) return true;
    if (parsed.hostname === 'telegram.org') return true;
    if (parsed.hostname === 'discord.com' || parsed.hostname === 'discord.gg') return true;
    return false;
  } catch {
    return false;
  }
}
