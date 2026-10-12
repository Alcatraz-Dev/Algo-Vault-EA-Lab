/**
 * Strategy Factory campaign + vault persistence (server-only).
 *
 * Stored under the existing `strategyLab/{uid}` subtree, protected by the same
 * owner-or-admin RTDB rule used by `evolutionRuns`/`dnaCandidates`:
 *
 *   strategyLab/{uid}/campaigns/{campaignId}  → Campaign
 *   strategyLab/{uid}/vault/{passportId}       → CampaignSurvivor
 *
 * Reads are paginated and capped so a browser can never pull an unbounded
 * number of records. Each campaign keeps a single lease slot so concurrent
 * `advance` calls cannot double-apply generation work (mirrors the
 * strategy-research `claimMissionLease` pattern).
 */

import { adminDatabase } from "@/lib/firebase-admin";
import type { Campaign, CampaignStore, CampaignSurvivor } from "@/lib/ai/strategy-lab/campaign";

export const CAMPAIGNS_PATH = "campaigns";
export const VAULT_PATH = "vault";

export const MAX_CAMPAIGNS_PER_READ = 20;
export const MAX_VAULT_PER_READ = 50;

const TTL_MS = 10 * 60 * 1000;

/** RTDB rows include the transient `lease` child; it is stripped on read. */
type StoredCampaign = Campaign & { lease?: { lockedBy: string; lockedAt: number } | null };

function campaignRef(uid: string, campaignId: string) {
    return adminDatabase.ref(`strategyLab/${uid}/${CAMPAIGNS_PATH}/${campaignId}`);
}

function vaultRef(uid: string, survivorId: string) {
    return adminDatabase.ref(`strategyLab/${uid}/${VAULT_PATH}/${survivorId}`);
}

function stripLease(campaign: StoredCampaign): Campaign {
    const { lease: _lease, ...rest } = campaign;
    return rest;
}

export const campaignStore: CampaignStore = {
    async claimLease(uid, campaignId, workerId, ttlMs = TTL_MS): Promise<boolean> {
        const ref = campaignRef(uid, campaignId).child("lease");
        let claimed = false;
        await ref.transaction((current) => {
            const lease = (current ?? null) as { lockedBy: string; lockedAt: number } | null;
            const fresh =
                !lease || Date.now() - (lease.lockedAt ?? 0) > ttlMs || lease.lockedBy === workerId;
            if (!fresh) {
                claimed = false;
                return; // abort — someone else holds it
            }
            claimed = true;
            return { lockedBy: workerId, lockedAt: Date.now() };
        });
        return claimed;
    },

    async releaseLease(uid, campaignId, workerId): Promise<void> {
        await campaignRef(uid, campaignId).child("lease").transaction((current) => {
            const lease = (current ?? null) as { lockedBy: string; lockedAt: number } | null;
            if (lease && lease.lockedBy === workerId) return null;
            return; // abort — not ours
        });
    },

    async create(campaign) {
        await campaignRef(campaign.uid, campaign.id).set(campaign);
    },

    async get(uid, campaignId) {
        const snap = await campaignRef(uid, campaignId).get();
        if (!snap.exists()) return null;
        return stripLease(snap.val() as StoredCampaign);
    },

    async update(uid, campaignId, patch) {
        const { version, ...rest } = patch;
        const updateData: Record<string, unknown> = { ...rest, updatedAt: Date.now() };
        if (typeof version === "number") updateData.version = version;
        await campaignRef(uid, campaignId).update(updateData);
    },

    async delete(uid, campaignId) {
        await campaignRef(uid, campaignId).remove();
    },

    async list(uid, options) {
        const limit = Math.max(1, Math.min(options?.limit ?? 10, MAX_CAMPAIGNS_PER_READ));
        const ref = adminDatabase.ref(`strategyLab/${uid}/${CAMPAIGNS_PATH}`);
        const snap = await ref.orderByChild("createdAt").limitToLast(Math.max(limit * 3, 30)).get();
        if (!snap.exists()) return [];

        const raw = snap.val() as Record<string, StoredCampaign>;
        let campaigns = Object.keys(raw)
            .map((k) => stripLease(raw[k]))
            .sort((a, b) => b.createdAt - a.createdAt);

        if (options?.status) {
            campaigns = campaigns.filter((c) => c.status === options.status);
        }
        return campaigns.slice(0, limit);
    },

    async saveSurvivor(uid, survivor) {
        await vaultRef(uid, survivor.id).set(survivor);
    },

    async getSurvivor(uid, survivorId) {
        const snap = await vaultRef(uid, survivorId).get();
        return snap.exists() ? (snap.val() as CampaignSurvivor) : null;
    },

    async listSurvivors(uid, options) {
        const limit = Math.max(1, Math.min(options?.limit ?? 25, MAX_VAULT_PER_READ));
        const ref = adminDatabase.ref(`strategyLab/${uid}/${VAULT_PATH}`);
        const snap = await ref.orderByChild("createdAt").limitToLast(Math.max(limit * 3, 90)).get();
        if (!snap.exists()) return [];

        let survivors = Object.keys(snap.val() as Record<string, CampaignSurvivor>)
            .map((k) => (snap.val() as Record<string, CampaignSurvivor>)[k])
            .sort((a, b) => b.createdAt - a.createdAt);

        if (options?.campaignId) {
            survivors = survivors.filter((s) => s.campaignId === options.campaignId);
        }
        return survivors.slice(0, limit);
    },

    async deleteSurvivors(uid, campaignId) {
        const ref = adminDatabase.ref(`strategyLab/${uid}/${VAULT_PATH}`);
        const snap = await ref.orderByChild("campaignId").equalTo(campaignId).get();
        if (!snap.exists()) return;
        const updates: Record<string, null> = {};
        for (const key of Object.keys(snap.val() as Record<string, unknown>)) {
            updates[key] = null;
        }
        await ref.update(updates);
    },
};