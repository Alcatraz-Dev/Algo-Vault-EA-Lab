import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";
import { getBot, findBotsWithMagic, notifyBotEvent, type UserBot } from "@/lib/bots";

export const runtime = "nodejs";

/**
 * Manual mapping: "Map MT5 activity to this bot".
 *
 * Picks the MT5 account, magic number, symbol and optional comment used by the
 * EA. If the chosen magic is already mapped to ANOTHER bot on the account, the
 * request is rejected with an overlap warning (409) rather than silently
 * overwriting the existing assignment.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ botId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const { botId } = await params;
        if (!botId) {
            return NextResponse.json({ success: false, error: "Bot ID is required." }, { status: 400 });
        }

        const bot = await getBot(token.uid, botId);
        if (!bot) {
            return NextResponse.json({ success: false, error: "Bot not found." }, { status: 404 });
        }

        const body = await request.json().catch(() => ({})) as Record<string, unknown>;

        const mt5Account = String(body.mt5Account || "").trim();
        const magicNumber = String(body.magicNumber ?? "").trim();
        const symbol = String(body.symbol || "").trim().toUpperCase() || null;
        const comment = String(body.comment || "").trim();

        if (mt5Account && !/^\d+$/.test(mt5Account)) {
            return NextResponse.json({ success: false, error: "MT5 account must be numeric." }, { status: 400 });
        }
        if (magicNumber && !/^\d+$/.test(magicNumber)) {
            return NextResponse.json({ success: false, error: "Magic number must be numeric." }, { status: 400 });
        }
        if (!mt5Account) {
            return NextResponse.json({ success: false, error: "MT5 account is required." }, { status: 400 });
        }

        if (magicNumber) {
            const overlaps = await findBotsWithMagic(token.uid, mt5Account, magicNumber);
            const conflicting = overlaps.find((b) => b.id !== botId);
            if (conflicting) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `WARNING: Magic number ${magicNumber} is already assigned to another bot (${conflicting.name}) on this MT5 account.`,
                        conflicts: overlaps.map((b) => ({ botId: b.id, name: b.name, mt5Account: b.mt5Account })),
                    },
                    { status: 409 }
                );
            }
            // No conflict, or re-mapping this exact bot — allowed.
        }

        const now = Date.now();

        const updated: Partial<UserBot> = {
            mt5Account,
            magicNumber: magicNumber || null,
            symbol,
            commentFilter: comment || null,
            mapping: {
                mt5Account,
                magicNumber: magicNumber || null,
                symbol,
                comment: comment || null,
                updatedAt: now,
            },
            updatedAt: now,
        };

        await adminDatabase.ref(`user_bots/${botId}`).update(updated);

        void notifyBotEvent(bot, {
            title: "Bot Mapping Updated",
            message: `Mapped to account ${mt5Account}${magicNumber ? ` · magic ${magicNumber}` : ""}.`,
            level: "info",
        });

        return NextResponse.json({ success: true, botId, mapping: updated.mapping });
    } catch (error) {
        console.error("[bots/[botId]/mapping POST]", error);
        return NextResponse.json({ success: false, error: "Unable to update mapping." }, { status: 500 });
    }
}