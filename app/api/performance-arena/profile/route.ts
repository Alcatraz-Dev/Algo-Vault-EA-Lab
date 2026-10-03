import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../_shared";
import { getProfile } from "@/lib/performance-arena/service";
import { getWallet, listLedger } from "@/lib/performance-arena/store";
import { arenaFlagSnapshot } from "@/lib/performance-arena/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token, owner-scoped profile + wallet summary.
export async function GET(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const [profile, wallet, recentRewards] = await Promise.all([
            getProfile(auth.uid),
            getWallet(auth.uid),
            listLedger(auth.uid, 25),
        ]);
        return arenaJson({
            profile,
            wallet,
            recentRewards,
            flags: arenaFlagSnapshot(),
        });
    } catch (error) {
        return arenaError(error, "Failed to load the trader profile.");
    }
}
