import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser, type NotifyAudit, type NotifyChannel } from "@/lib/notifications";
import { PineAlertEngine } from "@/lib/pine-runtime/alert-engine";
import { executePine } from "@/lib/pine-runtime/runtime";
import { getCandlesForTimeframe } from "@/lib/strategy-lab/market-data";
import { SUPPORTED_SYMBOLS, type SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { toPineCandles } from "@/lib/pine-runtime/backtest";
import type { AlertCondition } from "@/lib/pine-runtime/types";

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const view = request.nextUrl.searchParams.get("view") || "history";

    // ── View: definitions (pine alert rules) ──
    if (view === "definitions") {
      const snapshot = await adminDatabase.ref(`pineAlertDefinitions/${user.uid}`).get();
      if (!snapshot.exists()) return NextResponse.json({ success: true, definitions: [], stats: { total: 0, active: 0, expired: 0 } });

      const now = Date.now();
      const data = snapshot.val();
      const definitions: Array<{ id: string; [key: string]: unknown }> = Object.entries(data).map(([id, val]) => ({ id, ...(val as Record<string, unknown>) }));

      const total = definitions.length;
      const active = definitions.filter(d => {
        const expiredAt = d.expiredAt as number | undefined;
        return d.isActive !== false && (!expiredAt || expiredAt > now);
      }).length;
      const expired = definitions.filter(d => {
        const expiredAt = d.expiredAt as number | undefined;
        return d.isActive === false || (expiredAt && expiredAt <= now);
      }).length;

      definitions.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      return NextResponse.json({
        success: true,
        definitions,
        stats: { total, active, expired },
      });
    }

    // ── View: history (default) ──
    const period = request.nextUrl.searchParams.get("period") || "all";
    const snapshot = await adminDatabase.ref(`pineAlertHistory/${user.uid}`).get();

    if (!snapshot.exists()) return NextResponse.json({ success: true, events: [], stats: { total: 0, realtime: 0, replay: 0, simulated: 0 } });

    const data = snapshot.val();
    let events = Object.entries(data).map(([id, val]) => ({ id, ...(val as Record<string, unknown>) }));

    // Filter by period
    const now = Date.now();
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      events = events.filter(e => (e as unknown as { timestamp: number }).timestamp >= startOfDay.getTime());
    } else if (period === "week") {
      events = events.filter(e => (e as unknown as { timestamp: number }).timestamp >= now - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "month") {
      events = events.filter(e => (e as unknown as { timestamp: number }).timestamp >= now - 30 * 24 * 60 * 60 * 1000);
    }

    events.sort((a, b) => (b as unknown as { timestamp: number }).timestamp - (a as unknown as { timestamp: number }).timestamp);

    const total = events.length;
    const realtime = events.filter(e => (e as unknown as { executionStatus: string }).executionStatus === "live").length;
    const replay = events.filter(e => (e as unknown as { executionStatus: string }).executionStatus === "replay").length;
    const simulated = events.filter(e => (e as unknown as { executionStatus: string }).executionStatus === "simulated").length;

    return NextResponse.json({
      success: true,
      events,
      stats: { total, realtime, replay, simulated },
    });
  } catch (err) {
    console.error("Pine alert history error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const {
        alertId, alertName, scriptName, scriptId, symbol, timeframe, signal, price, message,
        direction, signalStrength, isRealtime, executionStatus,
        alertConditions, source,
        frequency, expiration,
        notifyInApp, notifyWebhook, webhookUrl,
        notifyDiscord, notifyTelegram, notifyEmail, playSound, soundName,
    } = body;

    const alertDef = alertId
        ? await getAlertDefinition(user.uid, alertId)
        : null;

    let conditions: AlertCondition[] = [];
    const resolvedSymbol = symbol || alertDef?.symbol || "FX:EURUSD";
    const resolvedTimeframe = timeframe || alertDef?.timeframe || "1H";
    let eventMessage = message || "";
    let eventSignal = signal || "";
    const eventDirection = direction || alertDef?.direction || "neutral";
    const eventStrength = signalStrength || alertDef?.signalStrength || "moderate";
    const eventStatus = executionStatus || "simulated";
    const eventRealtime = isRealtime || false;
    let eventPrice = price || 0;

    if (source) {
        try {
            const normalized = resolvedSymbol.replace(/^(FX:|XAU:|XAG:|INDEX:)/, "").toUpperCase();
            const tf = normalizeTimeframe(resolvedTimeframe);
            const supportedTfs: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
            const normSymbol = normalized as SupportedSymbol;
            if (SUPPORTED_SYMBOLS.includes(normSymbol) && supportedTfs.includes(tf)) {
                const { candles: marketCandles } = await getCandlesForTimeframe(
                    normSymbol, tf
                );
                const pineCandles = toPineCandles(marketCandles);
                const result = executePine(source, pineCandles, resolvedSymbol, tf);

                conditions = result.alerts;
                if (!eventSignal) eventSignal = result.title || scriptName || "Pine Alert";
                if (!eventMessage) eventMessage = result.alerts?.[0]?.message || "";
                if (!eventPrice) eventPrice = marketCandles.length > 0 ? marketCandles[marketCandles.length - 1].close : 0;
            }
        } catch (err) {
            console.error("[pine-alerts:evaluate]", err);
        }
    }

    if (alertConditions && Array.isArray(alertConditions)) {
        conditions = alertConditions.map((ac: { title: string; message: string }) => ({
            id: `${ac.title}-${Date.now()}`,
            title: ac.title,
            message: ac.message || "",
            condition: () => true,
        }));
    }

    const engine = new PineAlertEngine();
    if (alertDef) {
        engine.setAlerts([alertDef]);
    }

    let triggeredEvents = false;
    let deliveryAudit: NotifyAudit | null = null;

    // Channels explicitly chosen on this alert (dialog toggles). When none are
    // chosen we fall back to the user's saved notification preferences.
    const requestedChannels: NotifyChannel[] = [];
    if (notifyDiscord) requestedChannels.push("discord");
    if (notifyTelegram) requestedChannels.push("telegram");
    if (notifyEmail) requestedChannels.push("email");
    const channelOptions = requestedChannels.length > 0 ? { channels: requestedChannels } : undefined;

    if (conditions.length > 0) {
        const lastBar = conditions.length > 0 ? conditions.length - 1 : 0;
        const barIndex = typeof lastBar === "number" ? conditions.length - 1 : 0;

        const events = engine.evaluateAlerts(conditions, barIndex, {
            symbol: resolvedSymbol,
            timeframe: resolvedTimeframe,
            price: eventPrice,
            isRealtime: eventRealtime,
            isReplay: !eventRealtime,
        });

        if (events.length > 0) {
            triggeredEvents = true;
            const evt = events[0];
            deliveryAudit = await notifyUser(user.uid, {
                title: `${evt.scriptName} — ${evt.signal}`,
                message: `${evt.message}\n\n${evt.symbol} @ ${evt.price}\nDirection: ${evt.direction || "neutral"}`,
                level: "info",
            }, channelOptions);
        }
    } else if (source) {
        deliveryAudit = await notifyUser(user.uid, {
            title: eventSignal || scriptName || "Pine Alert",
            message: eventMessage || message || "",
            level: direction === "long" ? "success" : direction === "short" ? "warning" : "info",
        }, channelOptions);
        triggeredEvents = true;
    }

    const destinations: string[] = [];
    let deliveryStatus: "pending" | "delivered" | "failed" = "pending";

    if (deliveryAudit) {
        if (deliveryAudit.status === "no_channel") {
            deliveryStatus = "pending";
            destinations.push("none_configured");
        } else if (deliveryAudit.status === "delivered") {
            deliveryStatus = "delivered";
            destinations.push(...deliveryAudit.channels);
        } else {
            deliveryStatus = "failed";
            destinations.push(...deliveryAudit.results.filter((r) => !r.ok).map((r) => r.channel));
        }
    }

    // Webhook delivery (MT4/MT5 / bot bridge) — TradingView-compatible JSON payload
    let webhookStatus: "not_configured" | "sent" | "failed" = "not_configured";
    if (triggeredEvents && notifyWebhook && webhookUrl) {
        try {
            const core = resolvedSymbol.replace(/^(FX:|XAU:|XAG:|INDEX:)/, "").toUpperCase();
            const webhookPayload = {
                frequency,
                side: eventDirection === "long" ? "buy" : eventDirection === "short" ? "sell" : "close",
                ticker: core,
                exchange: deriveExchangeForWebhook(core),
                interval: normalizeTimeframe(resolvedTimeframe).toLowerCase(),
                price: eventPrice,
                time: Date.now(),
                alertName: alertName || eventSignal,
                signal: eventSignal,
                message: eventMessage,
                scriptName: scriptName || "",
                expiration,
                strategy: {
                    action: eventDirection === "long" ? "buy" : eventDirection === "short" ? "sell" : "close",
                },
            };
            const webhookRes = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(webhookPayload),
                cache: "no-store",
            });
            webhookStatus = webhookRes.ok ? "sent" : "failed";
            if (webhookStatus === "sent") {
                destinations.push("webhook");
                if (deliveryStatus === "pending") deliveryStatus = "delivered";
            }
        } catch (err) {
            console.error("[pine-alerts:webhook]", err);
            webhookStatus = "failed";
        }
    }

    // Persist the armed alert definition so frequency/expiration/notify prefs survive and a
    // future watcher can re-evaluate this alert on live bars.
    if (source || conditions.length > 0) {
        const defRef = adminDatabase.ref(`pineAlertDefinitions/${user.uid}`).push();
        await defRef.set({
            id: defRef.key,
            scriptId: scriptId || "pine_script",
            scriptName: scriptName || eventSignal || "Pine Alert",
            symbol: resolvedSymbol,
            timeframe: resolvedTimeframe,
            alertTitle: eventSignal || "Any alert() function call",
            message: eventMessage,
            frequency: mapAlertFrequency(frequency),
            direction: eventDirection,
            price: eventPrice || undefined,
            signalStrength: eventStrength,
            conditionSource: source || "",
            isActive: true,
            createdAt: Date.now(),
            expiredAt: resolveExpiration(expiration, Date.now()),
            expiration,
            notifyInApp,
            notifyWebhook,
            webhookUrl: notifyWebhook ? webhookUrl || "" : "",
            notifyDiscord,
            notifyTelegram,
            notifyEmail,
            playSound,
            soundName: playSound ? soundName || "" : "",
            lastTriggeredAt: triggeredEvents ? Date.now() : undefined,
        });
    }

    const eventRef = adminDatabase.ref(`pineAlertHistory/${user.uid}`).push();
    const event = {
        alertId: alertId || "",
        alertName: alertName || "",
        scriptId: scriptId || "",
        scriptName: scriptName || "",
        symbol: resolvedSymbol,
        timeframe: resolvedTimeframe,
        signal: eventSignal,
        price: eventPrice,
        timestamp: Date.now(),
        message: eventMessage,
        direction: eventDirection,
        signalStrength: eventStrength,
        isRealtime: eventRealtime,
        deliveryStatus,
        destinations,
        webhookStatus,
        frequency,
        expiration,
        notifyInApp,
        notifyWebhook,
        notifyDiscord,
        notifyTelegram,
        notifyEmail,
        executionStatus: eventStatus,
        conditionsEvaluated: conditions.length,
        triggered: triggeredEvents,
        conditionSource: source || "",
    };

    await eventRef.set(event);

    return NextResponse.json({
        success: true,
        event: { id: eventRef.key, ...event },
        triggered: triggeredEvents,
        delivery: deliveryAudit,
        webhookStatus,
    });
  } catch (err) {
    console.error("Pine alert history POST error:", err);
    return NextResponse.json({ error: "Failed to log alert" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { eventId, definitionId, eventIds, definitionIds, clearAllDefinitions } = body;

    const removes: Promise<unknown>[] = [];

    if (clearAllDefinitions) {
      removes.push(adminDatabase.ref(`pineAlertDefinitions/${user.uid}`).remove());
    } else {
      // Single IDs
      if (eventId) removes.push(adminDatabase.ref(`pineAlertHistory/${user.uid}/${eventId}`).remove());
      if (definitionId) removes.push(adminDatabase.ref(`pineAlertDefinitions/${user.uid}/${definitionId}`).remove());

      // Bulk IDs
      if (Array.isArray(eventIds)) {
        for (const id of eventIds) {
          removes.push(adminDatabase.ref(`pineAlertHistory/${user.uid}/${id}`).remove());
        }
      }
      if (Array.isArray(definitionIds)) {
        for (const id of definitionIds) {
          removes.push(adminDatabase.ref(`pineAlertDefinitions/${user.uid}/${id}`).remove());
        }
      }
    }

    if (removes.length === 0) {
      return NextResponse.json({ error: "eventId, definitionId, or bulk IDs required" }, { status: 400 });
    }

    await Promise.all(removes);

    return NextResponse.json({ success: true, deleted: removes.length });
  } catch (err) {
    console.error("Pine alerts DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete tool alert" }, { status: 500 });
  }
}

