import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal, SignalStatus, SignalEvent } from "@/lib/ai-signals/types";
import type { ProSignal } from "@/features/telegram-signals/types";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { calculateSignalResult } from "@/lib/ai-signals/results";
import { recordSignalEvent } from "@/lib/ai-signals/events";

const MAX_SIGNALS_TO_CHECK = 200;

/**
 * Signal auto-update sweep — invoked by a cron/worker (vercel.json, every 5 min).
 *
 * Auth: requires `x-cron-secret` to match CRON_SECRET (same convention as
 * /api/ai-signals/monitor, /api/alerts/check, /api/trade-management/monitor), OR
 * the request must come from Vercel's cron runner (user-agent "vercel-cron").
 * If CRON_SECRET is unset the endpoint refuses to run instead of running
 * unauthenticated.
 */
export async function POST(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const headerSecret = request.headers.get("x-cron-secret") || "";
    const querySecret = new URL(request.url).searchParams.get("secret") || "";
    const isVercelCron = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron");

    const authorized = isVercelCron || Boolean(secret && (headerSecret === secret || querySecret === secret));
    if (!authorized) {
        return NextResponse.json(
            { error: "Unauthorized. Set CRON_SECRET and send it as x-cron-secret." },
            { status: 401 }
        );
    }

    try {
        const body = await request.json().catch(() => ({}));
        const { signalIds, checkAllActive } = body;

        const now = Date.now();
        let updatedCount = 0;
        let checkedCount = 0;

        if (checkAllActive) {
            // Fetch all active signals from database
            const snap = await adminDatabase.ref("aiSignals").get();
            if (snap.exists()) {
                const allSignals: AISignal[] = [];
                snap.forEach((child) => {
                    const signal = child.val() as AISignal;
                    allSignals.push(signal);
                });

                // Filter to active signals that need monitoring
                const activeSignals = allSignals.filter((s) => 
                    ["ACTIVE", "READY", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "PENDING_ENTRY", "ENTRY_TRIGGERED"].includes(s.status)
                ).slice(0, MAX_SIGNALS_TO_CHECK);

                for (const signal of activeSignals) {
                    const updated = await checkAndUpdateSignal(signal);
                    if (updated) updatedCount++;
                    checkedCount++;
                }
            }
        } else if (signalIds && Array.isArray(signalIds)) {
            for (const signalId of signalIds) {
                const signalSnap = await adminDatabase.ref(`aiSignals/${signalId}`).get();
                if (signalSnap.exists()) {
                    const signal = signalSnap.val() as AISignal;
                    const updated = await checkAndUpdateSignal(signal);
                    if (updated) updatedCount++;
                    checkedCount++;
                }
            }
        }

        // Also check Pro signals
        const proSnap = await adminDatabase.ref("telegramSignals").get();
        if (proSnap.exists()) {
            const proData = proSnap.val();
            for (const userId of Object.keys(proData)) {
                for (const signalId of Object.keys(proData[userId])) {
                    if (checkedCount >= MAX_SIGNALS_TO_CHECK) break;
                    const signal = proData[userId][signalId];
                    const updated = await checkAndUpdateProSignal(userId, signal);
                    if (updated) updatedCount++;
                    checkedCount++;
                }
            }
        }

        return NextResponse.json({
            success: true,
            checked: checkedCount,
            updated: updatedCount,
            timestamp: now,
        });
    } catch (err) {
        console.error("[POST /api/signals/auto-update]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to auto-update signals" },
            { status: 500 }
        );
    }
}

