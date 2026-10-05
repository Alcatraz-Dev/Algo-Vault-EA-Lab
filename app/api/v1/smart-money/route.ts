/**
 * GET /api/v1/smart-money — deterministic Smart Money intelligence.
 *
 * Structure, liquidity, FVG, order blocks, premium/discount and sessions, all
 * read from the canonical SMC engine. No SMC logic lives in this route.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { getIntelligence } from "@/lib/intelligence-cloud/intelligence";
import { INTELLIGENCE_API_VERSION, type IntelligenceRequest } from "@/lib/intelligence-cloud/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "smartmoney:read",
            requiredEntitlement: "smc",
            endpoint: "GET /v1/smart-money",
            usageCategory: "smc.compute",
            apiVersion: INTELLIGENCE_API_VERSION,
            build: (intelligence) => ({
                apiVersion: intelligence.apiVersion,
                instrument: intelligence.instrument,
                structure: intelligence.structure,
                liquidity: intelligence.liquidity,
                smartMoney: intelligence.smartMoney,
                limitations: intelligence.limitations,
                engineVersions: intelligence.engineVersions,
                dataTimestamp: intelligence.dataTimestamp,
                dataLineage: intelligence.dataLineage,
                cost: intelligence.cost,
            }),
        },
        run: async (body) => {
            const intelligence = await getIntelligence({
                symbol: String(body.symbol ?? ""),
                timeframe: String(body.timeframe ?? ""),
                timestamp: body.timestamp ? Number(body.timestamp) : undefined,
                context: { smartMoney: true, structure: true, liquidity: true },
            } as IntelligenceRequest);
            return { intelligence };
        },
    });
}

export async function POST(request: Request) {
    return GET(request);
}
