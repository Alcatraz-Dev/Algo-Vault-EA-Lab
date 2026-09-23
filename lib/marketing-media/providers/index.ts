/**
 * Marketing Media Provider — provider registry + capability negotiation.
 *
 * The factory never hard-codes a single renderer/TTS/image/storage backend.
 * Each provider advertises its capabilities honestly; the pipeline picks the
 * best available provider per stage and falls back gracefully when a
 * capability is missing. Missing capabilities surface as
 * `NOT_AVAILABLE` — they never throw.
 */
import { MarketingMediaProvider, MediaProviderStatus } from "../types";

export { MarketingMediaProvider, MediaProviderStatus } from "../types";

const _providers: MarketingMediaProvider[] = [];

export function registerMarketingMediaProvider(provider: MarketingMediaProvider): void {
    if (_providers.some((p) => p.id === provider.id)) return;
    _providers.push(provider);
}

export function getMarketingMediaProviders(): MarketingMediaProvider[] {
    return [..._providers];
}

export async function getProviderStatuses(): Promise<MediaProviderStatus[]> {
    const out: MediaProviderStatus[] = [];
    for (const p of _providers) {
        let available = false;
        let reason: string | undefined;
        try {
            available = await p.isAvailable();
        } catch (err) {
            reason = err instanceof Error ? err.message : "Availability check failed";
        }
        out.push({ id: p.id, available, capabilities: p.capabilities, reason });
    }
    return out;
}

/** Pick the first available provider that supports the requested capability. */
export async function findProviderFor(
    capability: MarketingMediaProvider["capabilities"][number]
): Promise<MarketingMediaProvider | null> {
    for (const p of _providers) {
        if (!p.capabilities.includes(capability)) continue;
        try {
            if (await p.isAvailable()) return p;
        } catch {
            // try next
        }
    }
    return null;
}