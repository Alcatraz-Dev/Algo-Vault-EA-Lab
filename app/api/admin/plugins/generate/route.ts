import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, badRequest, unauthorized } from "@/lib/plugins/api-helpers";
import { generatePluginDraft, isSupportedExtensionType, SUPPORTED_RUNTIME_APIS } from "@/lib/plugins/ai-generator";
import { PluginKind, PluginCategory, PluginExtensionType } from "@/lib/plugins/types";

const VALID_TARGETS: PluginKind[] = ["plugin", "extension"];
const VALID_CATEGORIES: PluginCategory[] = [
    "trading-intelligence",
    "risk-management",
    "market-monitoring",
    "behavioral-analytics",
    "correlation-analysis",
    "automation",
    "external-integration",
    "workflow",
    "news-intelligence",
    "ai-assistant",
];

/**
 * AI Plugin Studio generation endpoint.
 * Runs the full safe pipeline: generate → validate → sandbox → tests → draft.
 * Rejects unsupported runtime APIs explicitly (see SUPPORTED_RUNTIME_APIS).
 */
export async function POST(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();

        const body = await request.json().catch(() => ({}));
        const prompt = String(body.prompt || "").trim();
        if (!prompt || prompt.length < 10) return badRequest("Describe the plugin in at least a sentence.");

        const target = VALID_TARGETS.includes(body.target) ? (body.target as PluginKind) : "plugin";
        const category = VALID_CATEGORIES.includes(body.category) ? (body.category as PluginCategory) : "trading-intelligence";

        // Extensions declare a connection type (webhook, browser, tradingview, chat, api).
        const extensionTypeRaw = String(body.extensionType || "").trim().toLowerCase();
        const extensionType: PluginExtensionType | undefined =
            target === "extension" && isSupportedExtensionType(extensionTypeRaw) ? extensionTypeRaw : undefined;

        const result = await generatePluginDraft({ prompt, target, category, createdBy: admin.uid, ...(extensionType ? { extensionType } : {}) });

        if (!result.ok || !result.draft) {
            return NextResponse.json(
                { success: false, error: result.error || "Generation failed.", messages: result.messages, jobId: result.jobId, supportedApis: SUPPORTED_RUNTIME_APIS },
                { status: 422 }
            );
        }

        return NextResponse.json({
            success: true,
            draft: result.draft,
            jobId: result.jobId,
            messages: result.messages,
            validation: result.draft.validation,
            supportedApis: SUPPORTED_RUNTIME_APIS,
        });
    } catch (err) {
        return serverError(err, "AI generation failed.");
    }
}

export const dynamic = "force-dynamic";