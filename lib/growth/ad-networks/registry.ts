/**
 * Provider registry for growth ad networks.
 * Supports filtering by platform (WEB / IOS / ANDROID).
 */
import { AdNetworkProvider, AdNetworkType, Platform } from "./types";

const registry = new Map<string, AdNetworkProvider>();

export function registerProvider(name: string, provider: AdNetworkProvider): void {
    registry.set(name, provider);
}

export function getProvider(name: string): AdNetworkProvider | undefined {
    return registry.get(name);
}

export function listProviders(): AdNetworkProvider[] {
    return Array.from(registry.values());
}

export function listProvidersByPlatform(platform: Platform): AdNetworkProvider[] {
    return Array.from(registry.values()).filter((p) => {
        if (p.type === "ADSENSE") return platform === "WEB";
        if (p.type === "ADMOB") return platform === "IOS" || platform === "ANDROID";
        return true;
    });
}

export function hasProvider(name: string, type?: AdNetworkType, platform?: Platform): boolean {
    const p = registry.get(name);
    if (!p) return false;
    if (type && p.type !== type) return false;
    if (platform) {
        if (p.type === "ADSENSE" && platform !== "WEB") return false;
        if (p.type === "ADMOB" && platform !== "IOS" && platform !== "ANDROID") return false;
    }
    return true;
}
