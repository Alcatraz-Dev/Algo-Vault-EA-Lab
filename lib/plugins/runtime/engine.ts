import { adminDatabase } from "@/lib/firebase-admin";
import {
    PluginConfig,
    PluginExecutionRecord,
    PluginExecutionResult,
    PluginRecord,
    PluginRuntimeState,
} from "../types";
import { getPluginConfig, getRuntimeState, recordExecution, setRuntimeState, updateInstallation, writePluginLog, getPluginLicense } from "../database";
import { loadMarketSnapshot, resolveTimeframe, clampSymbols, RuntimeMarketSnapshot } from "./market";
import { loadHistoryContext, HistoryContext } from "./history";
import { runAnalyzer, hasAnalyzer } from "./analyzers";
import { evaluateConditionTree, ConditionContext } from "./conditions";
import { deliverPluginAlert } from "./notification-hub";
import { emitEvent } from "./event-bus";
import { computeNextRunAt, isDue, fetchEconomicEvents, NewsFetchResult } from "./scheduler";
import { hasPermission } from "../permissions";
import { listUserBots } from "@/lib/bots";

/**
 * Plugin Runtime Engine.
 *
 *  Plugin → Runtime → Permission Layer → AlgoVault APIs (data / AI / notifs)
 *
 * The engine is the ONLY place that executes plugin logic. It enforces
 * installation status, permissions, licensing and timeouts before any
 * data access or notification happens. Generated plugins run declarative
 * conditions — never arbitrary code.
 */

export type EngineInput = {
    userId: string;
    plugin: PluginRecord;
    trigger: PluginExecutionRecord["trigger"];
    config?: PluginConfig | null;
    /** test mode bypasses alert delivery and licensing (admin sandbox). */
    testOnly?: boolean;
    maxRunMs?: number;
};

export type EngineResult = {
    execution: PluginExecutionRecord;
    runtimeState: PluginRuntimeState | null;
    alertDeliveries: { title: string; delivered: boolean; reason?: string }[];
};

export function defaultConfig(plugin: PluginRecord, userId: string): PluginConfig {
    const manifestInterval = plugin.manifest?.runtime?.interval;
    return {
        pluginId: plugin.id,
        userId,
        symbols: [],
        timeframes: ["M5"],
        interval: (manifestInterval === "manual" ? "5m" : manifestInterval) || "5m",
        notificationChannels: ["email"],
        cooldownMin: 5,
        maxAlertsPerDay: 10,
        severity: "medium",
        settings: {},
        paused: false,
        updatedAt: Date.now(),
    };
}

export function emptyHistoryContext(): HistoryContext {
    return { trades: [], positions: [], botCount: 0, symbols: [] };
}

async function licenseIsValid(userId: string, plugin: PluginRecord): Promise<{ valid: boolean; reason?: string }> {
    if (plugin.pricing.type === "free") return { valid: true };
    const license = await getPluginLicense(userId, plugin.id);
    if (!license) return { valid: false, reason: "Missing license — purchase required." };
    if (license.status !== "active") return { valid: false, reason: `License status is ${license.status}.` };
    if (license.expiresAt > 0 && Date.now() >= license.expiresAt) return { valid: false, reason: "License has expired." };
    return { valid: true };
}

type RiskBundle = {
    drawdownPercent: number;
    exposureRatio: number;
    positionCount: number;
    correlatedExposure: number;
    symbols: string[];
    currencyExposure: Record<string, number>;
};

