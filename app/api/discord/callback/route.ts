import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    consumeOAuthState,
    exchangeDiscordCode,
    getDiscordUser,
    getDiscordConfig,
} from "@/lib/discord-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const settingsUrl = `${appUrl}/account/settings?tab=notifications&discord=select-channel`;

    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get("code");
        const state = searchParams.get("state");
        const error = searchParams.get("error");

        if (error) {
            return NextResponse.redirect(`${settingsUrl}&discord_error=${encodeURIComponent(error)}`);
        }

        if (!code || !state) {
            return NextResponse.redirect(`${settingsUrl}&discord_error=missing_code`);
        }

        const uid = await consumeOAuthState(state);
        if (!uid) {
            return NextResponse.redirect(`${settingsUrl}&discord_error=invalid_state`);
        }

        if (!getDiscordConfig()) {
            return NextResponse.redirect(`${settingsUrl}&discord_error=not_configured`);
        }

        const tokens = await exchangeDiscordCode(code);
        const profile = await getDiscordUser(tokens.access_token);

        await adminDatabase.ref(`users/${uid}`).update({
            discordUserId: profile.id,
            discordUsername: profile.global_name || profile.username,
            discordConnectedAt: Date.now(),
            updatedAt: Date.now(),
        });

        await adminDatabase.ref(`discord_connect/${uid}`).set({
            accessToken: tokens.access_token,
            discordUserId: profile.id,
            discordUsername: profile.global_name || profile.username,
            expiresAt: Date.now() + 55 * 60 * 1000,
        });

        return NextResponse.redirect(settingsUrl);
    } catch (err) {
        const message = err instanceof Error ? err.message : "callback_failed";
        return NextResponse.redirect(`${settingsUrl}&discord_error=${encodeURIComponent(message)}`);
    }
}
