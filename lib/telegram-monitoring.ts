export async function ensureTelegramMonitoring(): Promise<{ success: boolean; error?: string }> {
    if (
        process.env.TELEGRAM_MONITORING_AUTOSTART === "false" ||
        (process.env.TELEGRAM_MONITORING_AUTOSTART === undefined && process.env.VERCEL === "1")
    ) {
        return { success: true };
    }

    if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
        return {
            success: false,
            error: "Telegram monitoring requires TELEGRAM_API_ID and TELEGRAM_API_HASH",
        };
    }

    try {
        const { telegramUserClientManager } = await import(
            "@/features/telegram-signals/connectors/telegram-client-manager"
        );
        return await telegramUserClientManager.startMonitoring();
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error("[ensureTelegramMonitoring]", error);
        return { success: false, error };
    }
}