async function checkAndUpdateSignal(signal: AISignal): Promise<boolean> {
    try {
        const now = Date.now();

        function statusToEventType(status: string): SignalEvent["eventType"] {
            switch (status) {
                case "TP1_HIT": return "TP1_HIT";
                case "TP2_HIT": return "TP2_HIT";
                case "TP3_HIT": return "TP3_HIT";
                case "STOPPED": return "STOP_LOSS_HIT";
                case "ACTIVE": return "ENTRY_REACHED";
                case "COMPLETED": return "COMPLETED";
                case "CANCELLED": return "CANCELLED";
                case "EXPIRED": return "EXPIRED";
                default: return "STATUS_CHANGE";
            }
        }

        // Get current market price for the symbol
        const priceData = await fetchLatestPrice(signal.symbol);
        if (!priceData) return false;

        const currentPrice = priceData.price;
        let newStatus: SignalStatus | null = null;
        let hitTpIndex: number | null = null;
        let hitSl = false;

        const isBuy = signal.direction === "BUY";

        // Check SL hit
        if (signal.stopLoss > 0) {
            if (isBuy && currentPrice <= signal.stopLoss) {
                hitSl = true;
            } else if (!isBuy && currentPrice >= signal.stopLoss) {
                hitSl = true;
            }
        }

        // Check TP hits
        if (!hitSl) {
            if (signal.tp1 && !signal.tp1Hit) {
                if (isBuy && currentPrice >= signal.tp1) hitTpIndex = 1;
                else if (!isBuy && currentPrice <= signal.tp1) hitTpIndex = 1;
            }
            if (signal.tp2 && !signal.tp2Hit && !hitTpIndex) {
                if (isBuy && currentPrice >= signal.tp2) hitTpIndex = 2;
                else if (!isBuy && currentPrice <= signal.tp2) hitTpIndex = 2;
            }
            if (signal.tp3 && !signal.tp3Hit && !hitTpIndex) {
                if (isBuy && currentPrice >= signal.tp3) hitTpIndex = 3;
                else if (!isBuy && currentPrice <= signal.tp3) hitTpIndex = 3;
            }
        }

        // Determine new status
        if (hitSl) {
            newStatus = "STOPPED";
        } else if (hitTpIndex === 1) {
            newStatus = "TP1_HIT";
        } else if (hitTpIndex === 2) {
            newStatus = "TP2_HIT";
        } else if (hitTpIndex === 3) {
            newStatus = "TP3_HIT";
        } else if (signal.status === "READY" || signal.status === "PENDING_ENTRY") {
            // Check if entry triggered
            if (isBuy && currentPrice >= signal.entry) newStatus = "ACTIVE";
            else if (!isBuy && currentPrice <= signal.entry) newStatus = "ACTIVE";
        }

        if (newStatus && newStatus !== signal.status) {
            const updates: Partial<AISignal> = {
                status: newStatus,
                currentPrice,
                updatedAt: now,
            };

            // Track TP hits
            if (hitTpIndex === 1) updates.tp1Hit = true;
            if (hitTpIndex === 2) updates.tp2Hit = true;
            if (hitTpIndex === 3) updates.tp3Hit = true;

            // If SL hit, calculate result and mark as COMPLETED
            if (hitSl) {
                const outcome = calculateSignalResult(signal);
                updates.result = outcome.result;
                updates.resultR = outcome.resultR;
                updates.profitPoints = outcome.profitPoints;
                updates.closedAt = now;
                updates.status = "COMPLETED"; // Mark as completed when SL hit
            }
            
            // If TP3 hit (final TP), mark as COMPLETED
            if (hitTpIndex === 3) {
                const outcome = calculateSignalResult(signal);
                updates.result = outcome.result;
                updates.resultR = outcome.resultR;
                updates.profitPoints = outcome.profitPoints;
                updates.closedAt = now;
                updates.status = "COMPLETED";
            }
            
            // If TP1 or TP2 hit but not final, keep as TP_HIT status but also update result if we can calculate
            if (hitTpIndex === 1 || hitTpIndex === 2) {
                const outcome = calculateSignalResult(signal);
                if (outcome.result !== "PENDING") {
                    updates.result = outcome.result;
                    updates.resultR = outcome.resultR;
                    updates.profitPoints = outcome.profitPoints;
                }
            }

            await adminDatabase.ref(`aiSignals/${signal.id}`).update(updates);

            // Record event
            await recordSignalEvent(signal, statusToEventType(newStatus), currentPrice);

            return true;
        }

        return false;
    } catch (err) {
        console.error(`[checkAndUpdateSignal] Error for ${signal.id}:`, err);
        return false;
    }
}

