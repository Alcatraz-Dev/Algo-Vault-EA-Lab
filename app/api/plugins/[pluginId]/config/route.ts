import { NextRequest, NextResponse } from "next/server";
import { authUid, unauthorized, serverError, badRequest, notFound } from "@/lib/plugins/api-helpers";
import { getPluginConfig, setPluginConfig, getPluginRecord, getInstallation, updateInstallation } from "@/lib/plugins/database";
import { VALID_INTERVALS } from "@/lib/plugins/manifest";
import { PluginConfig, PluginInterval } from "@/lib/plugins/types";
import { writeAuditLog } from "@/lib/plugins/database";

export const VALID_TIMEFRAMES = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];
const VALID_CHANNELS = ["email", "telegram", "discord", "webhook", "in-app"];

function hoursOk(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sanitizeConfig(raw: Record<string, unknown>, fallback: PluginConfig): { config: PluginConfig; errors: string[] } {
    const errors: string[] = [];

    const symbols = Array.isArray(raw.symbols)
        ? raw.symbols.map(String).map((s) => s.trim().toUpperCase()).filter((s) => s).slice(0, 10)
        : fallback.symbols;
    if (symbols.length > 10) errors.push("Up to 10 symbols are supported.");

    const timeframes = Array.isArray(raw.timeframes)
        ? raw.timeframes.map(String).filter((t) => VALID_TIMEFRAMES.includes(t)).slice(0, 4)
        : fallback.timeframes;
    if (timeframes.length === 0) errors.push("Configure at least one timeframe.");

    const interval = String(raw.interval || fallback.interval) as PluginInterval;
    if (!(VALID_INTERVALS as string[]).includes(interval)) {
        errors.push(`Unknown interval: ${interval}`);
    }

    const notificationChannels = Array.isArray(raw.notificationChannels)
        ? raw.notificationChannels.map(String).filter((c) => VALID_CHANNELS.includes(c)).slice(0, 5)
        : fallback.notificationChannels;

    const quietHoursStart = typeof raw.quietHoursStart === "string" && raw.quietHoursStart.trim() ? raw.quietHoursStart.trim() : fallback.quietHoursStart;
    const quietHoursEnd = typeof raw.quietHoursEnd === "string" && raw.quietHoursEnd.trim() ? raw.quietHoursEnd.trim() : fallback.quietHoursEnd;
    if (quietHoursStart && !hoursOk(quietHoursStart)) errors.push("quietHoursStart must be HH:MM (24h).");
    if (quietHoursEnd && !hoursOk(quietHoursEnd)) errors.push("quietHoursEnd must be HH:MM (24h).");

    const cooldownMin = Math.max(1, Math.min(1440, Number(raw.cooldownMin ?? fallback.cooldownMin) || 5));
    const maxAlertsPerDay = Math.max(1, Math.min(200, Number(raw.maxAlertsPerDay ?? fallback.maxAlertsPerDay) || 10));
    const severity = String(raw.severity || fallback.severity || "medium");
    if (!["low", "medium", "high"].includes(severity)) errors.push("severity must be low, medium or high.");

    const settings: Record<string, unknown> =
        raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
            ? (raw.settings as Record<string, unknown>)
            : fallback.settings;

    let riskLimits: Record<string, number | boolean> = fallback.riskLimits || {};
    if (raw.riskLimits && typeof raw.riskLimits === "object" && !Array.isArray(raw.riskLimits)) {
        riskLimits = {};
        for (const [key, value] of Object.entries(raw.riskLimits as Record<string, unknown>)) {
            const n = Number(value);
            if (typeof value === "boolean") riskLimits[key] = value;
            else if (Number.isFinite(n)) riskLimits[key] = n;
        }
    }

    return {
        config: {
            pluginId: fallback.pluginId,
            userId: fallback.userId,
            symbols,
            timeframes,
            interval,
            notificationChannels,
            quietHoursStart,
            quietHoursEnd,
            cooldownMin,
            maxAlertsPerDay,
            severity: severity as "low" | "medium" | "high",
            settings,
            riskLimits,
            paused: Boolean(raw.paused ?? fallback.paused),
            updatedAt: Date.now(),
        },
        errors,
    };
}

export async function GET(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { pluginId } = await context.params;
        const config = await getPluginConfig(uid, pluginId);
        return NextResponse.json({ success: true, config });
    } catch (err) {
        return serverError(err);
    }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ pluginId: string }> }) {
    try {
        const uid = await authUid(request);
        if (!uid) return unauthorized();
        const { pluginId } = await context.params;

        const plugin = await getPluginRecord(pluginId);
        if (!plugin) return notFound("Plugin not found.");
        const existing = await getPluginConfig(uid, pluginId);
        if (!existing) return notFound("Install the plugin before configuring it.");

        const body = await request.json().catch(() => ({}));
        const { config, errors } = sanitizeConfig(body, existing);
        if (errors.length > 0) return badRequest(errors.join(" "));

        await setPluginConfig(uid, config);

        const install = await getInstallation(uid, pluginId);
        if (install && install.status === "installed") {
            await updateInstallation(uid, pluginId, { status: "configured", lastActivityAt: Date.now(), notificationsEnabled: config.notificationChannels.length > 0 });
        }

        await writeAuditLog({ action: "plugin.config.updated", actor: uid, pluginId, detail: { interval: config.interval, symbols: config.symbols.length } });

        return NextResponse.json({ success: true, config });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";