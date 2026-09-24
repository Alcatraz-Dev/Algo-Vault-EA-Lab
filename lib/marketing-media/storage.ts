/** Marketing Content Factory — RTDB persistence layer.
 *
 * Reuses the growth engine's helpers (`deepClean`, `genId`,
 * `claimJobKey`, `writeGrowthAudit`) so the marketing DB contracts
 * stay consistent with the growth contracts. All writes deep‑clean
 * `undefined` → `null` (RTDB rejects undefined).
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { deepClean, genId, claimJobKey, writeGrowthAudit } from "../growth/database";
import { MARKETING_COLLECTIONS } from "./collections";
import type { MarketingCampaign, MarketingCreative, MarketingJob, MarketingAssetRecord, MarketingVariant, MarketingAnalyticsEvent } from "./domain";

export { adminDatabase };

function ref(collection: string, id?: string) {
  return id ? adminDatabase.ref(`${MARKETING_COLLECTIONS[collection as keyof typeof MARKETING_COLLECTIONS]}/${id}`) : adminDatabase.ref(MARKETING_COLLECTIONS[collection as keyof typeof MARKETING_COLLECTIONS]);
}

// ─── Campaigns ────────────────────────────────────────────────────────

export async function createCampaign(data: Partial<MarketingCampaign> & { createdBy: string }): Promise<MarketingCampaign & { id: string }> {
  const now = Date.now();
  const ref_ = adminDatabase.ref(MARKETING_COLLECTIONS.campaigns).push();
  const id = ref_.key as string;
  const rec = { ...data, id, createdAt: data.createdAt ?? now, updatedAt: now } as MarketingCampaign & { id: string };
  await ref_.set(deepClean(rec));
  return rec;
}

export async function getCampaign(id: string): Promise<MarketingCampaign & { id: string } | null> {
  const snap = await adminDatabase.ref(`${MARKETING_COLLECTIONS.campaigns}/${id}`).get();
  return snap.exists() ? ({ ...(snap.val() as MarketingCampaign), id }) : null;
}

// ─── Creatives ────────────────────────────────────────────────────────

export async function createCreative(data: Partial<MarketingCreative> & { createdBy: string }): Promise<MarketingCreative & { id: string }> {
  const now = Date.now();
  const ref_ = adminDatabase.ref(MARKETING_COLLECTIONS.creatives).push();
  const id = ref_.key as string;
  const rec = { ...data, id, createdAt: data.createdAt ?? now, updatedAt: now } as MarketingCreative & { id: string };
  await ref_.set(deepClean(rec));
  await writeGrowthAudit({ actor: data.createdBy, action: "marketing_creative_created", targetType: "marketingCreative", targetId: id });
  return rec;
}

export async function getCreative(id: string): Promise<MarketingCreative & { id: string } | null> {
  const snap = await adminDatabase.ref(`${MARKETING_COLLECTIONS.creatives}/${id}`).get();
  return snap.exists() ? ({ ...(snap.val() as MarketingCreative), id }) : null;
}

export async function updateCreative(id: string, updates: Partial<MarketingCreative>, updatedBy: string): Promise<void> {
  await adminDatabase.ref(`${MARKETING_COLLECTIONS.creatives}/${id}`).update({ ...deepClean(updates), updatedAt: Date.now(), updatedBy });
}

// ─── Jobs ──────────────────────────────────────────────────────────────

export async function createJob(data: Partial<MarketingJob> & { createdBy: string }): Promise<MarketingJob & { id: string }> {
  const now = Date.now();
  const ref_ = adminDatabase.ref(MARKETING_COLLECTIONS.jobs).push();
  const id = ref_.key as string;
  const rec = { ...data, id, createdAt: data.createdAt ?? now, updatedAt: now } as MarketingJob & { id: string };
  await ref_.set(deepClean(rec));
  return rec;
}

/** Claim a marketing job atomically (idempotent). Returns true for winner. */
export async function claimMarketingJob(jobKey: string, ttlMs?: number): Promise<boolean> {
  return claimJobKey(jobKey, ttlMs ?? MARKETING_DEFAULTS.pipelineJobTtlMs);
}

// ─── Assets ───────────────────────────────────────────────────────────

export async function createAsset(data: Partial<MarketingAssetRecord> & { createdBy: string }): Promise<MarketingAssetRecord & { id: string }> {
  const now = Date.now();
  const ref_ = adminDatabase.ref(MARKETING_COLLECTIONS.assets).push();
  const id = ref_.key as string;
  const rec = { ...data, id, createdAt: now, updatedAt: now } as MarketingAssetRecord & { id: string };
  await ref_.set(deepClean(rec));
  return rec;
}

// ─── Variants ─────────────────────────────────────────────────────────

export async function createVariant(data: Partial<MarketingVariant> & { createdBy: string }): Promise<MarketingVariant & { id: string }> {
  const now = Date.now();
  const ref_ = adminDatabase.ref(MARKETING_COLLECTIONS.variants).push();
  const id = ref_.key as string;
  const rec = { ...data, id, createdAt: now, updatedAt: now } as MarketingVariant & { id: string };
  await ref_.set(deepClean(rec));
  return rec;
}

// ─── Analytics ────────────────────────────────────────────────────────

export async function trackEvent(data: Partial<MarketingAnalyticsEvent> & { createdBy: string }): Promise<MarketingAnalyticsEvent & { id: string }> {
  const now = Date.now();
  const ref_ = adminDatabase.ref(MARKETING_COLLECTIONS.analytics).push();
  const id = ref_.key as string;
  const rec = { ...data, id, createdAt: now } as MarketingAnalyticsEvent & { id: string };
  await ref_.set(deepClean(rec));
  return rec;
}

/** List analytics for a creative (limited). */
export async function listAnalytics(creativeId: string, limit = 100) {
  const snap = await adminDatabase.ref(`${MARKETING_COLLECTIONS.analytics}/_byCreative/${creativeId}`).limitToLast(limit).get();
  const data = (snap.val() || {}) as Record<string, MarketingAnalyticsEvent>;
  return Object.values(data);
}