async function loadRiskContext(userId: string, positions: HistoryContext["positions"]): Promise<RiskBundle> {
    const active = positions || [];
    const totalExposure = active.reduce((s, p) => s + p.volume, 0);

    const symbolExposure: Record<string, number> = {};
    for (const p of active) {
        symbolExposure[p.symbol] = (symbolExposure[p.symbol] || 0) + p.volume;
    }
    const exposureRatio = totalExposure > 0 ? Math.max(0, ...Object.values(symbolExposure)) / totalExposure : 0;

    const clusters = new Map<string, string[]>();
    for (const p of active) {
        const key = p.symbol.includes("USD") ? "USD" : p.symbol.slice(0, 3);
        const list = clusters.get(key) || [];
        list.push(p.symbol);
        clusters.set(key, list);
    }
    const correlatedExposure = Math.max(0, ...Array.from(clusters.values()).map((l) => l.length));

    // Drawdown estimate from realized bot-trade P/L curves.
    let drawdown = 0;
    try {
        const bots = await listUserBots(userId);
        for (const bot of bots) {
            const snap = await adminDatabase.ref(`bot_trades/${bot.id}`).get();
            const data = (snap.val() || {}) as Record<string, unknown>;
            let peak = 0;
            let cum = 0;
            for (const raw of Object.values(data)) {
                if (!raw || typeof raw !== "object") continue;
                cum += Number((raw as { net?: number }).net || 0);
                if (cum > peak) peak = cum;
                const dd = peak - cum;
                if (dd > drawdown) drawdown = dd;
            }
        }
    } catch {
        // drawdown stays 0 when trade data is unavailable
    }

    return {
        drawdownPercent: drawdown,
        exposureRatio,
        positionCount: active.length,
        correlatedExposure,
        symbols: Object.keys(symbolExposure),
        currencyExposure: symbolExposure,
    };
}

