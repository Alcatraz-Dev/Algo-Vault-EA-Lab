/**
 * Phase 11 — device identity.
 *
 * A device id exists for exactly two reasons:
 *   1. conflict resolution needs a deterministic final tiebreak that does not
 *      depend on any device's clock, and
 *   2. admin observability needs to answer "how many devices is this user
 *      active on, and which app versions are in the field".
 *
 * What it deliberately is NOT: a hardware identifier. It is 128 bits of
 * `crypto.getRandomValues`, generated on first launch and stored locally. No
 * IMEI, no IDFA/GAID, no advertising id, no fingerprinting, nothing derived from
 * the user. It is not an authentication factor and grants no access on its own —
 * every route that uses it still takes the uid from a verified Firebase token.
 *
 * Client-side module.
 */

import type { DeviceInfo, DevicePlatform } from "./contracts";

const DEVICE_ID_KEY = "av_device_id_v1";

/** Matches the server-side `DEVICE_ID` grammar in lib/mobile/server.ts. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function randomId(): string {
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Only reached in environments without WebCrypto (ancient embedded webviews).
    // Still random, just not cryptographic — acceptable for a tiebreak token.
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`.padEnd(32, "0").slice(0, 32);
}

/**
 * Stable per-installation id. Persisted locally; survives reloads so a user's
 * device does not appear as a new device on every navigation.
 */
export function getOrCreateDeviceId(): string {
    if (typeof window === "undefined") return "server";
    try {
        const existing = window.localStorage.getItem(DEVICE_ID_KEY);
        if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;
        const created = randomId();
        window.localStorage.setItem(DEVICE_ID_KEY, created);
        return created;
    } catch {
        // Private mode or disabled storage: an ephemeral id still gives correct
        // merge behaviour for this session, it just cannot be recognised again.
        return randomId();
    }
}

/**
 * Which client surface this is.
 *
 * `pwa` is distinguished from `web` because an installed PWA has different
 * network and lifecycle characteristics — it is what admin adoption reporting
 * keys off, so conflating the two would make the number meaningless.
 */
export function detectPlatform(): DevicePlatform {
    if (typeof window === "undefined") return "unknown";
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const ua = nav.userAgent ?? "";
    if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
    if (/Android/i.test(ua)) return "android";
    if (nav.standalone === true) return "pwa";
    if (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) {
        return "pwa";
    }
    return "web";
}

/** A coarse, non-identifying label for the device registry. */
export function deviceLabel(platform: DevicePlatform): string {
    if (typeof navigator === "undefined") return "Unknown device";
    const touch = navigator.maxTouchPoints > 1;
    switch (platform) {
        case "ios":
            return touch ? "iOS device" : "iOS desktop";
        case "android":
            return "Android device";
        case "pwa":
            return "Installed app";
        case "web":
            return touch ? "Mobile browser" : "Desktop browser";
        default:
            return "Unknown device";
    }
}

/**
 * App version. For the web/PWA client this is the build id exposed by the app
 * router; a native client sets `EXPO_PUBLIC_APP_VERSION` and wins.
 */
export function detectAppVersion(): string {
    const native = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_APP_VERSION : undefined;
    if (native) return native;
    return "web";
}

/** Coarse OS version, reported for compatibility triage only. */
export function detectOsVersion(): string {
    if (typeof navigator === "undefined") return "unknown";
    const ua = navigator.userAgent;
    const ios = /OS (\d+([._]\d+)?)\s/.exec(ua);
    if (ios) return `iOS ${ios[1].replace("_", ".")}`;
    const android = /Android\s([\d.]+)/.exec(ua);
    if (android) return `Android ${android[1]}`;
    return "unknown";
}

/** Build the full identity sent with every sync write. */
export function describeDevice(): DeviceInfo {
    const platform = detectPlatform();
    return {
        deviceId: getOrCreateDeviceId(),
        platform,
        label: deviceLabel(platform),
        appVersion: detectAppVersion(),
        osVersion: detectOsVersion(),
    };
}