async function checkAndUpdateProSignal(userId: string, signal: ProSignal): Promise<boolean> {
    try {
        // Pro signals have different status values
        const activeStatuses = ["CREATED", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP1_HIT", "BE_PROFIT_LOCK", "TP2_HIT", "TP3_HIT", "TP4_HIT", "TP5_OPEN_RUNNER"];
        if (!activeStatuses.includes(signal.status)) return false;

        const priceData = await fetchLatestPrice(signal.symbol);
        if (!priceData) return false;

        const currentPrice = priceData.price;
        let newStatus: string | null = null;
        let tpHitIndex: number | null = null;
        let hitSl = false;

        const isBuy = signal.direction === "BUY";

        // Check SL hit
        if (signal.stopLoss > 0) {
            if (isBuy && currentPrice <= signal.stopLoss) {
                hitSl = true;
            } else if (!isBuy && currentPrice >= signal.stopLoss) {
                hitSl = true;
            }
        }

        // Check TP hits
        if (!hitSl) {
            for (const tp of signal.takeProfits) {
                if (tp.type === "PRICE" && tp.price && !tp.hit) {
                    if (isBuy && currentPrice >= tp.price) {
                        tpHitIndex = tp.index;
                        break;
                    } else if (!isBuy && currentPrice <= tp.price) {
                        tpHitIndex = tp.index;
                        break;
                    }
                }
            }
        }

        if (hitSl) {
            newStatus = "STOPPED";
        } else if (tpHitIndex) {
            switch (tpHitIndex) {
                case 1: newStatus = "TP1_HIT"; break;
                case 2: newStatus = "TP2_HIT"; break;
                case 3: newStatus = "TP3_HIT"; break;
                case 4: newStatus = "TP4_HIT"; break;
                default: newStatus = "TP5_OPEN_RUNNER"; break;
            }
        } else if (signal.status === "CREATED" || signal.status === "PENDING_ENTRY") {
            if (isBuy && currentPrice >= signal.entryMin && currentPrice <= signal.entryMax) newStatus = "ENTRY_TRIGGERED";
            else if (!isBuy && currentPrice >= signal.entryMin && currentPrice <= signal.entryMax) newStatus = "ENTRY_TRIGGERED";
        }

        if (newStatus && newStatus !== signal.status) {
            const { transitionSignalState } = await import("@/features/telegram-signals/lifecycle/state-machine");
            
            const eventType: "TRIGGER_ENTRY" | "HIT_TP" | "HIT_SL" =
                hitSl ? "HIT_SL" : (
                    tpHitIndex ? "HIT_TP" : "TRIGGER_ENTRY"
                );

            const transition = transitionSignalState(signal, eventType, {
                price: currentPrice,
                tpIndex: tpHitIndex ?? undefined,
            });

            if (transition.transitioned) {
                await adminDatabase.ref(`telegramSignals/${userId}/${signal.id}`).set(transition.updatedSignal);
                return true;
            }
        }

        return false;
    } catch (err) {
        console.error(`[checkAndUpdateProSignal] Error:`, err);
        return false;
    }
}

async function fetchLatestPrice(symbol: string): Promise<{ price: number } | null> {
    try {
        // Try to get latest price from market data
        const cleanSymbol = symbol.replace("/", "") as import("@/lib/market-data/types").SupportedSymbol;
        const candles = await fetchCandles(cleanSymbol, "M1");
        if (candles && candles.length > 0) {
            return { price: candles[candles.length - 1].close };
        }
        return null;
    } catch {
        return null;
    }
}