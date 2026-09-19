import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { getStrategy } from "@/lib/strategy-lab/storage";
import { generateEAForStrategy } from "@/lib/strategy-lab/ea/generator";
import { saveGeneratedEA, listGeneratedEAs, toEAView } from "@/lib/strategy-lab/ea-storage";
import { EAGenerateOptions, GeneratedEA } from "@/lib/strategy-lab/ea/types";
import { Strategy } from "@/lib/strategy-lab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
        const eas = await listGeneratedEAs(token.uid, Math.min(Math.max(limit, 1), 100));
        return NextResponse.json({ eas: eas.map((ea) => toEAView(ea, false)) }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/ea GET]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load generated EAs" }, { status: 500, headers: corsHeaders });
    }
}

export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json({ error: access.reason ?? "Access denied" }, { status: 403, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as {
            strategyId?: string;
            strategy?: Strategy;
            options?: EAGenerateOptions;
        };

        let strategy: Strategy | null = body.strategy ?? null;
        if (!strategy && body.strategyId) {
            strategy = await getStrategy(uid, body.strategyId);
        }
        if (!strategy) {
            return NextResponse.json({ error: "A valid strategy (strategyId or strategy) is required." }, { status: 400, headers: corsHeaders });
        }

        const options: EAGenerateOptions = {
            enableGateway: body.options?.enableGateway ?? true,
            enableLicense: body.options?.enableLicense ?? false,
            licenseDurationDays: body.options?.licenseDurationDays ?? 1,
            sourceAvailable: body.options?.sourceAvailable ?? true,
            protected: body.options?.protected ?? true,
            generatorVersion: body.options?.generatorVersion,
            compile: body.options?.compile ?? true,
        };

        const result = await generateEAForStrategy(strategy, options);

        if (!result.success) {
            const message = result.errors.some((e) => e.field === "compile")
                ? "Strategy generated but the EA failed compilation. Fix the reported errors and regenerate."
                : "Strategy could not be compiled to a runnable EA. See errors.";
            return NextResponse.json(
                {
                    success: false,
                    error: message,
                    errors: result.errors,
                    warnings: result.warnings,
                    hash: result.hash,
                    message,
                },
                { status: 422, headers: corsHeaders }
            );
        }

        const now = Date.now();
        const eaId = `EA-${String(result.hash ?? "").slice(0, 12).toUpperCase()}`;

        const ea: GeneratedEA = {
            eaId,
            userId: uid,
            strategyId: strategy.id,
            strategyVersion: strategy.version,
            strategyHash: result.hash ?? "",
            name: strategy.name,
            symbol: strategy.asset,
            timeframe: strategy.timeframes.setup,
            magicNumber: result.meta?.magicNumber ?? 0,
            generatorVersion: result.meta?.generatorVersion ?? "",
            sourceAvailable: options.sourceAvailable ?? true,
            compiled: result.compiled ?? false,
            protected: options.protected ?? true,
            fileVersion: result.meta?.fileVersion ?? 1,
            code: result.code ?? null,
            createdAt: now,
            updatedAt: now,
            licenseDurationDays: options.licenseDurationDays ?? 1,
            enableGateway: options.enableGateway ?? true,
            version: strategy.version,
            eaVersion: result.meta?.eaVersion,
            executionModel: result.meta?.executionModel,
            configurationHash: result.meta?.configurationHash,
            riskConfig: result.spec?.risk as unknown as Record<string, unknown>,
            tradeManagementConfig: {
                stopLoss: result.spec?.stopLoss,
                takeProfit: result.spec?.takeProfit,
            },
            aiNotes: null,
            compileReport: {
                compiled: result.compiled ?? false,
                errors: result.compileErrors ?? [],
                warnings: result.compileWarnings ?? [],
                compilerOutput: result.compilerOutput,
                compiledAt: result.meta?.compiledAt ?? now,
                method: result.meta?.compileMethod ?? "static",
            },
            parity: result.parity ?? null,
            gateway: null,
            marketplace: null,
        };

        const savedId = await saveGeneratedEA(uid, ea);

        return NextResponse.json({ success: true, eaId: savedId, ea: toEAView(ea, true) }, { status: 201, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/ea POST]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to generate EA" }, { status: 500, headers: corsHeaders });
    }
}