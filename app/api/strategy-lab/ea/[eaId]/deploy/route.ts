import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { generateCustomBotId, upsertBot, createCustomBotEntitlement, notifyBotEvent, UserBot } from "@/lib/bots";
import { getGeneratedEA, updateGeneratedEA } from "@/lib/strategy-lab/ea-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * Deploys a generated EA by registering its magic number with the AlgoVault
 * Trade Gateway's bot registry (user_bots/{botId}, type "custom"). The
 * existing Gateway (magic-based attribution + ReportAllMagic) then monitors
 * the account — no parallel monitoring system is introduced.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ eaId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const { eaId } = await params;
        const ea = await getGeneratedEA(token.uid, eaId);
        if (!ea) {
            return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as { mt5Account?: string };
        const mt5Account = String(body.mt5Account ?? "").trim();
        if (mt5Account && !/^\d+$/.test(mt5Account)) {
            return NextResponse.json({ error: "MT5 account must be numeric." }, { status: 400, headers: corsHeaders });
        }

        // Re-using the same bot record when re-deploying keeps the Gateway's
        // attribution history intact instead of creating duplicates.
        let botId: string;
        if (ea.gateway?.botId) {
            botId = ea.gateway.botId;
        } else {
            botId = generateCustomBotId();
        }

        const bot: Omit<UserBot, "createdAt" | "updatedAt"> & { id: string } = {
            id: botId,
            ownerId: token.uid,
            type: "custom",
            name: ea.name,
            platform: "MT5",
            symbol: ea.symbol,
            timeframe: ea.timeframe,
            magicNumber: String(ea.magicNumber),
            commentFilter: `AlgoVault ${ea.symbol}`,
            productId: ea.marketplaceProductId ?? null,
            licenseId: `${botId}-LIC`,
            mt5Account: mt5Account || null,
            gatewayInstallationId: null,
            mapping: {
                mt5Account: mt5Account || null,
                magicNumber: String(ea.magicNumber),
                symbol: ea.symbol,
                comment: `AlgoVault ${ea.symbol}`,
                updatedAt: Date.now(),
            },
            status: "active",
            online: false,
            lastHeartbeatAt: null,
            description: `Generated EA for strategy ${ea.strategyId} v${ea.strategyVersion} (EA ${ea.eaVersion ?? "1.0.0"}).`,
        };

        const savedBot = await upsertBot(bot);
        const license = await createCustomBotEntitlement(token.uid, botId, mt5Account);

        await updateGeneratedEA(token.uid, eaId, {
            gateway: {
                botId,
                productId: ea.marketplaceProductId ?? null,
                magicNumber: String(ea.magicNumber),
                symbol: ea.symbol,
                registeredAt: Date.now(),
            },
        });

        void notifyBotEvent(savedBot, {
            title: "EA Deployed",
            message: `Generated EA "${ea.name}" is live and monitored by the MT5 Gateway (magic ${ea.magicNumber}).`,
            level: "success",
        });

        return NextResponse.json(
            {
                success: true,
                botId,
                bot: { ...savedBot, licenseKey: license.licenseKey },
                entitlement: { id: license.id, status: license.status, type: license.type },
                magicNumber: ea.magicNumber,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/ea/:id/deploy POST]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Unable to deploy EA" }, { status: 500, headers: corsHeaders });
    }
}