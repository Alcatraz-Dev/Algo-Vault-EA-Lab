import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";
import {
    generateMarketplaceBotId,
    upsertBot,
    findBotsWithMagic,
    notifyBotEvent,
    type UserBot,
} from "@/lib/bots";

export const runtime = "nodejs";

/**
 * Connects a purchased Marketplace bot to this user's monitoring setup.
 * The bot record is keyed deterministically (user + product) so re-running
 * connect never duplicates it; the mapping (MT5 account + magic) is applied
 * or updated with an overlap warning — never silently overwritten.
 */
export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json().catch(() => ({})) as Record<string, unknown>;

        const productId = String(body.productId || "").trim();
        const licenseId = String(body.licenseId || "").trim();
        const mt5Account = String(body.mt5Account || "").trim();
        const magicNumber = String(body.magicNumber ?? "").trim();
        const symbol = String(body.symbol || "").trim().toUpperCase() || null;

        if (!productId) {
            return NextResponse.json({ success: false, error: "Product ID is required." }, { status: 400 });
        }

        const productSnap = await adminDatabase.ref(`bots/${productId}`).get();
        const product = productSnap.val() as (Record<string, unknown> & { name?: string; status?: string; platform?: string; symbol?: string; timeframe?: string }) | null;
        if (!product || product.status !== "published") {
            return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
        }

        // Verify the user actually holds an active license for this product.
        let activeLicenseId: string | null = null;
        const now = Date.now();
        const licensesSnap = await adminDatabase.ref(`licenses/${token.uid}`).get();
        const licenses = licensesSnap.val() || {};
        for (const [id, raw] of Object.entries(licenses)) {
            if (!raw || typeof raw !== "object") continue;
            const lic = raw as Record<string, unknown>;
            if (
                String(lic.productId || "") === productId &&
                lic.status === "active" &&
                Number(lic.expiresAt || 0) > now
            ) {
                activeLicenseId = lic?.licenseId ? String(lic.licenseId) : id;
                if (licenseId && String(licenseId) === id) {
                    activeLicenseId = id;
                    break;
                }
            }
        }
        if (!activeLicenseId) {
            return NextResponse.json(
                { success: false, error: "You don't have an active license for this product." },
                { status: 403 }
            );
        }

        if (mt5Account && magicNumber) {
            const overlaps = await findBotsWithMagic(token.uid, mt5Account, magicNumber);
            const otherProduct = overlaps.filter((b) => b.productId !== productId);
            if (otherProduct.length > 0) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `WARNING: Magic number ${magicNumber} is already assigned to another bot (${otherProduct[0].name}) on this MT5 account.`,
                        conflicts: otherProduct.map((b) => ({ botId: b.id, name: b.name, mt5Account: b.mt5Account })),
                    },
                    { status: 409 }
                );
            }
            // Same product re-connect: allow update.
        }

        const botId = generateMarketplaceBotId(token.uid, productId);

        const existing = await adminDatabase.ref(`user_bots/${botId}`).get();
        const existingBot = (existing.val() as UserBot | null);

        const bot: Omit<UserBot, "createdAt" | "updatedAt"> & { id: string } = {
            id: botId,
            ownerId: token.uid,
            type: "marketplace",
            name: String(product.name || productId),
            platform: String(product.platform || "MT5"),
            symbol: symbol || String(product.symbol || "") || null,
            timeframe: String(product.timeframe || "") || null,
            magicNumber: magicNumber || null,
            commentFilter: existingBot?.commentFilter || null,
            productId,
            licenseId: activeLicenseId,
            mt5Account: mt5Account || existingBot?.mt5Account || null,
            gatewayInstallationId: existingBot?.gatewayInstallationId || null,
            mapping: {
                mt5Account: mt5Account || existingBot?.mt5Account || null,
                magicNumber: magicNumber || existingBot?.magicNumber || null,
                symbol: symbol || existingBot?.symbol || product.symbol || null,
                comment: existingBot?.commentFilter || null,
                updatedAt: Date.now(),
            },
            status: existingBot?.status || "active",
            online: existingBot?.online ?? false,
            lastHeartbeatAt: existingBot?.lastHeartbeatAt ?? null,
            description: existingBot?.description,
        };

        const savedBot = await upsertBot(bot);

        void notifyBotEvent(savedBot, {
            title: existingBot ? "Bot Mapping Updated" : "Bot Connected",
            message: `Marketplace bot mapped to account ${mt5Account || "not set"}.`,
            level: "success",
        });

        return NextResponse.json({ success: true, botId, bot: savedBot });
    } catch (error) {
        console.error("[bots/connect POST]", error);
        return NextResponse.json({ success: false, error: "Unable to connect bot." }, { status: 500 });
    }
}