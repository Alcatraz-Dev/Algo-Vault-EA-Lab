/**
 * Loopback-only helpers for local inference.
 *
 * Local AI (Ollama) is a desktop/self-hosted capability. Two boundaries are
 * enforced with these helpers:
 *  1. The configured Ollama endpoint must itself be loopback (see
 *     `resolveOllamaEndpoint`), so the gateway can never be pointed at an
 *     arbitrary host and used as a proxy.
 *  2. The HTTP request that asks for local inference must arrive from this
 *     machine, so enabling local AI on a public deployment does not turn the
 *     unauthenticated chat endpoint into public access to a local model.
 *
 * Next.js populates `x-forwarded-for` with the socket peer address even for a
 * direct loopback request, so a forwarding header is not rejected on sight —
 * every address it carries must be loopback. These headers are client-supplied
 * and therefore defence-in-depth only: the primary controls remain the
 * loopback bind and the explicit `ALGOVAULT_LOCAL_AI` opt-in.
 */

/** True for the loopback names/addresses only. Never a private LAN range. */
export function isLoopbackHostname(hostname: string): boolean {
    const host = hostname.trim().toLowerCase();
    if (!host) return false;
    return (
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "::1" ||
        host === "[::1]"
    );
}

/** Strip the port from a `Host` header (`127.0.0.1:3000` -> `127.0.0.1`). */
export function hostnameFromHostHeader(host: string | null | undefined): string | null {
    if (typeof host !== "string") return null;
    const value = host.trim();
    if (!value) return null;
    // IPv6 literal: [::1]:3000
    if (value.startsWith("[")) {
        const end = value.indexOf("]");
        if (end === -1) return null;
        return value.slice(0, end + 1);
    }
    const colon = value.lastIndexOf(":");
    return colon === -1 ? value : value.slice(0, colon);
}

/** Normalise an IPv4-mapped loopback address (`::ffff:127.0.0.1`). */
function isLoopbackAddress(value: string): boolean {
    const address = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
    return isLoopbackHostname(address) || address === "::ffff:127.0.0.1";
}

/**
 * True only when the request appears to originate from this machine.
 *
 * The `Host` must be loopback. Any forwarding metadata that is present must
 * also describe a loopback hop; a single public address rejects the request.
 */
export function isLoopbackRequest(headers: Headers): boolean {
    const hostname = hostnameFromHostHeader(headers.get("host"));
    if (hostname === null || !isLoopbackHostname(hostname)) return false;

    // RFC 7239 `Forwarded` carries a client address in a format we do not need
    // to parse for a loopback-only call: treat its presence as non-local.
    if (headers.get("forwarded")) return false;

    const realIp = headers.get("x-real-ip");
    if (realIp && !isLoopbackAddress(realIp)) return false;

    const forwardedHost = headers.get("x-forwarded-host");
    if (forwardedHost) {
        for (const entry of forwardedHost.split(",")) {
            const host = hostnameFromHostHeader(entry);
            if (host === null || !isLoopbackHostname(host)) return false;
        }
    }

    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor) {
        for (const entry of forwardedFor.split(",")) {
            const address = entry.trim();
            if (!address) return false;
            if (!isLoopbackAddress(address)) return false;
        }
    }

    return true;
}
