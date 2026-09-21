import { adminDatabase } from "@/lib/firebase-admin";
import { CATALOG, BUILTIN_PLUGINS, BUILTIN_EXTENSIONS, PLUGIN_CATEGORIES } from "./catalog";
import { PluginRecord, ExtensionRecord } from "./types";
import { writeAuditLog } from "./database";

/**
 * Plugin catalog seeder — idempotent, admin-gated.
 *
 * Writes every built-in plugin + extension and the category registry into
 * Firebase Realtime Database. Records that already exist are left intact
 * (their runtime counters, ratings and user installs are preserved); only
 * missing timestamps are stamped. Re-running is safe.
 */

export type SeedResult = {
    seeded: number;
    updated: number;
    unchanged: number;
    categories: number;
};

function ensureTimestamps(record: PluginRecord, now: number): PluginRecord {
    return {
        ...record,
        lastUpdated: record.lastUpdated || Date.UTC(2026, 0, 15),
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now,
    };
}

export async function seedPluginCatalog(): Promise<SeedResult> {
    const now = Date.now();
    const result: SeedResult = { seeded: 0, updated: 0, unchanged: 0, categories: 0 };

    const entries: PluginRecord[] = [...BUILTIN_PLUGINS, ...BUILTIN_EXTENSIONS];
    for (const record of entries) {
        const existingSnap = await adminDatabase.ref(`plugins/${record.id}`).get();
        const existing = existingSnap.val() as (PluginRecord & ExtensionRecord) | null;

        if (existing && typeof existing === "object") {
            const merged: PluginRecord = {
                ...ensureTimestamps(record, now),
                // Preserve live state that the seed must never clobber.
                installs: existing.installs || record.installs,
                activeUsers: existing.activeUsers || record.activeUsers,
                rating: existing.rating || record.rating,
                versionHistory:
                    Array.isArray(existing.versionHistory) && existing.versionHistory.length > 0
                        ? existing.versionHistory
                        : record.versionHistory,
                lastUpdated: existing.lastUpdated || record.lastUpdated,
                createdAt: existing.createdAt || record.createdAt,
                updatedAt: now,
            };
            await adminDatabase.ref(`plugins/${record.id}`).set(merged);
            result.updated += 1;
        } else {
            const fresh = ensureTimestamps(record, Date.UTC(2026, 0, 15));
            await adminDatabase.ref(`plugins/${record.id}`).set({
                ...fresh,
                updatedAt: now,
            });
            result.seeded += 1;
        }
    }

    for (const category of PLUGIN_CATEGORIES) {
        await adminDatabase.ref(`pluginCategories/${category.id}`).set({
            ...category,
            updatedAt: now,
        });
        result.categories += 1;
    }

    await writeAuditLog({
        action: "plugin.catalog.seeded",
        actor: "admin",
        detail: { seeded: result.seeded, updated: result.updated, categories: result.categories },
    });

    return result;
}

/** Counts records that currently exist — used to make seeding status visible in the admin UI. */
export async function catalogSnapshot(): Promise<{ plugins: number; extensions: number; categories: number }> {
    const pluginsSnap = await adminDatabase.ref("plugins").get();
    const data = (pluginsSnap.val() || {}) as Record<string, PluginRecord>;
    let plugins = 0;
    let extensions = 0;
    for (const rec of Object.values(data)) {
        if (rec?.type === "extension") extensions += 1;
        else plugins += 1;
    }
    const categoriesSnap = await adminDatabase.ref("pluginCategories").get();
    return { plugins, extensions, categories: Object.keys(categoriesSnap.val() || {}).length };
}