import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { getProSignals, saveProSignal } from "@/features/telegram-signals/signals/signal-engine";
import { transitionSignalState } from "@/features/telegram-signals/lifecycle/state-machine";
import { fetchCandles } from "@/lib/market-data/normalizer";

const MAX_SIGNALS_TO_CHECK = 200;

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const { checkAllActive } = body;

        const now = Date.now();
        let updatedCount = 0;
        let checkedCount = 0;

        if (checkAllActive) {
            // Get all users with Pro signals
            const proSnap = await adminDatabase.ref("telegramSignals").get();
            if (proSnap.exists()) {
                const proData = proSnap.val();
                for (const userId of Object.keys(proData)) {
                    if (checkedCount >= MAX_SIGNALS_TO_CHECK) break;
                    const userSignals = proData[userId];
                    for (const signalId of Object.keys(userSignals)) {
                        if (checkedCount >= MAX_SIGNALS_TO_CHECK) break;
                        const signal = userSignals[signalId];
                        const updated = await checkAndUpdateProSignal(userId, signal);
                        if (updated) updatedCount++;
                        checkedCount++;
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            checked: checkedCount,
            updated: updatedCount,
            timestamp: now,
        });
    } catch (err: any) {
        console.error("[POST /api/pro-signals/auto-update]", err);
        return NextResponse.json(
            { error: err?.message || "Failed to auto-update pro signals" },
            { status: 500 }
        );
    }
}

async function checkAndUpdateProSignal(userId: string, signal: any): Promise<boolean> {
    try {
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
            let eventType: string;
            if (hitSl) eventType = "HIT_SL";
            else if (tpHitIndex) eventType = "HIT_TP";
            else eventType = "TRIGGER_ENTRY";

            const transition = transitionSignalState(signal, eventType as any, {
                price: currentPrice,
                tpIndex: tpHitIndex ?? undefined,
            });

            if (transition.transitioned) {
                await saveProSignal(userId, transition.updatedSignal);
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
        const cleanSymbol = symbol.replace("/", "") as unknown as import("@/lib/market-data/types").SupportedSymbol;
        const candles = await fetchCandles(cleanSymbol, "M1");
        if (candles && candles.length > 0) {
            return { price: candles[candles.length - 1].close };
        }
        return null;
    } catch {
        return null;
    }
}