export async function executePlugin(input: EngineInput): Promise<EngineResult> {
    const { userId, plugin, trigger, testOnly } = input;
    const startedAt = Date.now();
    const maxRunMs = input.maxRunMs || plugin.manifest?.runtime?.timeoutMs || 15000;
    const execId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const config = input.config || (await getPluginConfig(userId, plugin.id)) || defaultConfig(plugin, userId);

    let state = await getRuntimeState(userId, plugin.id);

    if (!testOnly) {
        const license = await licenseIsValid(userId, plugin);
        if (!license.valid) {
            const execution: PluginExecutionRecord = {
                id: execId,
                pluginId: plugin.id,
                userId,
                trigger,
                status: "failed",
                startedAt,
                finishedAt: Date.now(),
                durationMs: 0,
                symbols: [],
                error: license.reason || "License invalid.",
            };
            await recordExecution(userId, execution);
            await writePluginLog(userId, plugin.id, { level: "error", message: license.reason || "License invalid." });
            await emitEvent({ userId, sourcePlugin: plugin.id, type: "license.expired", payload: { pluginId: plugin.id }, allowedTypes: ["license.expired"] });
            if (state) {
                state = { ...state, status: "paused", updatedAt: Date.now() };
                await setRuntimeState(state);
                await updateInstallation(userId, plugin.id, { status: "disabled", licenseStatus: "expired" });
            }
            return { execution, runtimeState: state, alertDeliveries: [] };
        }
    }

    const result = await runWithTimeout(() => runPluginLogic(userId, plugin, config), maxRunMs);

    const finishedAt = Date.now();
    const execution: PluginExecutionRecord = {
        id: execId,
        pluginId: plugin.id,
        userId,
        trigger,
        status: result.status,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        symbols: config.symbols || [],
        summary: result.summary,
        findings: result.findings || [],
        alerts: result.alerts || [],
        events: result.events || [],
        error: result.error,
    };

    await recordExecution(userId, execution);
    await writePluginLog(userId, plugin.id, {
        level: result.status === "success" ? "info" : "error",
        message: result.summary || result.error || "Execution completed.",
        meta: { trigger, durationMs: finishedAt - startedAt },
    });

    // Update runtime scheduling state.
    if (!testOnly) {
        const interval = config.interval;
        const nextRunAt = computeNextRunAt(interval, finishedAt, state ? { lastRunAt: state.lastRunAt } : undefined);
        state = {
            userId,
            pluginId: plugin.id,
            status: "scheduled",
            nextRunAt,
            lastRunAt: finishedAt,
            lastExecutionId: execId,
            failures: result.status === "failed" ? (state?.failures || 0) + 1 : 0,
            alertedToday: state?.alertedToday || 0,
            lastAlertAt: state?.lastAlertAt || null,
            updatedAt: Date.now(),
        };
        await setRuntimeState(state);
        await updateInstallation(userId, plugin.id, {
            lastExecutionAt: finishedAt,
            lastActivityAt: finishedAt,
            nextRunAt,
        });
    }

    // Deliver alerts through the notification hub (unless sandbox test).
    const alertDeliveries: EngineResult["alertDeliveries"] = [];
    if (result.alerts && result.alerts.length > 0 && !testOnly) {
        for (const alert of result.alerts) {
            const delivery = await deliverPluginAlert({
                userId,
                pluginId: plugin.id,
                pluginName: plugin.displayName,
                alert,
                config,
                link: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/account/plugins/${plugin.id}`,
            });
            alertDeliveries.push({ title: alert.title, delivered: delivery.delivered, reason: delivery.decision.reason });
            if (delivery.delivered && state) {
                state = { ...state, alertedToday: state.alertedToday + 1, lastAlertAt: Date.now(), updatedAt: Date.now() };
                await setRuntimeState(state);
            }
        }
    }

    // Emit bus events the plugin is allowed to emit.
    if (result.events) {
        for (const type of result.events) {
            await emitEvent({
                userId,
                sourcePlugin: plugin.id,
                type,
                payload: { pluginId: plugin.id, summary: result.summary || "", symbol: config.symbols?.[0] || "" },
                allowedTypes: plugin.manifest?.emits || [],
            });
        }
    }
    await emitEvent({
        userId,
        sourcePlugin: plugin.id,
        type: result.status === "success" ? "plugin.execution.completed" : "plugin.execution.failed",
        payload: { pluginId: plugin.id, error: result.error || "" },
        allowedTypes: plugin.manifest?.emits || [],
    });

    return { execution, runtimeState: state, alertDeliveries };
}

async function runWithTimeout(fn: () => Promise<PluginExecutionResult>, timeoutMs: number): Promise<PluginExecutionResult> {
    const timer = new Promise<PluginExecutionResult>((resolve) => {
        setTimeout(() => resolve({ status: "failed", error: `Plugin execution timed out after ${timeoutMs}ms.` }), timeoutMs);
    });
    return Promise.race([fn(), timer]);
}

async function runPluginLogic(userId: string, plugin: PluginRecord, config: PluginConfig): Promise<PluginExecutionResult> {
    const symbols = clampSymbols(config.symbols || [], 10);
    const timeframe = resolveTimeframe(config.timeframes?.[0]);

    // Build context based on permissions.
    const market: Record<string, RuntimeMarketSnapshot> = {};
    const marketErrors: string[] = [];

    if (hasPermission(plugin.permissions ?? {}, "market_data") && symbols.length > 0) {
        const results = await Promise.all(
            symbols.map(async (symbol) => {
                const { snapshot, error } = await loadMarketSnapshot(symbol, timeframe);
                return { symbol, snapshot, error };
            })
        );
        for (const r of results) {
            if (r.snapshot) market[r.symbol] = r.snapshot;
            else if (r.error) marketErrors.push(`${r.symbol}: ${r.error}`);
        }
    }

    const history =
        hasPermission(plugin.permissions ?? {}, "trading_history") || hasPermission(plugin.permissions ?? {}, "portfolio_data")
            ? await loadHistoryContext(userId)
            : emptyHistoryContext();

    let news: NewsFetchResult = { incoming: [] };
    if (hasPermission(plugin.permissions ?? {}, "news_data")) {
        news = await fetchEconomicEvents();
    }

    const risk = await loadRiskContext(userId, history.positions);

    // Handler-based analyzers (built-ins).
    if (hasAnalyzer(plugin.manifest?.runtime?.handler)) {
        return runAnalyzer(plugin.manifest?.runtime?.handler, {
            userId,
            pluginId: plugin.id,
            config,
            market,
            history,
            news: { incoming: news.incoming, relevant: news.incoming },
            risk,
            now: Date.now(),
        });
    }

    // Declarative condition (AI-generated or admin-defined).
    const condition = plugin.manifest?.runtime?.condition;
    if (condition) {
        const ctx: ConditionContext = {
            market,
            risk: {
                drawdownPercent: risk.drawdownPercent,
                exposure: risk.exposureRatio,
                positionCount: risk.positionCount,
                correlatedExposure: risk.correlatedExposure,
            },
            news: { incomingEvents: news.incoming.length, recentImpact: news.incoming.filter((e) => e.impact === "High").length },
        };
        const { matched, reasons } = evaluateConditionTree(condition, ctx);
        if (matched) {
            return {
                status: "success",
                summary: `Condition matched on ${symbols.join(", ") || "configured symbols"}. ${reasons.join("; ")}`,
                findings: reasons.map((r) => ({ title: "Condition matched", detail: r })),
                alerts: [
                    {
                        severity: config.severity || "medium",
                        title: `${plugin.displayName}: condition detected`,
                        message: `Detected: ${reasons.join("; ")}. Analysis only — not trading advice.`,
                        symbol: symbols[0] || "",
                        eventType: "market.condition.detected",
                    },
                ],
                events: ["market.condition.detected"],
            };
        }
        return {
            status: "success",
            summary: `Condition not matched on this run${marketErrors.length > 0 ? ` (market note: ${marketErrors.join(" · ")})` : ""}.`,
        };
    }

    return {
        status: "failed",
        error: "Plugin has no analyzer implementation and no declarative condition. It cannot execute.",
    };
}

/** Drives the scheduler: executes every due plugin across all users. */
export async function runDueTasks(now = Date.now(), maxRuns = 30): Promise<{ ran: number; errors: number; skipped: number }> {
    const snap = await adminDatabase.ref("pluginRuntimeState").get();
    const data = (snap.val() || {}) as Record<string, Record<string, { status?: string; nextRunAt?: number | null }>>;

    const due: { userId: string; pluginId: string }[] = [];
    for (const [userId, pluginMap] of Object.entries(data)) {
        if (!pluginMap || typeof pluginMap !== "object") continue;
        for (const [pluginId, raw] of Object.entries(pluginMap)) {
            if (!raw || typeof raw !== "object") continue;
            const state = raw as { status?: string; nextRunAt?: number | null };
            if (isDue({ status: state.status || "", nextRunAt: state.nextRunAt ?? null }, now)) {
                due.push({ userId, pluginId });
            }
        }
    }

    let ran = 0;
    let errors = 0;
    for (const task of due.slice(0, maxRuns)) {
        const pluginSnap = await adminDatabase.ref(`plugins/${task.pluginId}`).get();
        const plugin = pluginSnap.val() as PluginRecord | null;
        if (!plugin || plugin.status !== "published") {
            await setRuntimeState({
                userId: task.userId,
                pluginId: task.pluginId,
                status: "paused",
                nextRunAt: null,
                lastRunAt: Date.now(),
                lastExecutionId: null,
                failures: 0,
                alertedToday: 0,
                lastAlertAt: null,
                updatedAt: Date.now(),
            });
            continue;
        }
        try {
            await executePlugin({ userId: task.userId, plugin: plugin, trigger: "schedule" });
            ran += 1;
        } catch (err) {
            errors += 1;
            await writePluginLog(task.userId, task.pluginId, { level: "error", message: err instanceof Error ? err.message : "Scheduled execution failed." });
        }
    }
    return { ran, errors, skipped: due.length - ran - errors };
}