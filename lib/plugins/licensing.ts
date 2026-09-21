import { adminDatabase } from "@/lib/firebase-admin";
import { PluginLicenseRecord, PluginRecord } from "./types";
import { getPluginLicense, setPluginLicense, listPluginLicenses } from "./database";
import { writeAuditLog } from "./database";

/**
 * Plugin licensing — entitlement for paid plugins.
 *
 * Licenses live at `pluginLicenses/{userId}/{pluginId}` and are written by
 * the Stripe webhook (via /api/webhooks/stripe) after a successful plugin
 * order. This module centralizes the grant/check/revoke operations so the
 * runtime, checkout flow and admin tooling all share the same rules.
 *
 * Free plugins never get a license record — their entitlement is implicit.
 */

export type LicenseCheck = {
    valid: boolean;
    reason?: string;
    license?: PluginLicenseRecord | null;
};

export function licenseExpiryForPricing(
    pricingType: PluginRecord["pricing"]["type"],
    intervalMonths: number,
    startedAt = Date.now()
): number {
    if (pricingType === "one_time") return 0; // lifetime
    if (pricingType !== "subscription") return 0;
    const months = Math.max(1, Math.min(24, Math.round(intervalMonths || 1)));
    const d = new Date(startedAt);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.getTime();
}

/**
 * Grants (or refreshes) a license after a confirmed payment. Idempotent:
 * re-running with the same order does not produce duplicate records.
 */
export async function grantPluginLicense(input: {
    userId: string;
    plugin: PluginRecord;
    orderId: string;
    amount: number;
    currency: string;
    stripeSubscriptionId?: string | null;
}): Promise<PluginLicenseRecord> {
    const now = Date.now();
    const existing = await getPluginLicense(input.userId, input.plugin.id);
    const pricing = input.plugin.pricing;

    const license: PluginLicenseRecord = {
        id: existing?.id || `plic_${input.plugin.id}_${input.userId.slice(0, 8)}`,
        pluginId: input.plugin.id,
        pluginName: input.plugin.displayName || input.plugin.name,
        userId: input.userId,
        orderId: input.orderId,
        pricingType: pricing.type,
        amount: Math.max(0, Number(input.amount) || 0),
        currency: String(input.currency || pricing.currency || "usd").toLowerCase(),
        status: "active",
        stripeSubscriptionId: input.stripeSubscriptionId || existing?.stripeSubscriptionId || null,
        startedAt: existing?.startedAt || now,
        expiresAt:
            pricing.type === "subscription" ? licenseExpiryForPricing(pricing.type, pricing.intervalMonths || 1, existing?.expiresAt || now) : 0,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    };

    await setPluginLicense(license);
    await writeAuditLog({
        action: "plugin.license.granted",
        actor: input.userId,
        pluginId: input.plugin.id,
        detail: { orderId: input.orderId, pricingType: pricing.type },
    });
    return license;
}

/**
 * Runtime entitlement check. Free plugins are always valid. Paid plugins need
 * an active, non-expired license. Expired licenses are reported as invalid
 * and the caller (engine) pauses the installation.
 */
export async function checkPluginLicense(userId: string, plugin: PluginRecord): Promise<LicenseCheck> {
    if (plugin.pricing.type === "free") {
        return { valid: true, license: null };
    }
    const license = await getPluginLicense(userId, plugin.id);
    if (!license) {
        return { valid: false, reason: "No license found — this plugin requires a purchase.", license: null };
    }
    if (license.status !== "active") {
        return { valid: false, reason: `License is ${license.status}. Re-activate it in Settings to resume.`, license };
    }
    if (license.expiresAt > 0 && Date.now() >= license.expiresAt) {
        return { valid: false, reason: "License expired on this plugin.", license };
    }
    return { valid: true, license };
}

export async function revokePluginLicense(userId: string, pluginId: string, reason = "Revoked by admin"): Promise<void> {
    const existing = await getPluginLicense(userId, pluginId);
    if (!existing) return;
    await setPluginLicense({
        ...existing,
        status: "revoked",
        updatedAt: Date.now(),
    });
    await writeAuditLog({
        action: "plugin.license.revoked",
        actor: "admin",
        pluginId,
        detail: { userId, reason },
    });
}

export async function listUserLicenses(userId: string): Promise<PluginLicenseRecord[]> {
    return listPluginLicenses(userId);
}

/**
 * Marks every expired license in a user's set as expired in the DB and
 * returns the list. Intended for the runtime/install page health check.
 */
export async function refreshExpiredLicenses(userId: string): Promise<PluginLicenseRecord[]> {
    const licenses = await listPluginLicenses(userId);
    const now = Date.now();
    let changed = false;
    for (const license of licenses) {
        if (license.status === "active" && license.expiresAt > 0 && now >= license.expiresAt) {
            await setPluginLicense({ ...license, status: "expired", updatedAt: now });
            changed = true;
        }
    }
    return changed ? listPluginLicenses(userId) : licenses;
}

/** Purges a license entirely when a plugin is uninstalled and its order won't be reused. */
export async function removePluginLicense(userId: string, pluginId: string): Promise<void> {
    await adminDatabase.ref(`pluginLicenses/${userId}/${pluginId}`).remove();
}