/**
 * POST /api/v1/strategies/validate — canonical strategy validation.
 *
 * Delegates to lib/strategy-engine/validation. There is no second validator in
 * the B2B layer.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { validateStrategy } from "@/lib/intelligence-cloud/intelligence";
import { INTELLIGENCE_API_VERSION, type StrategyValidationRequest } from "@/lib/intelligence-cloud/contracts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "strategy:read",
            requiredEntitlement: "strategy.intelligence",
            endpoint: "POST /v1/strategies/validate",
            usageCategory: "api.request",
            apiVersion: INTELLIGENCE_API_VERSION,
            build: (intelligence) => ({
                apiVersion: intelligence.apiVersion,
                limitations: intelligence.limitations,
                engineVersions: intelligence.engineVersions,
                cost: intelligence.cost,
            }),
        },
        // Validation returns its own envelope rather than an IntelligenceResponse,
        // so it bypasses the intelligence snapshot step.
        run: async (body) => {
            const result = await validateStrategy({
                definition: body.definition,
                symbol: body.symbol ? String(body.symbol) : undefined,
                timeframe: body.timeframe ? String(body.timeframe) : undefined,
                context: body.context as StrategyValidationRequest["context"],
            });
            return { valid: result.valid, result };
        },
    });
}