function deriveExchangeForWebhook(symbol: string): string {
    const s = symbol.toUpperCase();
    const compact = s.replace(/[^A-Z0-9]/g, "");
    if (compact === "XAUUSD" || compact === "XAGUSD") return "METALS";
    if (compact === "US30" || compact === "NAS100" || compact === "SPX500" || compact.startsWith("INDU")) return "INDEX";
    if (compact === "BTCUSD" || compact === "ETHUSD") return "CRYPTO";
    return "FX";
}

function mapAlertFrequency(raw: string): import("@/lib/pine-runtime/alert-engine").AlertFrequency {
    switch (raw) {
        case "once":
            return "once";
        case "per_bar":
            return "once_per_bar";
        case "per_bar_close":
            return "once_per_bar_close";
        case "every_time":
            return "every_time";
        default:
            return "once_per_bar_close";
    }
}

function resolveExpiration(expiration: string | undefined, from: number): number | undefined {
    switch (expiration) {
        case "1_day":
            return from + 24 * 60 * 60 * 1000;
        case "7_days":
            return from + 7 * 24 * 60 * 60 * 1000;
        case "30_days":
            return from + 30 * 24 * 60 * 60 * 1000;
        default:
            return undefined;
    }
}

async function getAlertDefinition(uid: string, alertId: string) {
    const snap = await adminDatabase.ref(`pineAlertDefinitions/${uid}/${alertId}`).once("value");
    if (!snap.exists()) return null;
    return snap.val() as import("@/lib/pine-runtime/alert-engine").PineAlertDefinition;
}

function normalizeTimeframe(raw: string): Timeframe {
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, "") as Timeframe;
}
