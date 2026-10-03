import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../_shared";
import { getCatalog } from "@/lib/performance-arena/service";
import { arenaFlagSnapshot } from "@/lib/performance-arena/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token — catalog access is evaluated per user (Pro/free/points)
// server-side; a rejected access item still renders with its honest reason.
export async function GET(request: import("next/server").NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const catalog = await getCatalog(auth.uid);
        return arenaJson({ ...catalog, flags: arenaFlagSnapshot() });
    } catch (error) {
        return arenaError(error, "Failed to load the challenge catalog.");
    }
}
