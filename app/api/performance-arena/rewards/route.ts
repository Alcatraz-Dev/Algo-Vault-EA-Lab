import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../_shared";
import { getWallet, listLedger, writeLedgerEntry, saveWallet } from "@/lib/performance-arena/store";
import { planPointsSpend } from "@/lib/performance-arena/rewards";
import { findSpendItem, POINTS_SPEND_CATALOG } from "@/lib/performance-arena/policies";
import { isPlatformRewardsEnabled } from "@/lib/performance-arena/flags";
import { ARENA_DISCLAIMERS } from "@/lib/performance-arena/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token, owner-scoped wallet + immutable ledger.
export async function GET(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const [wallet, ledger] = await Promise.all([getWallet(auth.uid), listLedger(auth.uid, 100)]);
        return arenaJson({
            wallet,
            ledger,
            spendCatalog: POINTS_SPEND_CATALOG,
            platformRewardsEnabled: isPlatformRewardsEnabled(),
            disclaimer: ARENA_DISCLAIMERS.rewards,
        });
    } catch (error) {
        return arenaError(error, "Failed to load rewards.");
    }
}

// Auth: bearer token. Spending is server-authoritative: the catalog price and
// grant amounts come from configuration, balances from RTDB, and every ledger
// entry uses a deterministic id (set-if-absent) — a retried request can never
// double-spend or double-grant.
export async function POST(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;

        const body = (await request.json().catch(() => null)) as { itemId?: unknown; requestId?: unknown } | null;
        if (!body || typeof body.itemId !== "string") {
            return arenaJson({ error: "itemId is required.", code: "INVALID_BODY" }, 400);
        }
        const item = findSpendItem(body.itemId);
        if (!item) return arenaJson({ error: "Unknown catalog item.", code: "ITEM_NOT_FOUND" }, 404);

        const requestId = typeof body.requestId === "string" && body.requestId ? body.requestId.slice(0, 80) : `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const wallet = await getWallet(auth.uid);
        const plan = planPointsSpend({
            wallet,
            itemId: item.id,
            costPoints: item.costPoints,
            grants: item.grants,
            now: Date.now(),
            requestSourceId: requestId,
        });
        if (!plan.ok) {
            return arenaJson({ error: plan.error ?? "Spend failed.", code: "SPEND_REJECTED" }, 402);
        }

        let createdCount = 0;
        for (const entry of plan.entries) {
            const created = await writeLedgerEntry(entry);
            if (created) createdCount += 1;
        }
        if (createdCount > 0) {
            // Apply the wallet delta only for entries this call created.
            await saveWallet(plan.wallet);
        }
        const fresh = await getWallet(auth.uid);
        return arenaJson({ wallet: fresh, created: createdCount, item }, 201);
    } catch (error) {
        return arenaError(error, "Failed to spend AV Points.");
    }
}
