// TTL-cached snapshot of the live model catalog, used as the ONLY source of
// pricing information for cost estimation.
//
// ── Why this exists ───────────────────────────────────────────────────────────
// Cost must come from what each provider's own catalog reports. Fetching that
// catalog on the AI request path would add a network round-trip to every chat,
// so instead the catalog is snapshotted in the background and read
// synchronously from memory.
//
// ── The honest cold-start behaviour ───────────────────────────────────────────
// `getModelPricingEntry` never blocks. If no snapshot is warm it returns
// `undefined`, which makes the cost of that one request `null` ("unknown") —
// never `0`. A background refresh is scheduled so the next request is priced.
// This is why the token limit is the exact enforcement axis and the cost limit
// is the estimate-based one: tokens are always reported, prices are not always
// warm.
//
// ── Testability ───────────────────────────────────────────────────────────────
// The loader is injected (`setCatalogLoader`) and the snapshot is explicitly
// resettable, so no test needs a live provider.

import { AIModel } from "./types";
import { AIModelPricingEntry, buildPricingIndex } from "./usage-events";

type CatalogLoader = () => Promise<AIModel[]>;

let loader: CatalogLoader | null = null;
let index: Map<string, AIModelPricingEntry> | null = null;
let modelCount = 0;
let loadedAt = 0;
let refreshPromise: Promise<void> | null = null;

function ttlMs(): number {
    const parsed = parseInt(process.env.AI_PRICING_CATALOG_TTL_MS || "1800000", 10);
    // 30 minutes default. Below 1000ms a snapshot would never be usable; the
    // floor keeps a misconfiguration from silently thrashing the providers.
    return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 1800000;
}

export function setCatalogLoader(fn: CatalogLoader | null): void {
    loader = fn;
    index = null;
    loadedAt = 0;
    refreshPromise = null;
}

/** Drop any cached snapshot. Used by tests and after a configuration change. */
export function resetCatalogSnapshot(): void {
    index = null;
    modelCount = 0;
    loadedAt = 0;
    refreshPromise = null;
}

function isWarm(): boolean {
    return index !== null && Date.now() - loadedAt < ttlMs();
}

async function doRefresh(): Promise<void> {
    if (!loader) return;
    try {
        const models = await loader();
        index = buildPricingIndex(models ?? []);
        modelCount = models?.length ?? 0;
        loadedAt = Date.now();
    } catch {
        // A catalog that cannot be read is not fatal: it degrades pricing to
        // "unknown" for the affected window. It must never propagate, because
        // this runs on the AI request path.
        loadedAt = 0;
    }
}

/**
 * Refresh the snapshot. Concurrent callers share one in-flight refresh so a
 * burst of AI requests cannot fan out into a burst of catalog fetches.
 */
export function refreshCatalogSnapshot(force = false): Promise<void> {
    if (!force && isWarm()) return Promise.resolve();
    if (refreshPromise) return refreshPromise;
    refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
    });
    return refreshPromise;
}

/** Warm the catalog in the background; never throws, never blocks. */
export function primeCatalogInBackground(): void {
    if (!loader || isWarm()) return;
    void refreshCatalogSnapshot();
}

/**
 * Synchronous pricing lookup. Returns `undefined` when the catalog is cold, the
 * model is unknown, or no loader has been installed.
 */
export function getModelPricingEntry(
    provider: string,
    model: string,
): AIModelPricingEntry | undefined {
    if (!index || !provider || !model) return undefined;
    const entry = index.get(`${provider.toLowerCase()}::${model.toLowerCase()}`);
    if (entry) return entry;
    return undefined;
}

export function isCatalogWarm(): boolean {
    return index !== null;
}

export function getCatalogSnapshotSize(): number {
    return modelCount;
}
