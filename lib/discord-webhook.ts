/**
 * Server-side Discord webhook resolution.
 *
 * Lives in its own module so it can be imported from code that also runs in
 * the browser (e.g. channel status adapters rendered in client components)
 * without dragging in firebase-admin, which relies on Node.js built-ins
 * unavailable in the browser.
 */

export function getServerDiscordWebhookUrl() {
    return String(process.env.DISCORD_WEBHOOK_URL || process.env.DISCROD_WEBHOOK_URL || "").trim();
}
