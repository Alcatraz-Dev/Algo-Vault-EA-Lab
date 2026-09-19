import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getServerDiscordWebhookUrl, notifyUser } from "@/lib/notifications";
import { isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    return NextResponse.json({
        discordServerConfigured: Boolean(getServerDiscordWebhookUrl()),
        telegramBotConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        emailConfigured: isEmailConfigured(),
    });
}

export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const audit = await notifyUser(token.uid, {
            title: "Alert channel connected",
            message:
                "This is a test notification — your Discord / Telegram / Email alerts are working. You will now receive trade and copy-signal updates here.",
            level: "success",
            link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/account`,
        });

        if (audit.status === "no_channel") {
            return NextResponse.json(
                {
                    success: false,
                    status: audit.status,
                    channels: audit.channels,
                    results: audit.results,
                    error: "No notification channel is configured.",
                },
                { status: 409 }
            );
        }

        if (audit.status === "failed") {
            return NextResponse.json(
                {
                    success: false,
                    status: audit.status,
                    channels: audit.channels,
                    results: audit.results,
                    error: "Test notification could not be delivered.",
                },
                { status: 502 }
            );
        }

        return NextResponse.json({
            success: true,
            status: audit.status,
            channels: audit.channels,
            results: audit.results,
        });
    } catch (error) {
        console.error("TEST NOTIFY ERROR:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to send test notification." },
            { status: 500 }
        );
    }
}
