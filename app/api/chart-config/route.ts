import { NextResponse } from "next/server";
import { hasTwelveDataApiKey } from "@/lib/market-data/twelvedata/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chart-config
 *
 * Public capability probe for the native chart engine. Exposes only feature
 * flags — never keys, hosts, or provider identities beyond what the flag
 * implies. The browser uses `deepHistory` to decide whether scrolling left
 * can load older pages or has reached the provider's history boundary.
 */
export async function GET() {
    return NextResponse.json(
        {
            deepHistory: hasTwelveDataApiKey(),
            maxInitialCandles: 500,
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}
