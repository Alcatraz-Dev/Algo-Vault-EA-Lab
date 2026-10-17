import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { AIConfig } from "@/lib/ai/config";
import { defaultRouter } from "@/lib/ai/router";
import { LocalStrategyAIProvider } from "@/lib/ai/local";
import { isLoopbackRequest } from "@/lib/ai/local-endpoint";
import type { AIProvider, AIModel } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderStatus =
    | "ready"
    | "not_configured"
    | "unreachable"
    | "catalog_unavailable"
    | "no_models";

interface CatalogProvider {
    id: string;
    name: string;
    type: "cloud" | "local";
    available: boolean;
    status: ProviderStatus;
    models: Array<{
        id: string;
        name: string;
        free: boolean;
        confirmedFree: boolean;
        capabilities?: AIModel["capabilities"];
        contextLength?: number;
        expiresAt?: string;
        deprecated?: boolean;
    }>;
}

function publicModel(model: AIModel) {
    return {
        id: model.id,
        name: model.name,
        free: model.free,
        confirmedFree: model.confirmedFree,
        capabilities: model.capabilities,
        contextLength: model.contextLength,
        expiresAt: model.expiresAt,
        deprecated: model.deprecated,
    };
}

function statusFor(provider: AIProvider, available: boolean, models: AIModel[], localEnabled: boolean): ProviderStatus {
    if (!available) {
        if (provider.id === "ollama" && localEnabled) return "unreachable";
        return "not_configured";
    }
    if (models.length === 0) {
        return provider.id === "openrouter" ? "catalog_unavailable" : "no_models";
    }
    return "ready";
}

/**
 * GET /api/ai/models
 *
 * Read-only provider/model catalog for the selector. It exposes no credentials,
 * no endpoint URLs, and no prompts. OpenRouter metadata is public, so its
 * catalog is still discoverable before a key is configured.
 *
 * In the desktop shell (`ALGOVAULT_LOCAL_AI=1`) the embedded server is bound to
 * loopback, so the read-only catalog is available without a Firebase ID token.
 * The token-free path additionally requires a loopback request, so a public
 * deployment that enabled local AI by mistake does not expose its catalog. On
 * the web, a verified Firebase ID token is required.
 */
export async function GET(req: NextRequest) {
    const localAI = AIConfig.localAIEnabled && isLoopbackRequest(req.headers);
    const token = localAI ? null : await authenticate(req);
    if (!localAI && !token) {
        return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

    try {
        const providers: CatalogProvider[] = [];
        const registered = defaultRouter.getRegisteredProviders();

        for (const provider of registered) {
            if (provider.id === "ollama" && !localAI) continue;

            const available = await Promise.resolve()
                .then(() => provider.isAvailable())
                .then((value) => value === true, () => false);
            const models = await provider.getModels(forceRefresh).catch(() => []);
            const status = statusFor(provider, available, models, localAI);

            // Keep unavailable providers only when they have useful public
            // metadata (OpenRouter is discoverable without a key).
            if (!available && models.length === 0 && provider.id !== "ollama") continue;

            providers.push({
                id: provider.id,
                name: provider.name,
                type: provider.isLocal ? "local" : "cloud",
                available,
                status,
                models: models.map(publicModel),
            });
        }

        const heuristic = new LocalStrategyAIProvider();
        providers.push({
            id: heuristic.id,
            name: heuristic.name,
            type: "local",
            available: true,
            status: "ready",
            models: (await heuristic.getModels()).map(publicModel),
        });

        return NextResponse.json(
            {
                success: true,
                localAI,
                providers,
                fetchedAt: Date.now(),
            },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (err) {
        console.error("[api/ai/models] error:", err instanceof Error ? err.message : err);
        return NextResponse.json(
            { success: false, error: "INTERNAL_ERROR" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
        );
    }
}
