import { NextRequest, NextResponse } from "next/server";
import { processIncomingTelegramMessage } from "@/features/telegram-signals/signals/signal-engine";

export async function POST(request: NextRequest) {
    try {
        // Fail-closed ingestion auth: the webhook only runs when
        // TELEGRAM_INGESTION_SECRET is configured and the caller presents it
        // (Authorization: Bearer <secret> or ?secret=). There is deliberately no
        // hardcoded default. Local development can opt into unauthenticated
        // ingestion with TELEGRAM_INGESTION_ALLOW_DEV=1.
        const secret = process.env.TELEGRAM_INGESTION_SECRET;
        const authHeader = request.headers.get("Authorization");
        const querySecret = request.nextUrl.searchParams.get("secret");
        const allowDevBypass = process.env.TELEGRAM_INGESTION_ALLOW_DEV === "1";

        const isValidSecret =
            (Boolean(secret) && (authHeader === `Bearer ${secret}` || querySecret === secret)) ||
            allowDevBypass;

        if (!isValidSecret) {
            return NextResponse.json({ error: "Unauthorized ingestion secret" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const { userId, rawText, channelId, channelName, messageId, replyToMessageId } = body;

        if (!userId || !rawText) {
            return NextResponse.json(
                { error: "userId and rawText are required" },
                { status: 400 }
            );
        }

        const result = await processIncomingTelegramMessage({
            userId,
            rawText,
            sourceMetadata: {
                sourceId: channelId ? String(channelId) : "telegram_channel_1",
                sourceType: "telegram_channel",
                channelName: channelName || "Telegram Signal Channel",
                channelId: channelId ? String(channelId) : undefined,
                messageId: messageId ? String(messageId) : undefined,
                replyToMessageId: replyToMessageId ? String(replyToMessageId) : undefined,
            },
        });

        return NextResponse.json(result);
    } catch (err) {
        console.error("[POST /api/telegram-signals/webhook]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
