export const ALLOWED_ORIGINS = [
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
export function isOriginAllowlisted(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            return false;
        if (ALLOWED_ORIGINS.some((rule) => rule.origin === parsed.origin))
            return true;
        if (parsed.hostname.endsWith('.algovault.com'))
            return true;
        if (parsed.hostname.endsWith('.algovault.app'))
            return true;
        if (parsed.hostname.endsWith('tradingview.com'))
            return true;
        if (parsed.hostname.endsWith('github.com'))
            return true;
        if (parsed.hostname === 'telegram.org')
            return true;
        if (parsed.hostname === 'discord.com' || parsed.hostname === 'discord.gg')
            return true;
        return false;
    }
    catch {
        return false;
    }
}
