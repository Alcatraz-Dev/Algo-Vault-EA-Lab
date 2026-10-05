/**
 * POST /api/intelligence/v2/indicators — legacy adapter over the canonical facade.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { getIntelligence } from "@/lib/intelligence-cloud/intelligence";
import {
    INTELLIGENCE_API_VERSION,
    INTELLIGENCE_LEGACY_API_VERSION,
    type IntelligenceRequest,
} from "@/lib/intelligence-cloud/contracts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "indicators:read",
            requiredEntitlement: "indicators",
            endpoint: "GET /v1/indicators",
            usageCategory: "indicator.compute",
            apiVersion: INTELLIGENCE_LEGACY_API_VERSION,
            build: (intelligence) => ({
                success: true,
                apiVersion: INTELLIGENCE_LEGACY_API_VERSION,
                contractVersion: INTELLIGENCE_API_VERSION,
                symbol: intelligence.instrument.symbol,
                timeframe: intelligence.instrument.timeframe,
                indicators: intelligence.indicators ?? [],
                limitations: intelligence.limitations,
                engineVersions: intelligence.engineVersions,
            }),
        },
        run: async (body) => {
            const context = (body.context ?? {}) as { indicators?: string[]; smartMoney?: boolean };
            const intelligence = await getIntelligence({
                symbol: String(body.symbol ?? ""),
                timeframe: String(body.timeframe ?? ""),
                timestamp: body.timestamp ? Number(body.timestamp) : undefined,
                context: {
                    indicators: Array.isArray(context.indicators) ? context.indicators : ["rsi", "macd", "atr", "vwap"],
                    smartMoney: context.smartMoney === true,
                },
                includeLineage: false,
            } as IntelligenceRequest);
            return { intelligence };
        },
    });
}
