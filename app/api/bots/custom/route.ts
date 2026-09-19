import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
    generateCustomBotId,
    upsertBot,
    createCustomBotEntitlement,
    notifyBotEvent,
    type UserBot,
} from "@/lib/bots";

export const runtime = "nodejs";

/**
 * Registers a user-owned Custom / Legacy MT5 EA. No EX5 upload is required —
 * the existing AlgoVaultTradeGateway monitors the account and attributes
 * activity to this bot via its magic number (and optional comment).
 *
 * Custom bots are entitled through an extended license record
 * (`licenses/{uid}/{botId}-LIC`, type "custom_bot") tied to an active
 * Pro/Enterprise subscription.
 */
export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json().catch(() => ({})) as Record<string, unknown>;

        const name = String(body.name || "").trim();
        const platform = String(body.platform || "MT5").trim().toUpperCase();
        const symbol = String(body.symbol || "").trim().toUpperCase() || null;
        const timeframe = String(body.timeframe || "").trim().toUpperCase() || null;
        const magicNumber = String(body.magicNumber ?? "").trim();
        const commentFilter = String(body.commentFilter || "").trim() || null;
        const description = String(body.description || "").trim() || undefined;
        const mt5Account = String(body.mt5Account || "").trim();

        if (!name) {
            return NextResponse.json({ success: false, error: "Bot name is required." }, { status: 400 });
        }
        if (!magicNumber) {
            return NextResponse.json({ success: false, error: "Magic number is required for custom MT5 bots." }, { status: 400 });
        }
        if (!/^\d+$/.test(magicNumber)) {
            return NextResponse.json({ success: false, error: "Magic number must be numeric." }, { status: 400 });
        }
        if (mt5Account && !/^\d+$/.test(mt5Account)) {
            return NextResponse.json({ success: false, error: "MT5 account must be numeric." }, { status: 400 });
        }

        const botId = generateCustomBotId();

        const bot: Omit<UserBot, "createdAt" | "updatedAt"> & { id: string } = {
            id: botId,
            ownerId: token.uid,
            type: "custom",
            name,
            platform,
            symbol,
            timeframe,
            magicNumber,
            commentFilter,
            productId: null,
            licenseId: `${botId}-LIC`,
            mt5Account: mt5Account || null,
            gatewayInstallationId: null,
            mapping: {
                mt5Account: mt5Account || null,
                magicNumber,
                symbol,
                comment: commentFilter,
                updatedAt: Date.now(),
            },
            status: "active",
            online: false,
            lastHeartbeatAt: null,
            description,
        };

        const savedBot = await upsertBot(bot);

        const license = await createCustomBotEntitlement(token.uid, botId, mt5Account);

        void notifyBotEvent(savedBot, {
            title: "Bot Connected",
            message: `Custom EA registered on MT5 (powered by the existing MT5 Gateway).`,
            level: "success",
        });

        return NextResponse.json({
            success: true,
            botId,
            bot: { ...savedBot, licenseKey: license.licenseKey },
            entitlement: { id: license.id, status: license.status, type: license.type },
        });
    } catch (error) {
        console.error("[bots/custom POST]", error);
        return NextResponse.json({ success: false, error: "Unable to register bot." }, { status: 500 });
    }
}