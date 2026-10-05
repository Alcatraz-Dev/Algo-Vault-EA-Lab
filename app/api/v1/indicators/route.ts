/**
 * GET /api/v1/indicators — indicator snapshots from the canonical Indicator Engine.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { getIntelligence } from "@/lib/intelligence-cloud/intelligence";
import { INTELLIGENCE_API_VERSION, type IntelligenceRequest } from "@/lib/intelligence-cloud/contracts";

export const dynamic = "force-dynamic";

/** Registry ids this endpoint will accept, for a clear INVALID_REQUEST instead of an empty result. */
const SUPPORTED = ["sma", "ema", "wma", "vwap", "bollinger", "rsi", "macd", "stochastic", "awesome", "atr", "adx", "obv"];

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "indicators:read",
            requiredEntitlement: "indicators",
            endpoint: "GET /v1/indicators",
            usageCategory: "indicator.compute",
            apiVersion: INTELLIGENCE_API_VERSION,
            build: (intelligence) => ({
                apiVersion: intelligence.apiVersion,
                instrument: intelligence.instrument,
                indicators: intelligence.indicators ?? [],
                dataTimestamp: intelligence.dataTimestamp,
                limitations: intelligence.limitations,
                engineVersions: intelligence.engineVersions,
                cost: intelligence.cost,
            }),
        },
        run: async (body) => {
            // Query-string form: ?symbol=XAUUSD&timeframe=M5&indicators=rsi,macd
            const raw = body.indicators;
            const list = Array.isArray(raw)
                ? raw.map(String)
                : typeof raw === "string"
                  ? raw.split(",").map((s) => s.trim()).filter(Boolean)
                  : ["rsi", "macd", "atr", "vwap"];
            const unknown = list.filter((id) => !SUPPORTED.includes(id));

            const intelligence = await getIntelligence({
                symbol: String(body.symbol ?? ""),
                timeframe: String(body.timeframe ?? ""),
                timestamp: body.timestamp ? Number(body.timestamp) : undefined,
                context: { indicators: list },
                includeLineage: false,
            } as IntelligenceRequest);

            // Surfaces unsupported ids rather than silently dropping them.
            if (unknown.length > 0) {
                intelligence.limitations.push(
                    `Unsupported indicator id(s) were requested and produced no values: ${unknown.join(", ")}.`
                );
            }
            return { intelligence };
        },
    });
}

export async function POST(request: Request) {
    return GET(request);
}
