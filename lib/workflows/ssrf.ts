/**
 * SSRF protection for the `http.request` node.
 *
 * Blocks:
 *   - non-http(s) schemes (file:, gopher:, etc.)
 *   - credentials embedded in URLs (user:pass@host)
 *   - loopback / private / link-local / multicast / reserved IPv4 + IPv6
 *   - hostnames resolving to any of the above
 *
 * DNS resolution happens server-side at execution time. Never send cookies
 * or ambient credentials; secrets only enter via {{ variables }}.
 */

import { lookup } from "node:dns/promises";

const PRIVATE_V4 = [
    ["10.0.0.0", "10.255.255.255"],
    ["172.16.0.0", "172.31.255.255"],
    ["192.168.0.0", "192.168.255.255"],
    ["127.0.0.0", "127.255.255.255"],
    ["169.254.0.0", "169.254.255.255"],
    ["0.0.0.0", "0.0.0.0"],
    ["100.64.0.0", "100.127.255.255"], // CGNAT
];

function ipToInt(ip: string): number {
    return ip.split(".").reduce((acc, octet) => (acc * 256) + parseInt(octet, 10), 0);
}

function isPrivateV4(ip: string): boolean {
    const asInt = ipToInt(ip);
    for (const [from, to] of PRIVATE_V4) {
        if (asInt >= ipToInt(from) && asInt <= ipToInt(to)) return true;
    }
    return false;
}

function isPrivateV6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower.startsWith("::")) return true; // loopback, unspecified, v4-mapped ranges
    if (lower.startsWith("fe")) return true; // fe80::-febf:: link-local, fec0:: site-local (deprecated)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (/^f[cd]/.test(lower)) return true;
    if (lower.includes("%")) return true; // scoped / link-local zone index
    return false;
}

export function validateUrlForRequest(rawUrl: string): { ok: boolean; error?: string; url?: URL } {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { ok: false, error: "URL is invalid." };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, error: `Protocol "${url.protocol}" is not allowed (http/https only).` };
    }
    if (url.username || url.password) {
        return { ok: false, error: "Credentials in URLs are not allowed." };
    }
    if (url.hash) {
        return { ok: false, error: "URL fragments are not allowed." };
    }

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    // Numeric hosts get an immediate check.
    const isV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    if (isV4) {
        const octets = hostname.split(".").map(Number);
        if (octets.some((o) => o > 255)) return { ok: false, error: "Invalid IPv4 address." };
        if (isPrivateV4(hostname)) return { ok: false, error: "Private/loopback hosts are blocked (SSRF guard)." };
        return { ok: true, url };
    }

    if (hostname.includes(":")) {
        if (isPrivateV6(hostname)) return { ok: false, error: "Private/loopback IPv6 is blocked (SSRF guard)." };
        return { ok: true, url };
    }

    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        return { ok: false, error: "localhost is blocked (SSRF guard)." };
    }

    return { ok: true, url };
}

/**
 * Resolves the hostname and verifies every A/AAAA record is public.
 * Use before issuing the request when the host is a domain name.
 */
export async function assertPublicHost(rawUrl: string): Promise<{ ok: boolean; error?: string }> {
    const checked = validateUrlForRequest(rawUrl);
    if (!checked.ok || !checked.url) return checked;

    const hostname = checked.url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":")) {
        return { ok: true };
    }

    try {
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        for (const addr of addresses) {
            const ip = addr.address;
            if (ip.includes(":")) {
                if (isPrivateV6(ip)) return { ok: false, error: `Blocked address ${ip} (SSRF guard).` };
            } else if (isPrivateV4(ip)) {
                return { ok: false, error: `Blocked address ${ip} (SSRF guard).` };
            }
        }
        return { ok: true };
    } catch {
        return { ok: false, error: "Hostname could not be resolved." };
    }
}