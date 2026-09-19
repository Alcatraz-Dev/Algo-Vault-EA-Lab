import { NextRequest, NextResponse } from "next/server";
import { processIncomingTelegramMessage } from "@/features/telegram-signals/signals/signal-engine";

export async function POST(request: NextRequest) {
    try {
        const secret = process.env.TELEGRAM_INGESTION_SECRET || "default_ingest_secret";
        const authHeader = request.headers.get("Authorization");
        const querySecret = request.nextUrl.searchParams.get("secret");

        const isValidSecret =
            authHeader === `Bearer ${secret}` ||
            querySecret === secret ||
            process.env.NODE_ENV !== "production";

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
    } catch (err: any) {
        console.error("[POST /api/telegram-signals/webhook]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
